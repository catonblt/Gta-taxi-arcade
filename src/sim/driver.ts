import type { InputState } from '../core/input';
import { angleDelta, clamp } from '../core/math';
import type { Car } from './car';

/**
 * Turns "get to that point" into the same InputState a thumb would produce. AI cars therefore
 * drive the identical physics the player does — they can understeer into a wall, they can
 * power-slide a corner, and a ram is a real collision rather than a scripted nudge.
 */
export function driveToward(
  car: Car,
  targetX: number,
  targetY: number,
  out: InputState,
  aggression = 1,
): InputState {
  const desired = Math.atan2(targetY - car.y, targetX - car.x);
  const error = angleDelta(car.angle, desired);
  const absError = Math.abs(error);

  out.steer = clamp(error * 2.4, -1, 1);
  out.driftReleased = out.drift && absError < 0.35;

  // Scrub speed for a corner that is too tight to take flat, and slide the really tight ones.
  const tooFast = car.speed > car.stats.topSpeed * 0.55;
  out.brake = absError > 1.15 && tooFast ? 1 : 0;
  out.throttle = out.brake > 0 ? 0 : clamp(aggression, 0, 1);
  out.drift = absError > 0.8 && car.speed > car.stats.topSpeed * 0.65;

  return out;
}
