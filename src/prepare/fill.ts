import type { Size } from './mask';

/**
 * Push-pull hole filling (Gortler et al. 1996 style): known pixels are
 * averaged down a pyramid, then holes are filled from coarser levels on the
 * way back up. Smooth, hole-free and fast; it does not synthesize texture.
 *
 * @param rgba   pixels, modified in place for hole pixels
 * @param hole   per-pixel hole weight in [0, 1]; 1 = unknown, 0 = keep
 */
export function pushPullFill(rgba: Uint8ClampedArray, size: Size, hole: Float32Array): void {
  type Level = { w: number; h: number; c: Float32Array }; // r, g, b, weight per pixel
  const levels: Level[] = [];
  const { width: w0, height: h0 } = size;
  const base = new Float32Array(w0 * h0 * 4);
  for (let i = 0; i < w0 * h0; i++) {
    const k = hole[i]! > 0.01 ? 0 : 1;
    base[i * 4] = rgba[i * 4]! * k;
    base[i * 4 + 1] = rgba[i * 4 + 1]! * k;
    base[i * 4 + 2] = rgba[i * 4 + 2]! * k;
    base[i * 4 + 3] = k;
  }
  levels.push({ w: w0, h: h0, c: base });

  // Push: downsample by 2 with weighted sums, normalised so weights stay <= 1.
  while (levels[levels.length - 1]!.w > 1 || levels[levels.length - 1]!.h > 1) {
    const src = levels[levels.length - 1]!;
    const w = Math.max(1, Math.ceil(src.w / 2));
    const h = Math.max(1, Math.ceil(src.h / 2));
    const c = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, wt = 0;
        for (let dy = 0; dy < 2; dy++) {
          const sy = Math.min(src.h - 1, y * 2 + dy);
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(src.w - 1, x * 2 + dx);
            const j = (sy * src.w + sx) * 4;
            r += src.c[j]!;
            g += src.c[j + 1]!;
            b += src.c[j + 2]!;
            wt += src.c[j + 3]!;
          }
        }
        const o = (y * w + x) * 4;
        const norm = wt > 1 ? 1 / wt : 1;
        c[o] = r * norm;
        c[o + 1] = g * norm;
        c[o + 2] = b * norm;
        c[o + 3] = Math.min(wt, 1);
      }
    }
    levels.push({ w, h, c });
  }

  // Pull: fill each level's missing weight from the (already filled) coarser level.
  for (let li = levels.length - 2; li >= 0; li--) {
    const fine = levels[li]!;
    const coarse = levels[li + 1]!;
    for (let y = 0; y < fine.h; y++) {
      // Bilinear sample of the coarser level at this pixel's centre.
      const fy = Math.min(Math.max((y + 0.5) / 2 - 0.5, 0), coarse.h - 1);
      const y0 = Math.floor(fy);
      const y1 = Math.min(y0 + 1, coarse.h - 1);
      const ty = fy - y0;
      for (let x = 0; x < fine.w; x++) {
        const o = (y * fine.w + x) * 4;
        const wt = fine.c[o + 3]!;
        if (wt >= 1) continue;
        const fx = Math.min(Math.max((x + 0.5) / 2 - 0.5, 0), coarse.w - 1);
        const x0 = Math.floor(fx);
        const x1 = Math.min(x0 + 1, coarse.w - 1);
        const tx = fx - x0;
        for (let ch = 0; ch < 4; ch++) {
          const a = coarse.c[(y0 * coarse.w + x0) * 4 + ch]!;
          const b = coarse.c[(y0 * coarse.w + x1) * 4 + ch]!;
          const c = coarse.c[(y1 * coarse.w + x0) * 4 + ch]!;
          const d = coarse.c[(y1 * coarse.w + x1) * 4 + ch]!;
          const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
          fine.c[o + ch] = fine.c[o + ch]! + v * (1 - wt);
        }
      }
    }
  }

  // Write back: coarse levels now hold weight-premultiplied colour with weight ~1.
  const top = levels[0]!.c;
  for (let i = 0; i < w0 * h0; i++) {
    if (hole[i]! <= 0.01) continue;
    const wt = top[i * 4 + 3]! || 1;
    rgba[i * 4] = top[i * 4]! / wt;
    rgba[i * 4 + 1] = top[i * 4 + 1]! / wt;
    rgba[i * 4 + 2] = top[i * 4 + 2]! / wt;
    rgba[i * 4 + 3] = 255;
  }
}
