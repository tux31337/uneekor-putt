import * as THREE from 'three';
import assert from 'node:assert/strict';
import { readFile, writeFile, stat, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { prepareReferenceTree } from '../src/scene/vegetation/ReferenceTree.ts';

const root = resolve('artifacts/tree-quality-review');
const asset = resolve('public/vegetation/external/tree-small-02');
const provenance = JSON.parse(await readFile(resolve(asset, 'provenance.json'), 'utf8'));
const bytes = await readFile(resolve(asset, 'tree-small-02.glb'));
assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.sha256);
assert.equal(bytes.readUInt32LE(8), bytes.length);
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const binaryStart = 28 + bytes.readUInt32LE(12);
const originalLength = provenance.downloads.records.find(record => record.file.endsWith('.bin')).bytes;
assert.equal(createHash('sha256').update(bytes.subarray(binaryStart, binaryStart + originalLength)).digest('hex'), provenance.sourceGeometrySha256);
assert.ok(gltf.images.every(image => image.bufferView !== undefined && image.uri === undefined));
assert.ok(gltf.buffers.every(buffer => buffer.uri === undefined));
assert.equal(gltf.materials.find(m => m.name.endsWith('_leaves')).alphaMode, 'MASK');

const source = new THREE.Group();
for (const primitive of gltf.meshes[0].primitives) {
  const accessor = gltf.accessors[primitive.attributes.POSITION];
  const view = gltf.bufferViews[accessor.bufferView];
  const start = bytes.byteOffset + binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const positions = new Float32Array(bytes.buffer, start, accessor.count * 3);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.MeshStandardMaterial(); material.name = gltf.materials[primitive.material].name;
  source.add(new THREE.Mesh(geometry, material));
}
const framing = {};
const point = new THREE.Vector3();
for (const size of ['desktop', 'mobile']) {
  const verification = JSON.parse(await readFile(resolve(root, 'cpu', size, 'verification.json'), 'utf8'));
  const state = verification.metrics.find(m => m.name === 'external' && m.view === 'whole');
  const info = state.externalTrees[0];
  assert.equal(state.externalTrees.length, 1);
  for (const view of ['whole', 'branches', 'bark', 'roots', 'top', 'course']) {
    const current = verification.metrics.find(m => m.name === 'current' && m.view === view);
    const external = verification.metrics.find(m => m.name === 'external' && m.view === view);
    assert.deepEqual(current.comparison, external.comparison, `${size}/${view}: camera, lighting or putting data differ`);
  }
  const { tree } = prepareReferenceTree(source.clone(), info.displayHeight);
  tree.position.fromArray(info.position);
  const orbit = JSON.parse(await readFile(resolve(root, 'cpu', size, 'external', 'orbit.json'), 'utf8'));
  const currentOrbit = JSON.parse(await readFile(resolve(root, 'cpu', size, 'current', 'orbit.json'), 'utf8'));
  assert.deepEqual(orbit.rotations, currentOrbit.rotations, `${size}: rotation cameras differ`);
  const angles = [];
  for (const frame of orbit.rotations) {
    assert.deepEqual(frame.camera, orbit.rotations[0].camera, 'Turntable camera moved');
    tree.rotation.y = info.rotation + frame.degrees / 180 * Math.PI;
    tree.updateMatrixWorld(true);
    const vp = new THREE.Matrix4().fromArray(frame.projection).multiply(new THREE.Matrix4().fromArray(frame.camera).invert());
    const limits = [Infinity, -Infinity, Infinity, -Infinity];
    tree.traverse(mesh => {
      if (!(mesh instanceof THREE.Mesh)) return;
      const positions = mesh.geometry.attributes.position;
      const matrix = new THREE.Matrix4().multiplyMatrices(vp, mesh.matrixWorld);
      // Sample dense source vertices, independently of image dimensions and silhouette guesses.
      for (let i = 0; i < positions.count; i += 16) {
        point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
        limits[0] = Math.min(limits[0], point.x); limits[1] = Math.max(limits[1], point.x);
        limits[2] = Math.min(limits[2], point.y); limits[3] = Math.max(limits[3], point.y);
      }
    });
    assert.ok(limits[0] >= -1 && limits[1] <= 1 && limits[2] >= -1 && limits[3] <= 1,
      `${size}/${frame.degrees}°: specimen clipped (${limits.join(', ')})`);
    angles.push({ degrees: frame.degrees, ndcBounds: limits });
  }
  framing[size] = { resolution: verification.resolution, sampleStride: 16, checkedAngles: angles.length, noSampledVerticesClipped: true, angles };
}
const html = await readFile(resolve(root, 'index.html'), 'utf8');
let checkedLinks = 0;
for (const [, link] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  if (/^https?:|^#/.test(link)) continue;
  await stat(resolve(root, link)); checkedLinks++;
}
const result = { assetHashVerified: true, originalGeometryUnchanged: true, selfContainedGlb: true,
  identicalCameraLightingAndPuttingData: true, checkedReportLinks: checkedLinks,
  backend: 'CPU reference only', browserCaptures: false, realDeviceFpsMeasured: false, framing };
await writeFile(resolve(root, 'artifact-checks.json'), JSON.stringify(result, null, 2) + '\n');
await copyFile(resolve(root, 'artifact-checks.json'), 'public/vegetation/tree-review/artifact-checks.json');
console.log(`Verified original geometry, embedded maps, ${checkedLinks} report links and 33 complete-tree turntable angles at both resolutions`);
