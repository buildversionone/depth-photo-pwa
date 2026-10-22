import { describe, expect, it } from 'vitest';
import { containRect, cropRect, marginPx, unitToPixelOffset } from '../../src/render/layout';

describe('layout', () => {
  it('margin is a fraction of the shorter side', () => {
    expect(marginPx(1080, 1440, 0.025)).toBeCloseTo(27);
    expect(marginPx(1440, 1080, 0.025)).toBeCloseTo(27);
  });

  it('crop removes the margin from every edge', () => {
    expect(cropRect(1000, 2000, 0.05)).toEqual({ x: 50, y: 50, w: 900, h: 1900 });
  });

  it('contain fits and centres without distortion', () => {
    const r = containRect(720, 1600, 900, 1200);
    expect(r.w / r.h).toBeCloseTo(900 / 1200);
    expect(r.w).toBeCloseTo(720);
    expect(r.y).toBeCloseTo((1600 - 960) / 2);
  });

  it('background sample rectangle never leaves the image for any unit offset', () => {
    const W = 1080;
    const H = 1440;
    const maxOffset = 0.03;
    const crop = cropRect(W, H, maxOffset);
    for (const ux of [-5, -1, -0.3, 0, 0.7, 1, 5, NaN]) {
      for (const uy of [-5, -1, 0, 1, 5]) {
        const o = unitToPixelOffset({ x: Number.isNaN(ux) ? 0 : ux, y: uy }, W, H, maxOffset);
        expect(crop.x + o.x).toBeGreaterThanOrEqual(0);
        expect(crop.y + o.y).toBeGreaterThanOrEqual(0);
        expect(crop.x + o.x + crop.w).toBeLessThanOrEqual(W + 1e-9);
        expect(crop.y + o.y + crop.h).toBeLessThanOrEqual(H + 1e-9);
      }
    }
  });
});
