import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GREEN, parseTrajectory } from './trajectory.ts';
import { distanceToHole, phaseAtTime, shotResult } from './playback.ts';

test('seek distinguishes preparation, a paused position and the completed shot', () => {
  assert.equal(phaseAtTime(-1, 5), 'ready');
  assert.equal(phaseAtTime(0, 5), 'ready');
  assert.equal(phaseAtTime(2, 5), 'rolling');
  assert.equal(phaseAtTime(5, 5), 'result');
  assert.equal(phaseAtTime(8, 5), 'result');
});

test('stopped results measure short, long and sideways misses from the supplied endpoint', () => {
  for (const [x, z, expected] of [[0, 5.2, 0.8], [0, 7.2, 1.2], [0.3, 5.6, 0.5]]) {
    const trajectory = parseTrajectory({ duration: 4, points: [{ x: 0, z: 0 }, { x, z }], outcome: 'stopped' });
    assert.ok(Math.abs(shotResult(trajectory, DEFAULT_GREEN).remaining - expected) < 1e-10);
    assert.equal(shotResult(trajectory, DEFAULT_GREEN).outcome, 'stopped');
  }
});

test('presentation respects the provider outcome, coordinates and timing without inferring a hole-in', () => {
  const trajectory = parseTrajectory({
    outcome: 'stopped', points: [{ x: 0, y: 0.1, z: 0, t: 100 }, { x: 0, y: 0.8, z: 6, t: 107 }],
  });
  const original = structuredClone(trajectory);
  assert.equal(distanceToHole(trajectory, DEFAULT_GREEN, 3.5), 3);
  assert.deepEqual(shotResult(trajectory, DEFAULT_GREEN), { outcome: 'stopped', remaining: 0, duration: 7 });
  assert.deepEqual(trajectory, original);
  assert.equal(shotResult({ ...trajectory, outcome: 'holed' }, DEFAULT_GREEN).outcome, 'holed');
});
