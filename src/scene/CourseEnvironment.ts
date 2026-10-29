
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GreenSettings } from '../core/trajectory';
import { courseHeightAt } from './course';
import type { TurfMaterials, TurfUniforms } from './TurfMaterial';
import type { SceneDetail } from '../core/renderQuality';
import { LegacyCourseEnvironment, createSky } from './LegacyCourseEnvironment';
import { ImpostorBatch, type PlantPlacement } from './vegetation/ImpostorBatch';
import { randomSource, type VegetationManifest } from './vegetation/TreeModels';
import assetManifest from '../assets/vegetation/manifest.json';
import { prepareReferenceTree, REFERENCE_TREE_FILE } from './vegetation/ReferenceTree';

export type EnvironmentMode = 'original' | 'images' | 'hybrid' | 'specimen';
export const ENVIRONMENT_LABELS: Record<EnvironmentMode, string> = { specimen: '외부 수목 · 한 그루', original: '기존', images: 'A · 이전 이미지', hybrid: 'B · 이전 3D 혼합' };
const manifest = assetManifest as VegetationManifest;
const assetUrl = (file: string) => `${import.meta.env.BASE_URL}vegetation/${file}`;

export class CourseEnvironment extends THREE.Group {
  readonly ready: Promise<void>;
  readonly mode: EnvironmentMode;
  private legacy?: LegacyCourseEnvironment;
  private ground?: THREE.Mesh;
  private groundGeometries: THREE.PlaneGeometry[] = [];
  private batches: ImpostorBatch[] = [];
  private models: { object: THREE.Group; plant: PlantPlacement }[] = [];
  private textures: THREE.Texture[] = [];
  private contacts?: THREE.Mesh;
  private green: GreenSettings;
  private disposed = false;
  private detail: SceneDetail = 0;
  readonly placements = createPlantPlacements();

  constructor(materials: TurfMaterials, uniforms: TurfUniforms, green: GreenSettings, mode: EnvironmentMode = 'specimen') {
    super(); this.name = 'course-environment'; this.green = green; this.mode = mode;
    if (mode === 'original') {
      this.legacy = new LegacyCourseEnvironment(materials, uniforms, green);
      this.add(this.legacy); this.ready = Promise.resolve(); return;
    }
    this.groundGeometries = [160, 104, 72].map(segments => {
      const geometry = new THREE.PlaneGeometry(300, 300, segments, segments);
      geometry.rotateX(-Math.PI / 2);
      const uv = geometry.attributes.uv as THREE.BufferAttribute;
      const positions = geometry.attributes.position as THREE.BufferAttribute;
      geometry.setAttribute('surfaceBlend', new THREE.Float32BufferAttribute(new Float32Array(positions.count).fill(1), 1));
      for (let i = 0; i < positions.count; i++) {
        const u = positions.getX(i) / 150, v = positions.getZ(i) / 150;
        const x = 150 * (u * 0.16 + u ** 3 * 0.84), z = 150 * (v * 0.16 + v ** 3 * 0.84);
        positions.setXYZ(i, x, 0, z); uv.setXY(i, x / 1.3, z / 1.3);
      }
      return geometry;
    });
    this.ground = new THREE.Mesh(this.groundGeometries[0], materials.create('rough', uniforms));
    this.ground.name = 'rolling-rough'; this.ground.receiveShadow = true;
    this.add(this.ground, createSky()); this.update(green);
    this.ready = this.loadVegetation();
  }

  private async loadVegetation() {
    const settled = await Promise.allSettled([...manifest.trees.map(info => `atlases/${info.name}.png`), 'forest-clusters.png']
      .map(path => new THREE.TextureLoader().loadAsync(assetUrl(path))));
    const textures = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    if (this.disposed || settled.some(result => result.status === 'rejected')) {
      textures.forEach(t => t.dispose()); if (this.disposed) return;
      throw new Error('나무 이미지를 불러오지 못했습니다.');
    }
    this.textures = textures;
    textures.forEach(texture => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 2; });
    const allImages = [...this.placements.mid, ...this.placements.shrubs, ...(this.mode === 'images' ? this.placements.near : [])];
    manifest.trees.forEach((info, variant) => {
      const batch = new ImpostorBatch(textures[variant], allImages.filter(p => p.variant === variant), info.size, info.center[1]);
      this.batches.push(batch); this.add(batch);
    });
    for (let variant = 0; variant < 4; variant++) {
      const texture = textures[6].clone();
      texture.repeat.set(1, 0.25); texture.offset.y = (3 - variant) * 0.25;
      this.textures.push(texture);
      const batch = new ImpostorBatch(texture, this.placements.forest.filter(p => p.variant === variant), 17, 5.1, 1, 4, 3);
      this.batches.push(batch); this.add(batch);
    }
    if (this.mode === 'hybrid' || this.mode === 'specimen') {
      const results = await Promise.allSettled(manifest.trees.map(info => new GLTFLoader().loadAsync(assetUrl(`models/${info.name}.glb`))));
      const loaded = results.flatMap(result => result.status === 'fulfilled' ? [result.value.scene] : []);
      if (this.disposed || results.some(result => result.status === 'rejected')) {
        loaded.forEach(group => disposeObjects(group)); if (this.disposed) return;
        throw new Error('주요 3D 나무를 불러오지 못했습니다.');
      }
      this.placements.near.forEach((plant, index) => {
        const object = (results[plant.variant] as PromiseFulfilledResult<{ scene: THREE.Group }>).value.scene;
        if (this.mode === 'specimen' && index === 0) { disposeObjects(object); return; }
        object.name = `hero-${manifest.trees[plant.variant].name}`;
        object.rotation.y = plant.rotation; object.scale.setScalar(plant.scale);
        object.traverse(o => {
          if (!(o instanceof THREE.Mesh)) return;
          o.castShadow = o.receiveShadow = true;
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(material => {
            if ('color' in material) (material as THREE.MeshStandardMaterial).color.setScalar(plant.tint);
          });
        });
        this.models.push({ object, plant }); this.add(object);
      });
      if (this.mode === 'specimen') {
        const plant = this.placements.near[0];
        const asset = await new GLTFLoader().loadAsync(assetUrl(REFERENCE_TREE_FILE));
        if (this.disposed) { disposeObjects(asset.scene); return; }
        const { tree, textures: referenceTextures } = prepareReferenceTree(asset.scene, manifest.trees[plant.variant].height * plant.scale);
        tree.rotation.y = plant.rotation;
        this.textures.push(...referenceTextures);
        this.models.push({ object: tree, plant }); this.add(tree);
      }
    }
    if (this.disposed) return;
    this.contacts = new THREE.Mesh(new THREE.BufferGeometry(), createGroundShade());
    this.contacts.name = 'vegetation-ground-contact'; this.contacts.renderOrder = 1;
    this.add(this.contacts); this.update(this.green);
  }

  update(green: GreenSettings) {
    this.green = green;
    if (this.legacy) { this.legacy.update(green); return; }
    const floor = (x: number, z: number) => courseHeightAt(x, z, green);
    this.groundGeometries.forEach(geometry => {
      const positions = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) positions.setY(i, floor(positions.getX(i), positions.getZ(i)));
      positions.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    });
    this.batches.forEach(batch => batch.setGround(floor));
    this.models.forEach(({ object, plant }) => object.position.set(plant.x, floor(plant.x, plant.z), plant.z));
    if (this.contacts) {
      this.contacts.geometry.dispose();
      this.contacts.geometry = contactGeometry([...this.placements.near, ...this.placements.mid, ...this.placements.shrubs], floor);
    }
  }
  faceCamera(camera: THREE.Camera) { this.batches.forEach(batch => batch.faceCamera(camera)); }
  setInspectionRotation(radians: number) {
    const model = this.models.find(model => model.plant === this.placements.near[0]);
    if (!model) return false;
    const rotation = model.plant.rotation + radians;
    if (Math.abs(model.object.rotation.y - rotation) < 1e-10) return false;
    model.object.rotation.y = rotation;
    return true;
  }
  setDetail(detail: SceneDetail) {
    this.detail = detail;
    if (this.legacy) this.legacy.setDetail(detail);
    else if (this.ground) this.ground.geometry = this.groundGeometries[detail];
  }
  getDiagnostics() {
    return { mode: this.mode, detail: this.detail, heroModels: this.models.length,
      externalTrees: this.models.filter(m => m.object.name === 'hero-reference-tree-small-02').map(m => ({
        position: m.object.position.toArray(), rotation: m.object.rotation.y, ...m.object.userData,
      })),
      imageTrees: this.mode === 'original' ? 0 : this.placements.mid.length + this.placements.shrubs.length + (this.mode === 'images' ? this.placements.near.length : 0),
      forestClusters: this.mode === 'original' ? 0 : this.placements.forest.length,
      viewSamples: this.batches.slice(0, 6).map(batch => batch.getViewSamples()) };
  }
  dispose() {
    this.disposed = true; this.legacy?.dispose(); this.textures.forEach(texture => texture.dispose());
    this.groundGeometries.forEach(geometry => geometry.dispose()); disposeObjects(this);
  }
}

export function createPlantPlacements() {
  const random = randomSource(723123);
  const plant = (x: number, z: number, variant: number, scale = 1): PlantPlacement => ({ x, z, variant, scale, rotation: random() * Math.PI * 2, tint: 0.88 + random() * 0.15 });
  const near = [plant(-11, 27, 0, 1.07), plant(12.5, 37, 2, 1.08), plant(-24, -12, 1, 1.02),
    plant(25, -22, 5, 1.12), plant(-15, 43, 4, 1.04), plant(31, 9, 3, 1.10)];
  const mid: PlantPlacement[] = [], shrubs: PlantPlacement[] = [], forest: PlantPlacement[] = [];
  for (const [cx, cz, rx, rz, count] of [[-34, 53, 16, 13, 8], [34, 63, 16, 14, 8], [-54, -24, 17, 13, 7],
    [45, -45, 16, 12, 6], [-67, 21, 12, 22, 7], [65, 18, 13, 19, 7], [1, -68, 23, 9, 6]]) {
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2, r = Math.sqrt(random());
      const x = cx + Math.cos(angle) * rx * r, z = cz + Math.sin(angle) * rz * r;
      if (mid.some(p => Math.hypot(p.x - x, p.z - z) < 7.3)) continue;
      mid.push(plant(x, z, Math.floor(random() * 6), 0.78 + random() * 0.39));
    }
  }
  // Retire the 21 miniature adult-tree shrubs. Preserve the random sequence so
  // the remaining mature trees and distant forest stay in their existing places.
  for (let i = 0; i < 21 * 5; i++) random();
  // A narrow phone still sees distinct complete trees beyond the open putting corridor.
  mid.push(plant(-6.5, 62, 3, 0.96), plant(9, 70, 1, 1.03));
  for (let i = 0; i < 14; i++) {
    const angle = i * Math.PI * 2 / 14 + (random() - 0.5) * 0.13, r = 112 + random() * 23;
    forest.push(plant(Math.sin(angle) * r, Math.cos(angle) * r, i % 4, 0.9 + random() * 0.25));
  }
  return { near, mid, shrubs, forest };
}

function createGroundShade() {
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { shade: { value: new THREE.Color('#263a1d') } },
    vertexShader: 'varying vec2 vUv; attribute float strength; varying float vStrength; void main(){vUv=uv;vStrength=strength;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec2 vUv; varying float vStrength; uniform vec3 shade; void main(){float r=length(vUv*2.-1.);float a=(1.-smoothstep(0.,1.,r))*vStrength;if(a<.002)discard;gl_FragColor=vec4(shade,a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  });
}

function contactGeometry(plants: PlantPlacement[], floor: (x: number, z: number) => number) {
  const positions: number[] = [], uvs: number[] = [], strengths: number[] = [];
  plants.forEach(plant => {
    for (const [radius, dx, dz, strength] of [[3.5 * plant.scale, 1.5 * plant.scale, 0.8 * plant.scale, 0.18], [0.8 * plant.scale, 0, 0, 0.42]]) {
      const grid = 5;
      for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
        for (const [u, v] of [[x, y], [x, y + 1], [x + 1, y + 1], [x, y], [x + 1, y + 1], [x + 1, y]]) {
          const px = plant.x + dx + (u / grid - 0.5) * radius * 2, pz = plant.z + dz + (v / grid - 0.5) * radius * 2;
          positions.push(px, floor(px, pz) + 0.018, pz); uvs.push(u / grid, v / grid); strengths.push(strength);
        }
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('strength', new THREE.Float32BufferAttribute(strengths, 1));
  return geometry;
}

function disposeObjects(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
