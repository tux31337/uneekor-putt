import * as THREE from 'three';

export const REFERENCE_TREE_FILE = 'external/tree-small-02/tree-small-02.glb';
export const REFERENCE_TREE_LABEL = 'Tree Small 02 · Poly Haven / Rico Cilliers · CC0';

/** Preserve the original topology, UVs and PBR maps; fit one tree to the existing hero's height. */
export function prepareReferenceTree(source: THREE.Group, height: number) {
  const bounds = new THREE.Box3().setFromObject(source);
  const nativeHeight = bounds.max.y - bounds.min.y;
  const scale = height / nativeHeight;
  // Anchor the scanned trunk, rather than the asymmetric canopy's bounding-box centre.
  const root = new THREE.Vector3();
  let samples = 0;
  const textures = new Set<THREE.Texture>();
  source.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = object.receiveShadow = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some(m => m.name.endsWith('_trunk'))) {
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) if (positions.getY(i) < bounds.min.y + 0.045) {
        root.add(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld)); samples++;
      }
    }
    materials.forEach(material => {
      Object.values(material).forEach(value => {
        if (value instanceof THREE.Texture) { value.anisotropy = 8; textures.add(value); }
      });
      material.dithering = true;
      material.alphaToCoverage = material.alphaTest > 0;
    });
  });
  if (samples) root.divideScalar(samples);
  source.position.set(-root.x, -bounds.min.y - 0.035 / scale, -root.z);
  const tree = new THREE.Group();
  tree.name = 'hero-reference-tree-small-02';
  tree.scale.setScalar(scale); tree.add(source);
  tree.userData.asset = REFERENCE_TREE_LABEL;
  tree.userData.nativeHeight = nativeHeight;
  tree.userData.displayHeight = height;
  tree.userData.uniformScale = scale;
  tree.userData.groundEmbedMeters = 0.035;
  return { tree, textures: [...textures] };
}
