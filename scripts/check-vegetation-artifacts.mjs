import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
const sharp = (await import(pathToFileURL(require.resolve('sharp', { paths: [resolve('node_modules/@drawcall/webgl')] })).href)).default;
const root = resolve('artifacts/vegetation-review');
const manifest = JSON.parse(await readFile('public/vegetation/manifest.json', 'utf8'));
for (const tree of manifest.trees) {
  const glb = await readFile(`public/vegetation/models/${tree.name}.glb`);
  assert.equal(glb.toString('utf8', 0, 4), 'glTF'); assert.equal(glb.readUInt32LE(4), 2); assert.equal(glb.readUInt32LE(8), glb.length);
  const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  assert.ok(json.buffers.every(buffer => !buffer.uri), 'A model depends on an external buffer.');
  const triangles = json.meshes.flatMap(mesh => mesh.primitives).reduce((sum, primitive) => sum + json.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3, 0);
  assert.equal(triangles, tree.triangles);
  const image = sharp(`public/vegetation/atlases/${tree.name}.png`);
  const metadata = await image.metadata();
  assert.deepEqual([metadata.width, metadata.height], [2048, 1024]);
  assert.equal(metadata.hasAlpha, true);
  const channels = (await image.stats()).channels;
  assert.equal(channels[3].min, 0); assert.equal(channels[3].max, 255);
}
assert.deepEqual(await sharp('public/vegetation/forest-clusters.png').metadata().then(m => [m.width, m.height]), [768, 4096]);
let pngs = 0, gifs = 0;
for (const size of ['desktop', 'mobile']) {
  const dimensions = size === 'desktop' ? [960, 600] : [390, 564];
  for (const mode of ['original', 'images', 'hybrid']) for (const view of ['ball', 'perspective', 'top']) {
    for (const suffix of ['', '-tree']) {
      assert.deepEqual(await sharp(resolve(root, 'cpu', size, mode, `${view}${suffix}.png`)).metadata().then(m => [m.width, m.height]), dimensions); pngs++;
    }
    const gif = await sharp(resolve(root, 'cpu', size, mode, `${view}-orbit.gif`)).metadata();
    assert.equal(gif.pages, 33, 'The turntable was saved as a still image.'); gifs++;
  }
  const metrics = JSON.parse(await readFile(resolve(root, 'cpu', size, 'metrics.json'), 'utf8'));
  assert.equal(metrics.browserPerformanceMeasured, false);
  assert.ok(metrics.metrics.every(row => row.fps === null), 'CPU images must not be reported as device FPS.');
}
const html = await readFile(resolve(root, 'index.html'), 'utf8');
let links = 0;
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (/^(?:https?:|#)/.test(match[1])) continue;
  await stat(resolve(root, match[1])); links++;
}
// Check the actual shared billboard class at poles and azimuth wrap without GPU timing.
const server = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
let orientations = 0;
try {
  const { ImpostorBatch } = await server.ssrLoadModule('/src/scene/vegetation/ImpostorBatch.ts');
  const plant = { x: 0, z: 0, scale: 1, rotation: 0.3, variant: 0, tint: 1 };
  for (const [columns, rows, aspect] of [[8, 4, 1], [1, 4, 3]]) {
    const texture = new THREE.Texture();
    const batch = new ImpostorBatch(texture, [plant], 15, 5, columns, rows, aspect); batch.setGround(() => 0);
    const camera = new THREE.PerspectiveCamera();
    for (const elevation of [-10, 0, 30, 60, 89.99, 90]) for (let azimuth = 0; azimuth <= 360; azimuth += 5) {
      const yaw = azimuth * Math.PI / 180, pitch = elevation * Math.PI / 180;
      camera.position.set(Math.sin(yaw) * Math.cos(pitch) * 30, 5 + Math.sin(pitch) * 30, Math.cos(yaw) * Math.cos(pitch) * 30);
      camera.updateMatrixWorld(); batch.faceCamera(camera);
      const matrix = new THREE.Matrix4(); batch.getMatrixAt(0, matrix);
      assert.ok(matrix.elements.every(Number.isFinite));
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
      const direction = camera.position.clone().sub(new THREE.Vector3(0, 5, 0)).normalize();
      assert.ok(normal.dot(direction) > 0.99999, 'A tree or forest card became edge-on.');
      assert.ok(batch.getViewSamples().every(Number.isFinite)); orientations++;
    }
    batch.geometry.dispose(); batch.material.dispose(); batch.dispose(); texture.dispose();
  }
} finally { await server.close(); }
await writeFile(resolve(root, 'integrity.json'), JSON.stringify({ models: 6, transparentAtlases: 6, pngs, gifs, framesPerGif: 33, localReportLinks: links, treeAndForestOrientations: orientations, backend: 'asset and CPU reference validation; not browser performance' }, null, 2));
console.log(`Validated 6 self-contained GLBs, alpha atlases, ${pngs} PNGs, ${gifs} animated GIFs, ${links} report links and ${orientations} tree/forest orientations.`);
