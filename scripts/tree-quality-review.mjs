import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** Actual PuttingScene via Mesa/lavapipe CPU adapter. Never a browser or device capture. */
export async function renderTreeReview({ scene, tick, sharp, width, height, phone }) {
  const cleanup = process.argv.includes('--cleanup');
  const root = resolve('artifacts', cleanup ? 'tree-cleanup-review' : 'tree-quality-review', 'cpu', phone ? 'mobile' : 'desktop');
  const previous = cleanup ? JSON.parse(await readFile(resolve('artifacts/tree-quality-review/cpu', phone ? 'mobile' : 'desktop', 'verification.json'), 'utf8')).metrics : undefined;
  const refreshWhole = process.argv.includes('--refresh-whole');
  const views = cleanup ? ['whole', 'roots', 'course'] : refreshWhole ? ['whole'] : process.argv.includes('--quick') ? ['whole', 'branches', 'roots']
    : ['whole', 'branches', 'bark', 'roots', 'top', 'course'];
  const references = new Map();
  const metrics = refreshWhole ? JSON.parse(await readFile(resolve(root, 'verification.json'), 'utf8')).metrics.filter(row => row.view !== 'whole') : [];
  const hash = array => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
  function conserved() {
    const state = scene.getReviewState();
    return { camera: state.cameraMatrix, projection: state.projectionMatrix,
      ball: state.ball, elapsed: state.elapsed, green: state.green,
      cup: scene.cup.position.toArray(), flag: scene.flag.position.toArray(),
      trajectory: scene.trajectory,
      puttingPlane: hash(scene.scene.getObjectByName('putting-surface').geometry.attributes.position.array),
      light: { position: scene.sun.position.toArray(), target: scene.sun.target.position.toArray(),
        color: scene.sun.color.toArray(), intensity: scene.sun.intensity,
        shadow: scene.sun.shadow.camera.projectionMatrix.toArray(), mapSize: scene.sun.shadow.mapSize.toArray() },
      width, height, pixelRatio: state.pixelRatio,
    };
  }
  scene.setView({ grid: true, flow: false, trajectory: true, heatmap: false, quality: 'high' });
  for (const [name, mode] of cleanup ? [['external', 'specimen']] : [['current', 'hybrid'], ['external', 'specimen']]) {
    await scene.setEnvironment(mode);
    const directory = resolve(root, name);
    await mkdir(directory, { recursive: true });
    scene.seek(0);
    for (const view of views) {
      scene.setTreeInspection(view);
      const pixels = tick();
      const comparison = conserved();
      if (cleanup) {
        const before = previous.find(row => row.name === 'external' && row.view === view);
        // The saved JSON normalizes signed zero; compare in the same representation.
        assert.deepEqual(JSON.parse(JSON.stringify(comparison)), before.comparison, `${view}: cleanup changed the camera, lighting or shot`);
        assert.equal(scene.getReviewState().imageTrees, before.imageTrees - 21, 'Only the 21 miniature trees should be removed');
      } else if (name === 'current') references.set(view, comparison);
      else assert.deepEqual(comparison, references.get(view), `${view}: camera, lighting or shot changed`);
      await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toFile(resolve(directory, `${view}.png`));
      metrics.push({ name, view, ...scene.getReviewState(), comparison,
        backend: 'CPU / @drawcall/webgl / Mesa lavapipe', browserCapture: false, mobileHardware: false, fps: null });
      console.log(`${phone ? 'mobile' : 'desktop'}/${name}/${view}: saved; shared camera, lighting and putting data verified`);
    }
    if (cleanup || process.argv.includes('--stills')) continue;
    const frames = [];
    const rotations = [];
    const count = 32;
    for (let i = 0; i <= count; i++) {
      const radians = i / count * Math.PI * 2;
      scene.setTreeInspection('whole', radians);
      const pixels = Buffer.from(tick());
      const comparison = conserved();
      if (name === 'current') references.set(`orbit-${i}`, comparison);
      else assert.deepEqual(comparison, references.get(`orbit-${i}`), `orbit ${i}: comparison changed`);
      frames.push(pixels);
      rotations.push({ degrees: i / count * 360, camera: comparison.camera, projection: comparison.projection });
      if (i % 4 === 0) console.log(`${phone ? 'mobile' : 'desktop'}/${name}: ${i / count * 360} degrees`);
    }
    await sharp(Buffer.concat(frames), { raw: { width, height: height * frames.length, channels: 4, pageHeight: height } })
      .gif({ delay: 120, loop: 0, effort: 3 }).toFile(resolve(directory, 'orbit.gif'));
    await writeFile(resolve(directory, 'orbit.json'), JSON.stringify({ backend: 'CPU reference, not browser footage', resolution: [width, height],
      frameCount: frames.length, fullRotation: true, rotation: 'tree rotates in place; fixed camera and sunlight', cameraAndShotMatch: true, rotations }, null, 2) + '\n');
    const thumbnailWidth = phone ? 195 : 320;
    const thumbnailHeight = Math.round(height * thumbnailWidth / width);
    const tiles = await Promise.all([0, 4, 8, 12, 16, 20, 24, 28].map(async (index, i) => ({
      input: await sharp(frames[index], { raw: { width, height, channels: 4 } }).resize(thumbnailWidth, thumbnailHeight).png().toBuffer(),
      left: i % 4 * thumbnailWidth, top: Math.floor(i / 4) * thumbnailHeight,
    })));
    await sharp({ create: { width: thumbnailWidth * 4, height: thumbnailHeight * 2, channels: 3, background: '#edf1e8' } })
      .composite(tiles).jpeg({ quality: 93 }).toFile(resolve(directory, 'orbit-strip.jpg'));
  }
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, 'verification.json'), JSON.stringify({ resolution: [width, height], backend: 'CPU reference only',
    browserCaptureAvailable: false, browserBlocker: 'Windows Computer Use stopped because current Chrome URL could not be verified',
    realDeviceFpsMeasured: false, sharedCameraAndLighting: true, preservedPuttingData: true,
    onlyOneExternalTree: true, ...(cleanup ? { miniatureTreesRemoved: 21, comparedWithPreviousCapture: true } : {}), metrics }, null, 2) + '\n');
}
