// Offline CPU bake of original 3D assets, NOT a browser performance benchmark.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import * as THREE from 'three';
import { createCanvas, installGlobals } from '@drawcall/webgl';

installGlobals();
const require = createRequire(import.meta.url);
const sharp = (await import(pathToFileURL(require.resolve('sharp', { paths: [resolve('node_modules/@drawcall/webgl')] })).href)).default;
const manifest = JSON.parse(await readFile('public/vegetation/manifest.json', 'utf8'));
const tile = manifest.tile;
const canvas = createCanvas(tile, tile);
Object.defineProperty(canvas.getContext('webgl2', { antialias: true }), 'drawingBufferColorSpace', { value: 'srgb', writable: true });
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false });
renderer.setSize(tile, tile, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.setClearColor(0, 0);
const scene = new THREE.Scene();
const server = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
try {
  const { createTreeModel, addVegetationLighting, randomSource } = await server.ssrLoadModule('/src/scene/vegetation/TreeModels.ts');
  addVegetationLighting(scene);
  await mkdir('public/vegetation/atlases', { recursive: true });
  for (let variant = 0; variant < manifest.trees.length; variant++) {
    if (process.argv.includes('--forest-only')) continue;
    const { group, info } = createTreeModel(variant);
    scene.add(group);
    const camera = new THREE.OrthographicCamera(-info.size / 2, info.size / 2, info.size / 2, -info.size / 2, 0.1, 100);
    const center = new THREE.Vector3(...info.center);
    const frames = [];
    for (let row = 0; row < manifest.elevations.length; row++) {
      for (let az = 0; az < manifest.azimuths; az++) {
        const yaw = az / manifest.azimuths * Math.PI * 2;
        const elevation = Math.min(89.99, manifest.elevations[row]) * Math.PI / 180;
        camera.position.set(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation)).multiplyScalar(30).add(center);
        camera.lookAt(center);
        renderer.render(scene, camera);
        frames.push({ input: Buffer.from(canvas.readPixels()), raw: { width: tile, height: tile, channels: 4 }, left: az * tile, top: row * tile });
      }
    }
    await sharp({ create: { width: tile * manifest.azimuths, height: tile * manifest.elevations.length, channels: 4, background: '#00000000' } })
      .composite(frames).png().toFile(`public/vegetation/atlases/${info.name}.png`);
    scene.remove(group);
    group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    console.log(`Baked ${info.name}: 8 azimuths × 4 elevations, ${tile}px each`);
  }
  // Forest clusters contain whole trees, baked into four original layered silhouettes.
  const forestTiles = [];
  for (let variant = 0; variant < 4; variant++) {
    for (let row = 0; row < 4; row++) {
      const random = randomSource(1700 + variant);
      const layers = [];
      for (let i = 0; i < 18; i++) {
        const tree = manifest.trees[(i * 5 + variant) % 6];
        const height = Math.round(210 + random() * 150), width = height;
        const az = Math.floor(random() * 8);
        const input = await sharp(`public/vegetation/atlases/${tree.name}.png`).extract({ left: az * tile, top: row * tile, width: tile, height: tile })
          .resize(width, height).modulate({ brightness: i < 9 ? 0.78 : 0.94 }).png().toBuffer();
        layers.push({ input, left: Math.round(14 + i % 9 * 92 + random() * 45), top: 384 - height - Math.round(random() * 14) });
      }
      const fullSize = await sharp({ create: { width: 1152, height: 384, channels: 4, background: '#00000000' } }).composite(layers).png().toBuffer();
      const input = await sharp(fullSize).resize(768, 256).png().toBuffer();
      forestTiles.push({ input, left: 0, top: (variant * 4 + row) * 256 });
    }
  }
  await sharp({ create: { width: 768, height: 4096, channels: 4, background: '#00000000' } }).composite(forestTiles).png().toFile('public/vegetation/forest-clusters.png');
  await writeFile('public/vegetation/BAKE.txt', 'Original 3D models rendered with @drawcall/webgl CPU adapter. ACES exposure 1.12; same hemisphere and sun as PuttingScene. 6 forms, 8 azimuths and elevations 0/30/60/90 degrees. These bakes are assets, not device performance measurements.\n');
} finally { renderer.dispose(); canvas.destroy(); await server.close(); }
