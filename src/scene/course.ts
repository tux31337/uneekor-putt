import { heightAt, type GreenSettings } from '../core/trajectory.ts';

export const GREEN_WIDTH = 7.4;
export const greenLength = (green: GreenSettings) => green.distance / 2 + 5.8;

function edgeFactor(theta: number) {
  return 1 + 0.105 * Math.sin(theta * 3 + 0.7)
    + 0.045 * Math.cos(theta * 5 - 0.35) + 0.025 * Math.sin(theta * 2 + 0.8);
}

export function greenEdge(theta: number, green: GreenSettings, expand = 0) {
  const organic = edgeFactor(theta);
  const collar = expand * (1 + 0.16 * Math.sin(theta * 2 + 0.4));
  return {
    x: Math.cos(theta) * (GREEN_WIDTH + collar) * organic,
    z: green.distance / 2 + Math.sin(theta) * (greenLength(green) + collar) * organic,
  };
}

function smooth(min: number, max: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

/** Only the surrounding course undulates. The entire putting surface stays on heightAt. */
export function courseHeightAt(x: number, z: number, green: GreenSettings) {
  const dz = z - green.distance / 2;
  const theta = Math.atan2(dz / greenLength(green), x / GREEN_WIDTH);
  const organic = edgeFactor(theta);
  const edge = (Math.hypot(x / GREEN_WIDTH, dz / greenLength(green)) / organic - 1) * GREEN_WIDTH;
  const blend = smooth(0.4, 13, edge);
  const mound = (cx: number, cz: number, width: number, height: number) =>
    height * Math.exp(-((x - cx) ** 2 + (dz - cz) ** 2) / (width * width));
  const hills = mound(-21, 12, 12, 2.7) + mound(24, 18, 15, 3.6)
    + mound(-43, 54, 24, 4.2) + mound(32, 65, 28, 5.2)
    + mound(-26, -32, 18, 2.8) + mound(44, -24, 24, 3.3)
    + Math.sin(x * 0.065 + dz * 0.04) * Math.cos(dz * 0.085) * 0.7;
  const plane = heightAt(x, z, green);
  const distantPlane = plane * (1 - smooth(18, 75, Math.hypot(x, dz)));
  return plane * (1 - blend) + (distantPlane + hills) * blend - 0.06;
}
