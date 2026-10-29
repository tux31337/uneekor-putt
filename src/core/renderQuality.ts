import type { ViewSettings } from './trajectory.ts';

export type SceneDetail = 0 | 1 | 2;

export interface RenderProfile {
  pixelRatio: number;
  detail: SceneDetail;
  grassCount: number;
  edgeGrassCount: number;
}

/** Limit physical pixels as well as DPR: a tall phone and a desktop have different costs. */
export function renderProfile(
  quality: ViewSettings['quality'], width: number, height: number, deviceRatio: number,
  moving: boolean, adaptiveDetail: SceneDetail,
): RenderProfile {
  const detail = quality === 'high' ? 0 : quality === 'balanced' ? 2 : moving ? adaptiveDetail : 0;
  const nativeRatio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  const ratioLimit = quality === 'high' ? 3 : quality === 'balanced' ? 1.5 : moving ? [2, 1.75, 1.4][detail] : 2.5;
  const pixelBudget = quality === 'high' ? 3_600_000 : quality === 'balanced' ? 1_000_000 : moving ? 1_600_000 : 2_600_000;
  const area = Math.max(1, width * height);
  return {
    pixelRatio: Math.min(nativeRatio, ratioLimit, Math.sqrt(pixelBudget / area)),
    detail,
    // Each crown contains three six-triangle ribbons; at most 216,000 grass triangles.
    grassCount: [6000, 3600, 1800][detail],
    edgeGrassCount: [6000, 3000, 1200][detail],
  };
}

/** Two slow windows lower quality; six fast windows recover it without oscillation. */
export class AdaptiveQuality {
  detail: SceneDetail = 0;
  private slowWindows = 0;
  private fastWindows = 0;

  observe(averageMs: number, p95Ms: number): boolean {
    if (!Number.isFinite(averageMs) || !Number.isFinite(p95Ms) || averageMs <= 0 || p95Ms <= 0) return false;
    this.slowWindows = averageMs > 24 || p95Ms > 42 ? this.slowWindows + 1 : 0;
    this.fastWindows = averageMs < 18 && p95Ms < 24 ? this.fastWindows + 1 : 0;
    if (this.slowWindows >= 2 && this.detail < 2) {
      this.detail = (this.detail + 1) as SceneDetail;
      this.resetSamples();
      return true;
    }
    if (this.fastWindows >= 6 && this.detail > 0) {
      this.detail = (this.detail - 1) as SceneDetail;
      this.resetSamples();
      return true;
    }
    return false;
  }

  resetSamples() { this.slowWindows = 0; this.fastWindows = 0; }
}
