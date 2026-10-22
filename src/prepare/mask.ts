/**
 * Pure mask operations on single-channel images stored row-major.
 * Float masks are in [0, 1]. Nothing here touches the DOM, so it runs in a
 * worker and in unit tests.
 */

export interface Size {
  width: number;
  height: number;
}

export interface NormPoint {
  x: number;
  y: number;
}

/** Bilinear resample of a float mask to a new size. */
export function resizeMask(src: Float32Array, from: Size, to: Size): Float32Array {
  if (from.width === to.width && from.height === to.height) return src.slice();
  const out = new Float32Array(to.width * to.height);
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  for (let y = 0; y < to.height; y++) {
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), from.height - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, from.height - 1);
    const ty = fy - y0;
    for (let x = 0; x < to.width; x++) {
      const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), from.width - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, from.width - 1);
      const tx = fx - x0;
      const a = src[y0 * from.width + x0]!;
      const b = src[y0 * from.width + x1]!;
      const c = src[y1 * from.width + x0]!;
      const d = src[y1 * from.width + x1]!;
      out[y * to.width + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

/** Nearest-neighbour resample of a label mask. */
export function resizeLabels(src: Uint8Array, from: Size, to: Size): Uint8Array {
  if (from.width === to.width && from.height === to.height) return src.slice();
  const out = new Uint8Array(to.width * to.height);
  for (let y = 0; y < to.height; y++) {
    const sy = Math.min(from.height - 1, Math.floor(((y + 0.5) * from.height) / to.height));
    for (let x = 0; x < to.width; x++) {
      const sx = Math.min(from.width - 1, Math.floor(((x + 0.5) * from.width) / to.width));
      out[y * to.width + x] = src[sy * from.width + sx]!;
    }
  }
  return out;
}

export interface Component {
  id: number;
  area: number;
  cx: number;
  cy: number;
  /** Most common label value inside the component. */
  label: number;
}

/**
 * 4-connected components of pixels where `inside(i)` is true.
 * Returns a per-pixel component id (0 = none) and component stats.
 */
export function connectedComponents(
  size: Size,
  inside: (i: number) => boolean,
  labelOf?: (i: number) => number,
): { ids: Int32Array; components: Component[] } {
  const { width: w, height: h } = size;
  const ids = new Int32Array(w * h);
  const components: Component[] = [];
  const stack = new Int32Array(w * h);
  let next = 1;
  for (let start = 0; start < w * h; start++) {
    if (ids[start] !== 0 || !inside(start)) continue;
    const id = next++;
    let sp = 0;
    stack[sp++] = start;
    ids[start] = id;
    let area = 0;
    let sx = 0;
    let sy = 0;
    const counts = new Map<number, number>();
    while (sp > 0) {
      const i = stack[--sp]!;
      const x = i % w;
      const y = (i - x) / w;
      area++;
      sx += x;
      sy += y;
      if (labelOf) {
        const l = labelOf(i);
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      if (x > 0 && ids[i - 1] === 0 && inside(i - 1)) (ids[i - 1] = id), (stack[sp++] = i - 1);
      if (x < w - 1 && ids[i + 1] === 0 && inside(i + 1)) (ids[i + 1] = id), (stack[sp++] = i + 1);
      if (y > 0 && ids[i - w] === 0 && inside(i - w)) (ids[i - w] = id), (stack[sp++] = i - w);
      if (y < h - 1 && ids[i + w] === 0 && inside(i + w)) (ids[i + w] = id), (stack[sp++] = i + w);
    }
    let label = 0;
    let best = -1;
    for (const [l, c] of counts) if (c > best) (best = c), (label = l);
    components.push({ id, area, cx: sx / area, cy: sy / area, label });
  }
  return { ids, components };
}

/**
 * Two-pass chamfer (3-4) distance from each inside pixel to the nearest
 * outside pixel or image edge. Units: roughly 3 per pixel.
 */
export function chamferDistance(size: Size, inside: Uint8Array): Uint16Array {
  const { width: w, height: h } = size;
  const INF = 65000;
  const d = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = inside[i] ? INF : 0;
  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, get(x - 1, y) + 3, get(x, y - 1) + 3, get(x - 1, y - 1) + 4, get(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, get(x + 1, y) + 3, get(x, y + 1) + 3, get(x + 1, y + 1) + 4, get(x - 1, y + 1) + 4);
    }
  }
  return d;
}

/** Smooth threshold of a confidence mask into an alpha mask. */
export function confidenceToAlpha(conf: Float32Array, lo = 0.35, hi = 0.65): Float32Array {
  const out = new Float32Array(conf.length);
  const span = hi - lo;
  for (let i = 0; i < conf.length; i++) {
    const t = Math.min(Math.max((conf[i]! - lo) / span, 0), 1);
    out[i] = t * t * (3 - 2 * t);
  }
  return out;
}

/** Separable max filter (grayscale dilation) with a square radius r. */
export function dilate(src: Float32Array, size: Size, r: number): Float32Array {
  if (r <= 0) return src.slice();
  return separable(src, size, r, (a, b) => (a > b ? a : b), 0);
}

/** Separable min filter (grayscale erosion) with a square radius r. */
export function erode(src: Float32Array, size: Size, r: number): Float32Array {
  if (r <= 0) return src.slice();
  return separable(src, size, r, (a, b) => (a < b ? a : b), 1);
}

function separable(
  src: Float32Array,
  { width: w, height: h }: Size,
  r: number,
  pick: (a: number, b: number) => number,
  init: number,
): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = init;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = pick(v, src[y * w + k]!);
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = init;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = pick(v, tmp[k * w + x]!);
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Separable box blur with radius r (running sums, O(1) per pixel). */
export function boxBlur(src: Float32Array, { width: w, height: h }: Size, r: number): Float32Array {
  if (r <= 0) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    let n = 0;
    for (let k = 0; k <= Math.min(r, w - 1); k++) (sum += src[row + k]!), n++;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n;
      const add = x + r + 1;
      const sub = x - r;
      if (add < w) (sum += src[row + add]!), n++;
      if (sub >= 0) (sum -= src[row + sub]!), n--;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let n = 0;
    for (let k = 0; k <= Math.min(r, h - 1); k++) (sum += tmp[k * w + x]!), n++;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n;
      const add = y + r + 1;
      const sub = y - r;
      if (add < h) (sum += tmp[add * w + x]!), n++;
      if (sub >= 0) (sum -= tmp[sub * w + x]!), n--;
    }
  }
  return out;
}

/**
 * Remove blobs that do not contain any seed point: keeps only the regions
 * (alpha > 0.5) the user or detector pointed at, plus their soft edges.
 */
export function keepSeededRegions(alpha: Float32Array, size: Size, seeds: NormPoint[]): Float32Array {
  const { ids, components } = connectedComponents(size, (i) => alpha[i]! > 0.5);
  if (components.length <= 1) return alpha.slice();
  const keep = new Set<number>();
  for (const s of seeds) {
    const x = Math.min(size.width - 1, Math.max(0, Math.round(s.x * size.width)));
    const y = Math.min(size.height - 1, Math.max(0, Math.round(s.y * size.height)));
    const id = ids[y * size.width + x]!;
    if (id) keep.add(id);
  }
  // No seed landed inside a blob (e.g. a tap on a thin edge): keep the largest.
  if (keep.size === 0) {
    const largest = components.reduce((a, b) => (b.area > a.area ? b : a));
    keep.add(largest.id);
  }
  const keepMask = new Float32Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) keepMask[i] = keep.has(ids[i]!) ? 1 : 0;
  // Grow the kept core slightly so its soft edge (alpha <= 0.5) survives.
  const grown = dilate(keepMask, size, 3);
  const out = new Float32Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) out[i] = alpha[i]! * grown[i]!;
  return out;
}

export function maskArea(alpha: Float32Array, threshold = 0.5): number {
  let n = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i]! > threshold) n++;
  return n;
}

/** Intersection over union of two masks thresholded at 0.5. */
export function iou(a: Float32Array, b: Float32Array): number {
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i]! > 0.5;
    const pb = b[i]! > 0.5;
    if (pa && pb) inter++;
    if (pa || pb) uni++;
  }
  return uni === 0 ? 0 : inter / uni;
}
