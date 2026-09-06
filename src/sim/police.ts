import type { InputState } from '../core/input';
import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import { POLICE } from '../data/vehicles';
import { Car } from './car';
import { resolveCarPair } from './collision';
import { driveToward } from './driver';
import type { Heat } from './heat';
import { PathGrid } from './pathgrid';
import { TILE, Tile, type TileMap } from './tilemap';

// Roughly a screen height. A cruiser sitting on your bumper down a straight avenue plainly
// sees you, so this has to exceed the range at which a tail is still a tail; anything shorter
// made pursuits drop to 'searching' with a marked car visible in the mirror.
const VISION_RANGE = 900;
/** Inside this, they have you regardless of sight lines — close enough to hear the engine. */
const POINT_BLANK = 190;

// Just beyond what a phone screen shows, so units arrive rather than appear. Any further and
// the arithmetic of the chase breaks down: a cruiser is only ~8% faster than the Beater, so a
// car dispatched a screen and a half back can never close the gap on a player at full throttle.
const SPAWN_MIN = 620;
const SPAWN_MAX = 980;
const DESPAWN = 1900;

/** Barely moving for this long while trying to drive means wedged on geometry, not slowed. */
const STUCK_SECONDS = 1.1;
const STUCK_SPEED = 28;
const REVERSE_SECONDS = 0.85;

/** Seconds boxed in by two or more cars before the shift ends. */
const BUST_SECONDS = 1.6;
const BUST_RADIUS = 95;
const BUST_MAX_SPEED = 70;

export type CopRole = 'pursue' | 'intercept';

export interface Cop {
  car: Car;
  role: CopRole;
  input: InputState;
  /** Staggers path lookups so a pack of cars never all rebuild in the same frame. */
  thinkIn: number;
  targetX: number;
  targetY: number;
  /** Seconds spent going nowhere while trying to move. */
  stuckFor: number;
  /** Seconds left backing out of whatever it wedged itself against. */
  reverseFor: number;
  /** Stops one near-miss counting repeatedly. */
  shaveCooldown: number;
}

export interface Roadblock {
  cars: { x: number; y: number; angle: number; stats: { length: number; width: number; mass: number }; vx: number; vy: number }[];
  age: number;
}

/**
 * Each rung of the ladder adds a TACTIC, not just another car — that is what makes the
 * difficulty climb something you learn your way past rather than out-stat.
 */
export interface Doctrine {
  cars: number;
  intercept: boolean;
  roadblocks: boolean;
}

export const DOCTRINE: readonly Doctrine[] = [
  { cars: 0, intercept: false, roadblocks: false },
  { cars: 1, intercept: false, roadblocks: false }, // one cruiser, straight pursuit
  { cars: 2, intercept: true, roadblocks: false },  // a second car cuts corners to head you off
  { cars: 3, intercept: true, roadblocks: true },   // junctions start closing ahead of you
  { cars: 4, intercept: true, roadblocks: true },
  { cars: 5, intercept: true, roadblocks: true },
];

export interface PoliceEvents {
  busted: boolean;
  ram: number;
  roadblockHit: number;
}

export class Police {
  readonly cops: Cop[] = [];
  readonly roadblocks: Roadblock[] = [];
  readonly events: PoliceEvents = { busted: false, ram: 0, roadblockHit: 0 };

  private readonly grid: PathGrid;
  private gridAge = 0;
  private boxedFor = 0;
  private roadblockCooldown = 0;

  constructor(
    private readonly map: TileMap,
    private readonly rng: Rng,
  ) {
    this.grid = new PathGrid(map);
  }

  clear(): void {
    this.cops.length = 0;
    this.roadblocks.length = 0;
    this.boxedFor = 0;
    this.roadblockCooldown = 0;
  }

  /** True if any pursuer currently has eyes on the player. Drives the whole seen/unseen split. */
  anyoneSees(px: number, py: number): boolean {
    for (const cop of this.cops) {
      const d = Math.hypot(cop.car.x - px, cop.car.y - py);
      if (d > VISION_RANGE) continue;
      if (d < POINT_BLANK) return true;
      if (this.map.hasLineOfSight(cop.car.x, cop.car.y, px, py)) return true;
    }
    return false;
  }

  step(player: Car, heat: Heat, dt: number): void {
    this.events.busted = false;
    this.events.ram = 0;
    this.events.roadblockHit = 0;

    const doctrine = DOCTRINE[clamp(heat.level, 0, DOCTRINE.length - 1)];
    const hunting = heat.pursuit !== 'clear';

    // The point the force is converging on: the player when seen, their last known position
    // when not. Everything downstream — pathing, spawning, roadblocks — reads from this.
    const swept = heat.searchFocus();
    const focusX = heat.seen ? player.x : swept.x;
    const focusY = heat.seen ? player.y : swept.y;

    this.gridAge -= dt;
    if (this.gridAge <= 0) {
      this.gridAge = 0.4;
      this.grid.compute(Math.floor(focusX / TILE), Math.floor(focusY / TILE));
    }

    if (hunting && this.cops.length < doctrine.cars) {
      this.spawn(player, heat, doctrine, focusX, focusY);
    }

    for (let i = this.cops.length - 1; i >= 0; i--) {
      const cop = this.cops[i];
      const far = Math.hypot(cop.car.x - player.x, cop.car.y - player.y) > DESPAWN;
      if (far || (!hunting && Math.hypot(cop.car.x - player.x, cop.car.y - player.y) > 900)) {
        this.cops.splice(i, 1);
        continue;
      }
      this.driveCop(cop, player, heat, focusX, focusY, dt);
      cop.car.step(cop.input, this.map, dt);
    }

    this.stepRoadblocks(player, heat, doctrine, dt);
    this.resolveContacts(player);
    this.checkBust(player, heat, dt);
  }

  private driveCop(cop: Cop, player: Car, heat: Heat, focusX: number, focusY: number, dt: number): void {
    // Backing out of a wedge. AI cars drive the player's physics, which means they can also get
    // hung on a kerb the way a player does — and unlike a player they will sit there forever.
    if (cop.reverseFor > 0) {
      cop.reverseFor -= dt;
      cop.input.throttle = 0;
      cop.input.brake = 1;
      cop.input.drift = false;
      cop.input.driftReleased = false;
      // Steer out the way it did not work going in.
      cop.input.steer = -Math.sign(cop.input.steer || 1);
      return;
    }

    const wantsToMove = cop.input.throttle > 0;
    cop.stuckFor = wantsToMove && cop.car.speed < STUCK_SPEED ? cop.stuckFor + dt : 0;
    if (cop.stuckFor > STUCK_SECONDS) {
      cop.stuckFor = 0;
      cop.reverseFor = REVERSE_SECONDS;
      return;
    }

    cop.thinkIn -= dt;
    if (cop.thinkIn <= 0) {
      cop.thinkIn = 0.18 + this.rng.next() * 0.12;

      let goalX = focusX;
      let goalY = focusY;
      if (cop.role === 'intercept' && heat.seen) {
        // Cut to where the player is going, not where they are. This is the tactic that makes
        // rung two feel different from rung one: running in a straight line stops working.
        goalX = player.x + player.vx * 1.7;
        goalY = player.y + player.vy * 1.7;
        if (this.map.isSolidWorld(goalX, goalY)) { goalX = focusX; goalY = focusY; }
      } else if (heat.pursuit === 'search') {
        // Searching: sweep outward from the last sighting rather than parking on it.
        const wander = 2.5 * TILE;
        goalX = focusX + (this.rng.next() - 0.5) * wander;
        goalY = focusY + (this.rng.next() - 0.5) * wander;
        if (this.map.isSolidWorld(goalX, goalY)) { goalX = focusX; goalY = focusY; }
      }

      const close = Math.hypot(cop.car.x - player.x, cop.car.y - player.y) < TILE * 2.2;
      if (close && heat.seen) {
        // In contact range, drive at the car rather than at the road: this is where a ram
        // happens, and it happens through the same physics the player is feeling.
        cop.targetX = player.x;
        cop.targetY = player.y;
      } else {
        const waypoint = this.grid.waypointFrom(cop.car.x, cop.car.y);
        cop.targetX = waypoint?.x ?? goalX;
        cop.targetY = waypoint?.y ?? goalY;
      }
    }

    driveToward(cop.car, cop.targetX, cop.targetY, cop.input, heat.seen ? 1 : 0.8);
  }

  private spawn(player: Car, heat: Heat, doctrine: Doctrine, focusX: number, focusY: number): void {
    const seen = heat.seen;
    for (let attempt = 0; attempt < 14; attempt++) {
      // Units are dispatched to get in FRONT of the car, not to trail it: a patrol arriving in
      // your mirrors is scenery, one arriving at the junction ahead is a chase. When the player
      // is barely moving, fall back to where the car is pointing.
      //
      // Crucially, when the police have NOT got eyes on you they are dispatched around where
      // they THINK you are — the swept search point — never around where you actually are.
      // Spawning relative to the player while unseen hands the force psychic knowledge and
      // makes hiding impossible: fresh cars simply keep materialising on top of you.
      const bias = seen
        ? player.speed > 40 ? Math.atan2(player.vy, player.vx) : player.angle
        : Math.atan2(heat.lastHeadingY, heat.lastHeadingX);
      const spread = seen ? (doctrine.intercept ? 1.2 : 1.6) : 0.75;
      const originX = seen ? player.x : focusX;
      const originY = seen ? player.y : focusY;
      const a = bias + (this.rng.next() - 0.5) * 2 * spread;
      const r = this.rng.range(SPAWN_MIN, SPAWN_MAX);
      const x = originX + Math.cos(a) * r;
      const y = originY + Math.sin(a) * r;
      const tile = this.map.atWorld(x, y);
      if (tile !== Tile.Road && tile !== Tile.Alley) continue;
      if (this.grid.distanceAt(Math.floor(x / TILE), Math.floor(y / TILE)) < 0) continue;

      const role: CopRole =
        doctrine.intercept && this.cops.filter((c) => c.role === 'intercept').length < doctrine.cars - 1
          ? 'intercept'
          : 'pursue';

      const car = new Car({ ...POLICE.cruiser });
      car.placeAt(x, y, Math.atan2(player.y - y, player.x - x));
      this.cops.push({
        car,
        role,
        input: { steer: 0, throttle: 1, brake: 0, drift: false, driftReleased: false },
        thinkIn: 0,
        targetX: player.x,
        targetY: player.y,
        stuckFor: 0,
        reverseFor: 0,
        shaveCooldown: 0,
      });
      return;
    }
  }

  private stepRoadblocks(player: Car, heat: Heat, doctrine: Doctrine, dt: number): void {
    this.roadblockCooldown -= dt;
    for (let i = this.roadblocks.length - 1; i >= 0; i--) {
      const block = this.roadblocks[i];
      block.age += dt;
      const d = Math.hypot(block.cars[0].x - player.x, block.cars[0].y - player.y);
      if (block.age > 45 || d > DESPAWN) this.roadblocks.splice(i, 1);
    }

    if (!doctrine.roadblocks || !heat.seen || this.roadblockCooldown > 0) return;
    if (player.speed < 120) return;

    // Placed on the road the player is actually heading down, far enough ahead to be seen and
    // reacted to. A roadblock you cannot see coming is a cheat, not a tactic.
    const ahead = 13 * TILE;
    const dirX = player.vx / Math.max(player.speed, 1);
    const dirY = player.vy / Math.max(player.speed, 1);
    const bx = player.x + dirX * ahead;
    const by = player.y + dirY * ahead;
    const tile = this.map.atWorld(bx, by);
    if (tile !== Tile.Road) return;

    // Lay the cars across the direction of travel, and leave one gap: a roadblock should be
    // beatable by someone precise, and a wall to everyone else.
    const perpX = -dirY;
    const perpY = dirX;
    const gap = this.rng.int(0, 3);
    const cars: Roadblock['cars'] = [];
    for (let slot = 0; slot < 3; slot++) {
      if (slot === gap) continue;
      const offset = (slot - 1) * 34;
      cars.push({
        x: bx + perpX * offset,
        y: by + perpY * offset,
        angle: Math.atan2(perpY, perpX),
        stats: { length: 38, width: 19, mass: 9 },
        vx: 0,
        vy: 0,
      });
    }
    this.roadblocks.push({ cars, age: 0 });
    this.roadblockCooldown = 11;
  }

  private resolveContacts(player: Car): void {
    for (let i = 0; i < this.cops.length; i++) {
      const impact = resolveCarPair(player, this.cops[i].car);
      if (impact > this.events.ram) this.events.ram = impact;
      for (let j = i + 1; j < this.cops.length; j++) {
        resolveCarPair(this.cops[i].car, this.cops[j].car);
      }
    }
    for (const block of this.roadblocks) {
      for (const parked of block.cars) {
        const impact = resolveCarPair(player, parked);
        // Parked cars are anchored: shunting one aside should feel like hitting furniture.
        parked.vx = 0;
        parked.vy = 0;
        if (impact > this.events.roadblockHit) this.events.roadblockHit = impact;
      }
    }
  }

  private checkBust(player: Car, heat: Heat, dt: number): void {
    if (heat.level === 0) { this.boxedFor = 0; return; }
    let near = 0;
    for (const cop of this.cops) {
      if (Math.hypot(cop.car.x - player.x, cop.car.y - player.y) < BUST_RADIUS) near++;
    }
    // Boxed in AND stopped. Being fast is always an answer; being surrounded and slow is not.
    const pinned = near >= 2 && player.speed < BUST_MAX_SPEED;
    this.boxedFor = pinned ? this.boxedFor + dt : 0;
    if (this.boxedFor >= BUST_SECONDS) {
      this.boxedFor = 0;
      this.events.busted = true;
    }
  }
}
