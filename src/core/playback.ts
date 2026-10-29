import { pointAtTime, type GreenSettings, type Trajectory } from './trajectory.ts';

export type PlaybackPhase = 'ready' | 'rolling' | 'result';

/** Seeking is independent of whether the playback clock is currently running. */
export function phaseAtTime(elapsed: number, duration: number): PlaybackPhase {
  return elapsed <= 0 ? 'ready' : elapsed >= duration ? 'result' : 'rolling';
}

/** Ground-plane distance to the cup; the trajectory's coordinates and time stay untouched. */
export function distanceToHole(trajectory: Trajectory, green: GreenSettings, elapsed: number) {
  const point = pointAtTime(trajectory, elapsed);
  return Math.hypot(point.x, point.z - green.distance);
}

export function shotResult(trajectory: Trajectory, green: GreenSettings) {
  return {
    outcome: trajectory.outcome,
    remaining: trajectory.outcome === 'holed' ? 0 : distanceToHole(trajectory, green, trajectory.duration),
    duration: trajectory.duration,
  };
}
