import * as THREE from 'three';

/** Recessed, rounded dimples in the coating; the sphere's size and silhouette stay intact. */
export function createBallMaterial(radius: number) {
  const width = 1024, height = 512;
  const dimpleRadius = 0.00165, depth = 0.00016;
  const rings = Array.from({ length: 16 }, (_, row) => {
    const theta = (row + 0.5) * Math.PI / 16;
    return { sin: Math.sin(theta), cos: Math.cos(theta), count: Math.round(32 * Math.sin(theta)), phase: (row % 2) * 0.5 };
  });
  const heights = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const theta = (1 - (y + 0.5) / height) * Math.PI;
    const sin = Math.sin(theta), cos = Math.cos(theta), row = Math.floor(theta / Math.PI * 16);
    for (let x = 0; x < width; x++) {
      const phi = (x + 0.5) / width * Math.PI * 2;
      let distanceSq = Infinity;
      for (let index = Math.max(0, row - 1); index <= Math.min(15, row + 1); index++) {
        const ring = rings[index];
        const nearest = Math.round(phi / (Math.PI * 2) * ring.count - ring.phase);
        const centerPhi = (nearest + ring.phase) / ring.count * Math.PI * 2;
        const dot = cos * ring.cos + sin * ring.sin * Math.cos(phi - centerPhi);
        distanceSq = Math.min(distanceSq, Math.max(0, 2 - 2 * dot) * radius * radius);
      }
      const bowl = Math.max(0, 1 - distanceSq / (dimpleRadius * dimpleRadius));
      heights[y * width + x] = -depth * bowl * bowl;
    }
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const theta = (1 - (y + 0.5) / height) * Math.PI;
    const du = 2 * radius * Math.max(0.0001, Math.sin(theta)) * Math.PI * 2 / width;
    const dv = 2 * radius * Math.PI / height;
    for (let x = 0; x < width; x++) {
      const dx = (heights[y * width + (x + 1) % width] - heights[y * width + (x + width - 1) % width]) / du;
      const dy = (heights[Math.min(height - 1, y + 1) * width + x] - heights[Math.max(0, y - 1) * width + x]) / dv;
      const length = Math.hypot(dx, dy, 1), index = (y * width + x) * 4;
      pixels[index] = Math.round((0.5 - dx / length * 0.5) * 255);
      pixels[index + 1] = Math.round((0.5 - dy / length * 0.5) * 255);
      pixels[index + 2] = Math.round((0.5 + 0.5 / length) * 255);
      pixels[index + 3] = 255;
    }
  }
  const normalMap = new THREE.DataTexture(pixels, width, height);
  normalMap.name = 'golf-ball-recessed-dimples';
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.magFilter = THREE.LinearFilter;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.generateMipmaps = true;
  normalMap.anisotropy = 4;
  normalMap.needsUpdate = true;
  const material = new THREE.MeshPhysicalMaterial({
    color: '#fffef9', metalness: 0, roughness: 0.33,
    normalMap, clearcoat: 0.25, clearcoatRoughness: 0.26,
  });
  material.userData.dimpleCount = rings.reduce((sum, ring) => sum + ring.count, 0);
  material.userData.dimpleDepthMeters = depth;
  material.addEventListener('dispose', () => normalMap.dispose());
  return material;
}
