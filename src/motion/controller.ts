import { OneEuroFilter } from './oneEuro';
import { stepCriticalSpring, type SpringState } from './spring';
import { wrapAngle, type ScreenTilt } from './tilt';

export interface MotionParams {
  /** Tilt (radians) that drives the offset to ~76% of its limit (tanh(1)). */
  tiltRange: number;
  /** Time constant (s) for drifting the neutral pose toward the current pose. 0 disables. */
  recenterSeconds: number;
  /** One Euro filter settings for raw tilt. */
  minCutoff: number;
  beta: number;
  /** Spring stiffness (rad/s). Higher = snappier. */
  springOmega: number;
  /** Effect strength 0..1, scales the reachable offset. */
  strength: number;
  invertX: boolean;
  invertY: boolean;
}

export const DEFAULT_MOTION_PARAMS: MotionParams = {
  tiltRange: 12 * (Math.PI / 180),
  recenterSeconds: 4,
  minCutoff: 0.8,
  beta: 0.4,
  springOmega: 10,
  strength: 1,
  invertX: false,
  invertY: false,
};

/** A 2D offset, normalized so that each axis lies in [-1, 1]. */
export interface UnitOffset {
  x: number;
  y: number;
}

/**
 * Turns noisy tilt samples into a smooth, bounded background offset.
 * Pipeline: One Euro filter -> neutral-pose subtraction (slow recentre)
 * -> tanh soft limit -> critically damped spring -> hard clamp.
 * Output is unit-normalized; the renderer scales it by the scene's max offset.
 */
export class MotionController {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;
  private neutral: ScreenTilt | null = null;
  private lastSampleT: number | null = null;
  private target: UnitOffset = { x: 0, y: 0 };
  private sx: SpringState = { x: 0, v: 0 };
  private sy: SpringState = { x: 0, v: 0 };
  private lastStepT: number | null = null;
  private manual: UnitOffset | null = null;

  constructor(public params: MotionParams = { ...DEFAULT_MOTION_PARAMS }) {
    const f = { minCutoff: params.minCutoff, beta: params.beta, dCutoff: 1 };
    this.fx = new OneEuroFilter({ ...f });
    this.fy = new OneEuroFilter({ ...f });
  }

  setParams(p: Partial<MotionParams>): void {
    this.params = { ...this.params, ...p };
    for (const f of [this.fx, this.fy]) {
      f.params.minCutoff = this.params.minCutoff;
      f.params.beta = this.params.beta;
    }
  }

  /** Feed a tilt sample (screen axes, radians). tSec is a timestamp in seconds. */
  addSample(tilt: ScreenTilt, tSec: number): void {
    if (!Number.isFinite(tilt.x) || !Number.isFinite(tilt.y) || !Number.isFinite(tSec)) return;
    const x = this.fx.filter(tilt.x, tSec);
    const y = this.fy.filter(tilt.y, tSec);

    if (this.neutral === null || this.lastSampleT === null) {
      this.neutral = { x, y };
    } else {
      const dt = Math.min(Math.max(tSec - this.lastSampleT, 0), 1);
      const tau = this.params.recenterSeconds;
      if (tau > 0) {
        const k = 1 - Math.exp(-dt / tau);
        this.neutral.x += wrapAngle(x - this.neutral.x) * k;
        this.neutral.y += wrapAngle(y - this.neutral.y) * k;
      }
    }
    this.lastSampleT = tSec;

    const range = Math.max(this.params.tiltRange, 1e-3);
    const sxSign = this.params.invertX ? -1 : 1;
    const sySign = this.params.invertY ? -1 : 1;
    this.target = {
      x: sxSign * Math.tanh(wrapAngle(x - this.neutral.x) / range),
      y: sySign * Math.tanh(wrapAngle(y - this.neutral.y) / range),
    };
  }

  /** Direct control (finger drag). Values are clamped to [-1, 1]. Pass null to release. */
  setManual(o: UnitOffset | null): void {
    this.manual = o ? { x: clampUnit(o.x), y: clampUnit(o.y) } : null;
  }

  get hasManual(): boolean {
    return this.manual !== null;
  }

  /** Forget the neutral pose and filters; the current pose becomes centre. */
  recenter(): void {
    this.neutral = null;
    this.lastSampleT = null;
    this.fx.reset();
    this.fy.reset();
    this.target = { x: 0, y: 0 };
  }

  /** Clear the sensor target so the picture eases back to centre. */
  clearTarget(): void {
    this.target = { x: 0, y: 0 };
  }

  /** Advance the spring to time tSec and return the current offset. */
  step(tSec: number): UnitOffset {
    const dt = this.lastStepT === null ? 0 : Math.min(Math.max(tSec - this.lastStepT, 0), 0.1);
    this.lastStepT = tSec;
    const goal = this.manual ?? this.target;
    const s = this.params.strength;
    this.sx = stepCriticalSpring(this.sx, goal.x * s, this.params.springOmega, dt);
    this.sy = stepCriticalSpring(this.sy, goal.y * s, this.params.springOmega, dt);
    // Hard clamp: the spring never overshoots, but this guarantees the bound.
    return { x: clampUnit(this.sx.x), y: clampUnit(this.sy.x) };
  }

  /** True when the displayed offset has reached its goal and stopped. */
  isSettled(eps = 1e-4): boolean {
    const goal = this.manual ?? this.target;
    const s = this.params.strength;
    return (
      Math.abs(this.sx.x - goal.x * s) < eps &&
      Math.abs(this.sy.x - goal.y * s) < eps &&
      Math.abs(this.sx.v) < eps &&
      Math.abs(this.sy.v) < eps
    );
  }
}

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
