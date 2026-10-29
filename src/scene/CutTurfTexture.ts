import * as THREE from 'three';

/** Shared world-space sampling keeps the canopy and emerging ribbons the same colour. */
export const cutTurfSamplingGLSL = /* glsl */`
  uniform sampler2D uCutColor;
  vec2 cutTurfUv(vec2 ground, float tile) {
    return vec2(ground.x * 0.95 - ground.y * 0.31, ground.x * 0.31 + ground.y * 0.95) / tile;
  }
  vec3 cutTurfColor(vec2 uv) {
    vec2 second = vec2(uv.x * 0.91 - uv.y * 0.41, uv.x * 0.41 + uv.y * 0.91) * 0.83 + vec2(0.212, 0.617);
    return mix(texture2D(uCutColor, uv).rgb, texture2D(uCutColor, second).rgb, 0.22);
  }
`;

let cachedPixels: { color: Uint8Array; normal: Uint8Array } | undefined;

/** Deterministic 25.6 cm cut-turf tile. Pixel scale is 0.25 mm, independent of viewport. */
export function createCutTurfTextures(anisotropy: number) {
  if (cachedPixels) return texturePair(cachedPixels.color, cachedPixels.normal, anisotropy);
  const size = 1024, pixels = size * size;
  const color = new Uint8Array(pixels * 4), normal = new Uint8Array(pixels * 4);
  const height = new Float32Array(pixels);
  let seed = 104729;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const index = (x: number, y: number) => ((y + size) % size) * size + (x + size) % size;
  for (let i = 0; i < pixels; i++) {
    const shade = 0.82 + random() * 0.24;
    color.set([19 * shade, 32 * shade, 8 * shade, 255], i * 4);
    height[i] = 0.08 + random() * 0.08;
  }
  // Crowns share a lay direction; individual clipped blades overlap without rows or a photo motif.
  for (let crown = 0; crown < 18000; crown++) {
    const cx = random() * size, cy = random() * size;
    const lay = 0.325 + (random() - 0.5) * 1.1;
    const tint = 0.78 + random() * 0.40;
    for (let leaf = 0; leaf < 3; leaf++) {
      const angle = lay + (leaf - 1) * 0.5 + (random() - 0.5) * 0.35;
      const dx = Math.sin(angle), dy = Math.cos(angle);
      const length = 6 + random() * 8, width = 1.8 + random() * 1.8;
      const x = cx + (random() - 0.5) * 3, y = cy + (random() - 0.5) * 3;
      const radius = Math.ceil(length + width);
      for (let py = Math.floor(y - radius); py <= y + radius; py++) {
        for (let px = Math.floor(x - radius); px <= x + radius; px++) {
          const rx = px + 0.5 - x, ry = py + 0.5 - y;
          const t = (rx * dx + ry * dy) / length;
          if (t < 0 || t > 1) continue;
          const cross = rx * dy - ry * dx - length * 0.10 * t * t;
          const coverage = clamp(width * (1 - t * 0.38) * 0.5 + 0.5 - Math.abs(cross));
          if (coverage <= 0) continue;
          const i = index(px, py), p = i * 4;
          const ridge = clamp(1 - Math.abs(cross) / width);
          const leafHeight = 0.22 + ridge * 0.40 + t * 0.22;
          if (leafHeight <= height[i]) continue;
          const shade = tint * (0.52 + t * 0.36 + ridge * 0.22);
          const bladeColor = [31 * shade, 49 * shade, 13 * shade];
          for (let channel = 0; channel < 3; channel++) color[p + channel] = color[p + channel] * (1 - coverage) + bladeColor[channel] * coverage;
          height[i] = height[i] * (1 - coverage) + leafHeight * coverage;
        }
      }
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (height[index(x - 1, y)] - height[index(x + 1, y)]) * 1.35;
    const ny = (height[index(x, y - 1)] - height[index(x, y + 1)]) * 1.35;
    const length = Math.hypot(nx, ny, 1), p = index(x, y) * 4;
    // Height shares the existing normal texture's alpha channel: no additional texture.
    normal.set([(nx / length * 0.5 + 0.5) * 255, (ny / length * 0.5 + 0.5) * 255, (1 / length * 0.5 + 0.5) * 255, height[index(x, y)] * 255], p);
  }
  cachedPixels = { color, normal };
  return texturePair(color, normal, anisotropy);
}

function texturePair(color: Uint8Array, normal: Uint8Array, anisotropy: number) {
  const textures = [color, normal].map(data => {
    const texture = new THREE.DataTexture(data, 1024, 1024);
    // Values are stored in linear light; custom sampler uniforms must not decode them as sRGB.
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = anisotropy; texture.needsUpdate = true;
    return texture;
  });
  return { albedo: textures[0], normal: textures[1] };
}
