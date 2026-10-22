/** Tilt angles in radians, in device axes. */
export interface DeviceTilt {
  /** Rotation about the device's long (y) axis: left/right tilt. */
  roll: number;
  /** Rotation about the device's short (x) axis: forward/back tilt. */
  pitch: number;
}

/** Tilt in screen axes: x moves the picture horizontally, y vertically. */
export interface ScreenTilt {
  x: number;
  y: number;
}

const DEG = Math.PI / 180;

/**
 * Tilt from the gravity vector (DeviceMotionEvent.accelerationIncludingGravity).
 * Works on accelerometer-only phones that have no gyroscope.
 * pitch uses atan2 in the y-z plane so it is well defined both upright and flat.
 */
export function tiltFromGravity(gx: number, gy: number, gz: number): DeviceTilt | null {
  const mag = Math.hypot(gx, gy, gz);
  // Reject readings that are clearly not dominated by gravity (free fall, bad data).
  if (!(mag > 4 && mag < 20)) return null;
  const yz = Math.hypot(gy, gz);
  return {
    pitch: Math.atan2(gy, gz),
    roll: Math.atan2(gx, yz),
  };
}

/** Tilt from DeviceOrientationEvent beta/gamma (degrees). */
export function tiltFromOrientation(beta: number, gamma: number): DeviceTilt {
  return { pitch: beta * DEG, roll: gamma * DEG };
}

/** Wrap an angle difference to (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  else if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/**
 * Rotate device-axis tilt into screen axes for the current screen orientation
 * angle (screen.orientation.angle: 0, 90, 180, 270).
 */
export function toScreenTilt(t: DeviceTilt, screenAngleDeg: number): ScreenTilt {
  const a = (((Math.round(screenAngleDeg / 90) * 90) % 360) + 360) % 360;
  switch (a) {
    case 90:
      return { x: t.pitch, y: -t.roll };
    case 180:
      return { x: -t.roll, y: -t.pitch };
    case 270:
      return { x: -t.pitch, y: t.roll };
    default:
      return { x: t.roll, y: t.pitch };
  }
}
