import { pushPullFill } from './fill';
import { boxBlur, confidenceToAlpha, dilate, keepSeededRegions, type NormPoint, type Size } from './mask';

export interface EdgeParams {
  /** Grow the mask by this many pixels (covers boundary gaps; does not scale the subject). */
  expandPx: number;
  /** Feather radius in pixels. */
  featherPx: number;
}

export const DEFAULT_EDGE_PARAMS: EdgeParams = { expandPx: 1, featherPx: 1 };

/** Confidence mask (image resolution) -> clean alpha matte for the subject. */
export function refineAlpha(conf: Float32Array, size: Size, seeds: NormPoint[], p: EdgeParams = DEFAULT_EDGE_PARAMS): Float32Array {
  let a = confidenceToAlpha(conf);
  a = keepSeededRegions(a, size, seeds);
  a = dilate(a, size, Math.round(p.expandPx));
  a = boxBlur(a, size, Math.round(p.featherPx));
  return a;
}

export interface Layers {
  background: Uint8ClampedArray;
  foreground: Uint8ClampedArray;
}

/**
 * Split a photo into a filled background and a straight-alpha foreground.
 * Edge colours of the foreground are decontaminated against the filled
 * background so the old background does not show as a halo when it moves.
 */
export function buildLayers(rgba: Uint8ClampedArray, size: Size, alpha: Float32Array): Layers {
  const n = size.width * size.height;
  const hole = dilate(alpha, size, 2);
  const background = new Uint8ClampedArray(rgba);
  pushPullFill(background, size, hole);

  const foreground = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const a = alpha[i]!;
    const o = i * 4;
    if (a <= 0.004) continue;
    if (a >= 0.98) {
      foreground[o] = rgba[o]!;
      foreground[o + 1] = rgba[o + 1]!;
      foreground[o + 2] = rgba[o + 2]!;
    } else {
      // I = a·F + (1 − a)·B  =>  F = (I − (1 − a)·B) / a, clamped by the typed array.
      const k = 1 - a;
      const inv = 1 / Math.max(a, 0.15);
      foreground[o] = (rgba[o]! - k * background[o]!) * inv;
      foreground[o + 1] = (rgba[o + 1]! - k * background[o + 1]!) * inv;
      foreground[o + 2] = (rgba[o + 2]! - k * background[o + 2]!) * inv;
    }
    foreground[o + 3] = Math.round(a * 255);
  }
  return { background, foreground };
}
