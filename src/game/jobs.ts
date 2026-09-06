import type { Rng } from '../core/rng';
import type { Heat } from '../sim/heat';
import { TILE, Tile, type TileMap } from '../sim/tilemap';
import type { Traffic, TrafficCar } from '../sim/traffic';

export type JobKind = 'courier' | 'getaway' | 'ghost' | 'intercept' | 'frenzy';
export type JobState = 'offered' | 'pickup' | 'active' | 'done' | 'failed';

/**
 * Tiers fuse the two decisions the game is built on. In Crazy Taxi a fare's colour told you how
 * far and how much; here it also tells you how hot, so choosing a job IS choosing how much
 * police attention you are taking on. There is only ever one question on the map: how greedy.
 */
export interface Tier {
  name: string;
  color: string;
  payout: number;
  fareSeconds: number;
  /** Heat applied the moment you accept. */
  heatOnAccept: number;
}

export const TIERS: readonly Tier[] = [
  { name: 'Local', color: '#5adca0', payout: 260, fareSeconds: 46, heatOnAccept: 0 },
  { name: 'Crosstown', color: '#f0a63c', payout: 640, fareSeconds: 62, heatOnAccept: 1 },
  { name: 'Hot', color: '#d83a44', payout: 1450, fareSeconds: 78, heatOnAccept: 2 },
];

export interface JobDefinition {
  kind: JobKind;
  label: string;
  /** Shown on the card when the job is offered — the whole brief, in one line. */
  brief: string;
  /** Multiplies the tier payout. Riskier shapes of work pay more. */
  payoutScale: number;
}

export const JOB_KINDS: Record<JobKind, JobDefinition> = {
  courier: { kind: 'courier', label: 'Courier', brief: 'Carry it across town. Hits damage the load.', payoutScale: 1 },
  getaway: { kind: 'getaway', label: 'Getaway', brief: 'They are already inside. Heat starts high.', payoutScale: 1.55 },
  ghost: { kind: 'ghost', label: 'Ghost run', brief: 'Stay off their radar. Double, if nobody calls it in.', payoutScale: 2 },
  intercept: { kind: 'intercept', label: 'Intercept', brief: 'Stop that car. Whatever it takes.', payoutScale: 1.35 },
  frenzy: { kind: 'frenzy', label: 'Frenzy', brief: 'Wreck four cars, fast. Clears a level off you.', payoutScale: 1.2 },
};

export interface Job {
  id: number;
  kind: JobKind;
  tier: Tier;
  state: JobState;
  payout: number;
  /** Seconds left on this fare. Runs out and the job is blown. */
  fareLeft: number;
  fareTotal: number;
  pickupX: number;
  pickupY: number;
  dropX: number;
  dropY: number;
  /** Courier only: 0..1 of the load still intact. */
  cargo: number;
  /** Intercept only. */
  target: TrafficCar | null;
  /** Frenzy only. */
  wrecksNeeded: number;
  wrecksDone: number;
  /** Why the job ended, for the shift summary. */
  failReason: string;
}

const OFFER_COUNT = 3;
const PICKUP_RADIUS = 46;
const OFFER_MIN = 5 * TILE;
const OFFER_MAX = 15 * TILE;
const FRENZY_SECONDS = 26;

export interface JobEvents {
  accepted: Job | null;
  completed: Job | null;
  failed: Job | null;
  /** Cash earned this step, before any style multiplier. */
  paid: number;
}

/**
 * Generates the work and tracks the one job in hand. Jobs are accepted by driving into them —
 * no menu, no pause. The map is the interface.
 */
export class Jobs {
  readonly offers: Job[] = [];
  active: Job | null = null;
  readonly events: JobEvents = { accepted: null, completed: null, failed: null, paid: 0 };

  completed = 0;
  blown = 0;

  private nextId = 1;

  constructor(
    private readonly map: TileMap,
    private readonly rng: Rng,
    private readonly traffic: Traffic,
  ) {}

  reset(): void {
    this.offers.length = 0;
    this.active = null;
    this.completed = 0;
    this.blown = 0;
  }

  /** A drivable road tile at roughly `distance` from a point, or null if the city says no. */
  private roadNear(x: number, y: number, min: number, max: number): { x: number; y: number } | null {
    for (let attempt = 0; attempt < 30; attempt++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(min, max);
      const wx = x + Math.cos(a) * r;
      const wy = y + Math.sin(a) * r;
      const tile = this.map.atWorld(wx, wy);
      if (tile === Tile.Road || tile === Tile.Alley || tile === Tile.Lot) return { x: wx, y: wy };
    }
    return null;
  }

  /** Job shapes that end in a delivery, as opposed to a fight or a rampage. */
  private static readonly DELIVERY: readonly JobKind[] = ['courier', 'getaway', 'ghost'];

  private makeOffer(px: number, py: number, avoid: readonly JobKind[] = [], deliveryOnly = false): Job | null {
    const pickup = this.roadNear(px, py, OFFER_MIN, OFFER_MAX);
    if (!pickup) return null;
    if (Math.hypot(pickup.x - px, pickup.y - py) < PICKUP_RADIUS * 1.5) return null;

    const tierIndex = this.rng.int(0, TIERS.length);
    const tier = TIERS[tierIndex];

    // Higher tiers unlock the nastier shapes of work: a Local job is never a Getaway.
    const pool: JobKind[] =
      tierIndex === 0
        ? ['courier', 'ghost']
        : tierIndex === 1
          ? ['courier', 'ghost', 'intercept', 'frenzy']
          : ['getaway', 'courier', 'intercept', 'frenzy'];
    // Keep the board a real choice: prefer a shape that is not already on it, and honour a
    // request for delivery work so a player can never be offered three rampages in a row.
    let candidates = deliveryOnly ? pool.filter((k) => Jobs.DELIVERY.includes(k)) : pool;
    if (candidates.length === 0) return null;
    const fresh = candidates.filter((k) => !avoid.includes(k));
    if (fresh.length > 0) candidates = fresh;

    const kind = this.rng.pick(candidates);
    const definition = JOB_KINDS[kind];

    // No fallback to the pickup point: a job whose drop is where you already are completes the
    // instant you accept it, which is free money. Better to offer no job at all.
    const drop = this.roadNear(pickup.x, pickup.y, OFFER_MIN * 1.4, OFFER_MAX * 1.5);
    if (!drop) return null;

    return {
      id: this.nextId++,
      kind,
      tier,
      state: 'offered',
      payout: Math.round(tier.payout * definition.payoutScale),
      fareLeft: tier.fareSeconds,
      fareTotal: tier.fareSeconds,
      pickupX: pickup.x,
      pickupY: pickup.y,
      dropX: drop.x,
      dropY: drop.y,
      cargo: 1,
      target: null,
      wrecksNeeded: 4,
      wrecksDone: 0,
      failReason: '',
    };
  }

  step(player: { x: number; y: number }, heat: Heat, dt: number): void {
    this.events.accepted = null;
    this.events.completed = null;
    this.events.failed = null;
    this.events.paid = 0;

    if (this.active) {
      this.stepActive(player, heat, dt);
      return;
    }

    // Keep a full board of offers around the player, and drop ones they have driven away from.
    for (let i = this.offers.length - 1; i >= 0; i--) {
      const offer = this.offers[i];
      if (Math.hypot(offer.pickupX - player.x, offer.pickupY - player.y) > OFFER_MAX * 2.2) {
        this.offers.splice(i, 1);
      }
    }
    // Bounded: a city corner where no valid drop exists must not spin here forever.
    for (let attempt = 0; this.offers.length < OFFER_COUNT && attempt < OFFER_COUNT * 4; attempt++) {
      const onBoard = this.offers.map((o) => o.kind);
      const needsDelivery = !onBoard.some((k) => Jobs.DELIVERY.includes(k));
      // The last slot is reserved for delivery work if nothing else on the board is.
      const forceDelivery = needsDelivery && this.offers.length === OFFER_COUNT - 1;
      const offer = this.makeOffer(player.x, player.y, onBoard, forceDelivery);
      if (offer) this.offers.push(offer);
    }

    for (const offer of this.offers) {
      if (Math.hypot(offer.pickupX - player.x, offer.pickupY - player.y) > PICKUP_RADIUS) continue;
      this.accept(offer, heat);
      return;
    }
  }

  private accept(job: Job, heat: Heat): void {
    this.offers.length = 0;
    job.state = 'active';
    job.fareLeft = job.fareTotal;
    this.active = job;
    this.events.accepted = job;

    // Taking the work is taking the heat. This is the joint the whole game turns on.
    if (job.tier.heatOnAccept > 0) heat.setLevel(Math.max(heat.level, job.tier.heatOnAccept));

    if (job.kind === 'frenzy') {
      job.fareLeft = FRENZY_SECONDS;
      job.fareTotal = FRENZY_SECONDS;
    }
    if (job.kind === 'intercept') {
      job.target = this.traffic.markTarget(job.pickupX, job.pickupY);
    }
  }

  private stepActive(player: { x: number; y: number }, heat: Heat, dt: number): void {
    const job = this.active;
    if (!job) return;

    job.fareLeft -= dt;
    if (job.fareLeft <= 0) {
      this.fail(job, job.kind === 'frenzy' ? 'Ran out of time' : 'Fare walked');
      return;
    }

    // A ghost run is a promise to stay quiet, and it is the only job you can blow without
    // crashing: the moment a second unit is called, the client is gone.
    if (job.kind === 'ghost' && heat.level > 1) {
      this.fail(job, 'They called it in');
      return;
    }

    switch (job.kind) {
      case 'intercept': {
        if (job.target?.wrecked) this.complete(job);
        else if (!job.target) this.fail(job, 'Lost the target');
        break;
      }
      case 'frenzy': {
        if (job.wrecksDone >= job.wrecksNeeded) {
          // The relief and the risk are the same action, exactly as in GTA2's kill frenzies.
          heat.setLevel(heat.level - 1);
          this.complete(job);
        }
        break;
      }
      default: {
        if (Math.hypot(job.dropX - player.x, job.dropY - player.y) <= PICKUP_RADIUS) {
          this.complete(job);
        }
        break;
      }
    }
  }

  /** Call when the player wrecks a civilian car, so Frenzy work can count it. */
  countWreck(): void {
    if (this.active?.kind === 'frenzy') this.active.wrecksDone++;
  }

  /** Call on a heavy impact while carrying a load. */
  damageCargo(impact: number): void {
    const job = this.active;
    if (!job || job.kind !== 'courier') return;
    job.cargo = Math.max(0, job.cargo - impact / 900);
  }

  private complete(job: Job): void {
    job.state = 'done';
    // A courier is paid for what survives the trip, never less than a third of the fee.
    const cargoFactor = job.kind === 'courier' ? 0.35 + job.cargo * 0.65 : 1;
    this.events.paid = Math.round(job.payout * cargoFactor);
    this.events.completed = job;
    this.completed++;
    this.clearTarget(job);
    this.active = null;
  }

  private fail(job: Job, reason: string): void {
    job.state = 'failed';
    job.failReason = reason;
    this.events.failed = job;
    this.blown++;
    this.clearTarget(job);
    this.active = null;
  }

  private clearTarget(job: Job): void {
    if (job.target) job.target.fleeing = false;
    job.target = null;
  }

  /** Where the player should be heading right now, if anywhere. */
  objective(): { x: number; y: number; label: string } | null {
    const job = this.active;
    if (!job) return null;
    if (job.kind === 'intercept') {
      return job.target ? { x: job.target.x, y: job.target.y, label: 'TARGET' } : null;
    }
    if (job.kind === 'frenzy') return null;
    return { x: job.dropX, y: job.dropY, label: 'DROP' };
  }
}
