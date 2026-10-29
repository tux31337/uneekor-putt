import * as THREE from 'three';

/** Original project assets, in metres. No downloaded geometry or image sources. */
export const TREE_PROFILES = [
  { name: 'spreading-oak', seed: 614, height: 10.4, spread: 5.0, forks: 5, low: 0.22, leaf: '#46652d', bark: '#665747', lean: 0.08 },
  { name: 'leaning-linden', seed: 921, height: 11.7, spread: 4.0, forks: 6, low: 0.28, leaf: '#647c36', bark: '#726551', lean: -0.16 },
  { name: 'multi-stem-birch', seed: 335, height: 12.4, spread: 3.8, forks: 5, low: 0.18, leaf: '#708347', bark: '#c1bba4', lean: 0.12 },
  { name: 'low-field-maple', seed: 761, height: 8.8, spread: 4.5, forks: 6, low: 0.18, leaf: '#546f31', bark: '#71604b', lean: -0.08 },
  { name: 'open-vase-elm', seed: 188, height: 12.0, spread: 5.0, forks: 5, low: 0.25, leaf: '#536d36', bark: '#635443', lean: 0.06 },
  { name: 'windswept-pine', seed: 433, height: 11.0, spread: 4.3, forks: 7, low: 0.31, leaf: '#405f40', bark: '#82634a', lean: 0.16 },
] as const;

export interface TreeAssetInfo { name: string; height: number; size: number; center: [number, number, number]; triangles: number }
export interface VegetationManifest { version: number; azimuths: number; elevations: number[]; tile: number; trees: TreeAssetInfo[] }

export function randomSource(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

class GeometryWriter {
  positions: number[] = [];
  colors: number[] = [];
  triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color, shade = 1) {
    for (const p of [a, b, c]) { this.positions.push(p.x, p.y, p.z); this.colors.push(color.r * shade, color.g * shade, color.b * shade); }
  }
  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Curved, tapered, connected limbs; branches start below the middle of the tree. */
export function createTreeModel(variant: number) {
  const profile = TREE_PROFILES[variant];
  const random = randomSource(profile.seed);
  const wood = new GeometryWriter(), leaves = new GeometryWriter();
  const bark = new THREE.Color(profile.bark), green = new THREE.Color(profile.leaf);
  const tips: { position: THREE.Vector3; direction: THREE.Vector3; radius: number }[] = [];
  const h = profile.height;
  const pine = variant === 5, birch = variant === 2;

  function limb(start: THREE.Vector3, end: THREE.Vector3, radius: number, endRadius: number, bend: number) {
    const direction = end.clone().sub(start).normalize();
    const side = new THREE.Vector3(-direction.z + 0.14, 0.17, direction.x + 0.1).normalize();
    const axis = new THREE.Vector3().crossVectors(direction, side).normalize();
    side.crossVectors(axis, direction).normalize();
    const rings: THREE.Vector3[][] = [];
    const sides = radius > 0.17 ? 9 : 6, steps = radius > 0.08 ? 5 : 3;
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      const center = start.clone().lerp(end, t).addScaledVector(side, Math.sin(t * Math.PI) * bend)
        .addScaledVector(axis, Math.sin(t * Math.PI * 1.7) * bend * 0.25);
      const r = THREE.MathUtils.lerp(radius, endRadius, t);
      rings.push(Array.from({ length: sides }, (_, s) => {
        const angle = s / sides * Math.PI * 2;
        const ridges = 1 + Math.sin(s * 3.1 + t * 7) * 0.11;
        return center.clone().addScaledVector(side, Math.cos(angle) * r * ridges).addScaledVector(axis, Math.sin(angle) * r * ridges);
      }));
    }
    for (let j = 0; j < steps; j++) for (let s = 0; s < sides; s++) {
      const next = (s + 1) % sides;
      const stripe = birch && Math.floor(j * 1.9 + s * 2.3) % 7 === 0 ? 0.43 : 0.82 + random() * 0.2;
      wood.triangle(rings[j][s], rings[j + 1][next], rings[j + 1][s], bark, stripe);
      wood.triangle(rings[j][s], rings[j][next], rings[j + 1][next], bark, stripe);
    }
  }

  function branch(start: THREE.Vector3, direction: THREE.Vector3, length: number, radius: number, depth: number) {
    const end = start.clone().addScaledVector(direction, length);
    limb(start, end, radius, radius * (depth ? 0.42 : 0.12), length * (0.06 + random() * 0.09));
    if (!depth) { tips.push({ position: end, direction, radius: pine ? 0.68 : 0.8 }); return; }
    const children = depth === 2 ? 4 : 3;
    for (let i = 0; i < children; i++) {
      const angle = random() * Math.PI * 2;
      const outward = new THREE.Vector3(Math.cos(angle), 0.3 + random() * 0.7, Math.sin(angle));
      const childDirection = direction.clone().multiplyScalar(0.64).addScaledVector(outward, 0.62).normalize();
      const attachment = start.clone().lerp(end, 0.60 + i / children * 0.4);
      branch(attachment, childDirection, length * (0.48 + random() * 0.13), radius * 0.47, depth - 1);
    }
    tips.push({ position: end, direction, radius: 0.65 });
  }

  const fork = new THREE.Vector3(h * profile.lean * 0.27, h * profile.low, 0.12);
  limb(new THREE.Vector3(), fork, birch ? 0.20 : 0.36, birch ? 0.15 : 0.27, 0.14);
  // Root flares anchor the trunk instead of leaving a cylinder resting on the grass.
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3 + random();
    limb(new THREE.Vector3(Math.cos(angle) * 0.8, -0.07, Math.sin(angle) * 0.8),
      new THREE.Vector3(0, 0.65, 0), 0.07, 0.18, 0.08);
  }
  for (let i = 0; i < profile.forks; i++) {
    const angle = i * 2.39996 + random() * 0.55;
    const level = i / (profile.forks - 1);
    const start = fork.clone().add(new THREE.Vector3(level * h * profile.lean * 0.25, level * h * 0.21, 0));
    const crownY = pine ? h * (0.55 + level * 0.37) : h * (0.66 + level * 0.18);
    const spread = profile.spread * (0.70 + random() * 0.37) * (pine ? 1.0 - level * 0.3 : 1);
    const end = new THREE.Vector3(Math.cos(angle) * spread + h * profile.lean, crownY, Math.sin(angle) * spread * 0.88);
    const direction = end.clone().sub(start);
    branch(start, direction.clone().normalize(), direction.length() * 0.65, birch ? 0.14 : 0.23 - level * 0.06, 2);
  }
  // A lower side branch breaks the repeated bare-trunk silhouette.
  branch(fork.clone().multiplyScalar(0.88), new THREE.Vector3(-0.88, 0.43, 0.25).normalize(), profile.spread * 0.76, 0.10, 1);

  for (const tip of tips) {
    const count = pine ? 42 : 54;
    for (let j = 0; j < count; j++) {
      const theta = random() * Math.PI * 2, yy = random() * 2 - 1;
      const rr = Math.sqrt(1 - yy * yy) * Math.cbrt(random());
      const size = tip.radius * (0.72 + random() * 0.48);
      const center = tip.position.clone().add(new THREE.Vector3(Math.cos(theta) * rr * size, yy * size * (pine ? 0.45 : 0.68), Math.sin(theta) * rr * size));
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler((random() - 0.5) * 1.9, random() * Math.PI * 2, (random() - 0.5) * 1.1));
      const length = pine ? 0.15 + random() * 0.14 : 0.14 + random() * 0.12;
      const width = length * (pine ? 0.27 : 0.62);
      const points = [[0, 0, length], [-width, 0, 0], [0, 0, -length * 0.83], [width, 0, 0], [0, length * 0.20, 0]]
        .map(p => new THREE.Vector3(...p as [number, number, number]).applyQuaternion(rotation).add(center));
      const shade = (0.70 + random() * 0.37) * (0.80 + Math.min(1, center.y / h) * 0.26);
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) leaves.triangle(points[a], points[b], points[4], green, shade);
    }
  }
  const group = new THREE.Group();
  group.name = profile.name;
  const barkMesh = new THREE.Mesh(wood.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  const leafMesh = new THREE.Mesh(leaves.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.95 }));
  barkMesh.name = 'connected-curved-wood'; leafMesh.name = 'individual-folded-leaves';
  group.add(barkMesh, leafMesh);
  group.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true; });
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const center = new THREE.Vector3(0, (bounds.max.y + bounds.min.y) * 0.5, 0);
  let radius = 0;
  group.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) radius = Math.max(radius, new THREE.Vector3().fromBufferAttribute(p, i).distanceTo(center));
  });
  const info: TreeAssetInfo = { name: profile.name, height: bounds.max.y, size: radius * 2.12, center: center.toArray() as [number, number, number], triangles: (wood.positions.length + leaves.positions.length) / 9 };
  group.userData.asset = info;
  return { group, info };
}

export function addVegetationLighting(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight('#dfedf5', '#899467', 1.95));
  const sun = new THREE.DirectionalLight('#fff2da', 2.55);
  sun.position.set(-24, 34, -12); scene.add(sun);
}
