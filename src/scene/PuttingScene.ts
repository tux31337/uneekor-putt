import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TurfMaterials } from './TurfMaterial';
import { GrassTips } from './GrassTips';
import { createBallMaterial } from './BallMaterial';
import { grassEdgeFrame, grassRootHeight, type GrassMode, type GrassInspectionView } from './grassPrototype';
import { CourseEnvironment, type EnvironmentMode } from './CourseEnvironment';
import { greenEdge, courseHeightAt } from './course';
import { reportRenderDiagnostic } from './diagnostics';
import { phaseAtTime, type PlaybackPhase } from '../core/playback';
import { AdaptiveQuality, renderProfile, type SceneDetail } from '../core/renderQuality';
import {
  heightAt, pointAtTime,
  type GreenSettings, type Trajectory, type TrajectoryPoint, type ViewSettings,
} from '../core/trajectory';

export type CameraView = 'perspective' | 'ball' | 'top' | 'surface';
export type TreeInspectionView = 'whole' | 'branches' | 'bark' | 'roots' | 'top' | 'course';
export interface SceneStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  detail: SceneDetail;
  idle?: boolean;
}
export interface SceneCallbacks {
  onReady: () => void;
  onProgress: (progress: number) => void;
  onComplete: () => void;
  onStats: (stats: SceneStats) => void;
  onError: (message: string) => void;
  onPhaseChange?: (phase: PlaybackPhase) => void;
  onPlayingChange?: (playing: boolean) => void;
  onAutoCameraChange?: (enabled: boolean) => void;
}

interface CameraPose { position: THREE.Vector3; target: THREE.Vector3; fov: number }
export interface SceneOptions { environment?: EnvironmentMode; fixedPixelRatio?: number; grass?: GrassMode }
export interface PerformanceResult {
  mode: EnvironmentMode; camera: CameraView; width: number; height: number; pixelRatio: number;
  fps: number; p95Ms: number; p99Ms: number; renderSubmissionMs: number; frames: number; seconds: number;
  drawCalls: number; triangles: number; renderer: string; userAgent: string; hidden: boolean;
}

const BALL_RADIUS = 0.02135;
const CUP_RADIUS = 0.054;
const UP = new THREE.Vector3(0, 1, 0);

/** One persistent GPU scene. React never updates ball position or camera frame by frame. */
export class PuttingScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.015, 380);
  private sun = new THREE.DirectionalLight('#fff2da', 2.55);
  private controls: OrbitControls;
  private terrain = new THREE.Group();
  private cup = new THREE.Group();
  private course: CourseEnvironment;
  private grassTips: GrassTips;
  private grassCenter = new THREE.Vector2();
  private cameraDirection = new THREE.Vector3();
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private flag: THREE.Mesh;
  private flagHome = new Float32Array();
  private trajectoryGroup = new THREE.Group();
  private markerGroup = new THREE.Group();
  private resultGroup = new THREE.Group();
  private trajectoryBounds = new THREE.Box3();
  private resizeObserver: ResizeObserver;
  private frame = 0;
  private disposed = false;
  private playing = false;
  private phase: PlaybackPhase = 'ready';
  private autoCamera = true;
  private motionPreference = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined;
  private reducedMotion = this.motionPreference?.matches ?? false;
  private readingStrength = 1;
  private lineStrength = 1;
  private resultStrength = 0;
  private elapsed = 0;
  private playbackRate = 1;
  private lastTime = 0;
  private statsStart = 0;
  private frames: number[] = [];
  private adaptiveQuality = new AdaptiveQuality();
  private detail: SceneDetail = 0;
  private interacting = false;
  private lastCameraMotion = -Infinity;
  private qualityChangedAt = 0;
  private pixelRatio = 1;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private needsRender = true;
  private lastRender = 0;
  private idleNotified = false;
  private latestStats: SceneStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, pixelRatio: 1, detail: 0 };
  private currentView: CameraView = 'ball';
  private grassInspection = false;
  private cameraTween?: { from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3; fovFrom: number; fovTo: number; start: number };
  private green: GreenSettings;
  private view: ViewSettings;
  private trajectory: Trajectory;
  private host: HTMLDivElement;
  private callbacks: SceneCallbacks;
  private turfMaterials: TurfMaterials;
  private materialsReady = false;
  private environmentReady = false;
  private environmentVersion = 0;
  private options: SceneOptions;
  private measurement?: { start: number; warmup: number; duration: number; previousFrame?: number; intervals: number[]; submissions: number[]; hidden: boolean; resolve: (result: PerformanceResult) => void; reject: (error: Error) => void };
  private renderFailed = false;
  private readyNotified = false;
  private uniforms = {
    uGrid: { value: 1 }, uHeat: { value: 0 }, uFlow: { value: 0 }, uFlowTime: { value: 0 },
    uCup: { value: new THREE.Vector2() },
    uHeightScale: { value: 0.4 },
    uSlope: { value: new THREE.Vector2() },
    uGrassBall: { value: new THREE.Vector2() },
    uGrassContactBall: { value: new THREE.Vector4() },
    uGrassEdge: { value: new THREE.Vector2() },
    uGrassEdgeTangent: { value: new THREE.Vector2() },
    uGrassPrototype: { value: 1 },
  };

  constructor(
    host: HTMLDivElement,
    green: GreenSettings,
    view: ViewSettings,
    trajectory: Trajectory,
    callbacks: SceneCallbacks,
    options: SceneOptions = {},
  ) {
    this.options = options;
    this.host = host;
    this.callbacks = callbacks;
    this.green = green;
    this.view = view;
    this.trajectory = trajectory;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      this.renderFailed = true;
      const detail = {
        program: gl.getProgramInfoLog(program),
        vertex: gl.getShaderInfoLog(vertex),
        fragment: gl.getShaderInfoLog(fragment),
        fragmentContext: shaderErrorContext(gl.getShaderSource(fragment), gl.getShaderInfoLog(fragment)),
      };
      console.error('Putting shader error', detail);
      reportRenderDiagnostic('shader-error', detail);
      this.callbacks.onError('잔디 그래픽을 표시하지 못했습니다. 그래픽 오류를 확인하고 있습니다.');
    };
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor('#d1e1df');
    this.renderer.domElement.setAttribute('aria-label', '퍼팅 그린 3D 화면. 드래그로 회전하고 두 손가락 또는 휠로 확대할 수 있습니다.');
    this.renderer.domElement.setAttribute('role', 'img');
    this.host.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    this.scene.background = new THREE.Color('#d1e1df');
    this.scene.fog = new THREE.FogExp2('#d1e1df', 0.0048);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.085;
    this.controls.minDistance = 0.25;
    this.controls.maxDistance = 90;
    this.controls.maxPolarAngle = Math.PI / 2.04;
    this.controls.minPolarAngle = 0.035;
    this.controls.enablePan = true;
    this.controls.addEventListener('change', this.onCameraChange);
    this.controls.addEventListener('start', this.cancelCameraTween);
    this.controls.addEventListener('end', this.onInteractionEnd);
    this.scene.add(this.terrain, this.cup, this.trajectoryGroup, this.markerGroup, this.resultGroup);

    this.scene.add(new THREE.HemisphereLight('#dfedf5', '#899467', 1.95));
    const sun = this.sun;
    sun.position.set(-24, 34, -12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 90 });
    sun.shadow.normalBias = 0.002;
    sun.shadow.bias = -0.000025;
    sun.shadow.radius = 1.8;
    this.scene.add(sun, sun.target);

    this.turfMaterials = new TurfMaterials(
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
      () => { this.materialsReady = true; this.invalidate(); },
      () => this.callbacks.onError('잔디 재질을 불러오지 못했습니다. 화면을 다시 열어 주세요.'),
    );
    this.course = new CourseEnvironment(this.turfMaterials, this.uniforms, green, options.environment);
    this.scene.add(this.course);
    void this.course.ready.then(() => { if (!this.disposed) { this.environmentReady = true; this.renderer.shadowMap.needsUpdate = true; this.invalidate(); } })
      .catch(error => { if (!this.disposed) this.callbacks.onError(String(error)); });
    this.grassTips = new GrassTips(this.uniforms, this.grassCenter, this.turfMaterials.canopyUniforms);
    this.setGrassMode(options.grass ?? 'prototype');
    this.scene.add(this.grassTips);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 40, 28), createBallMaterial(BALL_RADIUS));
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 0.11), createContactShadowMaterial(this.uniforms.uCup, this.uniforms.uGrassBall),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.renderOrder = 2;
    this.scene.add(this.ballShadow);

    const flagGeometry = new THREE.PlaneGeometry(0.45, 0.30, 16, 8);
    flagGeometry.translate(0.225, -0.15, 0);
    this.flagHome = new Float32Array(flagGeometry.attributes.position.array);
    this.flag = new THREE.Mesh(flagGeometry, new THREE.MeshStandardMaterial({ color: '#e65c40', roughness: 0.9, side: THREE.DoubleSide }));
    this.flag.castShadow = true;
    this.buildGreen();
    this.buildTrajectory();
    this.setView(view);
    this.moveCamera(this.presetPose('ball'), false);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.resize();
    this.callbacks.onPhaseChange?.('ready');
    this.callbacks.onPlayingChange?.(false);
    this.callbacks.onAutoCameraChange?.(true);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.motionPreference?.addEventListener('change', this.onMotionPreference);
    this.frame = requestAnimationFrame(this.animate);
  }

  private invalidate = () => { this.needsRender = true; };
  private onCameraChange = () => { this.lastCameraMotion = performance.now(); this.invalidate(); };
  private cancelCameraTween = () => { this.interacting = true; this.cameraTween = undefined; this.setAutoCamera(false); };
  private onInteractionEnd = () => { this.interacting = false; this.lastCameraMotion = performance.now(); this.invalidate(); };
  private onVisibility = () => { this.lastTime = 0; this.statsStart = 0; this.frames = []; this.adaptiveQuality.resetSamples(); this.invalidate(); };
  private onMotionPreference = (event: MediaQueryListEvent) => { this.reducedMotion = event.matches; this.invalidate(); };
  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.changePlaying(false);
    this.renderFailed = true;
    this.readyNotified = false;
    this.callbacks.onError('3D 그래픽 연결이 일시 중단되었습니다. 화면을 다시 열어 주세요.');
  };
  private onContextRestored = () => {
    this.renderFailed = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.callbacks.onError('');
    this.invalidate();
  };

  private resize = () => {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    const oldAspect = this.camera.aspect;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.applyRenderQuality(this.isMoving(performance.now()));
    this.renderer.setSize(width, height);
    reportRenderDiagnostic('viewport', { width, height, pixelRatio: this.pixelRatio });
    if (Math.abs(oldAspect - this.camera.aspect) > 0.01) {
      this.moveCamera(this.autoCamera && this.phase !== 'ready' ? this.automaticPose() : this.presetPose(this.currentView), false);
    }
    this.invalidate();
  };

  private isMoving(now: number) {
    return this.playing || this.interacting || !!this.cameraTween || now - this.lastCameraMotion < 240;
  }

  private applyRenderQuality(moving: boolean) {
    const width = this.viewportWidth, height = this.viewportHeight;
    const profile = renderProfile(this.view.quality, width, height, window.devicePixelRatio || 1, moving, this.adaptiveQuality.detail);
    if (this.options.fixedPixelRatio !== undefined) profile.pixelRatio = this.options.fixedPixelRatio;
    const changed = Math.abs(this.pixelRatio - profile.pixelRatio) > 0.001 || this.detail !== profile.detail
      || this.grassTips.near.geometry.instanceCount !== profile.grassCount;
    if (!changed) return;
    if (Math.abs(this.pixelRatio - profile.pixelRatio) > 0.001) this.renderer.setPixelRatio(profile.pixelRatio);
    this.pixelRatio = profile.pixelRatio;
    this.detail = profile.detail;
    this.course.setDetail(profile.detail);
    this.grassTips.setQuality(profile);
    this.qualityChangedAt = performance.now();
    this.frames = [];
    this.statsStart = 0;
    reportRenderDiagnostic('quality', { moving, ...profile, width, height });
    this.invalidate();
  }

  private buildGreen() {
    disposeGroup(this.terrain);
    // The flag's geometry and material live across green updates.
    this.flag.removeFromParent();
    disposeGroup(this.cup);
    this.uniforms.uSlope.value.set(this.green.crossSlope / 100, this.green.longitudinalSlope / 100);
    const edgeFrame = grassEdgeFrame(this.green);
    this.uniforms.uGrassEdge.value.copy(edgeFrame.center);
    this.uniforms.uGrassEdgeTangent.value.copy(edgeFrame.tangent);
    this.course.update(this.green);
    const makeSurface = (expand: number, surface: 'green' | 'fringe' | 'rough', innerExpand?: number) => {
      const isGreen = surface === 'green';
      const rings = isGreen ? 40 : 8;
      const slices = 128;
      const positions: number[] = [];
      const uvs: number[] = [];
      const surfaceBlends: number[] = [];
      const indices: number[] = [];
      for (let r = 0; r <= rings; r++) {
        for (let s = 0; s <= slices; s++) {
          const theta = s / slices * Math.PI * 2;
          const radial = r / rings;
          const band = innerExpand === undefined ? expand : innerExpand + (expand - innerExpand) * radial;
          const radius = innerExpand === undefined ? radial : 1;
          const edge = greenEdge(theta, this.green, band);
          const x = edge.x * radius;
          const z = this.green.distance / 2 + (edge.z - this.green.distance / 2) * radius;
          const blend = THREE.MathUtils.smoothstep(band, 0, 1.6);
          const y = THREE.MathUtils.lerp(heightAt(x, z, this.green), courseHeightAt(x, z, this.green), blend);
          positions.push(x, y, z);
          // Fine cut on the green; visibly longer blades in the fringe and rough.
          const tile = isGreen ? 0.24 : surface === 'fringe' ? 0.52 : 1.3;
          uvs.push(x / tile, z / tile);
          surfaceBlends.push(radial);
          if (r < rings && s < slices) {
            const a = r * (slices + 1) + s;
            const b = a + slices + 1;
            indices.push(a, a + 1, b, a + 1, b + 1, b);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('surfaceBlend', new THREE.Float32BufferAttribute(surfaceBlends, 1));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const material = this.turfMaterials.create(surface, this.uniforms, CUP_RADIUS);
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = surface === 'green' ? 'putting-surface' : `green-${surface}`;
      mesh.receiveShadow = true;
      this.terrain.add(mesh);
    };
    makeSurface(1.6, 'rough', 0.5);
    makeSurface(0.5, 'fringe', 0);
    makeSurface(0, 'green');
    this.grassTips.updateGreen(this.green, this.terrain.children);

    this.uniforms.uCup.value.set(0, this.green.distance);
    this.uniforms.uHeightScale.value = Math.max(0.15, (Math.abs(this.green.crossSlope) * 10 + Math.abs(this.green.longitudinalSlope) * this.green.distance) / 100);

    const cupY = heightAt(0, this.green.distance, this.green);
    const cupNormal = new THREE.Vector3(-this.green.crossSlope / 100, 1, -this.green.longitudinalSlope / 100).normalize();
    const sleeveGeometry = new THREE.CylinderGeometry(CUP_RADIUS, CUP_RADIUS * 0.94, 0.16, 48, 6, true);
    const sleeveColors: number[] = [];
    const sleevePositions = sleeveGeometry.attributes.position;
    for (let i = 0; i < sleevePositions.count; i++) {
      const light = THREE.MathUtils.smoothstep(sleevePositions.getY(i), -0.08, 0.08);
      const color = new THREE.Color('#18251b').lerp(new THREE.Color('#bbbba2'), light * light);
      sleeveColors.push(color.r, color.g, color.b);
    }
    sleeveGeometry.setAttribute('color', new THREE.Float32BufferAttribute(sleeveColors, 3));
    const sleeve = new THREE.Mesh(sleeveGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, side: THREE.DoubleSide }));
    sleeve.quaternion.setFromUnitVectors(UP, cupNormal);
    sleeve.position.copy(cupNormal).multiplyScalar(-0.08);
    sleeve.receiveShadow = true;
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(CUP_RADIUS, 40), new THREE.MeshBasicMaterial({ color: '#122017' }));
    bottom.quaternion.setFromUnitVectors(UP, cupNormal);
    bottom.rotateX(-Math.PI / 2);
    bottom.position.copy(cupNormal).multiplyScalar(-0.155);
    const lip = new THREE.Mesh(new THREE.RingGeometry(CUP_RADIUS, CUP_RADIUS + 0.003, 64), new THREE.MeshStandardMaterial({ color: '#b8b99c', roughness: 0.94, side: THREE.DoubleSide }));
    lip.quaternion.setFromUnitVectors(UP, cupNormal);
    lip.rotateX(-Math.PI / 2);
    lip.position.copy(cupNormal).multiplyScalar(0.0002);
    lip.receiveShadow = true;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 1.8, 12), new THREE.MeshStandardMaterial({ color: '#f7f4e5', roughness: 0.5 }));
    pole.position.y = 0.9;
    pole.castShadow = true;
    this.flag.position.set(0, 1.76, 0);
    this.cup.position.set(0, cupY, this.green.distance);
    this.cup.quaternion.identity();
    this.cup.add(sleeve, bottom, lip, pole, this.flag);
    // Include the one-tree specimen and the putting plane in the same solar shadow map.
    const shadowSpan = Math.max(25, this.green.distance * 0.75 + 4);
    this.sun.target.position.set(-5.5, cupY * 0.5 + 3, (this.green.distance * 0.5 + 27) * 0.5);
    this.sun.position.copy(this.sun.target.position).add(new THREE.Vector3(-24, 34, -12));
    Object.assign(this.sun.shadow.camera, { left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
    this.updateBall();
    this.invalidate();
  }

  private toPosition = (point: TrajectoryPoint, lift = 0.007): THREE.Vector3 => {
    return new THREE.Vector3(point.x, (point.y ?? heightAt(point.x, point.z, this.green)) + lift, point.z);
  };

  private buildTrajectory() {
    disposeGroup(this.trajectoryGroup);
    disposeGroup(this.markerGroup);
    disposeGroup(this.resultGroup);
    const points = this.trajectory.points.map(p => this.toPosition(p));
    this.trajectoryBounds.setFromPoints(points);
    if (points.length < 2) return;
    // Linear curve: preserve the supplied path, without inventing a different putting line.
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < points.length; i++) path.add(new THREE.LineCurve3(points[i - 1], points[i]));
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(path, Math.min(1000, Math.max(128, points.length * 4)), 0.0035, 5, false),
      new THREE.MeshBasicMaterial({ color: '#f2f7dc', transparent: true, opacity: 0.76, depthWrite: false }),
    );
    tube.renderOrder = 3;
    this.trajectoryGroup.add(tube);
    const dotGeo = new THREE.SphereGeometry(0.006, 8, 6);
    const dotMat = new THREE.MeshBasicMaterial({ color: '#eff8cc', transparent: true, depthWrite: false });
    const dots = new THREE.InstancedMesh(dotGeo, dotMat, 15);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 15; i++) {
      dummy.position.copy(path.getPoint((i + 1) / 16));
      dummy.updateMatrix();
      dots.setMatrixAt(i, dummy.matrix);
    }
    this.trajectoryGroup.add(dots);
    this.trajectoryGroup.visible = this.view.trajectory;

    const aim = new THREE.BufferGeometry().setFromPoints([this.toPosition(this.trajectory.points[0], 0.009), new THREE.Vector3(0, heightAt(0, this.green.distance, this.green) + 0.009, this.green.distance)]);
    const direct = new THREE.Line(aim, new THREE.LineDashedMaterial({ color: '#e0ebce', dashSize: 0.08, gapSize: 0.1, transparent: true, opacity: 0.3 }));
    direct.computeLineDistances();
    this.markerGroup.add(direct);
    const start = this.trajectory.points[0];
    const startRing = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.135, 48), new THREE.MeshBasicMaterial({ color: '#edf4cb', transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    startRing.rotation.x = -Math.PI / 2;
    startRing.position.copy(this.toPosition(start, 0.008));
    this.markerGroup.add(startRing);
    const normal = new THREE.Vector3(-this.green.crossSlope / 100, 1, -this.green.longitudinalSlope / 100).normalize();
    const ringAt = (point: TrajectoryPoint, inner: number, outer: number, opacity: number) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 64), new THREE.MeshBasicMaterial({
        color: '#f0f6d8', transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
      }));
      ring.quaternion.setFromUnitVectors(UP, normal);
      ring.rotateX(-Math.PI / 2);
      ring.position.copy(this.toPosition(point, 0.01));
      return ring;
    };
    const hole = { x: 0, z: this.green.distance };
    this.markerGroup.add(ringAt(hole, 0.36, 0.37, 0.45));
    const end = this.trajectory.points.at(-1)!;
    this.resultGroup.add(ringAt(this.trajectory.outcome === 'holed' ? hole : end, 0.16, 0.175, 0.88));
    if (this.trajectory.outcome === 'stopped' && Math.hypot(end.x, end.z - this.green.distance) > 0.12) {
      const connector = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([this.toPosition(end, 0.012), this.toPosition(hole, 0.012)]),
        new THREE.LineDashedMaterial({ color: '#f0f6d8', dashSize: 0.06, gapSize: 0.055, transparent: true, opacity: 0.62, depthWrite: false }),
      );
      connector.computeLineDistances();
      this.resultGroup.add(connector, ringAt(hole, 0.11, 0.12, 0.55));
    }
    this.updatePresentation(true);
    this.updateBall();
    this.invalidate();
  }

  setGreen(green: GreenSettings) {
    const geometryChanged = green.distance !== this.green.distance || green.crossSlope !== this.green.crossSlope || green.longitudinalSlope !== this.green.longitudinalSlope;
    this.green = green;
    if (geometryChanged) {
      this.buildGreen(); this.buildTrajectory();
      this.moveCamera(this.autoCamera && this.phase !== 'ready' ? this.automaticPose() : this.presetPose(this.currentView), false);
    }
  }

  setTrajectory(trajectory: Trajectory) {
    this.trajectory = trajectory;
    this.elapsed = 0;
    this.changePlaying(false);
    this.changePhase('ready');
    this.buildTrajectory();
    this.callbacks.onProgress(0);
    if (this.autoCamera) this.moveCamera(this.presetPose('ball'), false);
  }

  setView(view: ViewSettings) {
    if (view.quality !== this.view.quality) this.adaptiveQuality.resetSamples();
    this.view = view;
    this.updatePresentation(true);
    this.resize();
    this.invalidate();
  }

  setCamera(view: CameraView, animate = true) {
    this.setAutoCamera(false);
    this.currentView = view;
    this.updatePresentation(true);
    this.moveCamera(this.presetPose(view), animate);
  }

  setAutoCamera(enabled: boolean, animate = true) {
    if (this.autoCamera !== enabled) {
      this.autoCamera = enabled;
      this.callbacks.onAutoCameraChange?.(enabled);
    }
    if (enabled) {
      this.currentView = 'ball';
      this.moveCamera(this.phase === 'ready' ? this.presetPose('ball') : this.automaticPose(), animate);
    }
    this.updatePresentation(true);
    this.invalidate();
  }

  private presetPose(view: CameraView): CameraPose {
    const aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight);
    const scale = Math.max(1, (this.green.distance + 6) / 12) * Math.max(1, 1 / Math.max(0.5, aspect));
    const centre = this.green.distance / 2;
    const target = new THREE.Vector3(0, heightAt(0, centre, this.green), centre);
    let destination: THREE.Vector3;
    let fov = aspect < 0.85 ? 48 : 42;
    if (view === 'top') destination = new THREE.Vector3(0, heightAt(0, centre, this.green) + 25 * scale, centre - 0.01);
    else if (view === 'ball') {
      if (aspect < 0.85) {
        const ball = this.toPosition(this.trajectory.points[0], BALL_RADIUS);
        const hole = this.toPosition({ x: 0, z: this.green.distance }, 0);
        const points = [ball, hole, hole.clone().add(new THREE.Vector3(0, 1.83, 0)), hole.clone().add(new THREE.Vector3(0.49, 1.83, 0))];
        const target = ball.clone().lerp(hole, 0.61).add(new THREE.Vector3(0, 0.15, 0));
        return fitShot(points, target, new THREE.Vector3(0.025, 0.14, -1).normalize(), 40, aspect, 0.76, 0.72);
      }
      destination = new THREE.Vector3(0.12, heightAt(0.12, -3.4, this.green) + 1.22, -3.4);
      target.set(0, heightAt(0, this.green.distance * 0.78, this.green) + 0.16, this.green.distance * 0.78);
    } else if (view === 'surface') {
      fov = 48;
      // Step back on a short putt so the full flag still fits above the close-cut turf.
      const setback = -Math.max(0.55, 4.8 - this.green.distance);
      destination = new THREE.Vector3(0.08, heightAt(0.08, setback, this.green) + 0.13, setback);
      target.set(0, heightAt(0, 0.9, this.green) + 0.035, 0.9);
    } else destination = new THREE.Vector3(11.8 * scale, heightAt(11.8 * scale, centre - 14.4 * scale, this.green) + 10.2 * scale, centre - 14.4 * scale);
    return { position: destination, target, fov };
  }

  /** Fit the supplied ball position, cup and full flag into a safe area of the viewport. */
  private automaticPose(): CameraPose {
    const point = pointAtTime(this.trajectory, this.elapsed);
    const ball = this.toPosition(point, BALL_RADIUS);
    const hole = this.toPosition({ x: 0, z: this.green.distance }, 0);
    const forward = hole.clone().sub(this.toPosition(this.trajectory.points[0]));
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, 1);
    forward.normalize();
    const side = new THREE.Vector3(forward.z, 0, -forward.x);
    const offset = forward.clone().negate().addScaledVector(side, this.phase === 'result' ? 0.46 : 0.27);
    const portrait = this.camera.aspect < 0.85;
    offset.y = this.phase === 'result' ? (portrait ? 0.5 : 0.64) : portrait ? 0.28 : 0.5;
    offset.normalize();
    const points = [
      ball.clone().add(new THREE.Vector3(0.09, 0.07, 0)), ball.clone().add(new THREE.Vector3(-0.09, 0, 0)),
      hole, hole.clone().add(new THREE.Vector3(-0.08, 1.83, 0)), hole.clone().add(new THREE.Vector3(0.49, 1.83, 0)),
    ];
    let target = ball.clone().lerp(hole, 0.52).add(new THREE.Vector3(0, 0.24, 0));
    if (this.reducedMotion && this.phase === 'rolling') {
      // A static overview respects reduced motion while keeping the complete input path in view.
      points.splice(0, 2);
      for (const x of [this.trajectoryBounds.min.x, this.trajectoryBounds.max.x]) {
        for (const y of [this.trajectoryBounds.min.y, this.trajectoryBounds.max.y]) {
          for (const z of [this.trajectoryBounds.min.z, this.trajectoryBounds.max.z]) points.push(new THREE.Vector3(x, y + BALL_RADIUS, z));
        }
      }
      target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    }
    return fitShot(points, target, offset, portrait ? 40 : 42, this.camera.aspect, 0.74, 0.70,
      this.phase === 'result' ? 0.43 : 0.70);
  }

  private moveCamera(pose: CameraPose, animate: boolean) {
    this.cameraTween = undefined;
    if (animate && !this.reducedMotion) this.cameraTween = { from: this.camera.position.clone(), to: pose.position, targetFrom: this.controls.target.clone(), targetTo: pose.target, fovFrom: this.camera.fov, fovTo: pose.fov, start: performance.now() };
    else {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(pose.position);
      this.controls.target.copy(pose.target);
      this.controls.update();
    }
    this.invalidate();
  }

  /** Start/resume the supplied shot with the ball visible, including from tree inspection. */
  rollBall() {
    this.grassInspection = false;
    this.controls.minDistance = 0.25;
    if (this.course.setInspectionRotation(0)) this.renderer.shadowMap.needsUpdate = true;
    this.setAutoCamera(true, false);
    this.play();
  }

  play() {
    const restarting = this.elapsed >= this.trajectory.duration;
    if (restarting) { this.elapsed = 0; this.updateBall(); this.callbacks.onProgress(0); }
    this.changePhase('rolling');
    this.changePlaying(true);
    if (this.autoCamera) {
      this.cameraTween = undefined;
      if (restarting || this.reducedMotion) this.moveCamera(this.automaticPose(), false);
    }
    this.lastTime = 0;
    this.invalidate();
  }
  pause() { this.changePlaying(false); }
  seek(progress: number) {
    this.changePlaying(false);
    this.elapsed = Math.max(0, Math.min(1, progress)) * this.trajectory.duration;
    this.changePhase(phaseAtTime(this.elapsed, this.trajectory.duration));
    this.updateBall();
    this.updatePresentation(true);
    if (this.autoCamera) this.moveCamera(this.phase === 'ready' ? this.presetPose('ball') : this.automaticPose(), false);
    this.callbacks.onProgress(this.elapsed / this.trajectory.duration);
    this.invalidate();
  }
  setRate(rate: number) { this.playbackRate = rate; }

  /** Swap complete environments, keeping the shot, camera, lighting and putting plane. */
  async setEnvironment(mode: EnvironmentMode) {
    if (this.course.mode === mode) { await this.course.ready; return; }
    const version = ++this.environmentVersion;
    const replacement = new CourseEnvironment(this.turfMaterials, this.uniforms, this.green, mode);
    try { await replacement.ready; }
    catch (error) { replacement.dispose(); throw error; }
    if (this.disposed || version !== this.environmentVersion) { replacement.dispose(); return; }
    replacement.update(this.green); replacement.setDetail(this.detail);
    this.scene.remove(this.course); this.course.dispose(); this.course = replacement; this.scene.add(replacement);
    this.renderer.shadowMap.needsUpdate = true; this.invalidate();
  }

  getReviewState() {
    this.camera.updateMatrixWorld();
    const gl = this.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { ...this.course.getDiagnostics(), grass: this.grassTips.getDiagnostics(), width: this.viewportWidth, height: this.viewportHeight, pixelRatio: this.pixelRatio,
      camera: this.currentView, cameraMatrix: this.camera.matrixWorld.toArray(), projectionMatrix: this.camera.projectionMatrix.toArray(),
      ball: this.ball.position.toArray(), elapsed: this.elapsed, green: { ...this.green },
      drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
      renderer: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) };
  }

  setReviewOrbit(view: CameraView, radians: number, focusTree = false) {
    this.setAutoCamera(false, false); this.currentView = view; this.cameraTween = undefined;
    const pose = this.presetPose(view);
    if (focusTree) {
      const anchor = this.course.placements.near[0];
      pose.target.set(anchor.x, courseHeightAt(anchor.x, anchor.z, this.green) + 4.8, anchor.z);
      const offset = view === 'top' ? new THREE.Vector3(0, 23, -0.01)
        : view === 'ball' ? new THREE.Vector3(0, 1.5, -22) : new THREE.Vector3(12, 12, -17);
      // This auxiliary camera checks foliage from above; primary shot presets stay unchanged.
      if (this.camera.aspect < 0.85) offset.multiplyScalar(1.4);
      pose.position.copy(pose.target).add(offset); pose.fov = 42;
    }
    pose.position.sub(pose.target).applyAxisAngle(UP, radians).add(pose.target);
    this.moveCamera(pose, false); this.lastCameraMotion = performance.now(); this.invalidate();
  }

  captureFrame(): Promise<Blob> {
    this.course.faceCamera(this.camera); this.renderer.render(this.scene, this.camera);
    return new Promise((resolve, reject) => this.renderer.domElement.toBlob(blob => blob ? resolve(blob) : reject(new Error('화면을 저장하지 못했습니다.')), 'image/png'));
  }

  getCanvas() { return this.renderer.domElement; }

  setGrassMode(mode: GrassMode) {
    this.uniforms.uGrassPrototype.value = mode === 'prototype' ? 1 : 0;
    this.grassTips.setMode(mode);
    this.invalidate();
  }

  /** Inspection cameras share exact poses between grass variants; shot presets stay unchanged. */
  setGrassInspection(view: GrassInspectionView) {
    this.grassInspection = true;
    this.controls.minDistance = view === 'macro' || view === 'edge-macro' ? 0.055 : 0.25;
    this.setAutoCamera(false, false); this.cameraTween = undefined;
    if (view === 'ball' || view === 'course') { this.setCamera(view === 'ball' ? 'surface' : 'perspective', false); return; }
    this.currentView = 'surface';
    let target: THREE.Vector3, offset: THREE.Vector3;
    if (view === 'macro') {
      target = new THREE.Vector3(this.ball.position.x, heightAt(this.ball.position.x, this.ball.position.z, this.green) + 0.008, this.ball.position.z);
      offset = new THREE.Vector3(0.07, 0.04, -0.11);
    } else {
      const edge = grassEdgeFrame(this.green).center;
      target = new THREE.Vector3(edge.x, grassRootHeight(edge.x, edge.y, 0.28, this.green), edge.y);
      offset = view === 'edge-macro' ? new THREE.Vector3(-0.16, 0.085, -0.21) : new THREE.Vector3(-0.9, 0.38, -1.1);
    }
    if (this.camera.aspect < 0.85) offset.multiplyScalar(1.35);
    this.moveCamera({ position: target.clone().add(offset), target, fov: 44 }, false);
    this.lastCameraMotion = performance.now(); this.invalidate();
  }

  /** Auxiliary inspection only: identical framing for the old and external tree. */
  setTreeInspection(view: TreeInspectionView, radians = 0) {
    // A fixed-camera turntable avoids other course trees occluding the specimen.
    if (this.course.setInspectionRotation(view === 'course' ? 0 : radians)) this.renderer.shadowMap.needsUpdate = true;
    this.setAutoCamera(false, false); this.cameraTween = undefined;
    const anchor = this.course.placements.near[0];
    const floor = courseHeightAt(anchor.x, anchor.z, this.green);
    const portrait = this.camera.aspect < 0.85;
    if (view === 'course') {
      const target = new THREE.Vector3(-4, 3, 13);
      const offset = new THREE.Vector3(26, 16, -31).multiplyScalar(portrait ? 1.55 : 1);
      this.moveCamera({ position: target.clone().add(offset), target, fov: 48 }, false);
      this.lastCameraMotion = performance.now(); this.invalidate(); return;
    }
    const target = new THREE.Vector3(anchor.x, floor, anchor.z);
    let offset: THREE.Vector3;
    let fov = 38;
    if (view === 'whole') {
      target.y += 5.1;
      offset = new THREE.Vector3(0, 1.3, portrait ? -31 : -19);
    } else if (view === 'top') {
      target.y += 4;
      offset = new THREE.Vector3(0, portrait ? 32 : 25, -0.01);
      fov = 42;
    } else if (view === 'branches') {
      target.y += 4.6;
      offset = new THREE.Vector3(0, 0.3, portrait ? -10 : -7.5);
    } else if (view === 'bark') {
      target.y += 1.7;
      offset = new THREE.Vector3(0, 0.1, -3);
    } else {
      target.y += 0.18;
      offset = new THREE.Vector3(0, 0.8, -2.8);
    }
    this.moveCamera({ position: target.clone().add(offset), target, fov }, false);
    this.lastCameraMotion = performance.now(); this.invalidate();
  }

  /** Real rAF playback samples only; no gl.finish, resolution changes or idle samples. */
  measurePlayback(duration = 6000, warmup = 1500): Promise<PerformanceResult> {
    if (this.measurement) return Promise.reject(new Error('이미 측정 중입니다.'));
    if (!this.environmentReady || !this.materialsReady) return Promise.reject(new Error('자산을 불러온 뒤 측정해 주세요.'));
    this.seek(0); this.play();
    return new Promise((resolve, reject) => { this.measurement = { start: performance.now(), warmup, duration, intervals: [], submissions: [], hidden: document.hidden, resolve, reject }; });
  }

  private changePhase(phase: PlaybackPhase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.callbacks.onPhaseChange?.(phase);
    this.invalidate();
  }

  private changePlaying(playing: boolean) {
    if (this.playing === playing) return;
    this.playing = playing;
    this.frames = [];
    this.statsStart = 0;
    this.invalidate();
    this.callbacks.onPlayingChange?.(playing);
  }

  private updatePresentation(snap = false, delta = 1 / 60) {
    const alpha = snap || this.reducedMotion ? 1 : 1 - Math.exp(-9 * delta);
    const targets = { readingStrength: this.phase === 'ready' ? 1 : 0,
      lineStrength: this.phase === 'ready' ? 1 : this.phase === 'rolling' ? 0.12 : 0.55,
      resultStrength: this.phase === 'result' ? 1 : 0 };
    for (const key of ['readingStrength', 'lineStrength', 'resultStrength'] as const) {
      const gap = targets[key] - this[key];
      this[key] = Math.abs(gap) < 0.001 ? targets[key] : this[key] + gap * alpha;
      if (Math.abs(gap) >= 0.001) this.needsRender = true;
    }
    this.uniforms.uGrid.value = this.view.grid ? this.readingStrength : 0;
    this.uniforms.uFlow.value = this.view.flow ? this.readingStrength : 0;
    this.uniforms.uHeat.value = this.view.heatmap ? this.readingStrength : 0;
    setGroupOpacity(this.markerGroup, this.grassInspection ? 0 : this.readingStrength);
    setGroupOpacity(this.trajectoryGroup, this.view.trajectory ? this.lineStrength : 0);
    setGroupOpacity(this.resultGroup, this.resultStrength);
    this.grassTips.visible = this.uniforms.uHeat.value < 0.01 && (this.autoCamera || this.currentView === 'ball' || this.currentView === 'surface');
  }

  private updateBall() {
    const p = pointAtTime(this.trajectory, this.elapsed);
    const previous = this.ball.position.clone();
    this.ball.position.copy(this.toPosition(p, BALL_RADIUS));
    this.uniforms.uGrassBall.value.set(this.ball.position.x, this.ball.position.z);
    if (this.elapsed === 0) this.ball.quaternion.identity();
    if (this.elapsed > 0 && this.elapsed < this.trajectory.duration) {
      const movement = this.ball.position.clone().sub(previous);
      const axis = new THREE.Vector3().crossVectors(UP, movement).normalize();
      if (movement.lengthSq() < 1) this.ball.rotateOnWorldAxis(axis, movement.length() / BALL_RADIUS);
    }
    // Supplied heights already describe the provider's motion, including any drop into the cup.
    const nearCup = Math.hypot(p.x, p.z - this.green.distance) < CUP_RADIUS * 1.4;
    const sink = this.trajectory.outcome === 'holed' && p.y === undefined && nearCup
      ? THREE.MathUtils.smoothstep(this.elapsed / this.trajectory.duration, 0.985, 1) : 0;
    this.ball.position.y -= sink * 0.15;
    this.ball.visible = sink < 0.98;
    const groundY = heightAt(p.x, p.z, this.green);
    const lift = Math.max(0, this.ball.position.y - BALL_RADIUS - groundY);
    this.uniforms.uGrassContactBall.value.set(this.ball.position.x, this.ball.position.y, this.ball.position.z,
      this.ball.visible && lift < 0.007 ? BALL_RADIUS : 0);
    this.ballShadow.position.set(p.x + 0.018, groundY + 0.0018, p.z + 0.009);
    this.ballShadow.position.y += this.green.crossSlope / 100 * 0.018 + this.green.longitudinalSlope / 100 * 0.009;
    this.ballShadow.scale.setScalar(1 + Math.min(1.2, lift * 4));
    (this.ballShadow.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.68 / (1 + lift * 8);
    (this.ballShadow.material as THREE.ShaderMaterial).uniforms.uContact.value = 1 - THREE.MathUtils.smoothstep(lift, 0.001, 0.007);
    this.ballShadow.quaternion.setFromUnitVectors(UP, new THREE.Vector3(-this.green.crossSlope / 100, 1, -this.green.longitudinalSlope / 100).normalize());
    this.ballShadow.rotateX(-Math.PI / 2);
    this.ballShadow.visible = this.ball.visible;
    this.renderer.shadowMap.needsUpdate = true;
  }

  private animate = (now: number) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    if (document.hidden) {
      if (this.measurement) { this.measurement.reject(new Error('탭이 숨겨져 측정을 중단했습니다.')); this.measurement = undefined; this.pause(); }
      return;
    }
    const measuredFrameMs = this.measurement?.previousFrame === undefined ? 0 : now - this.measurement.previousFrame;
    if (this.measurement) this.measurement.previousFrame = now;
    if (this.measurement && !this.playing) { this.seek(0); this.play(); }
    const clockDelta = this.lastTime ? Math.max(0, (now - this.lastTime) / 1000) : 0;
    const delta = Math.min(0.1, clockDelta);
    this.lastTime = now;
    this.controls.update();
    if (this.cameraTween) {
      const t = Math.min(1, (now - this.cameraTween.start) / 650);
      const ease = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(this.cameraTween.from, this.cameraTween.to, ease);
      this.controls.target.lerpVectors(this.cameraTween.targetFrom, this.cameraTween.targetTo, ease);
      this.camera.fov = THREE.MathUtils.lerp(this.cameraTween.fovFrom, this.cameraTween.fovTo, ease);
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this.needsRender = true;
      if (t === 1) this.cameraTween = undefined;
    }
    if (this.playing) {
      const previousElapsed = this.elapsed;
      // Camera easing is bounded; the trajectory clock still follows the full elapsed time.
      this.elapsed = Math.min(this.trajectory.duration, this.elapsed + clockDelta * this.playbackRate);
      this.updateBall();
      this.needsRender = true;
      // UI is throttled to 10 Hz; all animation remains in this render loop.
      if (Math.floor(this.elapsed * 10) !== Math.floor(previousElapsed * 10)) this.callbacks.onProgress(this.elapsed / this.trajectory.duration);
      if (this.elapsed >= this.trajectory.duration) {
        this.changePlaying(false); this.changePhase('result'); this.callbacks.onProgress(1); this.callbacks.onComplete();
      }
    }
    if (this.autoCamera && this.phase !== 'ready' && !this.cameraTween) {
      const pose = this.automaticPose();
      const unsettled = this.camera.position.distanceToSquared(pose.position) + this.controls.target.distanceToSquared(pose.target)
        + Math.abs(this.camera.fov - pose.fov) > 0.000001;
      if (unsettled) {
        const alpha = this.reducedMotion ? 1 : 1 - Math.exp(-5 * Math.max(delta, 1 / 120));
        this.camera.position.lerp(pose.position, alpha);
        this.controls.target.lerp(pose.target, alpha);
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, pose.fov, alpha);
        this.camera.updateProjectionMatrix();
        this.controls.update();
        this.needsRender = true;
      }
    }
    this.updatePresentation(false, Math.max(delta, 1 / 120));
    const flowActive = this.view.flow && this.phase === 'ready' && !this.reducedMotion
      && (Math.abs(this.green.crossSlope) >= 0.05 || Math.abs(this.green.longitudinalSlope) >= 0.05);
    if (flowActive) {
      this.uniforms.uFlowTime.value += delta;
      if (now - this.lastRender >= 1000 / 30) this.needsRender = true;
    }
    this.camera.getWorldDirection(this.cameraDirection);
    this.grassCenter.set(this.camera.position.x + this.cameraDirection.x * 2.2, this.camera.position.z + this.cameraDirection.z * 2.2);
    const moving = this.isMoving(now);
    this.applyRenderQuality(moving);
    if (!this.needsRender) {
      if (!this.idleNotified && now - this.lastRender > 350) {
        this.idleNotified = true;
        this.callbacks.onStats({ ...this.latestStats, idle: true });
      }
      this.frames = [];
      this.statsStart = 0;
      return;
    }
    // Reading flow redraws at most 30 fps; hidden, flat and reduced-motion views can stay idle.
    if (this.playing || this.cameraTween) {
      const flagPositions = this.flag.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < flagPositions.count; i++) {
        const x = this.flagHome[i * 3];
        flagPositions.setZ(i, Math.sin(now * 0.0024 - x * 11) * 0.035 * x / 0.45);
      }
      flagPositions.needsUpdate = true;
    }
    this.course.faceCamera(this.camera);
    const submissionStart = performance.now();
    this.renderer.render(this.scene, this.camera);
    if (this.measurement && now - this.measurement.start >= this.measurement.warmup) {
      const measure = this.measurement;
      if (measuredFrameMs > 0 && now - measuredFrameMs - measure.start >= measure.warmup) measure.intervals.push(measuredFrameMs);
      measure.submissions.push(performance.now() - submissionStart);
      if (now - measure.start >= measure.warmup + measure.duration) {
        const sorted = measure.intervals.slice().sort((a, b) => a - b);
        const average = measure.intervals.reduce((sum, interval) => sum + interval, 0) / Math.max(1, measure.intervals.length);
        const state = this.getReviewState();
        this.measurement = undefined;
        measure.resolve({ mode: this.course.mode, camera: this.currentView, width: this.viewportWidth, height: this.viewportHeight, pixelRatio: this.pixelRatio,
          fps: Number((1000 / average).toFixed(2)), p95Ms: Number((sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(2)),
          p99Ms: Number((sorted[Math.floor(sorted.length * 0.99)] || 0).toFixed(2)),
          renderSubmissionMs: Number((measure.submissions.reduce((a, b) => a + b, 0) / measure.submissions.length).toFixed(2)),
          frames: sorted.length, seconds: Number((measure.intervals.reduce((a, b) => a + b, 0) / 1000).toFixed(3)),
          drawCalls: state.drawCalls, triangles: state.triangles, renderer: state.renderer, userAgent: navigator.userAgent, hidden: measure.hidden });
      }
    }
    if (this.materialsReady && this.environmentReady && !this.renderFailed && !this.readyNotified) {
      this.readyNotified = true;
      reportRenderDiagnostic('frame-ready', {
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      });
      this.callbacks.onReady();
    }
    this.needsRender = false;
    this.lastRender = now;
    this.idleNotified = false;
    this.latestStats = { ...this.latestStats, drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, pixelRatio: this.pixelRatio, detail: this.detail, idle: false };
    // Idle gaps, shader warm-up and quality reallocations are not sustained frame-time samples.
    if (moving && clockDelta > 0 && now - this.qualityChangedAt > 350) this.frames.push(clockDelta * 1000);
    if (!this.statsStart) this.statsStart = now;
    if (now - this.statsStart > 800 && this.frames.length >= 4) {
      const sorted = this.frames.slice().sort((a, b) => a - b);
      const average = this.frames.reduce((sum, n) => sum + n, 0) / this.frames.length;
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      this.latestStats = { ...this.latestStats, fps: Math.round(1000 / average), frameMs: Number(p95.toFixed(1)) };
      this.callbacks.onStats(this.latestStats);
      if (moving && this.view.quality === 'auto' && !this.measurement && !this.cameraTween && this.adaptiveQuality.observe(average, p95)) this.applyRenderQuality(true);
      this.frames = [];
      this.statsStart = now;
    }
  };

  dispose() {
    this.disposed = true;
    this.measurement?.reject(new Error('측정 화면을 닫았습니다.')); this.measurement = undefined;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.motionPreference?.removeEventListener('change', this.onMotionPreference);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.controls.dispose();
    this.sun.shadow.dispose();
    this.course.dispose();
    this.scene.remove(this.course);
    disposeGroup(this.scene);
    this.turfMaterials.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function shaderErrorContext(source: string | null, log: string | null) {
  const match = /ERROR:\s*\d+:(\d+)/.exec(log ?? '');
  if (!source || !match) return '';
  const line = Number(match[1]);
  return source.split('\n').slice(Math.max(0, line - 5), line + 4).map((text, index) => `${Math.max(1, line - 4) + index}: ${text}`).join('\n');
}

function fitShot(
  points: THREE.Vector3[], target: THREE.Vector3, offset: THREE.Vector3, fov: number,
  aspect: number, safeX: number, safeTop: number, safeBottom = safeTop,
): CameraPose {
  const tanY = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const right = new THREE.Vector3().crossVectors(UP, offset).normalize();
  const up = new THREE.Vector3().crossVectors(offset, right).normalize();
  let distance = 2.2;
  for (const point of points) {
    const relative = point.clone().sub(target);
    const depth = relative.dot(offset), y = relative.dot(up);
    distance = Math.max(distance, depth + Math.abs(relative.dot(right)) / (tanY * aspect * safeX),
      depth + Math.abs(y) / (tanY * (y < 0 ? safeBottom : safeTop)));
  }
  return { position: target.clone().addScaledVector(offset, distance), target, fov };
}

function createContactShadowMaterial(cup: { value: THREE.Vector2 }, ball: { value: THREE.Vector2 }) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uCup: cup, uBall: ball, uOpacity: { value: 0.68 }, uContact: { value: 1 } },
    vertexShader: `
      varying vec2 vShadowUv;
      varying vec3 vShadowPosition;
      void main() {
        vShadowUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vShadowPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec2 vShadowUv;
      varying vec3 vShadowPosition;
      uniform vec2 uCup;
      uniform vec2 uBall;
      uniform float uOpacity;
      uniform float uContact;
      void main() {
        if (distance(vShadowPosition.xz, uCup) < ${CUP_RADIUS}) discard;
        vec2 p = (vShadowUv - 0.5) * 2.0;
        float soft = exp(-dot(p, p) * 4.8) * 0.52;
        vec2 core = (vShadowPosition.xz - uBall) / vec2(0.012, 0.010);
        float contact = exp(-dot(core, core) * 2.6) * 0.82 * uContact;
        float edge = 1.0 - smoothstep(0.7, 1.0, length(p));
        gl_FragColor = vec4(vec3(0.035, 0.058, 0.026), min(0.90, soft + contact) * edge * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function setGroupOpacity(group: THREE.Group, strength: number) {
  group.visible = strength > 0.001;
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.userData.baseOpacity ??= material.opacity;
      material.opacity = material.userData.baseOpacity * strength;
    }
  });
}

function disposeGroup(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      if (object instanceof THREE.InstancedMesh) object.dispose();
    }
  });
  geometries.forEach(geo => geo.dispose());
  materials.forEach(material => {
    const map = (material as THREE.MeshStandardMaterial).map;
    // The shared turf texture is owned by the scene, not individual terrain meshes.
    if (map instanceof THREE.CanvasTexture) map.dispose();
    material.dispose();
  });
  group.clear();
}
