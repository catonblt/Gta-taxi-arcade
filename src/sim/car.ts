import type { InputState } from '../core/input';
import { clamp, damp } from '../core/math';
import type { VehicleStats } from '../data/vehicles';
import { resolveMapCollision } from './collision';
import type { TileMap } from './tilemap';

/** Speed below which the car is treated as stationary for launch taps and stop checks. */
const CRAWL = 30;
/**
 * How long after coming to rest a brake press still means "reverse" rather than "stop".
 *
 * Without this the car had to be under CRAWL/5 at the exact instant of the press, and with an
 * auto-throttle it clears that two frames after the brake is released — roughly 30ms. Reverse
 * therefore only engaged if the double tap happened to land inside that window, which is what
 * made it feel like it worked at random. Half a second is still under a car length of travel,
 * so it reads as shuffling in place rather than driving off.
 */
const REVERSE_GRACE = 0.55;
/** Slip angle (radians) past which the car is sliding whether the player asked for it or not. */
const AUTO_DRIFT_SLIP = 0.42; // ~24 degrees
/** Slip angle that counts as a real slide for charging the drift boost. */
const CHARGE_SLIP = 0.3;

export interface CarEvents {
  /** Impact speed into a wall this step, 0 if none. Drives damage and combo breaks. */
  impact: number;
  /** Set on the step a drift-cancel boost fires. */
  boosted: boolean;
}

export class Car {
  x = 0;
  y = 0;
  angle = 0;
  vx = 0;
  vy = 0;

  /** Previous-step transform, for render interpolation. */
  prevX = 0;
  prevY = 0;
  prevAngle = 0;

  damage = 0;
  drifting = false;
  /** Lateral speed in world units/s. */
  slip = 0;
  /** Angle between where the car points and where it is actually going, in radians. */
  slipAngle = 0;
  driftCharge = 0;

  readonly events: CarEvents = { impact: 0, boosted: false };

  /** Scaled by fitted parts. 1 is the bare car. */
  driftBoostScale = 1;
  /** Set by a spike strip: the car still runs, but it will not hold a line or a top end. */
  tiresShredded = false;

  private driftHeldFor = 0;
  private brakeWasDown = false;
  /** Seconds since the car was last essentially stationary. */
  private sinceRest = 0;
  /** Reverse is only available when the brake is pressed again from a standstill. */
  private reverseArmed = false;

  constructor(public stats: VehicleStats) {}

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Fresh rubber. Called at a respray and at the start of every shift. */
  repairTires(): void {
    this.tiresShredded = false;
  }

  placeAt(x: number, y: number, angle: number): void {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.angle = this.prevAngle = angle;
    this.vx = this.vy = 0;
  }

  step(input: InputState, map: TileMap, dt: number): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevAngle = this.angle;
    this.events.impact = 0;
    this.events.boosted = false;

    const s = this.stats;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);

    // Work in the car's frame: forward speed and lateral (sideways) speed are separate problems.
    let vLong = this.vx * cos + this.vy * sin;
    let vLat = -this.vx * sin + this.vy * cos;

    // Measured on the speed the car carried INTO this step, before the throttle touches it, so
    // that a car sitting still is recorded as still even though it is about to be driven away.
    this.sinceRest = Math.abs(vLong) < CRAWL * 0.2 ? 0 : this.sinceRest + dt;

    // --- Throttle and brake -------------------------------------------------------------
    // Drag is expressed as a fraction of the car's own acceleration so that thrust and drag
    // cancel exactly at topSpeed: the number in the data file IS the speed you reach, which
    // keeps the upgrade screen honest.
    // Shredded tyres cost top end and, far more painfully, grip.
    const topSpeed = s.topSpeed * (this.tiresShredded ? 0.76 : 1);
    const ratio = vLong / topSpeed;
    const drag = s.accel * ratio * Math.abs(ratio);
    if (input.throttle > 0) {
      vLong += (s.accel * input.throttle - drag) * dt;
    } else {
      // Coasting: quadratic drag plus rolling resistance, so lifting off actually slows you.
      vLong -= (drag + vLong * 0.5) * dt;
    }
    // The brake means stop, and holding it means stay stopped: with an auto-throttle there is
    // otherwise no way to park at all, which quietly made hideouts impossible to use. Reverse
    // is a second, deliberate press once you are already stationary.
    const braking = input.brake > 0;
    if (braking && !this.brakeWasDown) this.reverseArmed = this.sinceRest < REVERSE_GRACE;
    this.brakeWasDown = braking;

    if (braking) {
      if (vLong > CRAWL * 0.2) {
        vLong = Math.max(0, vLong - s.brake * dt);
      } else if (this.reverseArmed) {
        vLong = Math.max(-topSpeed * 0.35, vLong - s.accel * 0.7 * dt);
      } else {
        vLong = 0;
        vLat = 0;
      }
    }

    // --- Drift state --------------------------------------------------------------------
    // Slip ANGLE, not lateral speed, decides whether the car is sliding: a fast car with a
    // little lateral drift is still gripping, a slow car pointing 40 degrees off its own
    // velocity is not. Using speed here made every corner a drift and the button meaningless.
    const slipAngle = Math.abs(Math.atan2(vLat, Math.max(Math.abs(vLong), 1)));
    const fast = Math.abs(vLong) > CRAWL * 3;
    this.drifting = (input.drift && fast) || slipAngle > AUTO_DRIFT_SLIP;
    this.driftHeldFor = input.drift ? this.driftHeldFor + dt : 0;

    // --- Grip ---------------------------------------------------------------------------
    // Bleeding lateral velocity is the whole model: bleed it fast and the car is on rails,
    // bleed it slowly and the car slides while the nose keeps turning. That is the drift.
    const surface = map.gripAtWorld(this.x, this.y);
    const gripRate = (this.drifting ? s.driftGrip : s.grip) * surface * (this.tiresShredded ? 0.55 : 1);
    vLat *= damp(gripRate, dt);

    // Sliding scrubs forward speed, so drifting everywhere is not free.
    vLong -= Math.abs(vLat) * 0.55 * dt;

    this.slip = Math.abs(vLat);
    this.slipAngle = slipAngle;

    // --- Drift charge and exit boost ----------------------------------------------------
    if (this.drifting && slipAngle > CHARGE_SLIP) {
      this.driftCharge = Math.min(this.driftCharge + dt, 1.8);
    } else if (!this.drifting) {
      this.driftCharge = Math.max(0, this.driftCharge - dt * 0.8);
    }

    if (input.driftReleased) {
      if (this.driftCharge > 0.35) {
        // Drift-cancel: release at the apex and the slide pays you back in exit speed.
        vLong += (55 + this.driftCharge * 60) * this.driftBoostScale;
        this.events.boosted = true;
      } else if (Math.abs(vLong) < CRAWL && this.driftHeldFor < 0.25) {
        // Launch tap: a flick of the drift pad from a standstill. Never explained, always there.
        vLong += 140 * this.driftBoostScale;
        this.events.boosted = true;
      }
      this.driftCharge = 0;
    }

    // --- Integrate ----------------------------------------------------------------------
    // Recompose in the frame we decomposed from. Turning the wheel must NOT rotate the car's
    // momentum with it: the heading moves, the velocity stays where it was, and the gap between
    // them is the slide. Grip closes that gap over the following steps.
    this.vx = vLong * cos - vLat * sin;
    this.vy = vLong * sin + vLat * cos;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // --- Steering -----------------------------------------------------------------------
    // Authority ramps in off the line, then falls away at speed so the car stays stable flat out.
    const speedRamp = clamp(Math.abs(vLong) / 90, 0, 1);
    const highSpeedFalloff = 1 - 0.35 * clamp(Math.abs(vLong) / topSpeed, 0, 1);
    const driftAuthority = this.drifting ? 1.55 : 1;
    const dir = vLong < -1 ? -1 : 1;
    this.angle += s.steerRate * input.steer * speedRamp * highSpeedFalloff * driftAuthority * dir * dt;

    const impact = resolveMapCollision(this, map);
    if (impact > 0) {
      this.events.impact = impact;
      this.damage += Math.max(0, impact - 60) * 0.05;
      if (impact > 90) this.driftCharge = 0;
    }
  }
}
