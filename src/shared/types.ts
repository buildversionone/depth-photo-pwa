/** Image sources both renderers can draw and upload. */
export type LayerSource = HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

/**
 * Output of the preparation stage; everything the viewer needs.
 * Both layers share the same pixel size and are pixel-aligned.
 */
export interface PreparedScene {
  width: number;
  height: number;
  /** Opaque background with the hidden region behind the subject filled in. */
  background: LayerSource;
  /** Subject with straight (non-premultiplied) alpha; transparent elsewhere. */
  foreground: LayerSource;
  /**
   * Largest background shift, as a fraction of the image's shorter side.
   * The viewer crops this margin off every edge so the shift never shows empty space.
   */
  maxOffset: number;
  label: string;
}

/** Background offset in image pixels. */
export interface PixelOffset {
  x: number;
  y: number;
}
