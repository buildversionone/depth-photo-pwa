/**
 * One Euro filter (Casiez, Roussel, Vogel; CHI 2012).
 * Low cutoff while the signal is steady (removes jitter), higher cutoff as it
 * moves faster (keeps lag low).
 */
export interface OneEuroParams {
  /** Minimum cutoff frequency in Hz. Lower = smoother when still. */
  minCutoff: number;
  /** Speed coefficient. Higher = less lag during fast motion. */
  beta: number;
  /** Cutoff for the derivative estimate, in Hz. */
  dCutoff: number;
}

function smoothingAlpha(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private x: number | undefined;
  private dx = 0;
  private lastT: number | undefined;

  constructor(public params: OneEuroParams) {}

  reset(): void {
    this.x = undefined;
    this.lastT = undefined;
    this.dx = 0;
  }

  /** @param tSec timestamp in seconds */
  filter(value: number, tSec: number): number {
    if (this.x === undefined || this.lastT === undefined) {
      this.x = value;
      this.lastT = tSec;
      return value;
    }
    const dt = tSec - this.lastT;
    if (!(dt > 0)) return this.x;
    this.lastT = tSec;

    const rawDx = (value - this.x) / dt;
    this.dx += smoothingAlpha(dt, this.params.dCutoff) * (rawDx - this.dx);
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(this.dx);
    this.x += smoothingAlpha(dt, cutoff) * (value - this.x);
    return this.x;
  }
}
