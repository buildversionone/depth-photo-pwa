import { tiltFromGravity, tiltFromOrientation, toScreenTilt, type DeviceTilt, type ScreenTilt } from './tilt';

export type SensorSource = 'orientation' | 'gravity' | 'none';

export interface SensorSample {
  tilt: ScreenTilt;
  tSec: number;
  source: Exclude<SensorSource, 'none'>;
}

type PermissionFn = () => Promise<'granted' | 'denied'>;

function permissionFns(): PermissionFn[] {
  const fns: PermissionFn[] = [];
  const doe = (globalThis as { DeviceOrientationEvent?: { requestPermission?: PermissionFn } }).DeviceOrientationEvent;
  const dme = (globalThis as { DeviceMotionEvent?: { requestPermission?: PermissionFn } }).DeviceMotionEvent;
  if (typeof doe?.requestPermission === 'function') fns.push(doe.requestPermission.bind(doe));
  if (typeof dme?.requestPermission === 'function') fns.push(dme.requestPermission.bind(dme));
  return fns;
}

/** True on browsers (iOS Safari) that need a tap before sensor events are delivered. */
export function sensorsNeedPermission(): boolean {
  return permissionFns().length > 0;
}

/** Must be called from a user gesture (tap). Resolves true if any sensor was granted. */
export async function requestSensorPermission(): Promise<boolean> {
  const fns = permissionFns();
  if (fns.length === 0) return true;
  const results = await Promise.allSettled(fns.map((f) => f()));
  return results.some((r) => r.status === 'fulfilled' && r.value === 'granted');
}

export function sensorApisPresent(): boolean {
  return 'DeviceOrientationEvent' in globalThis || 'DeviceMotionEvent' in globalThis;
}

function screenAngle(): number {
  const so = globalThis.screen?.orientation;
  if (so && typeof so.angle === 'number') return so.angle;
  const legacy = (globalThis as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

/**
 * Listens to both orientation and motion events and reports tilt from the best
 * source that is actually delivering data. On phones without a gyroscope,
 * Chrome may never deliver usable deviceorientation values, so the gravity
 * vector from devicemotion is used instead.
 */
export class SensorInput {
  source: SensorSource = 'none';
  /** Events per second from the active source, updated about once a second. */
  rateHz = 0;
  lastRaw: DeviceTilt | null = null;

  private lastOrientationT = -Infinity;
  private countWindowStart = 0;
  private count = 0;
  private running = false;

  constructor(private onSample: (s: SensorSample) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener('deviceorientation', this.handleOrientation);
    window.addEventListener('devicemotion', this.handleMotion);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.removeEventListener('deviceorientation', this.handleOrientation);
    window.removeEventListener('devicemotion', this.handleMotion);
    this.source = 'none';
    this.rateHz = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private tick(source: Exclude<SensorSource, 'none'>, tSec: number): void {
    if (this.source !== source) {
      this.source = source;
      this.count = 0;
      this.countWindowStart = tSec;
    }
    this.count++;
    const span = tSec - this.countWindowStart;
    if (span >= 1) {
      this.rateHz = this.count / span;
      this.count = 0;
      this.countWindowStart = tSec;
    }
  }

  private handleOrientation = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null || !Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) return;
    const tSec = e.timeStamp / 1000;
    this.lastOrientationT = tSec;
    const raw = tiltFromOrientation(e.beta, e.gamma);
    this.lastRaw = raw;
    this.tick('orientation', tSec);
    this.onSample({ tilt: toScreenTilt(raw, screenAngle()), tSec, source: 'orientation' });
  };

  private handleMotion = (e: DeviceMotionEvent): void => {
    const tSec = e.timeStamp / 1000;
    // Prefer orientation while it is live; fall back to gravity if it goes quiet.
    if (tSec - this.lastOrientationT < 0.5) return;
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null || g.z === null) return;
    const raw = tiltFromGravity(g.x, g.y, g.z);
    if (!raw) return;
    this.lastRaw = raw;
    this.tick('gravity', tSec);
    this.onSample({ tilt: toScreenTilt(raw, screenAngle()), tSec, source: 'gravity' });
  };
}
