import type { PixelOffset, PreparedScene } from '../shared/types';

export interface Compositor {
  readonly kind: 'webgl2' | 'canvas2d';
  setScene(scene: PreparedScene): void;
  /** Resize the drawing buffer to the canvas's CSS size × device pixel ratio. */
  resize(): void;
  /** Draw the scene with the background shifted by `offset` image pixels. */
  draw(offset: PixelOffset): void;
  dispose(): void;
}

/** Device pixel ratio, capped: the 720 px wide A07 gains nothing past 2x and it costs fill rate. */
export function renderScale(): number {
  return Math.min(globalThis.devicePixelRatio || 1, 2);
}
