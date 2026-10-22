import { describe, expect, it } from 'vitest';
import { MotionController, DEFAULT_MOTION_PARAMS } from '../../src/motion/controller';
import { OneEuroFilter } from '../../src/motion/oneEuro';
import { stepCriticalSpring } from '../../src/motion/spring';
import { tiltFromGravity, tiltFromOrientation, toScreenTilt, wrapAngle } from '../../src/motion/tilt';

const DEG = Math.PI / 180;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('OneEuroFilter', () => {
  it('passes the first sample through and converges on a constant', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
    expect(f.filter(5, 0)).toBe(5);
    let y = 0;
    for (let i = 1; i <= 600; i++) y = f.filter(10, i / 60);
    expect(y).toBeCloseTo(10, 3);
  });

  it('reduces jitter on a noisy constant signal', () => {
    const f = new OneEuroFilter({ minCutoff: 0.8, beta: 0.4, dCutoff: 1 });
    const rand = seeded(1);
    let rawVar = 0;
    let outVar = 0;
    for (let i = 0; i < 1200; i++) {
      const noise = (rand() - 0.5) * 0.02;
      const y = f.filter(noise, i / 60);
      if (i > 120) {
        rawVar += noise * noise;
        outVar += y * y;
      }
    }
    expect(outVar).toBeLessThan(rawVar * 0.2);
  });

  it('ignores non-increasing timestamps', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
    f.filter(1, 1);
    expect(f.filter(100, 1)).toBe(1);
    expect(f.filter(100, 0.5)).toBe(1);
  });
});

describe('stepCriticalSpring', () => {
  it('approaches the target without overshoot', () => {
    let s = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 300; i++) {
      s = stepCriticalSpring(s, 1, 10, 1 / 60);
      max = Math.max(max, s.x);
    }
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
    expect(s.x).toBeCloseTo(1, 4);
  });

  it('is stable for a very large time step', () => {
    const s = stepCriticalSpring({ x: 0, v: 0 }, 1, 10, 100);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(s.x).toBeCloseTo(1, 6);
  });
});

describe('tilt', () => {
  it('reads pitch from the gravity vector upright and flat', () => {
    const upright = tiltFromGravity(0, 9.81, 0)!;
    const flat = tiltFromGravity(0, 0, 9.81)!;
    expect(upright.pitch).toBeCloseTo(Math.PI / 2, 6);
    expect(flat.pitch).toBeCloseTo(0, 6);
    expect(upright.roll).toBeCloseTo(0, 6);
  });

  it('reads roll when the phone tips sideways', () => {
    const g = 9.81;
    const t = tiltFromGravity(g * Math.sin(10 * DEG), g * Math.cos(10 * DEG), 0)!;
    expect(t.roll).toBeCloseTo(10 * DEG, 6);
  });

  it('rejects readings that are not gravity-dominated', () => {
    expect(tiltFromGravity(0, 0, 0)).toBeNull();
    expect(tiltFromGravity(30, 30, 30)).toBeNull();
    expect(tiltFromGravity(NaN, 1, 1)).toBeNull();
  });

  it('converts orientation degrees to radians', () => {
    const t = tiltFromOrientation(45, -30);
    expect(t.pitch).toBeCloseTo(45 * DEG);
    expect(t.roll).toBeCloseTo(-30 * DEG);
  });

  it('remaps axes for each screen rotation', () => {
    const t = { roll: 1, pitch: 2 };
    expect(toScreenTilt(t, 0)).toEqual({ x: 1, y: 2 });
    expect(toScreenTilt(t, 90)).toEqual({ x: 2, y: -1 });
    expect(toScreenTilt(t, 180)).toEqual({ x: -1, y: -2 });
    expect(toScreenTilt(t, 270)).toEqual({ x: -2, y: 1 });
    expect(toScreenTilt(t, -90)).toEqual({ x: -2, y: 1 });
  });

  it('wraps angles into (-PI, PI]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });
});

describe('MotionController', () => {
  it('starts centred: the first pose becomes neutral', () => {
    const c = new MotionController();
    c.addSample({ x: 0.7, y: -0.3 }, 0);
    for (let i = 0; i < 120; i++) c.step(i / 60);
    const o = c.step(2);
    expect(Math.abs(o.x)).toBeLessThan(1e-6);
    expect(Math.abs(o.y)).toBeLessThan(1e-6);
  });

  it('moves toward a tilt and stays within [-1, 1] even for extreme tilt', () => {
    const c = new MotionController({ ...DEFAULT_MOTION_PARAMS, recenterSeconds: 0 });
    c.addSample({ x: 0, y: 0 }, 0);
    let o = { x: 0, y: 0 };
    for (let i = 1; i < 600; i++) {
      const t = i / 60;
      c.addSample({ x: 80 * DEG, y: -80 * DEG }, t);
      o = c.step(t);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(1);
    }
    expect(o.x).toBeGreaterThan(0.95);
    expect(o.y).toBeLessThan(-0.95);
  });

  it('responds to an ordinary 5 degree hand tilt with a visible share of the range', () => {
    const c = new MotionController({ ...DEFAULT_MOTION_PARAMS, recenterSeconds: 0 });
    c.addSample({ x: 0, y: 0 }, 0);
    let o = { x: 0, y: 0 };
    for (let i = 1; i < 240; i++) {
      c.addSample({ x: 5 * DEG, y: 0 }, i / 60);
      o = c.step(i / 60);
    }
    expect(o.x).toBeGreaterThan(0.3);
    expect(o.x).toBeLessThan(0.6);
  });

  it('drifts back to centre when a tilt is held (re-centring)', () => {
    const c = new MotionController({ ...DEFAULT_MOTION_PARAMS, recenterSeconds: 2 });
    c.addSample({ x: 0, y: 0 }, 0);
    let o = { x: 0, y: 0 };
    for (let i = 1; i < 60 * 20; i++) {
      c.addSample({ x: 10 * DEG, y: 0 }, i / 60);
      o = c.step(i / 60);
    }
    expect(Math.abs(o.x)).toBeLessThan(0.05);
  });

  it('respects invert flags and strength', () => {
    const c = new MotionController({ ...DEFAULT_MOTION_PARAMS, recenterSeconds: 0, invertX: true, strength: 0.5 });
    c.addSample({ x: 0, y: 0 }, 0);
    let o = { x: 0, y: 0 };
    for (let i = 1; i < 600; i++) {
      c.addSample({ x: 80 * DEG, y: 0 }, i / 60);
      o = c.step(i / 60);
    }
    expect(o.x).toBeLessThan(-0.45);
    expect(o.x).toBeGreaterThanOrEqual(-0.5);
  });

  it('ignores NaN samples and never outputs NaN', () => {
    const c = new MotionController();
    c.addSample({ x: 0, y: 0 }, 0);
    c.addSample({ x: NaN, y: Infinity }, 0.1);
    const o = c.step(0.2);
    expect(Number.isFinite(o.x) && Number.isFinite(o.y)).toBe(true);
  });

  it('manual offset overrides sensors and is clamped', () => {
    const c = new MotionController();
    c.setManual({ x: 3, y: -3 });
    let o = { x: 0, y: 0 };
    for (let i = 0; i < 600; i++) o = c.step(i / 60);
    expect(o.x).toBeCloseTo(1, 3);
    expect(o.y).toBeCloseTo(-1, 3);
  });

  it('has no sudden jumps: per-frame change is bounded for a step input', () => {
    const c = new MotionController({ ...DEFAULT_MOTION_PARAMS, recenterSeconds: 0 });
    c.addSample({ x: 0, y: 0 }, 0);
    let prev = c.step(0);
    let maxDelta = 0;
    for (let i = 1; i < 300; i++) {
      c.addSample({ x: 30 * DEG, y: 0 }, i / 60);
      const o = c.step(i / 60);
      maxDelta = Math.max(maxDelta, Math.abs(o.x - prev.x));
      prev = o;
    }
    // Less than 10% of the full range in any single 60 Hz frame.
    expect(maxDelta).toBeLessThan(0.1);
  });
});
