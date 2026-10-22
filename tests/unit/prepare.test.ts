import { describe, expect, it } from 'vitest';
import { buildLayers, refineAlpha } from '../../src/prepare/compose';
import { pushPullFill } from '../../src/prepare/fill';
import { boxBlur, confidenceToAlpha, dilate, iou, keepSeededRegions, maskArea, resizeMask } from '../../src/prepare/mask';
import { subjectFromMask, suggestSubjects } from '../../src/prepare/subject';

const size = { width: 20, height: 20 };

function square(x0: number, y0: number, x1: number, y1: number, v = 1): Float32Array {
  const m = new Float32Array(size.width * size.height);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * size.width + x] = v;
  return m;
}

describe('mask helpers', () => {
  it('maps confidence through a smoothstep', () => {
    const a = confidenceToAlpha(new Float32Array([0, 0.35, 0.5, 0.65, 1]));
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(0);
    expect(a[2]).toBeCloseTo(0.5, 5);
    expect(a[3]).toBe(1);
    expect(a[4]).toBe(1);
  });

  it('dilates by the given radius', () => {
    expect(maskArea(dilate(square(9, 9, 10, 10), size, 1))).toBe(9);
  });

  it('box blur preserves a constant field', () => {
    const out = boxBlur(new Float32Array(size.width * size.height).fill(0.7), size, 2);
    for (const v of out) expect(v).toBeCloseTo(0.7, 5);
  });

  it('resizes a mask without shifting it', () => {
    const big = resizeMask(square(0, 0, 10, 20), size, { width: 40, height: 40 });
    expect(big[20 * 40 + 5]).toBeCloseTo(1);
    expect(big[20 * 40 + 35]).toBeCloseTo(0);
  });

  it('keeps only the blob a seed points at', () => {
    const a = square(1, 1, 5, 5);
    const b = square(12, 12, 18, 18);
    const two = a.map((v, i) => Math.max(v, b[i]!));
    const kept = keepSeededRegions(two, size, [{ x: 0.15, y: 0.15 }]);
    expect(kept[3 * 20 + 3]).toBe(1);
    expect(kept[15 * 20 + 15]).toBe(0);
  });

  it('iou of identical masks is 1 and of disjoint masks is 0', () => {
    expect(iou(square(0, 0, 5, 5), square(0, 0, 5, 5))).toBe(1);
    expect(iou(square(0, 0, 5, 5), square(10, 10, 15, 15))).toBe(0);
  });
});

describe('background fill', () => {
  it('fills a hole with the surrounding colour', () => {
    const rgba = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([200, 100, 50, 255], i);
    const hole = square(6, 6, 14, 14);
    for (let i = 0; i < hole.length; i++) if (hole[i]) rgba.set([0, 255, 0, 255], i * 4);
    pushPullFill(rgba, size, hole);
    const o = (10 * 20 + 10) * 4;
    expect(Math.abs(rgba[o]! - 200)).toBeLessThan(3);
    expect(Math.abs(rgba[o + 1]! - 100)).toBeLessThan(3);
  });
});

describe('layers', () => {
  it('refineAlpha keeps the seeded subject and drops a stray patch', () => {
    const conf = square(4, 4, 12, 12, 0.9);
    conf[18 * 20 + 18] = 0.9;
    conf[18 * 20 + 17] = 0.9;
    const a = refineAlpha(conf, size, [{ x: 0.4, y: 0.4 }]);
    expect(a[8 * 20 + 8]).toBeGreaterThan(0.9);
    expect(a[18 * 20 + 18]).toBe(0);
  });

  it('subject pixels go to the foreground and are removed from the background', () => {
    const rgba = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([10, 10, 200, 255], i);
    const alpha = square(6, 6, 14, 14);
    for (let i = 0; i < alpha.length; i++) if (alpha[i]) rgba.set([250, 20, 20, 255], i * 4);
    const { foreground, background } = buildLayers(rgba, size, alpha);
    const o = (10 * 20 + 10) * 4;
    expect(Array.from(foreground.subarray(o, o + 4))).toEqual([250, 20, 20, 255]);
    expect(background[o + 2]!).toBeGreaterThan(150);
    expect(foreground[3]).toBe(0);
  });
});

describe('subject suggestions', () => {
  const img = { width: 1000, height: 1000 };

  it('drops surfaces, tiny boxes and weak detections', () => {
    const s = suggestSubjects(
      [
        { label: 'person', score: 0.9, x: 300, y: 200, width: 300, height: 600 },
        { label: 'couch', score: 0.95, x: 0, y: 500, width: 1000, height: 500 },
        { label: 'cup', score: 0.8, x: 10, y: 10, width: 20, height: 20 },
        { label: 'dog', score: 0.2, x: 600, y: 600, width: 300, height: 300 },
      ],
      img,
    );
    expect(s.map((x) => x.label)).toEqual(['person']);
    expect(s[0]!.point).toEqual({ x: 0.45, y: 0.5 });
  });

  it('centre fallback accepts one object and rejects a full-frame mask', () => {
    expect(subjectFromMask(square(5, 5, 15, 15), size)).not.toBeNull();
    expect(subjectFromMask(new Float32Array(400).fill(1), size)).toBeNull();
  });
});
