import type { PixelOffset } from '../shared/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Margin in image pixels cropped from every edge, from the scene's max offset. */
export function marginPx(width: number, height: number, maxOffset: number): number {
  return Math.max(0, maxOffset) * Math.min(width, height);
}

/** The part of the image that is shown: the full image minus the margin on each side. */
export function cropRect(width: number, height: number, maxOffset: number): Rect {
  const m = Math.min(marginPx(width, height, maxOffset), Math.min(width, height) / 4);
  return { x: m, y: m, w: width - 2 * m, h: height - 2 * m };
}

/** Fit a content aspect ratio inside a canvas (letterboxed, centred). */
export function containRect(canvasW: number, canvasH: number, contentW: number, contentH: number): Rect {
  const scale = Math.min(canvasW / contentW, canvasH / contentH);
  const w = contentW * scale;
  const h = contentH * scale;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}

/**
 * Convert a unit offset ([-1, 1] per axis) to image pixels, clamped so the
 * background sample rectangle always stays inside the image.
 */
export function unitToPixelOffset(
  unit: { x: number; y: number },
  width: number,
  height: number,
  maxOffset: number,
): PixelOffset {
  const crop = cropRect(width, height, maxOffset);
  const m = crop.x; // same margin on all sides
  const clamp = (v: number) => (v < -m ? -m : v > m ? m : v);
  return { x: clamp(unit.x * m), y: clamp(unit.y * m) };
}
