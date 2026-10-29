// Acquire one original CC0 asset from its publisher, verifying publisher MD5s.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const root = resolve('.references/tree-small-02');
await mkdir(root, { recursive: true });
async function download(url, destination, expected) {
  let bytes;
  try { bytes = await readFile(destination); } catch {}
  const valid = data => data && (!expected || createHash('md5').update(data).digest('hex') === expected);
  if (!valid(bytes)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new Error(`Publisher checksum mismatch: ${destination}`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  console.log(`${destination.replace(root, '')}: ${bytes.length} bytes`);
  return { url, file: destination.replace(`${root}\\`, ''), bytes: bytes.length,
    md5: createHash('md5').update(bytes).digest('hex'), sha256: createHash('sha256').update(bytes).digest('hex') };
}

await download('https://api.polyhaven.com/files/tree_small_02', resolve(root, 'files.json'));
await download('https://api.polyhaven.com/info/tree_small_02', resolve(root, 'info.json'));
await download('https://polyhaven.com/license', resolve(root, 'publisher-license.html'));
for (const [name, url] of [
  ['publisher-preview.png', 'https://cdn.polyhaven.com/asset_img/primary/tree_small_02.png?width=1024&height=1024'],
  ['publisher-front.png', 'https://cdn.polyhaven.com/asset_img/renders/tree_small_02/orth_front.png?width=1024&height=1024'],
  ['publisher-top.png', 'https://cdn.polyhaven.com/asset_img/renders/tree_small_02/orth_top.png?width=1024&height=1024'],
]) await download(url, resolve(root, name));
const files = JSON.parse(await readFile(resolve(root, 'files.json'), 'utf8'));
const model = files.gltf['2k'].gltf;
const entries = [['tree_small_02_2k.gltf', model], ...Object.entries(model.include)];
entries.push(['textures/tree_small_02_leaves_alpha_2k.png', files.leaves_alpha['2k'].png]);
const records = [];
for (let i = 0; i < entries.length; i += 3) {
  records.push(...await Promise.all(entries.slice(i, i + 3).map(([file, info]) =>
    download(info.url, resolve(root, file), info.md5))));
}
await writeFile(resolve(root, 'downloads.json'), JSON.stringify({
  asset: 'Tree Small 02', source: 'https://polyhaven.com/a/tree_small_02',
  author: 'Rico Cilliers', license: 'CC0-1.0', licenseUrl: 'https://polyhaven.com/license',
  acquiredAt: new Date().toISOString(), records,
}, null, 2) + '\n');
const gltf = JSON.parse(await readFile(resolve(root, 'tree_small_02_2k.gltf'), 'utf8'));
console.log(JSON.stringify({ meshes: gltf.meshes.map(m => ({ name: m.name,
  primitives: m.primitives.map(p => ({ material: p.material, indices: gltf.accessors[p.indices]?.count,
    vertices: gltf.accessors[p.attributes.POSITION]?.count })) })), materialNames: gltf.materials.map(m => m.name) }, null, 2));
