// Package publisher geometry and PBR maps without decimation or remodelling.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const sharp = (await import(pathToFileURL(require.resolve('sharp', { paths: [resolve('node_modules/@drawcall/webgl')] })).href)).default;
const source = resolve('.references/tree-small-02');
const output = resolve('public/vegetation/external/tree-small-02');
await mkdir(output, { recursive: true });
const gltf = JSON.parse(await readFile(resolve(source, 'tree_small_02_2k.gltf'), 'utf8'));
const original = await readFile(resolve(source, gltf.buffers[0].uri));
const chunks = [original];
let offset = original.length;
const align = bytes => Buffer.concat([bytes, Buffer.alloc((4 - bytes.length % 4) % 4)]);
for (const image of gltf.images) {
  let bytes;
  if (image.name.includes('leaves_diff')) {
    const alpha = await sharp(resolve(source, 'textures/tree_small_02_leaves_alpha_2k.png')).greyscale().raw().toBuffer();
    bytes = await sharp(resolve(source, image.uri)).removeAlpha().joinChannel(alpha, { raw: { width: 2048, height: 2048, channels: 1 } }).png().toBuffer();
    image.mimeType = 'image/png';
  } else bytes = await readFile(resolve(source, image.uri));
  image.bufferView = gltf.bufferViews.length;
  gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
  delete image.uri;
  const padded = align(bytes); chunks.push(padded); offset += padded.length;
}
gltf.buffers = [{ byteLength: offset }];
const leaves = gltf.materials.find(m => m.name.endsWith('_leaves'));
leaves.alphaMode = 'MASK'; leaves.alphaCutoff = 0.45;
for (const material of gltf.materials) {
  material.occlusionTexture = { ...structuredClone(material.pbrMetallicRoughness.metallicRoughnessTexture),
    strength: material === leaves ? 0.65 : 0.85 };
}
gltf.asset.copyright = 'Tree Small 02 — Rico Cilliers / Poly Haven — CC0-1.0';
gltf.asset.extras = { source: 'https://polyhaven.com/a/tree_small_02', license: 'CC0-1.0',
  changes: 'Original geometry, UVs and normals preserved. Original 2K leaf alpha joined to diffuse. Alpha mask 0.45; original ARM red channel used as AO (leaves 0.65, wood 0.85). Embedded as GLB.' };
const json = Buffer.from(JSON.stringify(gltf));
const jsonChunk = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const binary = Buffer.concat(chunks);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonChunk.length + binary.length, 8);
const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonChunk.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length); binHeader.writeUInt32LE(0x004e4942, 4);
const result = Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binary]);
await writeFile(resolve(output, 'tree-small-02.glb'), result);
const audit = { asset: 'Tree Small 02', author: 'Rico Cilliers', publisher: 'Poly Haven',
  source: 'https://polyhaven.com/a/tree_small_02', license: 'CC0-1.0',
  licenseUrl: 'https://polyhaven.com/license', legalCode: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode',
  file: 'tree-small-02.glb', bytes: result.length,
  sha256: createHash('sha256').update(result).digest('hex'),
  sourceGeometrySha256: createHash('sha256').update(original).digest('hex'),
  geometryPreservedByteForByte: true, nativeHeightMeters: Math.max(...gltf.accessors.filter(a => a.max?.length === 3).map(a => a.max[1])) - Math.min(...gltf.accessors.filter(a => a.min?.length === 3).map(a => a.min[1])),
  primitives: gltf.meshes.flatMap(m => m.primitives.map(p => ({ material: gltf.materials[p.material].name,
    vertices: gltf.accessors[p.attributes.POSITION].count, triangles: gltf.accessors[p.indices].count / 3 }))),
  textures: 'Original publisher 2048×2048 color / OpenGL normal / ARM, plus original leaf alpha PNG',
  conversion: gltf.asset.extras.changes,
  downloads: JSON.parse(await readFile(resolve(source, 'downloads.json'), 'utf8')),
};
await writeFile(resolve(output, 'provenance.json'), JSON.stringify(audit, null, 2) + '\n');
await writeFile(resolve(output, 'LICENSE.txt'), `Tree Small 02\nAuthor: Rico Cilliers\nPublisher: Poly Haven\nSource: ${audit.source}\nLicense: CC0 1.0 Universal\n${audit.licenseUrl}\n${audit.legalCode}\nFree for commercial use, modification and redistribution. Attribution is appreciated by the publisher.\n\n${audit.conversion}\n\nOriginal download hashes and URLs: provenance.json\n`);
console.log(JSON.stringify({ bytes: result.length, nativeHeight: audit.nativeHeightMeters, primitives: audit.primitives, sha256: audit.sha256 }, null, 2));
