import { TILE, Tile, type TileMap } from './tilemap';

export const MAX_HEAT = 5;

/** Seconds of unbroken line of sight loss before a pursuit collapses into a search. */
const SEARCH_AFTER = 2.5;
/** Seconds of searching before the police give up on this chase entirely. */
const GIVE_UP_AFTER = 14;
/** Seconds parked in a hideout, unseen, to shed one level. */
export const HIDEOUT_SECONDS = 6;
/** How still you have to be for a hideout to count. */
const HIDEOUT_MAX_SPEED = 30;

export type Pursuit = 'clear' | 'chase' | 'search';

export interface PlayerSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
}

export interface HeatEvents {
  levelChanged: number;
  cooled: boolean;
  busted: boolean;
}

/**
 * Heat is two separate facts and the game reads better for keeping them apart:
 * WHAT the police want you for (level, which never decays on its own) and WHETHER they
 * currently know where you are (seen). GTA2 showed the second one by shaking the wanted heads;
 * here the badge pulses. Losing them is a skill you can perform; forgiveness is something you buy.
 */
export class Heat {
  level = 0;
  seen = false;
  pursuit: Pursuit = 'clear';

  /** Where the police think you are. They converge here once they lose sight of you. */
  lastKnownX = 0;
  lastKnownY = 0;
  /** The direction you were last seen heading, as a unit vector, and how fast. */
  lastHeadingX = 1;
  lastHeadingY = 0;
  lastSeenSpeed = 0;

  /** Seconds since anyone last had eyes on the player. */
  timeUnseen = 0;
  /** Progress through a hideout hold, 0..HIDEOUT_SECONDS. */
  hideoutProgress = 0;

  readonly events: HeatEvents = { levelChanged: 0, cooled: false, busted: false };

  private accrual = 0;
  /** Set when a new crime is called in, so the next step pins the report to where it happened. */
  private reported = false;

  reset(): void {
    this.level = 0;
    this.seen = false;
    this.pursuit = 'clear';
    this.timeUnseen = 0;
    this.hideoutProgress = 0;
    this.accrual = 0;
    this.reported = false;
  }

  /** Raises heat by a fraction of a level. Whole levels tick over as the fraction fills. */
  add(amount: number): void {
    if (this.level >= MAX_HEAT) return;
    this.accrual += amount;
    while (this.accrual >= 1 && this.level < MAX_HEAT) {
      this.accrual -= 1;
      this.level++;
      this.events.levelChanged = 1;
      this.report();
    }
  }

  setLevel(level: number): void {
    const next = Math.max(0, Math.min(MAX_HEAT, level));
    if (next > this.level) this.report();
    if (next !== this.level) this.events.levelChanged = Math.sign(next - this.level);
    this.level = next;
    this.accrual = 0;
    if (next === 0) {
      this.pursuit = 'clear';
      this.seen = false;
    }
  }

  /**
   * A fresh crime is a radio call: the police start looking even though nobody has eyes on you
   * yet. Without this the system deadlocks — no car nearby means never seen, never seen means
   * no pursuit, and no pursuit means no car is ever sent.
   */
  private report(): void {
    this.pursuit = 'search';
    this.timeUnseen = 0;
    this.reported = true;
  }

  step(
    player: PlayerSnapshot,
    anyoneSees: boolean,
    map: TileMap,
    dt: number,
  ): void {
    this.events.levelChanged = 0;
    this.events.cooled = false;

    if (this.level === 0) {
      this.seen = false;
      this.pursuit = 'clear';
      this.hideoutProgress = 0;
      return;
    }

    if (this.reported) {
      // Pin the report to where the crime actually happened, and send them there.
      this.mark(player);
      this.reported = false;
    }

    this.seen = anyoneSees;
    if (anyoneSees) {
      this.mark(player);
      this.timeUnseen = 0;
      this.pursuit = 'chase';
    } else {
      this.timeUnseen += dt;
      if (this.pursuit === 'chase' && this.timeUnseen > SEARCH_AFTER) this.pursuit = 'search';
      if (this.pursuit === 'search' && this.timeUnseen > GIVE_UP_AFTER) this.pursuit = 'clear';
    }

    // --- Hideouts ------------------------------------------------------------------------
    // Free, but paid for in clock: the shift timer keeps running while you sit in the dark.
    const onHideout = map.atWorld(player.x, player.y) === Tile.Hideout;
    const canHide = onHideout && !anyoneSees && player.speed < HIDEOUT_MAX_SPEED;
    if (canHide) {
      this.hideoutProgress += dt;
      if (this.hideoutProgress >= HIDEOUT_SECONDS) {
        this.hideoutProgress = 0;
        this.setLevel(this.level - 1);
        this.events.cooled = true;
      }
    } else {
      // Leaving early loses the hold, so a hideout is a commitment, not a tap.
      this.hideoutProgress = Math.max(0, this.hideoutProgress - dt * 2);
    }
  }

  /**
   * Records not just where you were but which way you were going. A search that only knows the
   * point you vanished from is trivially beaten by driving in a straight line; one that follows
   * your escape line has to be broken by turning off it, which is a skill worth having.
   */
  private mark(player: PlayerSnapshot): void {
    this.lastKnownX = player.x;
    this.lastKnownY = player.y;
    // Dispatch assumes a car in motion even if the crime happened at a standstill; a search
    // that sweeps at the speed you happened to be doing when spotted never moves at all.
    this.lastSeenSpeed = Math.max(player.speed, 190);
    if (player.speed > 1) {
      this.lastHeadingX = player.vx / player.speed;
      this.lastHeadingY = player.vy / player.speed;
    }
  }

  /** Where the search has swept to by now: down your last known line, widening with time. */
  searchFocus(): { x: number; y: number } {
    const reach = Math.min(this.lastSeenSpeed * this.timeUnseen * 0.65, TILE * 22);
    return {
      x: this.lastKnownX + this.lastHeadingX * reach,
      y: this.lastKnownY + this.lastHeadingY * reach,
    };
  }

  /** True if the player is sitting on a respray bay and slow enough to pull in. */
  canRespray(player: { x: number; y: number; speed: number }, map: TileMap): boolean {
    return (
      this.level > 0 &&
      map.atWorld(player.x, player.y) === Tile.Respray &&
      player.speed < HIDEOUT_MAX_SPEED * 2
    );
  }

  respray(): void {
    this.setLevel(0);
    this.timeUnseen = 0;
    this.hideoutProgress = 0;
  }

  /** Distance in tiles from the police's best guess to where the player actually is. */
  searchErrorTiles(player: { x: number; y: number }): number {
    return Math.hypot(player.x - this.lastKnownX, player.y - this.lastKnownY) / TILE;
  }
}
