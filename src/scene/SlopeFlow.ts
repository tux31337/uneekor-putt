/** Beads follow each 50 cm grid axis downhill, using the same gradient as heightAt. */
export const slopeFlowGLSL = /* glsl */`
  float slopeFlow(vec2 cell, vec2 gridDist, vec2 gridWidth, vec2 slope, float time) {
    vec2 speed = abs(slope) * 8.0;
    vec2 phase = fract(cell + sign(slope) * speed * 2.0 * time) - 0.5;
    vec2 pulse = 1.0 - smoothstep(vec2(0.04), vec2(0.075) + gridWidth * 0.5, abs(phase));
    vec2 line = 1.0 - smoothstep(vec2(0.35), vec2(1.1), gridDist);
    vec2 sloped = step(vec2(0.0005), abs(slope));
    return max(line.y * pulse.x * sloped.x, line.x * pulse.y * sloped.y);
  }
`;
