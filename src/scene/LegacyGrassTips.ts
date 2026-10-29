import * as THREE from 'three';
import type { TurfUniforms } from './TurfMaterial';

/** Short cut tips only in the foreground. One draw call; no alpha cards or per-blade objects. */
export function createGrassTips(uniforms: TurfUniforms, center: THREE.Vector2) {
  const count = 32000;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, 0, 0.5, 0, 0, 0.12, 1, 0.1,
  ], 3));
  const blades = new Float32Array(count * 4);
  let seed = 481516;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  for (let i = 0; i < count; i++) {
    blades[i * 4] = random() * 5.6;
    blades[i * 4 + 1] = random() * 6.4;
    blades[i * 4 + 2] = 0.003 + random() * 0.0025;
    blades[i * 4 + 3] = random() * Math.PI * 2;
  }
  geometry.setAttribute('blade', new THREE.InstancedBufferAttribute(blades, 4));
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    uniforms: { uSlope: uniforms.uSlope, uCup: uniforms.uCup, uGrassCenter: { value: center } },
    side: THREE.DoubleSide,
    vertexShader: `
      attribute vec4 blade;
      uniform vec2 uSlope;
      uniform vec2 uCup;
      uniform vec2 uGrassCenter;
      varying vec3 vTipColor;
      void main() {
        // Recycle only blades beyond the patch edge; the visible roots stay fixed in world space.
        vec2 rootXZ = mod(blade.xy - uGrassCenter + vec2(2.8, 3.2), vec2(5.6, 6.4)) + uGrassCenter - vec2(2.8, 3.2);
        vec3 root = vec3(rootXZ.x, dot(rootXZ, uSlope) + 0.0004, rootXZ.y);
        float fade = 1.0 - smoothstep(2.2, 4.9, distance(root, cameraPosition));
        fade *= smoothstep(0.054, 0.06, distance(root.xz, uCup));
        float width = 0.0014;
        vec2 sideways = vec2(cos(blade.w), sin(blade.w));
        vec3 point = root;
        point.xz += sideways * position.x * width * fade;
        point.xz += vec2(-sideways.y, sideways.x) * position.z * blade.z * fade;
        point.y += position.y * blade.z * fade;
        float variation = fract(sin(blade.w * 74.3 + blade.x * 19.2) * 4387.2);
        vTipColor = mix(vec3(0.14, 0.245, 0.068), vec3(0.27, 0.385, 0.12), variation);
        vTipColor *= mix(0.65, 1.08, position.y) * (0.93 + 0.07 * abs(cos(blade.w)));
        gl_Position = projectionMatrix * viewMatrix * vec4(point, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vTipColor;
      void main() {
        gl_FragColor = vec4(vTipColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'near-cut-grass-tips';
  return mesh;
}
