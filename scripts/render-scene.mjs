// Render the actual PuttingScene offscreen. This does not open or control a browser.
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCanvas, installGlobals, ImageBitmap, createImageBitmap } from '@drawcall/webgl';

installGlobals();
const require = createRequire(import.meta.url);
const sharp = (await import(pathToFileURL(require.resolve('sharp', { paths: [resolve('node_modules/@drawcall/webgl')] })).href)).default;
const phone = process.argv.includes('--phone');
const portrait = phone || process.argv.includes('--portrait');
const width = portrait ? 390 : 960;
const height = phone ? 564 : portrait ? 520 : 600;
const canvas = createCanvas(width, height);
// The CPU adapter exposes this browser property as a getter; Three.js sets it to sRGB.
Object.defineProperty(canvas.getContext('webgl2', { antialias: true }), 'drawingBufferColorSpace', { value: 'srgb', writable: true });
let queue = new Map();
let nextFrame = 1;
globalThis.requestAnimationFrame = callback => { const id = nextFrame++; queue.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => queue.delete(id);

const documentShim = {
  hidden: false,
  addEventListener() {}, removeEventListener() {},
  createElementNS(_namespace, tag) {
    if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
    return canvas;
  },
  createElement(tag) {
    if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
    // CanvasTexture's radial contact shadow, represented as decoded pixels in Node.
    const pixels = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const distance = Math.hypot(x - 32, y - 32);
      const alpha = distance <= 3 ? 0.9 : distance <= 11.1
        ? 0.9 - (distance - 3) / 8.1 * 0.35 : Math.max(0, 0.55 * (30 - distance) / 18.9);
      const i = (y * 64 + x) * 4;
      pixels.set([20, 32, 10, Math.round(alpha * 255)], i);
    }
    const image = new ImageBitmap(64, 64, pixels);
    image.getContext = () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} });
    return image;
  },
};
globalThis.document = documentShim;
globalThis.window = { devicePixelRatio: 1 };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
canvas.ownerDocument = documentShim;
canvas.getRootNode = () => documentShim;
canvas.setAttribute = () => {};
canvas.remove = () => {};
canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width, height });
canvas.clientWidth = width;
canvas.clientHeight = height;
// Decode the same WebP assets into ImageBitmaps; HTMLImageElement is not a Node API.
THREE.TextureLoader.prototype.loadAsync = async url => {
  const source = String(url);
  const file = source.startsWith('file:') ? fileURLToPath(source) : source.includes('vegetation/') ? resolve('public/vegetation', source.split('vegetation/')[1]) : source;
  const bytes = await readFile(file);
  const bitmap = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'flipY' });
  const texture = new THREE.Texture(bitmap);
  texture.needsUpdate = true;
  return texture;
};
GLTFLoader.prototype.loadAsync = async url => {
  const file = resolve('public/vegetation', String(url).split('vegetation/')[1]);
  const bytes = await readFile(file);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
};
globalThis.ProgressEvent ??= class { constructor(type) { this.type = type; } };
globalThis.self ??= globalThis;

const server = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
let scene;
const failures = [];
let ready = false;
const phaseChanges = [];
const playingChanges = [];
let completed = 0;
try {
  const { PuttingScene } = await server.ssrLoadModule('/src/scene/PuttingScene.ts');
  const { DEFAULT_GREEN, DEFAULT_VIEW, makeSampleTrajectory, parseTrajectory, pointAtTime, heightAt } = await server.ssrLoadModule('/src/core/trajectory.ts');
  const host = { clientWidth: width, clientHeight: height, getBoundingClientRect: canvas.getBoundingClientRect, appendChild() {} };
  scene = new PuttingScene(host, DEFAULT_GREEN, DEFAULT_VIEW, makeSampleTrajectory(DEFAULT_GREEN), {
    onReady: () => { ready = true; }, onProgress() {}, onComplete() { completed++; }, onStats() {},
    onPhaseChange: phase => phaseChanges.push(phase),
    onPlayingChange: playing => playingChanges.push(playing),
    onError: message => { if (message) failures.push(message); },
  }, process.argv.includes('--tree') ? { environment: 'hybrid', fixedPixelRatio: 1 } : {});
  const tick = (now = performance.now()) => {
    const callbacks = queue;
    queue = new Map();
    callbacks.forEach(callback => callback(now));
    return canvas.readPixels();
  };
  for (let i = 0; i < 500 && !ready && !failures.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 30));
    tick();
  }
  if (failures.length) throw new Error(failures.join('\n'));
  if (!ready) throw new Error('The scene did not finish loading its turf maps and render a frame.');
  const output = resolve('.tmp/render', phone ? 'phone' : portrait ? 'portrait' : '.');
  await mkdir(output, { recursive: true });
  if (process.argv.includes('--details') || process.argv.includes('--details-before')) {
    const { renderPuttingDetailReview } = await import('./putting-detail-review.mjs');
    await renderPuttingDetailReview({ scene, tick, sharp, width, height, phone, THREE });
    if (failures.length) throw new Error(failures.join('\n'));
  } else if (process.argv.includes('--grass')) {
    const { renderGrassReview } = await import('./grass-review.mjs');
    await renderGrassReview({ scene, tick, sharp, width, height, phone, THREE });
    if (failures.length) throw new Error(failures.join('\n'));
  } else if (process.argv.includes('--tree')) {
    const { renderTreeReview } = await import('./tree-quality-review.mjs');
    await renderTreeReview({ scene, tick, sharp, width, height, phone, THREE });
    if (failures.length) throw new Error(failures.join('\n'));
  } else if (process.argv.includes('--vegetation')) {
    const { renderVegetationReview } = await import('./vegetation-review.mjs');
    await renderVegetationReview({ scene, tick, sharp, width, height, phone, THREE });
  } else {
  // Check the actual mesh and camera, including the extremes available in the UI.
  // These checks do not alter the trajectory provider's coordinates or playback time.
  const settingsCases = [
    DEFAULT_GREEN,
    { ...DEFAULT_GREEN, distance: 2, crossSlope: 0, longitudinalSlope: 0 },
    { ...DEFAULT_GREEN, distance: 2, crossSlope: -5, longitudinalSlope: -5 },
    { ...DEFAULT_GREEN, distance: 2, crossSlope: 5, longitudinalSlope: 5 },
    { ...DEFAULT_GREEN, distance: 2, crossSlope: 5, longitudinalSlope: -5 },
    { ...DEFAULT_GREEN, distance: 12, crossSlope: 5, longitudinalSlope: 5 },
    { ...DEFAULT_GREEN, distance: 12, crossSlope: -5, longitudinalSlope: -5 },
    { ...DEFAULT_GREEN, distance: 12, crossSlope: 5, longitudinalSlope: -5 },
  ];
  for (const settings of settingsCases) {
    scene.setGreen(settings);
    const positions = scene.scene.getObjectByName('putting-surface').geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const expected = positions.getX(i) * settings.crossSlope / 100 + positions.getZ(i) * settings.longitudinalSlope / 100;
      if (Math.abs(positions.getY(i) - expected) > 0.00001) throw new Error('Course hills intrude on the configured putting plane.');
    }
    for (const view of ['ball', 'surface', 'top', 'perspective']) {
      scene.setCamera(view, false);
      scene.camera.updateMatrixWorld();
      for (const [label, x, y, z] of [
        ['ball', 0, 0.02135, 0],
        ['cup', 0, settings.distance * settings.longitudinalSlope / 100, settings.distance],
        ['flag', 0, settings.distance * settings.longitudinalSlope / 100 + 1.8, settings.distance],
      ]) {
        const p = new THREE.Vector3(x, y, z).project(scene.camera);
        if (Math.abs(p.x) > 0.97 || Math.abs(p.y) > 0.97 || p.z < -1 || p.z > 1) {
          throw new Error(`${view}: ${label} falls outside the frame at ${settings.distance}m, slopes ${settings.crossSlope}/${settings.longitudinalSlope} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}).`);
        }
      }
      if (portrait && view === 'ball' && settings.distance === 6) {
        const centre = scene.ball.position.clone();
        const cameraRight = new THREE.Vector3().setFromMatrixColumn(scene.camera.matrixWorld, 0);
        const edge = centre.clone().addScaledVector(cameraRight, 0.02135).project(scene.camera);
        const projected = centre.project(scene.camera);
        const diameter = Math.abs(edge.x - projected.x) * width;
        assert.ok(diameter >= 8, `The portrait starting ball is too small: ${diameter.toFixed(1)} CSS pixels.`);
        console.log(`Portrait starting ball: ${diameter.toFixed(1)} CSS pixels in a ${width}×${height} viewport.`);
      }
      if (view === 'top' || view === 'perspective') {
        for (let i = 0; i < positions.count; i++) {
          const p = new THREE.Vector3().fromBufferAttribute(positions, i).project(scene.camera);
          if (Math.abs(p.x) > 0.98 || Math.abs(p.y) > 0.98) throw new Error(`${view}: the green edge is cropped at ${settings.distance}m.`);
        }
      }
    }
  }
  console.log(`Validated putting plane and four camera presets at 2–12m, ±5% slopes (${width}×${height}).`);

  // Use the real scene and projection math without drawing each intermediate assertion frame.
  for (const settings of settingsCases) {
    scene.setGreen(settings);
    const trajectory = makeSampleTrajectory(settings);
    scene.setTrajectory(trajectory);
    scene.setAutoCamera(true, false);
    for (const progress of [0, 0.25, 0.6, 0.9, 1]) {
      scene.seek(progress);
      assert.equal(scene.phase, progress === 0 ? 'ready' : progress === 1 ? 'result' : 'rolling');
      assert.equal(scene.playing, false, 'Seeking must pause the playback clock.');
      assert.equal(scene.uniforms.uGrid.value, progress === 0 ? 1 : 0, 'Reading overlays must follow the shot phase.');
      const point = pointAtTime(trajectory, progress * trajectory.duration);
      assert.ok(Math.abs(scene.ball.position.x - point.x) < 1e-10 && Math.abs(scene.ball.position.z - point.z) < 1e-10,
        'Automatic presentation changed a supplied trajectory coordinate.');
      scene.camera.updateMatrixWorld();
      for (const position of [
        new THREE.Vector3(point.x, heightAt(point.x, point.z, settings) + 0.02135, point.z),
        new THREE.Vector3(0, heightAt(0, settings.distance, settings), settings.distance),
        new THREE.Vector3(0.45, heightAt(0, settings.distance, settings) + 1.8, settings.distance),
      ]) {
        const p = position.project(scene.camera);
        const limit = progress === 0 ? 0.98 : 0.8;
        assert.ok(Math.abs(p.x) < limit && Math.abs(p.y) < limit && p.z > -1 && p.z < 1,
          `Automatic camera crops the shot at ${settings.distance}m, progress ${progress}: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}.`);
      }
      if (portrait && progress === 1) {
        const cup = new THREE.Vector3(0, heightAt(0, settings.distance, settings), settings.distance).project(scene.camera);
        assert.ok((1 - cup.y) * height / 2 < height - 110, 'The mobile result card would cover the cup.');
      }
    }
  }
  console.log('Validated automatic camera framing, preparation/rolling/result phases and overlay visibility.');

  scene.setGreen(DEFAULT_GREEN);
  const externalCases = [
    ['stopped-short', { outcome: 'stopped', points: [{ x: 0, z: 0, t: 10 }, { x: 0.2, z: 3.8, t: 12 }, { x: 0, z: 5.3, t: 14 }] }],
    ['stopped-long', { outcome: 'stopped', points: [{ x: 0, z: 0, t: 10 }, { x: 0.3, z: 5, t: 12 }, { x: 0.35, z: 7.1, t: 14 }] }],
    ['holed-timed', { outcome: 'holed', points: [{ x: 0, y: 0, z: 0, t: 10 }, { x: 0.12, y: 0.04, z: 4.8, t: 12 }, { x: 0, y: -0.08, z: 6, t: 14 }] }],
  ];
  const render = scene.renderer.render.bind(scene.renderer);
  scene.renderer.render = () => {};
  for (const [name, input] of externalCases) {
    const trajectory = parseTrajectory(input);
    const original = structuredClone(trajectory);
    scene.setTrajectory(trajectory);
    scene.setAutoCamera(true, false);
    scene.seek(0.5);
    assert.deepEqual({ x: scene.ball.position.x, z: scene.ball.position.z }, { x: trajectory.points[1].x, z: trajectory.points[1].z });
    assert.ok(Math.abs(scene.ballShadow.position.y - (heightAt(scene.ballShadow.position.x, scene.ballShadow.position.z, DEFAULT_GREEN) + 0.0018)) < 1e-8,
      'The contact shadow must stay on the green when the provider supplies a raised ball.');
    const checkpoint = scene.elapsed;
    scene.pause();
    scene.animate(performance.now());
    assert.equal(scene.elapsed, checkpoint, 'Pause advanced the trajectory clock.');
    scene.seek(0);
    scene.play();
    const start = performance.now();
    scene.animate(start);
    for (let frame = 1; frame <= 41; frame++) scene.animate(start + frame * 100);
    assert.equal(scene.phase, 'result', `${name} did not reach the result phase.`);
    assert.equal(scene.playing, false);
    assert.equal(scene.elapsed, trajectory.duration);
    assert.deepEqual(trajectory, original, 'Playback modified provider data.');
    if (trajectory.points.at(-1).y !== undefined) {
      assert.ok(Math.abs(scene.ball.position.y - (trajectory.points.at(-1).y + 0.02135)) < 1e-10,
        'The renderer applied an extra hole-in drop to a supplied height.');
    }
    scene.play();
    assert.equal(scene.phase, 'rolling', 'Replay did not clear the result state.');
    assert.equal(scene.elapsed, 0);
    scene.camera.updateMatrixWorld();
    const replayBall = scene.ball.position.clone().project(scene.camera);
    assert.ok(Math.abs(replayBall.x) < 0.98 && Math.abs(replayBall.y) < 0.98 && replayBall.z > -1 && replayBall.z < 1,
      'Replay must immediately bring the starting ball back into view.');
    scene.seek(0);
  }
  assert.equal(completed, 3, 'Completion must fire once per natural playback, never on seek.');
  assert.ok(phaseChanges.includes('ready') && phaseChanges.includes('rolling') && phaseChanges.includes('result'));

  // The visible roll button must work from a tree-focused manual camera, not just move an offscreen ball.
  scene.setTrajectory(makeSampleTrajectory(DEFAULT_GREEN));
  scene.seek(0);
  scene.setTreeInspection('whole', Math.PI / 2);
  const inputBeforeRoll = structuredClone(scene.trajectory);
  const playChangeStart = playingChanges.length;
  const completedBeforeRoll = completed;
  scene.rollBall();
  assert.equal(scene.autoCamera, true, 'Roll must enable the ball-follow camera from tree inspection.');
  assert.equal(scene.playing, true);
  assert.equal(scene.phase, 'rolling');
  scene.camera.updateMatrixWorld();
  const visibleStart = scene.ball.position.clone().project(scene.camera);
  assert.ok(Math.abs(visibleStart.x) < 0.98 && Math.abs(visibleStart.y) < 0.98 && visibleStart.z > -1 && visibleStart.z < 1,
    'The roll button left the starting ball outside the frame.');
  const rollStart = performance.now();
  scene.animate(rollStart); scene.animate(rollStart + 700);
  assert.ok(Math.abs(scene.elapsed - 0.7) < 1e-10);
  scene.pause(); scene.animate(rollStart + 900);
  assert.ok(Math.abs(scene.elapsed - 0.7) < 1e-10, 'Pausing the roll changed its time.');
  scene.rollBall(); scene.animate(rollStart + 1000); scene.animate(rollStart + 1500);
  assert.ok(Math.abs(scene.elapsed - 1.2) < 1e-10, 'Resuming the roll restarted the shot.');
  const rollingPoint = pointAtTime(scene.trajectory, scene.elapsed);
  assert.ok(Math.abs(scene.ball.position.x - rollingPoint.x) < 1e-10 && Math.abs(scene.ball.position.z - rollingPoint.z) < 1e-10,
    'The rolling ball left the supplied trajectory.');
  scene.animate(rollStart + 10000);
  assert.equal(scene.phase, 'result'); assert.equal(scene.playing, false);
  assert.equal(completed, completedBeforeRoll + 1);
  scene.rollBall();
  assert.equal(scene.elapsed, 0, 'Roll again must start at the beginning after completion.');
  scene.camera.updateMatrixWorld();
  const visibleReplay = scene.ball.position.clone().project(scene.camera);
  assert.ok(Math.abs(visibleReplay.x) < 0.98 && Math.abs(visibleReplay.y) < 0.98 && visibleReplay.z > -1 && visibleReplay.z < 1);
  scene.seek(0);
  assert.equal(scene.phase, 'ready'); assert.equal(scene.playing, false);
  assert.deepEqual(playingChanges.slice(playChangeStart), [true, false, true, false, true, false], 'Playback callbacks do not match the button states.');
  assert.deepEqual(scene.trajectory, inputBeforeRoll, 'The roll action modified provider coordinates or timing.');
  console.log('Validated roll from tree inspection, visible ball, pause/resume, completion, replay, reset and UI playback callbacks.');

  for (const settings of settingsCases) {
    scene.setGreen(settings);
    const trajectory = makeSampleTrajectory(settings);
    scene.setTrajectory(trajectory);
    scene.setAutoCamera(true, false);
    scene.seek(0);
    scene.play();
    const followStart = performance.now();
    scene.animate(followStart);
    for (let frame = 1; frame <= 48; frame++) {
      scene.animate(followStart + frame * 100);
      const point = pointAtTime(trajectory, scene.elapsed);
      scene.camera.updateMatrixWorld();
      for (const position of [
        new THREE.Vector3(point.x, heightAt(point.x, point.z, settings) + 0.02135, point.z),
        new THREE.Vector3(0, heightAt(0, settings.distance, settings), settings.distance),
        new THREE.Vector3(0.45, heightAt(0, settings.distance, settings) + 1.8, settings.distance),
      ]) {
        const p = position.project(scene.camera);
        assert.ok(Math.abs(p.x) < 0.98 && Math.abs(p.y) < 0.98 && p.z > -1 && p.z < 1,
          `The moving camera crops the shot at ${settings.distance}m, frame ${frame}.`);
      }
    }
    assert.ok(scene.uniforms.uGrid.value < 0.001, 'The preparation grid did not fade during playback.');
    scene.pause();
  }
  scene.setGreen(DEFAULT_GREEN);
  scene.setTrajectory(parseTrajectory(externalCases.at(-1)[1]));
  scene.setCamera('top', false);
  scene.seek(0.5);
  const manualPosition = scene.camera.position.clone();
  scene.play();
  scene.animate(performance.now());
  assert.ok(scene.camera.position.distanceTo(manualPosition) < 1e-8, 'A manual camera was overridden.');
  scene.pause();
  scene.setAutoCamera(true, false);
  scene.controls.dispatchEvent({ type: 'start' });
  assert.equal(scene.autoCamera, false, 'Dragging must hand camera control back to the user.');
  scene.controls.dispatchEvent({ type: 'end' });
  scene.reducedMotion = true;
  scene.setAutoCamera(true, false);
  scene.seek(0.1);
  const reducedPosition = scene.camera.position.clone();
  scene.seek(0.7);
  assert.ok(scene.camera.position.distanceTo(reducedPosition) < 1e-10, 'Reduced-motion playback must keep a static overview.');
  scene.reducedMotion = false;
  scene.seek(0);
  scene.play();
  const irregularStart = performance.now();
  scene.animate(irregularStart);
  scene.animate(irregularStart + 370);
  assert.ok(Math.abs(scene.elapsed - 0.37) < 1e-10, 'A delayed frame must not slow the supplied trajectory clock.');
  const irregularPoint = pointAtTime(scene.trajectory, 0.37);
  assert.ok(Math.abs(scene.ball.position.z - irregularPoint.z) < 1e-10);
  scene.pause();
  // Exercise the quality controller on the actual scene without expensive intermediate CPU draws.
  scene.setTrajectory(makeSampleTrajectory(DEFAULT_GREEN));
  scene.seek(0);
  scene.controls.enableDamping = false;
  scene.adaptiveQuality.detail = 0;
  scene.adaptiveQuality.resetSamples();
  scene.applyRenderQuality(false);
  window.devicePixelRatio = 3;
  const nearCrowns = scene.scene.getObjectByName('hero-reference-tree-small-02') ?? scene.scene.getObjectByName('hero-spreading-oak');
  const nearGeometries = [];
  nearCrowns.traverse(object => { if (object.isMesh) nearGeometries.push(object.geometry); });
  const nearCount = scene.course.getDiagnostics().heroModels;
  const fullTerrainCount = scene.scene.getObjectByName('rolling-rough').geometry.attributes.position.count;
  scene.adaptiveQuality.observe(36, 50);
  scene.adaptiveQuality.observe(36, 50);
  scene.adaptiveQuality.observe(36, 50);
  scene.adaptiveQuality.observe(36, 50);
  scene.play();
  scene.animate(performance.now());
  assert.equal(scene.detail, 2, 'Playback did not apply the learned background limit.');
  assert.equal(scene.pixelRatio, 1.4, 'Playback did not reduce physical resolution with background complexity.');
  assert.ok(scene.scene.getObjectByName('rolling-rough').geometry.attributes.position.count < fullTerrainCount);
  const retainedGeometries = [];
  nearCrowns.traverse(object => { if (object.isMesh) retainedGeometries.push(object.geometry); });
  assert.deepEqual(retainedGeometries, nearGeometries, 'Adaptive quality replaced nearby tree geometry.');
  assert.ok(nearCrowns.visible && scene.course.getDiagnostics().heroModels === nearCount,
    'Adaptive quality must retain the complete nearby 3D tree assets.');
  scene.seek(0);
  scene.lastCameraMotion = -Infinity;
  scene.animate(performance.now() + 1000);
  assert.equal(scene.detail, 0, 'A stationary shot did not restore full scenery.');
  assert.ok(scene.pixelRatio > 1.4, 'A stationary shot did not restore resolution.');
  assert.equal(scene.adaptiveQuality.detail, 2, 'Idle restoration lost the device performance history.');
  scene.setView({ ...DEFAULT_VIEW, quality: 'high' });
  assert.equal(scene.detail, 0, 'The high-quality override did not restore the background.');
  scene.setView({ ...DEFAULT_VIEW, quality: 'balanced' });
  assert.equal(scene.detail, 2, 'The performance override did not simplify the background.');
  window.devicePixelRatio = 1;
  scene.adaptiveQuality.detail = 0;
  scene.setView(DEFAULT_VIEW);
  scene.controls.enableDamping = true;
  scene.lastTime = 0;
  console.log('Validated coupled resolution/scenery adaptation, idle sharpness recovery and manual quality overrides.');
  scene.renderer.render = render;
  console.log('Validated timed external shots, short/long misses, height preservation, pause, seek, replay, manual camera and reduced motion.');

  // Deterministic sampling logic check only; these synthetic timestamps are NOT device FPS.
  scene.renderer.render = () => {};
  globalThis.navigator ??= { userAgent: 'CPU regression harness, synthetic timestamps' };
  const measurement = scene.measurePlayback(1200, 300);
  const measurementStart = performance.now();
  for (let frame = 0; frame <= 16; frame++) scene.animate(measurementStart + frame * 100);
  const sampled = await measurement;
  assert.ok(Math.abs(sampled.fps - 10) < 0.01, 'Frame sampling must use the rAF clock.');
  assert.ok(sampled.frames >= 11, 'Warm-up removed the sustained playback samples.');
  scene.pause();
  const hiddenMeasurement = scene.measurePlayback(600, 0);
  documentShim.hidden = true;
  scene.animate(performance.now());
  await assert.rejects(hiddenMeasurement, /숨겨져/);
  documentShim.hidden = false;
  scene.renderer.render = render;
  scene.lastTime = 0;
  console.log('Validated benchmark warm-up, frame sampling and hidden-tab cancellation with synthetic timestamps (not performance results).');

  scene.setGreen(DEFAULT_GREEN);
  scene.setTrajectory(makeSampleTrajectory(DEFAULT_GREEN));
  scene.setView(DEFAULT_VIEW);
  for (const view of ['ball', 'surface', 'top', 'perspective']) {
    scene.setCamera(view, false);
    const pixels = tick();
    if (failures.length) throw new Error(failures.join('\n'));
    const isGrass = i => pixels[i + 1] > pixels[i] * 1.05 && pixels[i + 1] > pixels[i + 2] * 1.15 && pixels[i + 1] > 25;
    let grassPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) if (isGrass(i)) grassPixels++;
    const coverage = grassPixels / (width * height);
    if (coverage < (view === 'top' ? 0.6 : 0.25)) throw new Error(`${view}: the turf is missing (${coverage.toFixed(3)} green pixel coverage)`);
    let detail = 0;
    let pairs = 0;
    for (let y = Math.floor(height * 0.72); y < height * 0.94; y++) {
      for (let x = Math.floor(width * 0.2); x < width * 0.8; x++) {
        const i = (y * width + x) * 4;
        if (isGrass(i) && isGrass(i + 4)) { detail += Math.abs(pixels[i + 1] - pixels[i + 5]); pairs++; }
      }
    }
    const grainContrast = detail / Math.max(pairs, 1);
    // A short, filtered green has less pixel contrast than the previous long-grass photo.
    // Continue rejecting a flat field; close-up blade and lighting checks live in --grass.
    if ((view === 'ball' || view === 'surface') && grainContrast < 0.6) throw new Error(`${view}: the turf has no visible texture detail (${grainContrast.toFixed(2)})`);
    await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toFile(resolve(output, `${view}.png`));
    console.log(`Rendered ${view}: coverage ${(coverage * 100).toFixed(1)}%, grain ${grainContrast.toFixed(2)}, ${scene.renderer.info.render.calls} draws; ${resolve(output, `${view}.png`)}`);
  }
  for (const [name, camera, view] of [
    ['grid', 'ball', { ...DEFAULT_VIEW, grid: true, flow: true }],
    ['heatmap', 'top', { ...DEFAULT_VIEW, heatmap: true }],
    ['balanced', 'surface', { ...DEFAULT_VIEW, quality: 'balanced' }],
  ]) {
    scene.setView(view);
    scene.setCamera(camera, false);
    const pixels = tick();
    if (failures.length) throw new Error(failures.join('\n'));
    await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toFile(resolve(output, `${name}.png`));
    console.log(`Rendered ${name}: ${resolve(output, `${name}.png`)}`);
  }

  scene.setView(DEFAULT_VIEW);
  scene.setTrajectory(makeSampleTrajectory(DEFAULT_GREEN));
  scene.setAutoCamera(true, false);
  for (const [name, progress] of [['ready', 0], ['rolling', 0.6], ['result-holed', 1]]) {
    scene.seek(progress);
    const pixels = tick();
    if (failures.length) throw new Error(failures.join('\n'));
    await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toFile(resolve(output, `${name}.png`));
    console.log(`Rendered ${name}: ${resolve(output, `${name}.png`)}`);
  }
  for (const [name, input] of externalCases.slice(0, 2)) {
    scene.setTrajectory(parseTrajectory(input));
    scene.seek(1);
    const pixels = tick();
    if (failures.length) throw new Error(failures.join('\n'));
    await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toFile(resolve(output, `${name}.png`));
    console.log(`Rendered ${name}: ${resolve(output, `${name}.png`)}`);
  }
  }
} finally {
  scene?.dispose();
  canvas.destroy();
  await server.close();
}
