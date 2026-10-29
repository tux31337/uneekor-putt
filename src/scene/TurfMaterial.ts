import * as THREE from 'three';
import { reportRenderDiagnostic } from './diagnostics';
import { grassCoverageGLSL } from './grassPrototype';
import { createCutTurfTextures, cutTurfSamplingGLSL } from './CutTurfTexture';
import { slopeFlowGLSL } from './SlopeFlow';

const albedoUrl = new URL('../assets/turf/green-color.webp', import.meta.url).href;
const normalUrl = new URL('../assets/turf/green-normal.webp', import.meta.url).href;
const roughnessUrl = new URL('../assets/turf/green-roughness.webp', import.meta.url).href;

export interface TurfCanopyUniforms {
  uCutColor: { value: THREE.Texture };
  uTurfPhoto: { value: THREE.Texture };
  uCanopyGreen: { value: THREE.Color };
  uCanopyFringe: { value: THREE.Color };
  uCanopyRough: { value: THREE.Color };
  uCanopyRelief: { value: number };
}

/** Match the existing photograph's mean colour; only the close-up blade grain changes. */
export const turfCanopyGLSL = /* glsl */`
  ${cutTurfSamplingGLSL}
  uniform sampler2D uTurfPhoto;
  uniform vec3 uCanopyGreen;
  uniform vec3 uCanopyFringe;
  uniform vec3 uCanopyRough;
  uniform float uCanopyRelief;
  vec3 turfCanopy(vec2 ground, float surface, float blend) {
    vec3 inner = surface < 1.5 ? uCanopyGreen : uCanopyFringe;
    vec3 outer = surface < 0.5 ? uCanopyGreen : surface < 1.5 ? uCanopyFringe : uCanopyRough;
    float tile = surface < 0.5 ? 0.24 : surface < 1.5 ? 0.52 : 1.3;
    vec3 meanColor = textureLod(uTurfPhoto, ground / tile, 7.0).rgb * mix(inner, outer, blend);
    float luma = dot(meanColor, vec3(0.2126, 0.7152, 0.0722));
    float cooling = surface < 0.5 ? 0.65 : surface < 1.5 ? mix(0.65, 0.48, blend) : mix(0.48, 0.38, blend);
    meanColor = mix(meanColor, luma * vec3(0.70, 1.28, 0.63), cooling);
    float cutTile = surface < 0.5 ? 0.256 : surface < 1.5 ? 0.40 : 0.72;
    vec3 grain = cutTurfColor(cutTurfUv(ground, cutTile)) / vec3(0.105, 0.170, 0.045);
    return meanColor * clamp(vec3(1.0) + (grain - 1.0) * 1.45, vec3(0.48), vec3(1.55));
  }
`;

export interface TurfUniforms {
  uGrid: { value: number };
  uFlow: { value: number };
  uFlowTime: { value: number };
  uHeat: { value: number };
  uCup: { value: THREE.Vector2 };
  uHeightScale: { value: number };
  uSlope: { value: THREE.Vector2 };
  uGrassBall: { value: THREE.Vector2 };
  uGrassContactBall: { value: THREE.Vector4 };
  uGrassEdge: { value: THREE.Vector2 };
  uGrassEdgeTangent: { value: THREE.Vector2 };
  uGrassPrototype: { value: number };
}

export type TurfSurface = 'green' | 'fringe' | 'rough';

/** Shared maps: approximately 11 MiB including mipmaps, independent of terrain area. */
export class TurfMaterials {
  private maps: THREE.Texture[] = [];
  private disposed = false;
  private fallback = new THREE.DataTexture(new Uint8Array([128, 147, 78, 255]), 1, 1);
  private anisotropy: number;
  private invalidate: () => void;
  private onError: () => void;
  private cutMaps: ReturnType<typeof createCutTurfTextures>;
  readonly canopyUniforms: TurfCanopyUniforms;

  constructor(anisotropy: number, invalidate: () => void, onError: () => void) {
    this.anisotropy = anisotropy;
    this.invalidate = invalidate;
    this.onError = onError;
    this.cutMaps = createCutTurfTextures(anisotropy);
    this.canopyUniforms = {
      uCutColor: { value: this.cutMaps.albedo }, uTurfPhoto: { value: this.fallback },
      uCanopyGreen: { value: new THREE.Color('#dcebc7') },
      uCanopyFringe: { value: new THREE.Color('#c6d9ad') },
      uCanopyRough: { value: new THREE.Color('#a2bd82') },
      uCanopyRelief: { value: 1 },
    };
    this.fallback.colorSpace = THREE.SRGBColorSpace;
    this.fallback.needsUpdate = true;
  }

  create(surface: TurfSurface, uniforms: TurfUniforms, cupRadius = 0.054) {
    const isGreen = surface === 'green';
    const greenColor = new THREE.Color('#dcebc7');
    const fringeColor = new THREE.Color('#c6d9ad');
    const roughColor = new THREE.Color('#a2bd82');
    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.98,
      metalness: 0,
      dithering: true,
      map: this.fallback,
      normalScale: new THREE.Vector2(isGreen ? 0.23 : surface === 'fringe' ? 0.38 : 0.55, isGreen ? 0.23 : surface === 'fringe' ? 0.38 : 0.55),
    });

    // The material is replaced only when the green geometry changes, not on animation frames.
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms, this.canopyUniforms);
      shader.uniforms.uCutNormal = { value: this.cutMaps.normal };
      shader.uniforms.uIsGreen = { value: isGreen ? 1 : 0 };
      shader.uniforms.uTurfInnerColor = { value: isGreen || surface === 'fringe' ? greenColor : fringeColor };
      shader.uniforms.uTurfOuterColor = { value: isGreen ? greenColor : surface === 'fringe' ? fringeColor : roughColor };
      shader.vertexShader = 'attribute float surfaceBlend; varying float vSurfaceBlend; varying vec3 vTurfPosition;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\nvTurfPosition = transformed; vSurfaceBlend = surfaceBlend;',
      );
      shader.fragmentShader = `
        varying vec3 vTurfPosition;
        varying float vSurfaceBlend;
        uniform vec3 uTurfInnerColor;
        uniform vec3 uTurfOuterColor;
        uniform float uIsGreen;
        uniform vec2 uCup;
        uniform vec2 uSlope;
        uniform sampler2D uCutNormal;
        ${turfCanopyGLSL}
        ${grassCoverageGLSL}
        ${isGreen ? `uniform float uGrid; uniform float uHeat; uniform float uHeightScale;
          uniform float uFlow; uniform float uFlowTime; ${slopeFlowGLSL}` : ''}

        float turfHash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float turfNoise(vec2 p) {
          vec2 cell = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(turfHash(cell), turfHash(cell + vec2(1.0, 0.0)), f.x),
                     mix(turfHash(cell + vec2(0.0, 1.0)), turfHash(cell + vec2(1.0)), f.x), f.y);
        }
      ` + shader.fragmentShader
        .replace('#include <map_fragment>', `
          #include <map_fragment>
          float turfDistance = length(vViewPosition);
          float turfNearDetail = 1.0 - smoothstep(2.0, 12.0, turfDistance);
          float turfPrototypeMask = grassCoverage(vTurfPosition.xz) * turfNearDetail;
          float surfaceMix = smoothstep(0.0, 1.0, vSurfaceBlend);
          diffuseColor.rgb *= mix(uTurfInnerColor, uTurfOuterColor, surfaceMix);
          // Keep the licensed photograph's detail while cooling the dry yellow blades.
          float turfLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(diffuseColor.rgb, turfLuma * vec3(0.70, 1.28, 0.63), ${isGreen ? '0.65' : surface === 'fringe' ? 'mix(0.65, 0.48, surfaceMix)' : 'mix(0.48, 0.38, surfaceMix)'});
          ${isGreen ? `
            // A putting green reads as an even cut in the distance, with fine grain up close.
            float textureFootprint = max(length(dFdx(vMapUv)), length(dFdy(vMapUv)));
            float farCut = max(smoothstep(0.025, 0.14, textureFootprint), 1.0 - turfNearDetail);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.20, 0.065), farCut * 0.46);
          ` : ''}
        `)
        .replace('#include <color_fragment>', `
          #include <color_fragment>
          vec2 ground = vTurfPosition.xz;
          float cupDistance = distance(ground, uCup);
          // The underlying course must also leave the cup open below the green.
          if (cupDistance < ${cupRadius.toFixed(5)}) discard;
          // Low-frequency variation removes the uniform carpet appearance; no texture resampling.
          float patches = turfNoise(ground * 0.16) * 0.7 + turfNoise(ground * 0.61 + 8.2) * 0.3;
          diffuseColor.rgb *= mix(${isGreen ? '0.97, 1.035' : '0.89, 1.09'}, patches);
          // Broad, restrained mowing lanes. The fine blade normal is handled by the PBR light model.
          float lane = sin((ground.y + ground.x * 0.26 + sin(ground.x * 0.11) * 0.2) * 1.13);
          float mowing = smoothstep(-0.65, 0.65, lane);
          float laneStrength = uIsGreen * (1.0 - smoothstep(0.78, 1.0, vSurfaceBlend));
          diffuseColor.rgb *= mix(1.0, mix(0.965, 1.035, mowing), laneStrength);
          // A physically scaled cut-turf canopy replaces the long-grass photograph in the study.
          // Two non-aligned samples suppress a recognisable repeat; hardware mipmaps filter blades.
          vec2 cutUv = cutTurfUv(ground, ${isGreen ? '0.256' : surface === 'fringe' ? '0.40' : '0.72'});
          vec2 cutDx = dFdx(cutUv), cutDy = dFdy(cutUv);
          float cutFootprint = max(length(cutDx), length(cutDy)) * 1024.0;
          float cutReliefVisibility = (1.0 - smoothstep(2.0, 8.0, cutFootprint)) * turfPrototypeMask * uCanopyRelief;
          vec2 canopyGround = ground;
          // Trace the millimetre canopy, leaving the actual putting mesh and ball path intact.
          // Explicit gradients keep mip selection stable across steps and the coverage feather.
          if (cutReliefVisibility > 0.01) {
            vec3 toEye = normalize(cameraPosition - vTurfPosition);
            float elevation = max(toEye.y - dot(toEye.xz, uSlope), 0.18);
            vec2 travel = toEye.xz / elevation * ${isGreen ? '0.0012' : '0.0022'} / 6.0;
            vec2 rayGround = ground + travel * 6.0;
            vec2 previousGround = rayGround;
            float rayHeight = 1.0, previousGap = -1.0;
            for (int step = 0; step <= 6; step++) {
              float canopyHeight = textureGrad(uCutNormal, cutTurfUv(rayGround, ${isGreen ? '0.256' : surface === 'fringe' ? '0.40' : '0.72'}), cutDx, cutDy).a;
              float gap = canopyHeight - rayHeight;
              if (gap >= 0.0) {
                float crossing = clamp(-previousGap / max(gap - previousGap, 0.0001), 0.0, 1.0);
                canopyGround = mix(previousGround, rayGround, crossing);
                break;
              }
              previousGround = rayGround; previousGap = gap;
              rayGround -= travel; rayHeight -= 1.0 / 6.0;
            }
          }
          canopyGround = mix(ground, canopyGround, cutReliefVisibility);
          cutUv = cutTurfUv(canopyGround, ${isGreen ? '0.256' : surface === 'fringe' ? '0.40' : '0.72'});
          vec4 canopyShape = textureGrad(uCutNormal, cutUv, cutDx, cutDy);
          vec3 closeCut = turfCanopy(canopyGround, ${isGreen ? '0.0' : surface === 'fringe' ? '1.0' : '2.0'}, surfaceMix);
          vec3 closeCutNormal = canopyShape.rgb * 2.0 - 1.0;
          closeCut *= mix(1.0, mix(0.66, 1.04, smoothstep(0.18, 0.82, canopyShape.a)), cutReliefVisibility);
          closeCut *= mix(0.965, 1.035, mowing) * mix(0.97, 1.035, patches);
          diffuseColor.rgb = mix(diffuseColor.rgb, closeCut, turfPrototypeMask);
          ${isGreen ? `
            // Millimetre-scale grain vanishes once a pixel covers several blades.
            vec2 bladeUv = ground * vec2(480.0, 220.0);
            float bladeFootprint = max(length(dFdx(bladeUv)), length(dFdy(bladeUv)));
            float bladeVisibility = 1.0 - smoothstep(0.3, 1.1, bladeFootprint);
            float cutGrain = turfHash(floor(bladeUv));
            diffuseColor.rgb *= 1.0 + (cutGrain - 0.5) * bladeVisibility * turfNearDetail * (1.0 - turfPrototypeMask) * 0.12;
            // A narrow contact occlusion grounds the cut lip without painting a large dark ring.
            diffuseColor.rgb *= mix(0.60, 1.0, smoothstep(${cupRadius.toFixed(5)}, ${(cupRadius + 0.023).toFixed(5)}, cupDistance));
            float height = clamp(0.5 + vTurfPosition.y / max(uHeightScale, 0.05), 0.0, 1.0);
            vec3 heatColor = height < 0.5
              ? mix(vec3(0.08, 0.26, 0.38), vec3(0.23, 0.38, 0.07), height * 2.0)
              : mix(vec3(0.23, 0.38, 0.07), vec3(0.56, 0.27, 0.04), (height - 0.5) * 2.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, heatColor, uHeat * 0.72);
          ` : ''}
        `)
        .replace('#include <normal_fragment_maps>', `
          #include <normal_fragment_maps>
          // Preserve grazing light nearby, and flatten unresolved normals in the distance.
          normal = normalize(mix(nonPerturbedNormal, normal, mix(0.16, 1.0, turfNearDetail)));
          #ifdef USE_NORMALMAP_TANGENTSPACE
            float nap = sin(vTurfPosition.z * 9.0 + vTurfPosition.x * 2.3) * 0.012;
            normal = normalize(normal + tbn[0] * nap * turfNearDetail);
            vec3 cutNormal = normalize(nonPerturbedNormal
              + tbn[0] * closeCutNormal.x * turfNearDetail * 1.15
              + tbn[1] * closeCutNormal.y * turfNearDetail * 1.15);
            normal = normalize(mix(normal, cutNormal, turfPrototypeMask));
          #endif
        `)
        .replace('#include <roughnessmap_fragment>', `
          #include <roughnessmap_fragment>
          roughnessFactor = mix(0.98, clamp(roughnessFactor, 0.86, 1.0), turfNearDetail);
        `)
        .replace('#include <opaque_fragment>', `
          ${isGreen ? `
            // Draw the reading grid after lighting so it remains thin and legible in shadow.
            vec2 cell = vTurfPosition.xz * 2.0;
            vec2 gridWidth = max(fwidth(cell), vec2(0.0001));
            vec2 gridDist = abs(fract(cell - 0.5) - 0.5) / gridWidth;
            float grid = 1.0 - smoothstep(0.35, 1.1, min(gridDist.x, gridDist.y));
            float gridDistanceFade = 1.0 - smoothstep(0.15, 0.65, max(gridWidth.x, gridWidth.y));
            outgoingLight = mix(outgoingLight, vec3(0.64, 0.77, 0.48), grid * gridDistanceFade * uGrid * 0.065);
            float flow = slopeFlow(cell, gridDist, gridWidth, uSlope, uFlowTime);
            float flowDistanceFade = 1.0 - smoothstep(0.05, 0.24, max(gridWidth.x, gridWidth.y));
            outgoingLight = mix(outgoingLight, vec3(0.70, 0.80, 0.53), flow * flowDistanceFade * uFlow * 0.60);
          ` : ''}
          #include <opaque_fragment>
        `);
    };
    material.customProgramCacheKey = () => `course-turf-v9-flow-${surface}-${cupRadius}`;
    this.applyMaps(material);
    return material;
  }

  private loaded?: { albedo: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture };
  private pending = new Set<THREE.MeshStandardMaterial>();
  private started = false;

  private applyMaps(material: THREE.MeshStandardMaterial) {
    if (this.loaded) { this.bindMaps(material); return; }
    this.pending.add(material);
    material.addEventListener('dispose', () => { this.pending.delete(material); });
    if (this.started) return;
    this.started = true;
    const loader = new THREE.TextureLoader();
    Promise.all([loader.loadAsync(albedoUrl), loader.loadAsync(normalUrl), loader.loadAsync(roughnessUrl)])
      .then(([albedo, normal, roughness]) => {
        if (this.disposed) { [albedo, normal, roughness].forEach(map => map.dispose()); return; }
        this.maps = [albedo, normal, roughness];
        albedo.colorSpace = THREE.SRGBColorSpace;
        normal.repeat.set(1.5, 1.5);
        for (const map of this.maps) {
          map.wrapS = map.wrapT = THREE.RepeatWrapping;
          map.anisotropy = this.anisotropy;
          map.minFilter = THREE.LinearMipmapLinearFilter;
          map.magFilter = THREE.LinearFilter;
          map.generateMipmaps = true;
          map.needsUpdate = true;
        }
        this.loaded = { albedo, normal, roughness };
        this.canopyUniforms.uTurfPhoto.value = albedo;
        reportRenderDiagnostic('turf-loaded', {
          albedo: [albedo.image.width, albedo.image.height],
          normal: [normal.image.width, normal.image.height],
          roughness: [roughness.image.width, roughness.image.height],
          materials: this.pending.size,
        });
        this.pending.forEach(item => this.bindMaps(item));
        this.pending.clear();
        this.invalidate();
      })
      .catch(error => {
        if (!this.disposed) {
          reportRenderDiagnostic('texture-error', { message: String(error) });
          this.onError();
        }
      });
  }

  private bindMaps(material: THREE.MeshStandardMaterial) {
    if (!this.loaded) return;
    material.map = this.loaded.albedo;
    material.normalMap = this.loaded.normal;
    material.roughnessMap = this.loaded.roughness;
    material.needsUpdate = true;
  }

  dispose() {
    this.disposed = true;
    this.maps.forEach(map => map.dispose());
    this.fallback.dispose();
    this.cutMaps.albedo.dispose(); this.cutMaps.normal.dispose();
    this.pending.clear();
  }
}
