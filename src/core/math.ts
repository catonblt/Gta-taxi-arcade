export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Angle interpolation that takes the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

/** Frame-rate independent exponential approach: fraction remaining after dt at `rate` per second. */
export function damp(rate: number, dt: number): number {
  return Math.exp(-rate * dt);
}

export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function len(x: number, y: number): number {
  return Math.hypot(x, y);
}
