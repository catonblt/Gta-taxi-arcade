import type { Job } from './jobs';

/** The only thing a shift needs from the garage: somewhere to put the night's takings. */
export interface Bank {
  bank(amount: number): void;
}

export type ShiftState = 'briefing' | 'running' | 'over';

/** A shift is short on purpose: a phone session, and the boundary where progression is felt. */
export const START_SECONDS = 90;
/** The most one delivery can put back on the clock, so a long fare cannot fund a whole night. */
const MAX_TIME_BONUS = 45;
/** Taken off the top when the police impound a hot car. */
const IMPOUND_FEE = 400;

export interface ShiftSummary {
  reason: string;
  detail: string;
  earned: number;
  tips: number;
  peakMultiplier: number;
  banked: number;
  lost: number;
  jobs: number;
  blown: number;
  seconds: number;
}

/**
 * The global clock is the pressure, and finishing work is what buys more of it — Crazy Taxi's
 * dual timer, unchanged, because competence buying playtime is the cleanest loop in the genre.
 * The unbanked pile is the tension: it is only yours once the shift ends on your terms.
 */
export class Shift {
  state: ShiftState = 'briefing';
  timeLeft = START_SECONDS;
  /** Earned this shift and still at risk. */
  pending = 0;
  /** Of the pending pile, how much came from driving rather than delivering. */
  tips = 0;
  elapsed = 0;
  summary: ShiftSummary | null = null;

  constructor(private readonly career: Bank) {}

  start(): void {
    this.state = 'running';
    this.timeLeft = START_SECONDS;
    this.pending = 0;
    this.tips = 0;
    this.elapsed = 0;
    this.summary = null;
  }

  step(dt: number): void {
    if (this.state !== 'running') return;
    this.elapsed += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
  }

  /** True once the clock is spent. The caller ends the shift, so it can supply the job counts. */
  get expired(): boolean {
    return this.state === 'running' && this.timeLeft <= 0;
  }

  /** Style money, paid the moment it is earned so the flourish and the reward are one event. */
  tip(amount: number): void {
    this.pending += amount;
    this.tips += amount;
  }

  /** A completed delivery pays cash and hands back whatever was left on the fare's own clock. */
  bookJob(job: Job, amount: number): void {
    this.pending += amount;
    this.timeLeft += Math.min(job.fareLeft, MAX_TIME_BONUS);
  }

  /** Best multiplier reached, handed in by the style system when the shift closes. */
  peakMultiplier = 1;

  busted(hot: boolean, jobs: number, blown: number): void {
    const fee = hot ? IMPOUND_FEE : 0;
    this.end('BUSTED', 'They boxed you in. The night’s takings went with the car.', this.pending + fee, jobs, blown);
  }

  clockOut(jobs: number, blown: number): void {
    if (this.state !== 'running') return;
    this.end('CLOCKED OUT', 'The night ran out before you did.', 0, jobs, blown);
  }

  private end(reason: string, detail: string, lost: number, jobs = 0, blown = 0): void {
    if (this.state === 'over') return;
    this.state = 'over';
    // Tips accrue in fractions of a dollar so that a half-second slide still counts; nobody
    // should ever be shown $113.40000000000002.
    const banked = Math.round(Math.max(0, this.pending - lost));
    this.career.bank(banked);
    this.summary = {
      reason,
      detail,
      earned: Math.round(this.pending),
      tips: Math.round(this.tips),
      peakMultiplier: this.peakMultiplier,
      banked,
      lost: Math.round(Math.min(lost, this.pending + IMPOUND_FEE)),
      jobs,
      blown,
      seconds: this.elapsed,
    };
    this.pending = 0;
    this.tips = 0;
  }
}
