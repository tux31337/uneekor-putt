type GrassMode = 'baseline' | 'prototype';

interface GrassCaptureScene {
  pause(): void;
  setGrassMode(mode: GrassMode): void;
  captureFrame(): Promise<Blob>;
}

/** Snapshot both variants in one task, before camera damping can advance on the next frame. */
export function captureGrassPair(scene: GrassCaptureScene, restoreMode: GrassMode): Promise<[Blob, Blob]> {
  scene.pause();
  try {
    // captureFrame renders and starts toBlob synchronously. Only PNG encoding is asynchronous.
    const capture = async (mode: GrassMode) => {
      scene.setGrassMode(mode);
      return scene.captureFrame();
    };
    return Promise.all([capture('baseline'), capture('prototype')]);
  } finally {
    scene.setGrassMode(restoreMode);
  }
}
