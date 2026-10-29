import * as THREE from 'three';
import type { GreenSettings } from '../core/trajectory';
import { courseHeightAt } from './course';
import type { TurfMaterials, TurfUniforms } from './TurfMaterial';
import type { SceneDetail } from '../core/renderQuality';

type Species = 'oak' | 'birch' | 'pine';
interface Tree { x: number; z: number; height: number; width: number; rotation: number; species: Species; tint: THREE.Color }
const NEAR_CLUSTERS = 32;
const PINE_LAYERS = 11;
const DISTANT_CLUSTERS = [18, 9, 4];

/** Solid foreground trees stay detailed; only distant terrain and groves change with quality. */
export class LegacyCourseEnvironment extends THREE.Group {
  private ground: THREE.Mesh;
  private groundGeometries: THREE.PlaneGeometry[];
  private trunks: THREE.InstancedMesh;
  private branches: THREE.InstancedMesh;
  private crowns: THREE.InstancedMesh[];
  private nearTrunks: THREE.InstancedMesh;
  private nearBranches: THREE.InstancedMesh;
  private nearCrowns: THREE.InstancedMesh;
  private nearPines: THREE.InstancedMesh;
  private trees: Tree[] = [];
  private nearTrees: Tree[] = [];
  private leafTexture = createFoliageTexture();
  private detail: SceneDetail = 0;

  constructor(materials: TurfMaterials, uniforms: TurfUniforms, green: GreenSettings) {
    super();
    this.name = 'course-environment';
    this.groundGeometries = [160, 104, 72].map(segments => {
      const geometry = new THREE.PlaneGeometry(300, 300, segments, segments);
      geometry.rotateX(-Math.PI / 2);
      const uv = geometry.attributes.uv as THREE.BufferAttribute;
      const positions = geometry.attributes.position as THREE.BufferAttribute;
      geometry.setAttribute('surfaceBlend', new THREE.Float32BufferAttribute(new Float32Array(positions.count).fill(1), 1));
      for (let i = 0; i < positions.count; i++) {
        // Concentrate vertices beside the green even in the least expensive distant mesh.
        const u = positions.getX(i) / 150, v = positions.getZ(i) / 150;
        const x = 150 * (u * 0.16 + u * u * u * 0.84);
        const z = 150 * (v * 0.16 + v * v * v * 0.84);
        positions.setXYZ(i, x, positions.getY(i), z);
        uv.setXY(i, x / 1.3, z / 1.3);
      }
      return geometry;
    });
    this.ground = new THREE.Mesh(this.groundGeometries[0], materials.create('rough', uniforms));
    this.ground.name = 'rolling-rough';
    this.ground.receiveShadow = true;
    this.add(this.ground, createSky());

    const random = seededRandom(240527);
    const tree = (x: number, z: number, height: number, width: number, species: Species): Tree => ({
      x, z, height, width, species, rotation: random() * Math.PI * 2,
      tint: new THREE.Color(species === 'pine' ? '#54775b' : species === 'birch' ? '#88a363' : '#6f8a4e')
        .offsetHSL((random() - 0.5) * 0.035, (random() - 0.5) * 0.08, (random() - 0.5) * 0.07),
    });
    this.nearTrees = [
      tree(-18, 17, 11.2, 7.1, 'oak'), tree(21, 26, 13.5, 5.7, 'birch'),
      tree(-29, 34, 15.3, 5.5, 'pine'), tree(31, 12, 9.8, 7.2, 'oak'),
      tree(-34, -20, 12.6, 5.3, 'birch'), tree(24, -28, 14.7, 5.8, 'pine'),
      tree(-15, 44, 11.8, 8.1, 'oak'), tree(34, 43, 16.1, 6.1, 'pine'),
      tree(-42, 8, 13.4, 7.5, 'oak'), tree(45, -8, 14.1, 5.9, 'birch'),
      tree(-10.8, 36, 11.8, 7.3, 'oak'), tree(12.8, 43, 13.8, 5.8, 'birch'),
    ];
    // Elliptical groves leave gaps and overlap at different depths, instead of a uniform ring.
    for (const [cx, cz, rx, rz, count] of [
      [-47, 58, 26, 13, 18], [48, 63, 22, 18, 19], [-70, -26, 30, 17, 20],
      [61, -46, 24, 14, 16], [-26, 114, 35, 20, 20], [46, 124, 30, 16, 20],
      [-112, 55, 22, 30, 17], [105, 12, 22, 24, 18], [8, -93, 40, 19, 22],
      [-22, 74, 23, 12, 16], [22, 82, 25, 12, 18],
    ]) {
      for (let i = 0; i < count; i++) {
        const angle = random() * Math.PI * 2, radius = Math.sqrt(random());
        const species: Species = random() < 0.26 ? 'pine' : random() < 0.32 ? 'birch' : 'oak';
        this.trees.push(tree(cx + Math.cos(angle) * radius * rx, cz + Math.sin(angle) * radius * rz,
          7.5 + random() * 9.5, species === 'pine' ? 3.4 + random() * 2.8 : 4.2 + random() * 4.3, species));
      }
    }
    const bark = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    this.trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.38, 0.72, 1, 7), bark, this.trees.length);
    this.branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.38, 1, 5), bark, this.trees.length * 3);
    // Leaf illumination is baked into the texture and per-cluster tint. This avoids
    // black back faces and visible light/dark seams between the crossed cards.
    const leafMaterial = new THREE.MeshBasicMaterial({
      map: this.leafTexture, alphaTest: 0.48, side: THREE.DoubleSide,
      color: '#ffffff', dithering: true,
    });
    // Three crossing cards per cluster keep the crown volumetric when the user orbits.
    const crownGeometry = new THREE.BufferGeometry();
    const vertices: number[] = [], uvs: number[] = [], normals: number[] = [];
    for (let card = 0; card < 3; card++) {
      const angle = card * Math.PI / 3;
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
        vertices.push(x * Math.cos(angle), y, x * Math.sin(angle));
        uvs.push((x + 1) / 2, (y + 1) / 2);
        // Rounded normals soften the lighting differences between crossing cards.
        normals.push(x * Math.cos(angle) * 0.55, y * 0.35 + 0.45, x * Math.sin(angle) * 0.55);
      }
    }
    crownGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    crownGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    crownGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.crowns = DISTANT_CLUSTERS.map((clusters, detail) => {
      const mesh = new THREE.InstancedMesh(crownGeometry, leafMaterial, this.trees.length * clusters);
      mesh.name = `distant-foliage-${detail}`;
      mesh.visible = detail === 0;
      return mesh;
    });
    this.trunks.name = 'distant-tree-trunks';
    this.branches.name = 'distant-tree-branches';
    // Nearby crowns are solid, lit geometry, including their underside and outline.
    const foliage = createSolidFoliageMaterial();
    this.nearTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.38, 0.72, 1, 10), bark, this.nearTrees.length);
    this.nearBranches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.10, 0.38, 1, 7), bark, this.nearTrees.length * 9);
    this.nearCrowns = new THREE.InstancedMesh(createCrownGeometry(), foliage, this.nearTrees.filter(t => t.species !== 'pine').length * NEAR_CLUSTERS);
    this.nearPines = new THREE.InstancedMesh(createPineGeometry(), foliage, this.nearTrees.filter(t => t.species === 'pine').length * PINE_LAYERS);
    this.nearTrunks.name = 'near-solid-trunks';
    this.nearBranches.name = 'near-solid-branches';
    this.nearCrowns.name = 'near-solid-oak-and-birch';
    this.nearPines.name = 'near-solid-pines';
    for (const mesh of [this.nearTrunks, this.nearBranches, this.nearCrowns, this.nearPines]) {
      mesh.castShadow = mesh.receiveShadow = true;
    }
    this.add(this.trunks, this.branches, ...this.crowns, this.nearTrunks, this.nearBranches, this.nearCrowns, this.nearPines);
    this.update(green);
  }

  update(green: GreenSettings) {
    for (const geometry of this.groundGeometries) {
      const positions = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) positions.setY(i, courseHeightAt(positions.getX(i), positions.getZ(i), green));
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    }
    const dummy = new THREE.Object3D();
    const branchDirection = new THREE.Vector3();
    const random = seededRandom(8264);
    this.trees.forEach((tree, i) => {
      const floor = courseHeightAt(tree.x, tree.z, green);
      dummy.position.set(tree.x, floor + tree.height * 0.29, tree.z);
      dummy.rotation.set(0, tree.rotation, 0);
      dummy.scale.set(tree.height * 0.045, tree.height * 0.58, tree.height * 0.045);
      dummy.updateMatrix();
      this.trunks.setMatrixAt(i, dummy.matrix);
      const bark = new THREE.Color(tree.species === 'birch' ? '#b6b7a5' : '#716959');
      this.trunks.setColorAt(i, bark);
      for (let b = 0; b < 3; b++) {
        const angle = tree.rotation + b * Math.PI * 2 / 3;
        branchDirection.set(Math.cos(angle) * 0.55, 0.84, Math.sin(angle) * 0.55).normalize();
        dummy.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, branchDirection);
        dummy.position.set(tree.x + Math.cos(angle) * tree.width * 0.19, floor + tree.height * 0.54, tree.z + Math.sin(angle) * tree.width * 0.19);
        dummy.scale.set(tree.height * 0.05, tree.height * 0.34, tree.height * 0.05);
        dummy.updateMatrix();
        this.branches.setMatrixAt(i * 3 + b, dummy.matrix);
        this.branches.setColorAt(i * 3 + b, bark);
      }
      for (let detail = 0; detail < this.crowns.length; detail++) {
        const clusters = DISTANT_CLUSTERS[detail];
        for (let c = 0; c < clusters; c++) {
          const angle = c * 2.39996 + tree.rotation;
          const level = 1 - 2 * c / (clusters - 1);
          const pine = tree.species === 'pine';
          const spread = pine ? (1 - level) * tree.width * 0.12 : Math.sqrt(1 - level * level) * tree.width * 0.36;
          dummy.position.set(tree.x + Math.cos(angle) * spread, floor + tree.height * ((pine ? 0.67 : 0.74) + level * (pine ? 0.21 : 0.18)), tree.z + Math.sin(angle) * spread);
          dummy.rotation.set((random() - 0.5) * 0.25, tree.rotation + c * 0.7, (random() - 0.5) * 0.2);
          const clusterWidth = pine ? tree.width * (0.16 + (1 - level) * 0.22) : tree.width * (0.30 + random() * 0.10);
          dummy.scale.set(clusterWidth, tree.height * (pine ? 0.18 : tree.species === 'birch' ? 0.19 : 0.145), clusterWidth);
          dummy.updateMatrix();
          this.crowns[detail].setMatrixAt(i * clusters + c, dummy.matrix);
          const sunFacing = Math.max(0, Math.cos(angle) * -0.52 + Math.sin(angle) * -0.3 + level * 0.8);
          this.crowns[detail].setColorAt(i * clusters + c, tree.tint.clone().multiplyScalar(0.80 + sunFacing * 0.42));
        }
      }
    });
    let crownIndex = 0, pineIndex = 0;
    this.nearTrees.forEach((tree, i) => {
      const floor = courseHeightAt(tree.x, tree.z, green);
      const bark = new THREE.Color(tree.species === 'birch' ? '#c3c3af' : '#746b59');
      const lean = tree.species === 'birch' ? 0.045 : 0.025;
      dummy.position.set(tree.x, floor + tree.height * 0.34, tree.z);
      dummy.rotation.set(lean, tree.rotation, -lean * 0.7);
      dummy.scale.set(tree.height * (tree.species === 'birch' ? 0.026 : 0.042), tree.height * 0.68, tree.height * 0.036);
      dummy.updateMatrix();
      this.nearTrunks.setMatrixAt(i, dummy.matrix);
      this.nearTrunks.setColorAt(i, bark);
      for (let b = 0; b < 9; b++) {
        const angle = tree.rotation + b * 2.39996;
        branchDirection.set(Math.cos(angle) * 0.72, 0.66 + random() * 0.3, Math.sin(angle) * 0.72).normalize();
        dummy.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, branchDirection);
        dummy.position.set(tree.x + Math.cos(angle) * tree.width * 0.15, floor + tree.height * (0.43 + b * 0.032), tree.z + Math.sin(angle) * tree.width * 0.15);
        dummy.scale.set(tree.height * 0.027, tree.width * (0.36 + random() * 0.13), tree.height * 0.027);
        dummy.updateMatrix();
        this.nearBranches.setMatrixAt(i * 9 + b, dummy.matrix);
        this.nearBranches.setColorAt(i * 9 + b, bark);
      }
      if (tree.species === 'pine') {
        for (let c = 0; c < PINE_LAYERS; c++) {
          const level = c / (PINE_LAYERS - 1);
          const spread = tree.width * (0.50 * (1 - level) + 0.06);
          dummy.position.set(tree.x + Math.sin(c * 2.4) * 0.15, floor + tree.height * (0.36 + level * 0.57), tree.z + Math.cos(c * 2.4) * 0.15);
          dummy.rotation.set((random() - 0.5) * 0.1, tree.rotation + c, (random() - 0.5) * 0.1);
          dummy.scale.set(spread, tree.height * (0.19 - level * 0.07), spread * (0.86 + random() * 0.15));
          dummy.updateMatrix();
          this.nearPines.setMatrixAt(pineIndex, dummy.matrix);
          this.nearPines.setColorAt(pineIndex++, tree.tint.clone().multiplyScalar(0.84 + level * 0.22));
        }
      } else {
        for (let c = 0; c < NEAR_CLUSTERS; c++) {
          const angle = c * 2.39996 + tree.rotation;
          const level = 1 - 2 * (c + 0.5) / NEAR_CLUSTERS;
          const spread = Math.sqrt(1 - level * level) * tree.width * (0.29 + random() * 0.09);
          dummy.position.set(tree.x + Math.cos(angle) * spread, floor + tree.height * (0.71 + level * (tree.species === 'birch' ? 0.23 : 0.17)), tree.z + Math.sin(angle) * spread);
          dummy.rotation.set(random(), random() * Math.PI * 2, random() * 0.6);
          const size = tree.width * (0.15 + random() * 0.10);
          dummy.scale.set(size, tree.height * (tree.species === 'birch' ? 0.125 : 0.105) * (0.8 + random() * 0.4), size * (0.8 + random() * 0.35));
          dummy.updateMatrix();
          this.nearCrowns.setMatrixAt(crownIndex, dummy.matrix);
          this.nearCrowns.setColorAt(crownIndex++, tree.tint.clone().multiplyScalar(0.84 + random() * 0.27));
        }
      }
    });
    for (const mesh of [this.trunks, this.branches, ...this.crowns, this.nearTrunks, this.nearBranches, this.nearCrowns, this.nearPines]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  setDetail(detail: SceneDetail) {
    if (this.detail === detail) return;
    this.detail = detail;
    this.ground.geometry = this.groundGeometries[detail];
    this.crowns.forEach((mesh, index) => { mesh.visible = index === detail; });
    this.branches.visible = detail < 2;
  }

  dispose() {
    this.leafTexture.dispose();
    this.groundGeometries.filter(geometry => geometry !== this.ground.geometry).forEach(geometry => geometry.dispose());
  }
}

function createCrownGeometry() {
  return createLeafCloud(false);
}

function createPineGeometry() {
  return createLeafCloud(true);
}

/** Folded leaves give close trees an open, irregular silhouette without alpha overdraw. */
function createLeafCloud(pine: boolean) {
  const random = seededRandom(pine ? 71934 : 91728);
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const rotation = new THREE.Quaternion();
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  const count = pine ? 140 : 180;
  for (let i = 0; i < count; i++) {
    const angle = i * 2.39996;
    const y = pine ? random() - 0.5 : random() * 2 - 1;
    const radius = pine ? (0.92 - (y + 0.5) * 0.82) * Math.sqrt(random())
      : Math.sqrt(1 - y * y) * Math.cbrt(0.12 + random() * 0.88);
    const root = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    rotation.setFromEuler(new THREE.Euler(random() * Math.PI, random() * Math.PI * 2, random() * Math.PI));
    const length = pine ? 0.22 + random() * 0.15 : 0.18 + random() * 0.15;
    const width = length * (pine ? 0.32 : 0.52);
    const vertices = [[0, length, 0], [-width, 0, 0], [0, -length, 0], [width, 0, 0], [0, 0, length * 0.18]];
    const shade = (0.72 + random() * 0.23) * (0.88 + (y + 1) * 0.10);
    for (const index of [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]) {
      const vertex = vertices[index];
      point.set(vertex[0], vertex[1], vertex[2]).applyQuaternion(rotation).add(root);
      positions.push(point.x, point.y, point.z);
      normal.set(vertex[0] / length * 0.3, vertex[1] / length * 0.15, 1).normalize().applyQuaternion(rotation);
      normals.push(normal.x, normal.y, normal.z);
      const ridge = index === 4 ? 1.08 : 0.96;
      colors.push(shade * ridge, shade * ridge, shade * ridge * 0.94);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function createSolidFoliageMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, side: THREE.DoubleSide, roughness: 0.93, dithering: true });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vLeafPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeafPosition = position;');
    shader.fragmentShader = 'varying vec3 vLeafPosition;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float footprint = max(length(dFdx(vLeafPosition)), length(dFdy(vLeafPosition)));
      float leafDetail = 1.0 - smoothstep(0.012, 0.055, footprint);
      float grain = sin(vLeafPosition.x * 173.0 + vLeafPosition.y * 57.0) * sin(vLeafPosition.z * 139.0 - vLeafPosition.y * 93.0);
      diffuseColor.rgb *= 1.0 + grain * leafDetail * 0.12;
    `);
  };
  return material;
}

function seededRandom(initial: number) {
  let seed = initial;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}

/** Small original leaf texture, generated once without a network or canvas dependency. */
function createFoliageTexture() {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  const random = seededRandom(40763);
  for (let leaf = 0; leaf < 2300; leaf++) {
    const theta = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * (0.85 + 0.09 * Math.sin(theta * 5) + 0.06 * Math.cos(theta * 9));
    const cx = size * (0.5 + Math.cos(theta) * radius * 0.46);
    const cy = size * (0.5 + Math.sin(theta) * radius * 0.45);
    const rx = 1.3 + random() * 3.6, ry = 1.2 + random() * 2;
    const brightness = 0.65 + random() * 0.35;
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(size, cy + ry); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(size, cx + rx); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d > 1) continue;
        const shade = brightness * (1 - d * 0.22) * (1.05 - cy / size * 0.28);
        const index = (y * size + x) * 4;
        pixels.set([Math.round(218 * shade), Math.round(229 * shade), Math.round(184 * shade), 255], index);
      }
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color('#3e8fc9') },
      horizon: { value: new THREE.Color('#c1dce1') },
      cloudColor: { value: new THREE.Color('#f6f4e8') },
    },
    vertexShader: `
      varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vSkyDirection;
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 cloudColor;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1)), f.x), f.y);
      }
      float clouds(vec2 p) {
        return noise(p) * 0.55 + noise(p * 2.03 + 7.4) * 0.26 + noise(p * 4.11) * 0.13 + noise(p * 8.21) * 0.06;
      }
      void main() {
        vec3 direction = normalize(vSkyDirection);
        float elevation = max(0.0, direction.y);
        vec3 color = mix(horizon, zenith, pow(smoothstep(0.0, 0.48, elevation), 0.48));
        vec2 p = direction.xz / (elevation + 0.19) * 2.8 + vec2(7.2, 3.8);
        float cover = smoothstep(0.53, 0.73, clouds(p));
        cover *= smoothstep(0.015, 0.14, elevation) * (1.0 - smoothstep(0.65, 0.95, elevation));
        color = mix(color, cloudColor, cover * 0.88);
        color += vec3(1.0, 0.83, 0.55) * pow(max(0.0, dot(direction, normalize(vec3(-0.52, 0.8, -0.3)))), 180.0) * 0.28;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(245, 32, 16), material);
  sky.name = 'daylight-sky';
  sky.renderOrder = -1;
  return sky;
}
