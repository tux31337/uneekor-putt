import * as THREE from 'three';
import type { GreenSettings } from '../core/trajectory';
import { heightAt } from '../core/trajectory';
import { courseHeightAt, greenEdge } from './course';

export type GrassMode = 'baseline' | 'prototype';
export type GrassInspectionView = 'ball' | 'macro' | 'edge' | 'edge-macro' | 'course';
export const GRASS_PATCH_RADIUS = 1.9;
export const GRASS_EDGE_ANGLE = -0.42;
export const GRASS_LENGTHS = { green: 0.003, fringe: 0.011, rough: 0.030 } as const;

export function grassEdgeFrame(green: GreenSettings) {
  const a = greenEdge(GRASS_EDGE_ANGLE - 0.01, green);
  const b = greenEdge(GRASS_EDGE_ANGLE + 0.01, green);
  const center = greenEdge(GRASS_EDGE_ANGLE, green, 0.28);
  return { center: new THREE.Vector2(center.x, center.z), tangent: new THREE.Vector2(b.x - a.x, b.z - a.z).normalize() };
}

/** Same collar height as the terrain rings; never changes the putting plane. */
export function grassRootHeight(x: number, z: number, band: number, green: GreenSettings) {
  const blend = THREE.MathUtils.smoothstep(Math.max(0, band), 0, 1.6);
  return THREE.MathUtils.lerp(heightAt(x, z, green), courseHeightAt(x, z, green), blend);
}

/** Shared world-space footprint for ribbons and the surface beneath them. */
export const grassCoverageGLSL = /* glsl */`
  uniform vec2 uGrassBall;
  uniform vec2 uGrassEdge;
  uniform vec2 uGrassEdgeTangent;
  uniform float uGrassPrototype;
  float grassEdgeCoverage(vec2 p) {
    vec2 q = p - uGrassEdge;
    vec2 edgeUv = vec2(dot(q, uGrassEdgeTangent) / 1.5,
      dot(q, vec2(-uGrassEdgeTangent.y, uGrassEdgeTangent.x)) / 0.9);
    return 1.0 - smoothstep(0.72, 1.0, length(edgeUv));
  }
  float grassCoverage(vec2 p) {
    float ballPatch = 1.0 - smoothstep(1.45, ${GRASS_PATCH_RADIUS.toFixed(2)}, distance(p, uGrassBall));
    return max(ballPatch, grassEdgeCoverage(p)) * uGrassPrototype;
  }
`;
