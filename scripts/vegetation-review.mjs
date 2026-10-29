import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Review the actual scene with a CPU WebGL adapter. FPS is deliberately not measured. */
export async function renderVegetationReview({ scene, tick, sharp, width, height, phone, THREE }) {
  const root = resolve('artifacts/vegetation-review/cpu', phone ? 'mobile' : 'desktop');
  await mkdir(root, { recursive: true });
  scene.setView({ grid: true, flow: false, trajectory: true, heatmap: false, quality: 'high' });
  const cameras = ['ball', 'perspective', 'top'];
  const modes = ['original', 'images', 'hybrid'];
  const reference = new Map();
  const metrics = [];
  for (const mode of modes) {
    await scene.setEnvironment(mode);
    const directory = resolve(root, mode);
    await mkdir(directory, { recursive: true });
    for (const camera of cameras) {
      scene.seek(0); scene.setCamera(camera, false);
      const pixels = tick();
      const state = scene.getReviewState();
      const comparable = { camera: state.cameraMatrix, projection: state.projectionMatrix, ball: state.ball, elapsed: state.elapsed, green: state.green, width, height, pixelRatio: state.pixelRatio };
      if (mode === 'original') reference.set(camera, comparable);
      else assert.deepEqual(comparable, reference.get(camera), `${mode}/${camera}: the comparison changed the camera or shot.`);
      await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toFile(resolve(directory, `${camera}.png`));
      const { viewSamples, ...summary } = state;
      metrics.push({ ...summary, backend: 'CPU / @drawcall/webgl / Mesa lavapipe', fps: null, mobileHardware: false });
      scene.setReviewOrbit(camera, 0, true);
      await sharp(Buffer.from(tick()), { raw: { width, height, channels: 4 } }).png().toFile(resolve(directory, `${camera}-tree.png`));
      const focusState = scene.getReviewState();
      const focusCamera = { camera: focusState.cameraMatrix, projection: focusState.projectionMatrix };
      if (mode === 'original') reference.set(`${camera}-tree`, focusCamera);
      else assert.deepEqual(focusCamera, reference.get(`${camera}-tree`), 'Tree inspection cameras must also match.');
      scene.setCamera(camera, false);
      if (process.argv.includes('--stills')) continue;

      const frames = [];
      // Include every 45-degree azimuth boundary and an exact wrap back to the starting frame.
      const count = 32;
      let previous;
      const differences = [];
      for (let i = 0; i <= count; i++) {
        scene.setReviewOrbit(camera, i / count * Math.PI * 2, camera === 'top');
        const rgba = Buffer.from(tick());
        const cameraDirection = new THREE.Vector3();
        const planeNormal = new THREE.Vector3(0, 0, 1);
        scene.course.traverse(object => {
          if (!object.name.includes('multiview-images')) return;
          for (let j = 0; j < object.count; j++) {
            const matrix = new THREE.Matrix4(); object.getMatrixAt(j, matrix);
            const position = new THREE.Vector3().setFromMatrixPosition(matrix);
            cameraDirection.subVectors(scene.camera.position, position).normalize();
            const normal = planeNormal.clone().transformDirection(matrix);
            assert.ok(normal.dot(cameraDirection) > 0.99999, `${mode}/${camera}: a tree card turned edge-on.`);
            assert.ok(matrix.elements.every(Number.isFinite), 'A camera pole produced a non-finite tree transform.');
          }
        });
        const reduced = await sharp(rgba, { raw: { width, height, channels: 4 } }).resize(480, Math.round(height / width * 480)).raw().toBuffer({ resolveWithObject: true });
        frames.push(reduced);
        if (previous) {
          let sum = 0;
          for (let p = 0; p < rgba.length; p += 4) sum += Math.abs(rgba[p] - previous[p]) + Math.abs(rgba[p + 1] - previous[p + 1]) + Math.abs(rgba[p + 2] - previous[p + 2]);
          differences.push(Number((sum / (width * height * 3)).toFixed(3)));
        }
        previous = rgba;
      }
      // A looping animated GIF is a CPU-rendered turntable, not a captured browser video.
      const frameHeight = frames[0].info.height;
      await sharp(Buffer.concat(frames.map(frame => frame.data)), { raw: { width: 480, height: frameHeight * frames.length, channels: 4, pageHeight: frameHeight } })
        .gif({ delay: 95, loop: 0, effort: 3 }).toFile(resolve(directory, `${camera}-orbit.gif`));
      const strips = await Promise.all([0, 4, 8, 12, 16, 20, 24, 28].map(async (index, i) => ({
        input: await sharp(frames[index].data, { raw: { width: 480, height: frameHeight, channels: 4 } }).resize(240, Math.round(frameHeight / 2)).jpeg({ quality: 88 }).toBuffer(),
        left: i % 4 * 240, top: Math.floor(i / 4) * Math.round(frameHeight / 2),
      })));
      await sharp({ create: { width: 960, height: Math.round(frameHeight / 2) * 2, channels: 3, background: '#edf1e8' } }).composite(strips).jpeg({ quality: 90 }).toFile(resolve(directory, `${camera}-orbit-strip.jpg`));
      await writeFile(resolve(directory, `${camera}-rotation.json`), JSON.stringify({ mode, camera, focus: camera === 'top' ? 'hero tree inspection' : 'original green camera', width, height, frames: count + 1, fullTurn: true, cardFacingAssertion: 'passed', differences, note: 'CPU reference. Whole-frame differences are motion indicators, not a proof of no perceptual popping.' }, null, 2));
      console.log(`${phone ? 'mobile' : 'desktop'} ${mode}/${camera}: ${state.drawCalls} draws, ${state.triangles} triangles; camera/shot match and 360° card-facing checks passed.`);
    }
  }
  await writeFile(resolve(root, 'metrics.json'), JSON.stringify({ resolution: [width, height], backend: 'CPU reference only', browserPerformanceMeasured: false, metrics }, null, 2) + '\n');
}
