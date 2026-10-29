import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// GLTFExporter only needs FileReader for packing the final binary buffer in Node.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
};
const server = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
try {
  const { TREE_PROFILES, createTreeModel } = await server.ssrLoadModule('/src/scene/vegetation/TreeModels.ts');
  const output = resolve('public/vegetation');
  await mkdir(resolve(output, 'models'), { recursive: true });
  const manifest = { version: 1, azimuths: 8, elevations: [0, 30, 60, 90], tile: 256, trees: [] };
  for (let i = 0; i < TREE_PROFILES.length; i++) {
    const { group, info } = createTreeModel(i);
    const glb = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: true });
    await writeFile(resolve(output, 'models', `${info.name}.glb`), Buffer.from(glb));
    manifest.trees.push(info);
    console.log(`${info.name}: ${info.triangles} triangles, ${(glb.byteLength / 1024).toFixed(0)} KiB`);
    group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir('src/assets/vegetation', { recursive: true });
  await writeFile('src/assets/vegetation/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
} finally { await server.close(); }
