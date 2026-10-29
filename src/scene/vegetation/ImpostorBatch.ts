import * as THREE from 'three';

export interface PlantPlacement { x: number; z: number; scale: number; rotation: number; variant: number; tint: number }

/** One opaque cutout draw per atlas; no stacked crossed cards or transparent sorting. */
export class ImpostorBatch extends THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  private frames: THREE.InstancedBufferAttribute;
  private dummy = new THREE.Object3D();
  private basis = new THREE.Matrix4();
  private eye = new THREE.Vector3();
  private center = new THREE.Vector3();
  readonly plants: PlantPlacement[];
  private size: number;
  private centerY: number;
  private columns: number;
  private rows: number;
  private aspect: number;
  private lastCamera = new THREE.Vector3(Infinity, 0, 0);
  private floors: number[] = [];
  private yaw: number[] = [];

  constructor(texture: THREE.Texture, plants: PlantPlacement[], size: number,
    centerY: number, columns = 8, rows = 4, aspect = 1) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const frames = new THREE.InstancedBufferAttribute(new Float32Array(plants.length * 4), 4);
    geometry.setAttribute('instanceViews', frames);
    const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.26, alphaToCoverage: true, side: THREE.FrontSide, toneMapped: false });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute vec4 instanceViews; varying vec4 vViews; varying vec2 vPlantUv;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvViews = instanceViews; vPlantUv = uv;');
      shader.fragmentShader = 'varying vec4 vViews; varying vec2 vPlantUv; uniform mat3 mapTransform;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
        vec2 localUv = clamp(vPlantUv, vec2(0.004), vec2(0.996));
        vec2 cells = vec2(${columns.toFixed(1)}, ${rows.toFixed(1)});
        float nextColumn = mod(vViews.x + 1.0, cells.x);
        float nextRow = min(vViews.y + 1.0, cells.y - 1.0);
        vec4 a = texture2D(map, (mapTransform * vec3((vec2(vViews.x, cells.y - 1.0 - vViews.y) + localUv) / cells, 1.0)).xy);
        vec4 b = texture2D(map, (mapTransform * vec3((vec2(nextColumn, cells.y - 1.0 - vViews.y) + localUv) / cells, 1.0)).xy);
        vec4 c = texture2D(map, (mapTransform * vec3((vec2(vViews.x, cells.y - 1.0 - nextRow) + localUv) / cells, 1.0)).xy);
        vec4 d = texture2D(map, (mapTransform * vec3((vec2(nextColumn, cells.y - 1.0 - nextRow) + localUv) / cells, 1.0)).xy);
        // Blend premultiplied samples inside one depth-writing cutout, without pixel dissolve.
        a.rgb *= a.a; b.rgb *= b.a; c.rgb *= c.a; d.rgb *= d.a;
        vec4 plantColor = mix(mix(a, b, vViews.z), mix(c, d, vViews.z), vViews.w);
        plantColor.rgb /= max(plantColor.a, 0.0001);
        diffuseColor *= plantColor;
      `);
    };
    material.customProgramCacheKey = () => `whole-plant-interpolated-cutout-${columns}-${rows}`;
    super(geometry, material, plants.length);
    this.plants = plants; this.size = size; this.centerY = centerY; this.columns = columns; this.rows = rows; this.aspect = aspect;
    this.frames = frames;
    this.name = columns === 1 ? 'forest-cluster-images' : 'whole-tree-multiview-images';
    this.instanceMatrix.setUsage(THREE.DynamicDrawUsage); frames.setUsage(THREE.DynamicDrawUsage);
    this.frustumCulled = false;
    const tint = new THREE.Color();
    plants.forEach((plant, index) => { this.setColorAt(index, tint.setScalar(plant.tint)); this.yaw[index] = plant.rotation; });
  }

  setGround(heightAt: (x: number, z: number) => number) {
    this.floors = this.plants.map(plant => heightAt(plant.x, plant.z)); this.lastCamera.x = Infinity;
  }

  faceCamera(camera: THREE.Camera) {
    camera.getWorldPosition(this.eye);
    if (this.eye.distanceToSquared(this.lastCamera) < 0.00000001) return;
    this.lastCamera.copy(this.eye);
    this.plants.forEach((plant, i) => {
      this.center.set(plant.x, this.floors[i] + this.centerY * plant.scale, plant.z);
      const dx = this.eye.x - this.center.x, dz = this.eye.z - this.center.z, horizontal = Math.hypot(dx, dz);
      if (horizontal > 0.001) this.yaw[i] = Math.atan2(dx, dz);
      const elevation = Math.max(0, Math.atan2(this.eye.y - this.center.y, horizontal)) * 180 / Math.PI;
      const azimuth = ((this.yaw[i] - plant.rotation) / (Math.PI * 2) % 1 + 1) % 1 * this.columns;
      const row = Math.min(this.rows - 1, elevation / 30);
      this.frames.setXYZW(i, Math.floor(azimuth), Math.floor(row), azimuth % 1, row % 1);
      this.basis.lookAt(this.eye, this.center, this.up);
      this.dummy.position.copy(this.center); this.dummy.quaternion.setFromRotationMatrix(this.basis);
      this.dummy.scale.set(this.size * plant.scale * this.aspect, this.size * plant.scale, 1);
      this.dummy.updateMatrix(); this.setMatrixAt(i, this.dummy.matrix);
    });
    this.instanceMatrix.needsUpdate = true; this.frames.needsUpdate = true;
  }

  getViewSamples() { return Array.from(this.frames.array); }
}
