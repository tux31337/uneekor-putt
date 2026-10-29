import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality, renderProfile } from './renderQuality.ts';

test('a stationary high-DPR phone restores sharpness and scenery after an adaptive downgrade', () => {
  const moving = renderProfile('auto', 390, 564, 3, true, 2);
  const still = renderProfile('auto', 390, 564, 3, false, 2);
  assert.equal(moving.pixelRatio, 1.4);
  assert.equal(moving.detail, 2);
  assert.equal(still.pixelRatio, 2.5);
  assert.equal(still.detail, 0);
  assert.ok(still.grassCount > moving.grassCount);
  // Returning to playback retains the learned limit rather than retrying an expensive tier.
  assert.deepEqual(renderProfile('auto', 390, 564, 3, true, 2), moving);
});

test('pixel budgets and native DPR bound large, low-DPR and rotated screens', () => {
  for (const [width, height, ratio] of [[390, 614, 3], [844, 245, 3], [2560, 1440, 2], [390, 614, 1]]) {
    for (const moving of [true, false]) {
      const profile = renderProfile('auto', width, height, ratio, moving, 0);
      assert.ok(profile.pixelRatio <= ratio);
      assert.ok(width * height * profile.pixelRatio ** 2 <= (moving ? 1_600_000 : 2_600_000) + 0.01);
    }
  }
  assert.equal(renderProfile('auto', 390, 614, NaN, false, 0).pixelRatio, 1);
});

test('explicit quality choices are independent of adaptive history and motion', () => {
  assert.deepEqual(renderProfile('high', 390, 614, 3, true, 2), renderProfile('high', 390, 614, 3, false, 0));
  assert.equal(renderProfile('high', 390, 614, 3, true, 2).pixelRatio, 3);
  assert.equal(renderProfile('balanced', 390, 614, 3, false, 0).detail, 2);
  assert.equal(renderProfile('balanced', 390, 614, 3, false, 0).pixelRatio, 1.5);
});

test('adaptive quality ignores isolated stalls and uses hysteresis when recovering', () => {
  const quality = new AdaptiveQuality();
  assert.equal(quality.observe(40, 60), false);
  quality.observe(16.7, 19);
  assert.equal(quality.observe(40, 60), false);
  assert.equal(quality.observe(40, 60), true);
  assert.equal(quality.detail, 1);
  quality.observe(27, 35);
  quality.observe(27, 35);
  assert.equal(quality.detail, 2);
  for (let i = 0; i < 5; i++) assert.equal(quality.observe(16.7, 20), false);
  assert.equal(quality.observe(16.7, 20), true);
  assert.equal(quality.detail, 1);
  quality.observe(16.7, 20);
  quality.resetSamples();
  for (let i = 0; i < 5; i++) assert.equal(quality.observe(16.7, 20), false);
  assert.equal(quality.observe(16.7, 20), true);
  assert.equal(quality.detail, 0);
  assert.equal(quality.observe(NaN, 20), false);
});
