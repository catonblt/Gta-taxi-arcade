import { clamp } from '../core/math';

/** The default ceiling on a perfect run. A Showboat Package raises it. */
export const MAX_MULTIPLIER = 3;
/** Seconds of clean, dull driving before the combo starts to bleed away. */
const GRACE = 2.4;
const DECAY_PER_SECOND = 0.45;
/** Impact speed that counts as a genuine crash rather than a scrape. */
const BREAK_IMPACT = 135;

/** Immediate cash for each flourish, before the multiplier is applied. */
const TIPS = { shave: 14, driftPerSecond: 9, dodge: 45 } as const;
/** What each flourish adds to the multiplier. */
const GAIN = { shave: 0.14, driftPerSecond: 0.12, dodge: 0.3 } as const;

export type StyleEvent = 'shave' | 'drift' | 'dodge' | 'break';

export interface StyleEvents {
  /** Cash tipped this step. */
  tip: number;
  /** The most notable thing that happened this step, for the HUD. */
  last: StyleEvent | null;
}

/**
 * The skill layer, and the reason a good driver out-earns a rich one. Upgrades buy access to
 * harder, better-paid work; style is what turns that work into money. Crashing costs you the
 * combo and nothing else — a combo breaker, never a failure state, exactly as in Crazy Taxi.
 */
export class Style {
  multiplier = 1;
  /** Best multiplier reached this shift, for the summary. */
  peak = 1;
  /** Raised by parts. */
  ceiling = MAX_MULTIPLIER;
  readonly events: StyleEvents = { tip: 0, last: null };

  private sinceEvent = 0;

  reset(): void {
    this.multiplier = 1;
    this.peak = 1;
    this.sinceEvent = 0;
  }

  step(dt: number): void {
    this.events.tip = 0;
    this.events.last = null;
    this.sinceEvent += dt;
    if (this.sinceEvent > GRACE && this.multiplier > 1) {
      this.multiplier = Math.max(1, this.multiplier - DECAY_PER_SECOND * dt);
    }
  }

  /** Threading traffic close enough to feel it. */
  closeShave(): void {
    this.award('shave', TIPS.shave, GAIN.shave);
  }

  /** Held while the car is genuinely sideways and moving. */
  drifting(dt: number): void {
    this.award('drift', TIPS.driftPerSecond * dt, GAIN.driftPerSecond * dt);
  }

  /** A pursuer committed to a ram and got nothing. */
  copDodge(): void {
    this.award('dodge', TIPS.dodge, GAIN.dodge);
  }

  /** Hitting something hard enough to matter. Returns true if a combo was actually lost. */
  impact(speed: number): boolean {
    if (speed < BREAK_IMPACT || this.multiplier <= 1.02) return false;
    this.multiplier = 1;
    this.sinceEvent = 0;
    this.events.last = 'break';
    return true;
  }

  private award(event: StyleEvent, tip: number, gain: number): void {
    this.events.tip += tip * this.multiplier;
    this.events.last = event;
    this.sinceEvent = 0;
    this.multiplier = clamp(this.multiplier + gain, 1, this.ceiling);
    if (this.multiplier > this.peak) this.peak = this.multiplier;
  }
}
