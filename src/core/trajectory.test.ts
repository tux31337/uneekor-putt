import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrajectory, pointAtTime } from './trajectory.ts';

test('external timed data preserves coordinates and normalizes an arbitrary starting timestamp', () => {
  const input = parseTrajectory({ points: [{ x: 0, z: 0, t: 100 }, { x: 1, y: 0.4, z: 3, t: 102 }, { x: 0, y: 0.8, z: 6, t: 105 }] });
  assert.equal(input.duration, 5);
  assert.equal(input.source, 'external');
  const midpoint = pointAtTime(input, 3.5);
  assert.equal(midpoint.x, 0.5);
  assert.equal(midpoint.z, 4.5);
  assert.ok(Math.abs(midpoint.y! - 0.6) < 1e-10);
  assert.equal(pointAtTime(input, 20).z, 6);
});

test('untimed coordinates play uniformly with the specified duration', () => {
  const input = parseTrajectory({ duration: 4, points: [{ x: 0, z: 0 }, { x: 2, z: 4 }] });
  assert.deepEqual(pointAtTime(input, 2), { x: 1, z: 2 });
});

test('invalid coordinates and mixed or nonincreasing time values are rejected', () => {
  for (const points of [
    [{ x: NaN, z: 0 }, { x: 0, z: 2 }],
    [{ x: 0, z: 0, t: 0 }, { x: 0, z: 2 }],
    [{ x: 0, z: 0, t: 2 }, { x: 0, z: 2, t: 1 }],
    [{ x: 0, z: 0 }, { x: 0, z: 2, t: 1 }],
  ]) assert.throws(() => parseTrajectory({ duration: 4, points }));
});
