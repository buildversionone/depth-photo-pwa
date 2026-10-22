/**
 * Critically damped spring, integrated exactly (stable for any dt).
 * Moves toward the target with no overshoot and no bounce.
 */
export interface SpringState {
  x: number;
  v: number;
}

export function stepCriticalSpring(s: SpringState, target: number, omega: number, dt: number): SpringState {
  if (!(dt > 0)) return s;
  const d = s.x - target;
  const e = Math.exp(-omega * dt);
  const k = s.v + omega * d;
  return {
    x: target + (d + k * dt) * e,
    v: (s.v - omega * k * dt) * e,
  };
}
