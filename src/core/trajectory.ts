/** Rendering contract for the existing trajectory calculator. Units: metres and seconds. */
export interface TrajectoryPoint {
  x: number;
  z: number;
  /** Surface height. If omitted, the renderer places the ball on the displayed green. */
  y?: number;
  /** Elapsed seconds. All points must either provide time, or omit it. */
  t?: number;
}

export interface GreenSettings {
  distance: number;
  stimp: number;
  crossSlope: number;
  longitudinalSlope: number;
}

export interface Trajectory {
  id: string;
  points: TrajectoryPoint[];
  duration: number;
  outcome: 'holed' | 'stopped';
  source: 'sample' | 'external';
}

export interface ViewSettings {
  grid: boolean;
  flow: boolean;
  trajectory: boolean;
  heatmap: boolean;
  quality: 'auto' | 'high' | 'balanced';
}

export const DEFAULT_GREEN: GreenSettings = {
  distance: 6, stimp: 10, crossSlope: 1.5, longitudinalSlope: 0.5,
};
export const DEFAULT_VIEW: ViewSettings = {
  grid: true, flow: false, trajectory: true, heatmap: false, quality: 'auto',
};

/** Only display geometry. This is not a putting/ball physics equation. */
export function heightAt(x: number, z: number, green: GreenSettings): number {
  return x * green.crossSlope / 100 + z * green.longitudinalSlope / 100;
}

/** Hand-authored illustration used until the user's trajectory provider is connected. */
const SAMPLE_LINE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [0.07, 0.095, 0.16], [0.14, 0.187, 0.33],
  [0.2, 0.274, 0.51], [0.25, 0.355, 0.70], [0.29, 0.432, 0.90],
  [0.32, 0.505, 1.11], [0.34, 0.573, 1.33], [0.345, 0.638, 1.56],
  [0.34, 0.698, 1.81], [0.325, 0.754, 2.07], [0.30, 0.805, 2.35],
  [0.265, 0.852, 2.65], [0.22, 0.895, 2.98], [0.167, 0.932, 3.34],
  [0.111, 0.963, 3.74], [0.057, 0.985, 4.19], [0.015, 0.998, 4.69],
  [0, 1, 5.15],
];

export function makeSampleTrajectory(green: GreenSettings): Trajectory {
  // The sample is stretched/mirrored for visual inspection, never presented as a prediction.
  const bend = green.crossSlope / 1.5 * green.distance / 6;
  return {
    id: 'visual-sample', duration: 5.15, outcome: 'holed', source: 'sample',
    points: SAMPLE_LINE.map(([x, z, t]) => ({ x: x * bend, z: z * green.distance, t })),
  };
}

export function parseTrajectory(value: unknown): Trajectory {
  if (!value || typeof value !== 'object') throw new Error('궤적 데이터가 올바르지 않습니다.');
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.points) || input.points.length < 2 || input.points.length > 10000) {
    throw new Error('궤적 좌표는 2~10,000개가 필요합니다.');
  }
  const hasTime = typeof input.points[0]?.t === 'number';
  let previousTime = -Infinity;
  const points = input.points.map((raw: unknown): TrajectoryPoint => {
    if (!raw || typeof raw !== 'object') throw new Error('좌표 형식을 확인해 주세요.');
    const p = raw as Record<string, unknown>;
    if (typeof p.x !== 'number' || typeof p.z !== 'number' || !Number.isFinite(p.x + p.z) || Math.abs(p.x) > 100 || Math.abs(p.z) > 100) {
      throw new Error('x, z 좌표는 미터 단위의 유한한 숫자여야 합니다.');
    }
    if (p.y !== undefined && (typeof p.y !== 'number' || !Number.isFinite(p.y) || Math.abs(p.y) > 100)) {
      throw new Error('y 높이 값을 확인해 주세요.');
    }
    if (hasTime && (typeof p.t !== 'number' || !Number.isFinite(p.t) || p.t < 0 || p.t <= previousTime)) {
      throw new Error('t는 0 이상이며 이전 좌표보다 커야 합니다.');
    }
    if (!hasTime && p.t !== undefined) throw new Error('모든 좌표에 t를 넣거나 모두 생략해 주세요.');
    if (hasTime) previousTime = p.t as number;
    return { x: p.x, z: p.z, ...(p.y !== undefined ? { y: p.y as number } : {}), ...(hasTime ? { t: p.t as number } : {}) };
  });
  const duration = hasTime ? points.at(-1)!.t! - points[0].t! : input.duration;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 120) {
    throw new Error('재생 시간은 0초 초과, 120초 이하여야 합니다.');
  }
  const startTime = points[0].t ?? 0;
  return {
    id: typeof input.id === 'string' ? input.id : 'external',
    points: hasTime ? points.map(p => ({ ...p, t: p.t! - startTime })) : points,
    duration, outcome: input.outcome === 'holed' ? 'holed' : 'stopped', source: 'external',
  };
}

/** Time-based interpolation makes 30/60/120 Hz devices follow the exact same input data. */
export function pointAtTime(trajectory: Trajectory, time: number): TrajectoryPoint {
  const { points, duration } = trajectory;
  const elapsed = Math.max(0, Math.min(duration, time));
  if (elapsed >= duration) return { ...points.at(-1)! };
  if (points[0].t === undefined) {
    const index = elapsed / duration * (points.length - 1);
    const a = Math.floor(index);
    return lerpPoint(points[a], points[Math.min(a + 1, points.length - 1)], index - a);
  }
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t! <= elapsed) lo = mid; else hi = mid;
  }
  return lerpPoint(points[lo], points[hi], (elapsed - points[lo].t!) / (points[hi].t! - points[lo].t!));
}

function lerpPoint(a: TrajectoryPoint, b: TrajectoryPoint, t: number): TrajectoryPoint {
  return {
    x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
    ...(a.y !== undefined && b.y !== undefined ? { y: a.y + (b.y - a.y) * t } : {}),
  };
}
