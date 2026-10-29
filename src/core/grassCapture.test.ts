import assert from 'node:assert/strict';
import test from 'node:test';
import { captureGrassPair } from './grassCapture.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function createScene() {
  const encodings = [deferred<Blob>(), deferred<Blob>()];
  const snapshots: { mode: string; camera: number; elapsed: number }[] = [];
  const scene = {
    mode: 'prototype' as 'baseline' | 'prototype', camera: 7, elapsed: 2.8, playing: true,
    pause() { this.playing = false; },
    setGrassMode(mode: 'baseline' | 'prototype') { this.mode = mode; },
    captureFrame() {
      snapshots.push({ mode: this.mode, camera: this.camera, elapsed: this.elapsed });
      return encodings[snapshots.length - 1].promise;
    },
  };
  return { scene, snapshots, encodings };
}

test('grass PNGs keep the same pose when the camera moves during asynchronous encoding', async () => {
  const { scene, snapshots, encodings } = createScene();
  const pair = captureGrassPair(scene, 'prototype');
  assert.equal(scene.playing, false);
  assert.equal(scene.mode, 'prototype', 'restore the visible grass before waiting for PNG encoding');
  scene.camera = 9; // A subsequent rAF updates the damped camera while encoding is pending.
  const baseline = new Blob(['baseline']), prototype = new Blob(['prototype']);
  encodings[1].resolve(prototype); // Encoding callbacks may finish in either order.
  encodings[0].resolve(baseline);
  assert.deepEqual(await pair, [baseline, prototype]);
  assert.deepEqual(snapshots, [
    { mode: 'baseline', camera: 7, elapsed: 2.8 },
    { mode: 'prototype', camera: 7, elapsed: 2.8 },
  ]);
});

test('a failed PNG rejects the whole pair and preserves the selected grass mode', async () => {
  const { scene, encodings } = createScene();
  scene.mode = 'baseline';
  const pair = captureGrassPair(scene, 'baseline');
  const rejected = assert.rejects(pair, /PNG encoding failed/);
  assert.equal(scene.mode, 'baseline');
  encodings[0].resolve(new Blob(['baseline']));
  encodings[1].reject(new Error('PNG encoding failed'));
  await rejected;
});

test('a synchronous render error restores the selected mode and rejects safely', async () => {
  const { scene, encodings } = createScene();
  const capture = scene.captureFrame.bind(scene);
  scene.captureFrame = () => {
    if (scene.mode === 'prototype') throw new Error('Render failed');
    return capture();
  };
  const pair = captureGrassPair(scene, 'baseline');
  const rejected = assert.rejects(pair, /Render failed/);
  assert.equal(scene.mode, 'baseline');
  // A later error from the already-started first PNG must also have a rejection handler.
  encodings[0].reject(new Error('PNG encoding failed'));
  await rejected;
});
