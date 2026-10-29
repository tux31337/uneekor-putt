import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** Same Three.js scene, CPU adapter. These images are never browser/device captures. */
export async function renderGrassReview({ scene, tick, sharp, width, height, phone, THREE }) {
  const outputName = process.argv.find(arg => arg.startsWith('--grass-output='))?.split('=')[1] ?? 'grass-review';
  assert.match(outputName, /^[a-z0-9-]+$/, 'Grass output must be a directory name inside artifacts');
  const root = resolve('artifacts', outputName, 'cpu', phone ? 'mobile' : 'desktop');
  await mkdir(root, { recursive: true });
  const hash = data => createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
  function conserved() {
    const state = scene.getReviewState();
    const trees = [];
    scene.course.traverse(node => { if (node.isMesh) trees.push([node.name, node.position.toArray(), node.quaternion.toArray(), node.scale.toArray(), hash(node.geometry.attributes.position.array)]); });
    return { camera: state.cameraMatrix, projection: state.projectionMatrix, ball: state.ball, elapsed: state.elapsed,
      green: state.green, cup: scene.cup.position.toArray(), flag: scene.flag.position.toArray(), trajectory: scene.trajectory,
      plane: hash(scene.scene.getObjectByName('putting-surface').geometry.attributes.position.array), trees,
      sun: [scene.sun.position.toArray(), scene.sun.target.position.toArray(), scene.sun.color.toArray(), scene.sun.intensity,
        scene.sun.shadow.camera.projectionMatrix.toArray(), scene.sun.shadow.mapSize.toArray()],
      resolution: [width, height, state.pixelRatio] };
  }
  scene.setView({ grid: false, flow: false, trajectory: false, heatmap: false, quality: 'high' });
  scene.seek(0);
  const metrics = [], comparisons = new Map(), pixelsByView = new Map();
  const views = process.argv.includes('--quick') ? ['macro', 'edge'] : ['ball', 'macro', 'edge', 'edge-macro', 'course', 'rolling'];
  for (const mode of ['baseline', 'prototype']) {
    scene.setGrassMode(mode);
    const directory = resolve(root, mode); await mkdir(directory, { recursive: true });
    for (const view of views) {
      scene.seek(view === 'rolling' ? 0.6 : 0);
      scene.setGrassInspection(view === 'rolling' ? 'macro' : view);
      const pixels = Buffer.from(tick());
      const invariant = conserved();
      if (mode === 'baseline') comparisons.set(view, invariant);
      else assert.deepEqual(invariant, comparisons.get(view), `${view}: grass changed the camera, shot, trees or lighting`);
      const state = scene.getReviewState();
      assert.equal(state.heroModels, 6); assert.equal(state.imageTrees, 32); assert.equal(state.forestClusters, 14);
      assert.deepEqual(scene.uniforms.uGrassBall.value.toArray(), [scene.ball.position.x, scene.ball.position.z]);
      await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(resolve(directory, `${view}.png`));
      const baselinePixels = pixelsByView.get(view);
      if (mode === 'baseline') pixelsByView.set(view, pixels);
      else {
        let delta = 0;
        for (let i = 0; i < pixels.length; i += 4) delta += Math.abs(pixels[i + 1] - baselinePixels[i + 1]);
        if (view === 'course') assert.ok(delta < 1000, 'Unresolved grass changed the distant course');
        else assert.ok(delta > 1000, `${view}: prototype did not change any visible grass`);
        const pair = await sharp({ create: { width: width * 2, height, channels: 4, background: '#edf1e8' } }).composite([
          { input: await sharp(baselinePixels, { raw: { width, height, channels: 4 } }).png().toBuffer(), left: 0, top: 0 },
          { input: await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer(), left: width, top: 0 },
        ]).jpeg({ quality: 94 }).toBuffer();
        await writeFile(resolve(root, `${view}-pair.jpg`), pair);
      }
      metrics.push({ grassMode: mode, view, ...state });
      console.log(`${phone ? 'mobile' : 'desktop'}/${mode}/${view}: rendered, camera/shot/trees/light preserved`);
    }
  }
  // Verify light/shadow response on actual rendered ribbons, independently of the ground.
  scene.seek(0); scene.setGrassMode('prototype'); scene.setGrassInspection('macro'); tick();
  const near = scene.grassTips.near;
  const hidden = [];
  scene.scene.traverse(node => { if ((node.isMesh || node.isLine) && node !== near) { hidden.push([node, node.visible]); node.visible = false; } });
  const sunStrength = scene.sun.intensity;
  scene.renderer.shadowMap.needsUpdate = true; scene.invalidate(); const lit = Buffer.from(tick());
  scene.sun.intensity = 0; scene.invalidate(); const unlit = Buffer.from(tick()); scene.sun.intensity = sunStrength; scene.invalidate();
  let lightDelta = 0; for (let i = 0; i < lit.length; i += 4) lightDelta += Math.abs(lit[i + 1] - unlit[i + 1]);
  assert.ok(lightDelta > 1000, 'Prototype does not respond to scene lighting');
  assert.equal(near.receiveShadow, true); assert.equal(near.material.type, 'MeshStandardMaterial');
  // Invisible to the color/depth pass, but opaque in the sun's depth shadow pass.
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.015, 0.20), new THREE.MeshStandardMaterial({ colorWrite: false, depthWrite: false }));
  blocker.position.set(scene.ball.position.x - 0.04, scene.ball.position.y + 0.065, scene.ball.position.z - 0.025);
  blocker.castShadow = true; scene.scene.add(blocker);
  scene.renderer.shadowMap.needsUpdate = true; scene.invalidate(); const shaded = Buffer.from(tick());
  let shadowDelta = 0;
  for (let i = 0; i < lit.length; i += 4) shadowDelta += Math.max(0, lit[i + 1] - shaded[i + 1]);
  assert.ok(shadowDelta > 1000, 'Actual grass ribbons do not receive the course shadow');
  blocker.removeFromParent(); blocker.geometry.dispose(); blocker.material.dispose();
  scene.renderer.shadowMap.needsUpdate = true;
  hidden.forEach(([node, visible]) => { node.visible = visible; }); scene.invalidate();
  const stationary = Buffer.from(tick());
  scene.invalidate();
  assert.deepEqual(Buffer.from(tick()), stationary, 'Stationary grass changed between rendered frames');
  scene.seek(0.6); scene.setGrassInspection('macro'); tick();
  scene.seek(0); scene.setGrassInspection('macro');
  assert.deepEqual(Buffer.from(tick()), stationary, 'Grass changed after seeking away and back to the same shot');
  let bladePixelDelta = 0, reliefPixelDelta = 0;
  if (outputName.startsWith('grass-depth')) {
    // Render the actual layers separately, so a colour-only change cannot pass as 3D turf.
    near.visible = false; scene.invalidate();
    const groundOnly = Buffer.from(tick());
    scene.turfMaterials.canopyUniforms.uCanopyRelief.value = 0; scene.invalidate();
    const noRelief = Buffer.from(tick());
    for (let i = 0; i < stationary.length; i += 4) {
      bladePixelDelta += Math.abs(stationary[i + 1] - groundOnly[i + 1]);
      reliefPixelDelta += Math.abs(groundOnly[i + 1] - noRelief[i + 1]);
    }
    assert.ok(bladePixelDelta > 1000, 'Close-up grass has no visible geometric canopy');
    assert.ok(reliefPixelDelta > 1000, 'The canopy relief has no visible depth response');
    const diagnostic = resolve(root, 'diagnostics'); await mkdir(diagnostic, { recursive: true });
    await sharp(groundOnly, { raw: { width, height, channels: 4 } }).png().toFile(resolve(diagnostic, 'ground-only.png'));
    await sharp(noRelief, { raw: { width, height, channels: 4 } }).png().toFile(resolve(diagnostic, 'no-relief.png'));
    near.visible = true; scene.turfMaterials.canopyUniforms.uCanopyRelief.value = 1; scene.invalidate();
    assert.deepEqual(Buffer.from(tick()), stationary, 'Diagnostic renders did not restore the original frame');
  }
  // Inspect actual collar triangles rather than trusting the analytic root-height formula.
  const roots = scene.grassTips.edge.geometry.attributes.rootData;
  const tufts = scene.grassTips.edge.geometry.attributes.tuft;
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 2);
  let maxRootGap = 0;
  for (let i = 0; i < roots.count; i += 17) {
    ray.ray.origin.set(tufts.getX(i), roots.getX(i) + 1, tufts.getY(i));
    const hit = ray.intersectObjects(scene.terrain.children, false)[0];
    assert.ok(hit, 'A collar crown has no ground beneath it');
    const gap = roots.getX(i) - hit.point.y;
    maxRootGap = Math.max(maxRootGap, Math.abs(gap));
    assert.ok(gap <= 0.00005 && gap >= -0.0004, 'A collar crown floats above or sinks into the ground');
  }
  assert.equal(near.geometry.attributes.position.count, 24);
  assert.equal(near.geometry.index.count / 3, 18);
  const shape = near.geometry.attributes.position;
  assert.ok(Math.abs((shape.getX(7) - shape.getX(6)) / (shape.getX(1) - shape.getX(0)) - 0.62) < 1e-6, 'Mown ends must retain width');
  const edgeLengths = scene.grassTips.edge.geometry.attributes.rootData;
  for (const [min, max] of [[0.002,0.004], [0.008,0.014], [0.024,0.036]]) {
    let matching = 0; for (let i = 0; i < edgeLengths.count; i++) if (edgeLengths.getY(i) >= min && edgeLengths.getY(i) <= max) matching++;
    assert.ok(matching > 500, 'Missing one of the green / fringe / rough cuts');
  }
  const conservedFiles = JSON.parse(await readFile(resolve('scripts/grass-baseline.json'), 'utf8')).unchangedSources;
  for (const item of conservedFiles) {
    const current = createHash('sha256').update(await readFile(resolve(item.file))).digest('hex');
    assert.equal(current, item.sha256, `${item.file}: unrelated source changed`);
  }
  const report = { backend: 'CPU / @drawcall/webgl / Mesa lavapipe', browserCapture: false, physicalMobileDevice: false,
    fps: null, browserBlocker: 'Automatic approval review rejected reading an unrelated private Chrome window; no connected task browser available', resolution: [width, height], sharedCameraAndLighting: true,
    preservedPuttingAndTrees: true, lightingResponse: true, shadowResponse: true, lightDelta, shadowDelta,
    mownEndAndThreeCutsVerified: true, pbrShadowReception: true, sourceHashesVerified: true,
    stationaryFramesStable: true, seekRoundTripStable: true, maxRootGapMeters: maxRootGap,
    bladePixelDelta, reliefPixelDelta, metrics };
  await writeFile(resolve(root, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
}
