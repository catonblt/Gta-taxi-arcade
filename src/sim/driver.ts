import type { InputState } from '../core/input';
import { angleDelta, clamp, lerpAngle } from '../core/math';
import type { Car } from './car';

/**
 * Slip angle past which an AI driver stops chasing its target and starts saving the car. Set
 * near the tyres' grip peak: beyond it, steering harder into the corner only digs deeper.
 */
const STABILITY_SLIP = 0.24;

/**
 * Turns "get to that point" into the same InputState a thumb would produce. AI cars therefore
 * drive the identical physics the player does — they can understeer into a wall, they can
 * power-slide a corner, and a ram is a real collision rather than a scripted nudge.
 *
 * They do get one thing the player does not: a stability assist. A player feels a slide starting
 * and lifts or catches it; an AI holding full lock into a grip curve that has already passed its
 * peak simply spins, and a chase full of spun-out cruisers is no chase at all. Giving the police
 * an electronic aid the player has to manage by hand is a fair trade, and a common one in racing
 * games.
 */
export function driveToward(
  car: Car,
  targetX: number,
  targetY: number,
  out: InputState,
  aggression = 1,
): InputState {
  let desired = Math.atan2(targetY - car.y, targetX - car.x);

  // Once the car is genuinely sliding, aim where it is actually going rather than where it was
  // asked to go. That blend IS countersteer, and it unwinds the slide instead of feeding it.
  const sliding = car.slipAngle > STABILITY_SLIP && car.speed > 40;
  if (sliding) {
    const travelling = Math.atan2(car.vy, car.vx);
    const blend = clamp((car.slipAngle - STABILITY_SLIP) / 0.5, 0, 0.8);
    desired = lerpAngle(desired, travelling, blend);
  }

  const error = angleDelta(car.angle, desired);
  const absError = Math.abs(error);

  out.steer = clamp(error * 2.4, -1, 1);
  out.driftReleased = out.drift && absError < 0.35;

  // Scrub speed for a corner that is too tight to take flat, and slide the really tight ones —
  // but never while already sideways. Braking now spends grip that the slide needs back, and
  // asking for more drift mid-slide is how a cruiser ends up facing the wrong way.
  const tooFast = car.speed > car.stats.topSpeed * 0.55;
  out.brake = absError > 1.15 && tooFast && !sliding ? 1 : 0;
  out.throttle = out.brake > 0 ? 0 : clamp(aggression, 0, 1);
  out.drift = absError > 0.8 && car.speed > car.stats.topSpeed * 0.65 && !sliding;

  return out;
}
