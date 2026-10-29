import * as THREE from 'three';
import { turfCanopyGLSL, type TurfUniforms, type TurfCanopyUniforms } from './TurfMaterial';
import type { GreenSettings } from '../core/trajectory';
import type { RenderProfile } from '../core/renderQuality';
import { createGrassTips as createLegacyGrassTips } from './LegacyGrassTips';
import { greenEdge } from './course';
import { grassCoverageGLSL, grassRootHeight, GRASS_EDGE_ANGLE, GRASS_LENGTHS, type GrassMode } from './grassPrototype';

const GREEN_TUFTS = 6000;
const EDGE_TUFTS = 6000;

/** Three curved, blunt-cut ribbons per crown. No alpha cards, wind or per-frame allocations. */
export class GrassTips extends THREE.Group {
  readonly near: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardMaterial>;
  readonly edge: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardMaterial>;
  private baseline: THREE.Mesh;
  private mode: GrassMode = 'prototype';
  private greenDistance = { value: 6 };

  constructor(uniforms: TurfUniforms, legacyCenter: THREE.Vector2, canopy: TurfCanopyUniforms) {
    super(); this.name = 'near-cut-grass-tips';
    this.baseline = createLegacyGrassTips(uniforms, legacyCenter);
    this.near = new THREE.Mesh(tuftGeometry(GREEN_TUFTS, false), bladeMaterial(uniforms, this.greenDistance, false, canopy));
    this.edge = new THREE.Mesh(tuftGeometry(EDGE_TUFTS, true), bladeMaterial(uniforms, this.greenDistance, true, canopy));
    this.near.name = 'green-crowns-3mm'; this.edge.name = 'collar-crowns-3-11-30mm';
    for (const mesh of [this.near, this.edge]) {
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      // Millimetre tips receive course shadows without expanding the tree shadow workload.
      mesh.castShadow = false;
    }
    this.add(this.baseline, this.near, this.edge); this.setMode('prototype');
  }

  setMode(mode: GrassMode) {
    this.mode = mode; this.baseline.visible = mode === 'baseline';
    this.near.visible = this.edge.visible = mode === 'prototype';
  }

  setQuality(profile: RenderProfile) {
    this.near.geometry.instanceCount = profile.grassCount;
    this.edge.geometry.instanceCount = profile.edgeGrassCount;
    (this.baseline.geometry as THREE.InstancedBufferGeometry).instanceCount = [32000, 20000, 12000][profile.detail];
  }

  updateGreen(green: GreenSettings, surfaces: THREE.Object3D[]) {
    this.greenDistance.value = green.distance;
    const tuft = this.edge.geometry.getAttribute('tuft') as THREE.InstancedBufferAttribute;
    const roots = this.edge.geometry.getAttribute('rootData') as THREE.InstancedBufferAttribute;
    const surfaceData = this.edge.geometry.getAttribute('surfaceData') as THREE.InstancedBufferAttribute;
    const random = randomSource(719031);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 2);
    const hits: THREE.Intersection[] = [];
    const ground = Object.fromEntries(surfaces.map(mesh => [mesh.name, mesh]));
    // Interleaved positions preserve all three cuts when quality reduces instanceCount.
    for (let i = 0; i < EDGE_TUFTS; i++) {
      const angle = GRASS_EDGE_ANGLE + (random() - 0.5) * 0.40;
      const band = -0.18 + random() * 1.20;
      const edge = greenEdge(angle, green, band);
      const surface = band < 0 ? 'green' : band < 0.5 ? 'fringe' : 'rough';
      const variance = 0.82 + random() * 0.36;
      const length = GRASS_LENGTHS[surface] * variance;
      tuft.setXYZW(i, edge.x, edge.z, random(), random());
      // The interpolated collar triangles sit below the analytic curve by up to millimetres.
      // Sample those actual triangles only when rebuilding the green, never during playback.
      ray.ray.origin.set(edge.x, grassRootHeight(edge.x, edge.z, band, green) + 1, edge.z);
      hits.length = 0;
      ray.intersectObject(ground[surface === 'green' ? 'putting-surface' : `green-${surface}`], false, hits);
      const rootY = hits[0]?.point.y ?? grassRootHeight(edge.x, edge.z, band, green);
      surfaceData.setXY(i, surface === 'green' ? 0 : surface === 'fringe' ? 1 : 2,
        surface === 'green' ? 0 : surface === 'fringe' ? band / 0.5 : (band - 0.5) / 1.1);
      roots.setXYZW(i, rootY - 0.00018,
        length, (surface === 'green' ? 0.00048 : surface === 'fringe' ? 0.00085 : 0.0014) * (0.85 + random() * 0.30), length * (0.30 + random() * 0.32));
    }
    tuft.needsUpdate = roots.needsUpdate = surfaceData.needsUpdate = true;
  }

  getDiagnostics() {
    return { mode: this.mode, greenTufts: this.near.geometry.instanceCount, edgeTufts: this.edge.geometry.instanceCount,
      bladesPerTuft: 3, trianglesPerBlade: 6, cutHeightsMm: [3, 11, 30], surfaceRadiusMeters: 1.9, geometryRadiusMeters: 0.46,
      denseGreenTufts: this.near.geometry.instanceCount * 4 / 5, denseRadiusMeters: 0.15, nearDensityGain: 0.8 * (0.92 / 0.30) ** 2 };
  }
}

function randomSource(initial: number) {
  let seed = initial;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}

/** Progressive best-candidate points reduce clumps without introducing visible rows. */
function crownPoints(count: number, seed = 349021) {
  const random = randomSource(seed), cells = Math.ceil(Math.sqrt(count / 4));
  const bins: number[][] = Array.from({ length: cells * cells }, () => []);
  const points = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    let bestX = 0, bestZ = 0, bestDistance = -1;
    for (let candidate = 0; candidate < 6; candidate++) {
      const x = random(), z = random(), cx = Math.floor(x * cells), cz = Math.floor(z * cells);
      let nearest = 1;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const bin = bins[((cz + dz + cells) % cells) * cells + (cx + dx + cells) % cells];
        for (const index of bin) {
          const px = Math.abs(x - points[index * 2]), pz = Math.abs(z - points[index * 2 + 1]);
          nearest = Math.min(nearest, Math.min(px, 1 - px) ** 2 + Math.min(pz, 1 - pz) ** 2);
        }
      }
      if (nearest > bestDistance) { bestX = x; bestZ = z; bestDistance = nearest; }
    }
    points.set([bestX, bestZ], i * 2);
    bins[Math.floor(bestZ * cells) * cells + Math.floor(bestX * cells)].push(i);
  }
  return points;
}

function tuftGeometry(count: number, edge: boolean) {
  const geometry = new THREE.InstancedBufferGeometry();
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (let leaf = 0; leaf < 3; leaf++) {
    for (let row = 0; row <= 3; row++) for (let side = 0; side < 2; side++) {
      // Top retains 62% of base width, giving a mown cut instead of a pointed triangle.
      positions.push((side - 0.5) * (1 - row / 3 * 0.38), row / 3, leaf);
      normals.push(0, 0, 1);
    }
    for (let row = 0; row < 3; row++) {
      const a = leaf * 8 + row * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  const tuft = new Float32Array(count * 4), roots = new Float32Array(count * 4);
  const random = randomSource(edge ? 719031 : 481516);
  const densePoints = edge ? undefined : crownPoints(count * 4 / 5);
  const widePoints = edge ? undefined : crownPoints(count / 5, 91823);
  let denseIndex = 0, wideIndex = 0;
  for (let i = 0; i < count; i++) {
    // Interleave levels so every quality prefix retains a dense, close-cut canopy.
    const dense = i % 5 !== 4;
    const points = dense ? densePoints : widePoints;
    const pointIndex = dense ? denseIndex++ : wideIndex++;
    const span = dense && !edge ? 0.30 : 0.92;
    const x = (points ? points[pointIndex * 2] : random()) * span;
    const z = (points ? points[pointIndex * 2 + 1] : random()) * span;
    tuft.set([x, z, random(), random()], i * 4);
    const length = GRASS_LENGTHS.green * (0.82 + random() * 0.36);
    roots.set([span, length, 0.00058 * (0.85 + random() * 0.30), length * (0.42 + random() * 0.30)], i * 4);
  }
  geometry.setAttribute('tuft', new THREE.InstancedBufferAttribute(tuft, 4));
  geometry.setAttribute('rootData', new THREE.InstancedBufferAttribute(roots, 4));
  geometry.setAttribute('surfaceData', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2));
  geometry.instanceCount = count;
  return geometry;
}

function bladeMaterial(uniforms: TurfUniforms, distance: { value: number }, edge: boolean, canopy: TurfCanopyUniforms) {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, side: THREE.DoubleSide, dithering: true });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, canopy, { uGreenDistance: distance });
    shader.vertexShader = /* glsl */`
      attribute vec4 tuft;
      attribute vec4 rootData;
      attribute vec2 surfaceData;
      uniform vec2 uSlope;
      uniform vec2 uCup;
      uniform vec4 uGrassContactBall;
      uniform float uGreenDistance;
      varying float vGrassHeight;
      varying float vGrassVariation;
      varying float vGrassLength;
      varying float vGrassSide;
      varying float vGrassCompression;
      varying vec2 vGrassRoot;
      varying vec2 vGrassSurface;
      ${grassCoverageGLSL}
    ` + shader.vertexShader.replace('#include <beginnormal_vertex>', /* glsl */`
      vec2 rootXZ = ${edge ? 'tuft.xy' : 'mod(tuft.xy - uGrassBall + rootData.x * 0.5, rootData.x) + uGrassBall - rootData.x * 0.5'};
      float leaf = position.z;
      float turn = 0.325 + (tuft.w - 0.5) * 1.6 + (leaf - 1.0) * 0.66;
      vec2 lean = vec2(sin(turn), cos(turn));
      vec2 sideways = vec2(lean.y, -lean.x);
      float leafVariation = fract(tuft.z * 17.31 + leaf * 0.381);
      float leafLength = rootData.y * mix(0.88, 1.12, leafVariation);
      float rootSpread = ${edge ? 'max(0.00035, rootData.y * 0.035)' : '0.00045'};
      rootXZ += vec2(cos(leaf * 2.399 + tuft.w * 6.28), sin(leaf * 2.399 + tuft.w * 6.28)) * rootSpread;
      float rootY = ${edge ? 'rootData.x + dot(rootXZ - tuft.xy, uSlope)' : 'dot(rootXZ, uSlope) - 0.00018'};
      vec3 root = vec3(rootXZ.x, rootY, rootXZ.y);
      float coverage = ${edge ? 'grassEdgeCoverage(rootXZ)' : '1.0 - smoothstep(rootData.x * 0.35, rootData.x * 0.5, distance(rootXZ, uGrassBall))'};
      ${edge ? '' : `
        vec2 relative = vec2(rootXZ.x / 7.4, (rootXZ.y - uGreenDistance * 0.5) / (uGreenDistance * 0.5 + 5.8));
        float theta = atan(relative.y, relative.x);
        float boundary = 1.0 + 0.105 * sin(theta * 3.0 + 0.7) + 0.045 * cos(theta * 5.0 - 0.35) + 0.025 * sin(theta * 2.0 + 0.8);
        coverage *= 1.0 - smoothstep(boundary - 0.002, boundary, length(relative));
      `}
      coverage *= smoothstep(0.055, 0.060, distance(rootXZ, uCup));
      coverage *= 1.0 - smoothstep(${edge ? '2.5, 6.0' : '1.8, 4.2'}, distance(root, cameraPosition));
      float t = position.y;
      // The lower hemisphere limits only the touching crowns. An elevated ball has no footprint.
      float compression = 0.0;
      if (uGrassContactBall.w > 0.0) {
        vec2 fromBall = rootXZ - uGrassContactBall.xz;
        float radius = uGrassContactBall.w;
        float radial = length(fromBall);
        float lowerSphere = uGrassContactBall.y - sqrt(max(0.0, radius * radius - radial * radial));
        compression = (1.0 - smoothstep(leafLength * 0.05, leafLength * 1.2, lowerSphere - rootY))
          * (1.0 - smoothstep(radius * 0.72, radius * 0.9, radial));
        if (compression > 0.0) lean = normalize(mix(lean, normalize(fromBall + lean * 0.00001), compression * 0.75));
      }
      float pressedLength = leafLength * mix(1.0, 0.14, compression);
      sideways = vec2(lean.y, -lean.x);
      float bendLength = rootData.w + leafLength * 0.62 * compression;
      float bend = bendLength * t * t;
      float twist = (leafVariation - 0.5) * t * 0.75;
      vec2 bladeSide = sideways * cos(twist) + lean * sin(twist);
      vec2 offsetXZ = bladeSide * position.x * rootData.z * mix(0.70, 1.0, smoothstep(0.0, 0.35, t)) + lean * bend;
      vec3 grassPoint = root + vec3(offsetXZ.x, t * pressedLength + dot(offsetXZ, uSlope), offsetXZ.y) * coverage;
      grassPoint.y += position.x * rootData.z * (leafVariation - 0.5) * t * t * t * coverage;
      if (compression > 0.0) {
        vec2 fromBall = grassPoint.xz - uGrassContactBall.xz;
        float radiusSq = uGrassContactBall.w * uGrassContactBall.w;
        if (dot(fromBall, fromBall) < radiusSq) {
          float lowerSphere = uGrassContactBall.y - sqrt(radiusSq - dot(fromBall, fromBall));
          grassPoint.y = min(grassPoint.y, max(rootY + 0.00002, lowerSphere - 0.0001));
        }
      }
      vec3 bladeTangent = vec3(lean.x * 2.0 * bendLength * t, pressedLength + dot(lean, uSlope) * 2.0 * bendLength * t, lean.y * 2.0 * bendLength * t);
      vec3 objectNormal = normalize(cross(vec3(bladeSide.x, dot(bladeSide, uSlope), bladeSide.y), bladeTangent));
      vGrassHeight = t; vGrassVariation = tuft.z * 0.55 + leafVariation * 0.45; vGrassLength = rootData.y;
      vGrassSide = position.x / (1.0 - t * 0.38); vGrassRoot = rootXZ;
      vGrassCompression = compression;
      vGrassSurface = surfaceData;
    `).replace('#include <begin_vertex>', 'vec3 transformed = grassPoint;');
    shader.fragmentShader = /* glsl */`
      varying float vGrassHeight;
      varying float vGrassVariation;
      varying float vGrassLength;
      varying float vGrassSide;
      varying float vGrassCompression;
      varying vec2 vGrassRoot;
      varying vec2 vGrassSurface;
      uniform vec2 uSlope;
      ${turfCanopyGLSL}
    ` + shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      vec3 canopy = turfCanopy(vGrassRoot, vGrassSurface.x, smoothstep(0.0, 1.0, vGrassSurface.y));
      diffuseColor.rgb *= canopy * mix(0.86, 1.12, vGrassVariation);
      // The buried sheath is shaded; the cut end retains width without a bright painted cap.
      diffuseColor.rgb *= mix(0.62, 1.03, smoothstep(0.02, 0.65, vGrassHeight));
      diffuseColor.rgb *= mix(0.97, 1.0, 1.0 - abs(vGrassSide * 2.0));
      diffuseColor.rgb *= mix(1.0, 0.66, vGrassCompression);
    `).replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      // Filter a sub-millimetre ribbon toward the canopy normal to avoid alternating glints.
      vec3 canopyNormal = normalize((viewMatrix * vec4(-uSlope.x, 1.0, -uSlope.y, 0.0)).xyz);
      float canopyLight = mix(1.4, 0.90, smoothstep(0.006, 0.025, vGrassLength));
      normal = normalize(normal + canopyNormal * canopyLight);
    `);
  };
  material.customProgramCacheKey = () => `grass-crown-pbr-v4-contact-${edge}`;
  return material;
}
