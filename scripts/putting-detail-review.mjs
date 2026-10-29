import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** Same scene and inspection poses, using the CPU adapter; never a browser capture. */
export async function renderPuttingDetailReview({ scene, tick, sharp, width, height, phone, THREE }) {
  const revision = process.argv.includes('--details-before') ? 'before' : 'after';
  const root = resolve('artifacts/putting-details-20261028/cpu', phone ? 'mobile' : 'desktop');
  const directory = resolve(root, revision);
  if (revision === 'before' && await access(resolve(directory, 'verification.json')).then(() => true, () => false)) {
    throw new Error('The original before snapshot is already saved. Use --details to verify the current revision.');
  }
  await mkdir(directory, { recursive: true });
  const hash = data => createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
  const snapshot = () => {
    const state = scene.getReviewState(), trees = [];
    scene.course.traverse(node => {
      if (node.isMesh) trees.push([node.name, node.position.toArray(), node.quaternion.toArray(), node.scale.toArray(), hash(node.geometry.attributes.position.array)]);
    });
    return { camera: state.cameraMatrix, projection: state.projectionMatrix, ball: state.ball,
      ballRadius: scene.ball.geometry.parameters.radius, elapsed: state.elapsed, green: state.green,
      trajectory: structuredClone(scene.trajectory), cup: scene.cup.position.toArray(), flag: scene.flag.position.toArray(),
      plane: hash(scene.scene.getObjectByName('putting-surface').geometry.attributes.position.array), trees,
      sun: [scene.sun.position.toArray(), scene.sun.target.position.toArray(), scene.sun.color.toArray(), scene.sun.intensity,
        scene.sun.shadow.camera.projectionMatrix.toArray(), scene.sun.shadow.mapSize.toArray()],
      resolution: [width, height, state.pixelRatio], grass: state.grass };
  };
  scene.setView({ grid: false, flow: false, trajectory: false, heatmap: false, quality: 'high' });
  scene.setGrassMode('prototype');
  const views = ['ball', 'macro', 'edge', 'edge-macro', 'course', 'rolling'];
  const previous = revision === 'after' ? JSON.parse(await readFile(resolve(root, 'before/verification.json'), 'utf8')) : undefined;
  const metrics = [];
  for (const view of views) {
    scene.seek(view === 'rolling' ? 0.6 : 0);
    scene.setGrassInspection(view === 'rolling' ? 'macro' : view);
    const pixels = Buffer.from(tick());
    const conserved = snapshot();
    // JSON snapshots normalize signed zero in matrices; compare the same serialized representation.
    if (previous) assert.deepEqual(JSON.parse(JSON.stringify(conserved)), previous.metrics.find(item => item.view === view).conserved,
      `${view}: camera, ball size/position, shot, plane, grass budget, trees or light changed`);
    await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(resolve(directory, `${view}.png`));
    metrics.push({ view, conserved, ...scene.getReviewState() });
    console.log(`${phone ? 'portrait' : 'landscape'}/${revision}/${view}: saved; geometry and shot conserved`);
  }
  const checks = revision === 'after'
    ? { ...await verifyContact({ scene, tick, sharp, width, height, directory }),
      ...await verifyFlow({ scene, tick, sharp, width, height, directory, THREE }) } : {};
  const conservedFiles = JSON.parse(await readFile(resolve('scripts/grass-baseline.json'), 'utf8')).unchangedSources;
  for (const item of conservedFiles) assert.equal(createHash('sha256').update(await readFile(resolve(item.file))).digest('hex'), item.sha256, item.file);
  const report = { backend: 'CPU / @drawcall/webgl / Mesa lavapipe', browserCapture: false, physicalMobileDevice: false,
    fps: null, revision, resolution: [width, height], sourceHashesVerified: true, ...checks, metrics };
  await writeFile(resolve(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
}

const delta = (a, b) => a.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : Math.abs(value - b[index])), 0);

async function verifyContact({ scene, tick, sharp, width, height, directory }) {
  const save = (pixels, name) => sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(resolve(directory, `${name}.png`));
  scene.seek(0); scene.setGrassInspection('macro');
  const stationary = Buffer.from(tick());
  scene.invalidate(); assert.deepEqual(Buffer.from(tick()), stationary, 'A stationary dimple/grass frame changed');
  scene.seek(0.6); scene.setGrassInspection('macro'); tick();
  scene.seek(0); scene.setGrassInspection('macro');
  assert.deepEqual(Buffer.from(tick()), stationary, 'Seeking away and back changed the contact frame');
  const near = scene.grassTips.near, hidden = [];
  scene.scene.traverse(node => {
    if ((node.isMesh || node.isLine) && node !== near) { hidden.push([node, node.visible]); node.visible = false; }
  });
  scene.renderer.shadowMap.needsUpdate = true; scene.invalidate();
  const pressed = Buffer.from(tick()), sphere = scene.uniforms.uGrassContactBall.value.clone();
  scene.uniforms.uGrassContactBall.value.w = 0; scene.invalidate();
  const upright = Buffer.from(tick());
  const compressionPixelDelta = delta(pressed, upright);
  assert.ok(compressionPixelDelta > 1000, `Touching blades did not deform (${compressionPixelDelta})`);
  await save(pressed, 'contact-blades'); await save(upright, 'unpressed-blades');
  const originalTrajectory = scene.trajectory;
  const raised = { id: 'airborne-contact-check', source: 'external', outcome: 'stopped', duration: 1,
    points: [{ x: 0, z: 0, y: 0.12, t: 0 }, { x: 0.1, z: 1, y: 0.12, t: 1 }] };
  const supplied = structuredClone(raised);
  scene.setTrajectory(raised); scene.seek(0);
  assert.equal(scene.ball.position.y, 0.12 + sphere.w, 'Supplied height changed');
  assert.equal(scene.uniforms.uGrassContactBall.value.w, 0, 'Airborne motion retained ground compression');
  assert.equal(scene.ballShadow.material.uniforms.uContact.value, 0, 'Airborne motion retained a contact core');
  scene.ball.visible = scene.ballShadow.visible = false;
  scene.renderer.shadowMap.needsUpdate = true; scene.invalidate();
  const airborne = Buffer.from(tick());
  scene.uniforms.uGrassContactBall.value.w = sphere.w; scene.invalidate();
  assert.deepEqual(Buffer.from(tick()), airborne, 'An elevated sphere changed the grass even without contact');
  assert.deepEqual(raised, supplied, 'Contact modified the supplied path, heights or time');
  await save(airborne, 'airborne-blades');
  scene.setTrajectory(originalTrajectory); scene.seek(0);
  hidden.forEach(([node, visible]) => { node.visible = visible; });
  scene.renderer.shadowMap.needsUpdate = true; scene.invalidate();
  assert.deepEqual(Buffer.from(tick()), stationary, 'Contact diagnostics did not restore the scene');
  const material = scene.ball.material;
  material.normalScale.set(0, 0); scene.invalidate();
  const smooth = Buffer.from(tick());
  const dimplePixelDelta = delta(stationary, smooth);
  assert.ok(dimplePixelDelta > 1000, 'The dimples have no light/normal response');
  await save(smooth, 'smooth-ball');
  material.normalScale.set(1, 1); scene.invalidate();
  assert.deepEqual(Buffer.from(tick()), stationary, 'The ball normal diagnostic did not restore the scene');
  console.log(`Contact/dimples: ${compressionPixelDelta} / ${dimplePixelDelta} pixel delta; airborne unaffected; seek stable`);
  return { compressionPixelDelta, dimplePixelDelta, dimpleCount: material.userData.dimpleCount,
    airborneGrassUnchanged: true, externalTrajectoryUnchanged: true, stationaryFramesStable: true, seekRoundTripStable: true };
}

async function verifyFlow({ scene, tick, sharp, width, height, directory, THREE }) {
  const originalGreen = { ...scene.green }, originalView = { ...scene.view };
  scene.setCamera('top', false);
  scene.setView({ ...originalView, grid: true, flow: true });
  scene.reducedMotion = true;
  scene.uniforms.uFlowTime.value = 0; scene.invalidate();
  const first = Buffer.from(tick());
  scene.uniforms.uFlowTime.value = 0.6; scene.invalidate();
  const second = Buffer.from(tick());
  const flowPixelDelta = delta(first, second);
  assert.ok(flowPixelDelta > 1000, 'The actual green has no moving slope beads');
  for (const [name, pixels] of [['flow-0', first], ['flow-06', second]]) {
    await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(resolve(directory, `${name}.png`));
  }
  scene.setCamera('ball', false); scene.invalidate();
  await sharp(Buffer.from(tick()), { raw: { width, height, channels: 4 } }).png().toFile(resolve(directory, 'flow-perspective.png'));
  // Rasterize the same shader in one grid cell to measure direction and speed from pixels.
  const { slopeFlowGLSL } = await import('../src/scene/SlopeFlow.ts');
  const material = new THREE.ShaderMaterial({ uniforms: { slope: { value: new THREE.Vector2() }, time: { value: 0 } },
    vertexShader: 'varying vec2 cell; void main(){cell=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `varying vec2 cell; uniform vec2 slope; uniform float time; ${slopeFlowGLSL}
      void main(){gl_FragColor=vec4(vec3(slopeFlow(cell,vec2(0.0),vec2(0.00001),slope,time)),1.0);}` });
  const testScene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  testScene.add(mesh);
  const centroid = (x, z, time) => {
    material.uniforms.slope.value.set(x, z); material.uniforms.time.value = time;
    scene.renderer.render(testScene, new THREE.Camera());
    const pixels = Buffer.from(tickPixels());
    let weight = 0, sumX = 0, sumZ = 0;
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
      const value = pixels[(py * width + px) * 4];
      weight += value; sumX += (px + 0.5) / width * value; sumZ += (1 - (py + 0.5) / height) * value;
    }
    return { x: sumX / weight, z: sumZ / weight, weight };
  };
  // Read the adapter directly, without scheduling another application frame.
  function tickPixels() { return scene.getCanvas().readPixels(); }
  for (const [x, z] of [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]]) {
    const start = centroid(x, z, 0), moved = centroid(x, z, 0.2);
    assert.ok(x ? (moved.x - start.x) * x < -0.002 : (moved.z - start.z) * z < -0.002,
      'Slope beads move uphill rather than downhill');
  }
  const slow = Math.abs(centroid(0.01, 0, 0.2).x - centroid(0.01, 0, 0).x);
  const fast = Math.abs(centroid(0.05, 0, 0.2).x - centroid(0.05, 0, 0).x);
  assert.ok(fast / slow > 4.5 && fast / slow < 5.5, 'A steeper plane did not move the beads faster');
  assert.equal(centroid(0, 0, 1).weight, 0, 'Flat ground shows a flow direction');
  mesh.geometry.dispose(); material.dispose();
  // Exercise the real rAF scheduler while suppressing expensive draws in this timing-only check.
  const render = scene.renderer.render.bind(scene.renderer);
  let draws = 0, now = 100000;
  scene.renderer.render = () => { draws++; };
  const frames = () => { for (let i = 0; i < 60; i++) { now += 1000 / 60; tick(now); } };
  const settle = () => { now += 1000; tick(now); draws = 0; };
  scene.reducedMotion = false; scene.lastTime = now; settle(); frames();
  const flowDrawsPerSecond = draws;
  assert.ok(draws > 10 && draws <= 30, `Flow cadence is outside its limit (${draws})`);
  scene.setView({ ...scene.view, flow: false }); settle();
  let frozen = scene.uniforms.uFlowTime.value; frames();
  assert.equal(draws, 0, 'Hidden flow keeps redrawing'); assert.equal(scene.uniforms.uFlowTime.value, frozen);
  scene.setView({ ...scene.view, flow: true }); scene.reducedMotion = true; settle();
  frozen = scene.uniforms.uFlowTime.value; frames();
  assert.equal(draws, 0, 'Reduced-motion flow keeps redrawing'); assert.equal(scene.uniforms.uFlowTime.value, frozen);
  scene.reducedMotion = false; document.hidden = true; draws = 0; frames();
  assert.equal(draws, 0, 'A hidden page keeps redrawing'); assert.equal(scene.uniforms.uFlowTime.value, frozen);
  document.hidden = false; scene.onVisibility();
  scene.setGreen({ ...originalGreen, crossSlope: 0, longitudinalSlope: 0 }); settle(); frames();
  assert.equal(draws, 0, 'Flat ground keeps redrawing');
  scene.setGreen(originalGreen); scene.seek(0.2); settle(); frames();
  assert.equal(scene.uniforms.uFlow.value, 0, 'Flow remains on screen after the shot starts');
  assert.equal(draws, 0, 'A paused shot keeps animating hidden flow');
  scene.renderer.render = render; scene.setView(originalView); scene.seek(0); scene.setGrassInspection('macro');
  scene.invalidate(); tick();
  console.log(`Slope flow: four downhill directions; stronger slope faster; ${flowDrawsPerSecond} draws/60 simulated rAFs; inactive states idle`);
  return { flowPixelDelta, flowDownhillVerified: true, flowSpeedVerified: true, flatFlowStopped: true,
    hiddenFlowStopped: true, reducedMotionFlowStopped: true, hiddenPageStopped: true, shotFlowHidden: true,
    flowDrawsPer60SimulatedFrames: flowDrawsPerSecond, maximumFlowFps: 30 };
}
