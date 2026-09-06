import type { Rng } from '../core/rng';
import { TILE, Tile, type TileMap } from './tilemap';

const CARDINALS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
] as const;

const SPAWN_MIN = 420;
const SPAWN_MAX = 900;
const DESPAWN = 1150;

export interface TrafficCar {
  x: number;
  y: number;
  angle: number;
  speed: number;
  dirX: number;
  dirY: number;
  color: string;
  length: number;
  width: number;
  /** Counts down to the next junction decision. */
  nextTurnAt: number;
  /** Wrecked cars stop driving and become scenery. Frenzy and Intercept work counts these. */
  wrecked: boolean;
  /** Set while this car is the target of an Intercept job: it runs instead of commuting. */
  fleeing: boolean;
  damage: number;
  /** Stops one pass counting as a dozen close shaves. */
  shaveCooldown: number;
}

const COLORS = ['#c8ccd4', '#7d8590', '#4a5560', '#a8a094', '#5f7d6a', '#8e6f5a'];

/**
 * Ambient traffic exists to be threaded, not fought: it makes the streets read as a city and it
 * is the raw material for close-shave tips. Cars drive axis-aligned lanes and turn at junctions.
 */
export class Traffic {
  readonly cars: TrafficCar[] = [];

  constructor(
    private readonly map: TileMap,
    private readonly rng: Rng,
    public density: number,
  ) {}

  /** Clears the streets. Used by the test harness to isolate the car from the city. */
  clear(): void {
    this.cars.length = 0;
  }

  /** Applies collision damage to a civilian car and reports whether that finished it. */
  damage(car: TrafficCar, impact: number): boolean {
    if (car.wrecked) return false;
    car.damage += impact;
    if (car.damage < 260) return false;
    car.wrecked = true;
    car.fleeing = false;
    return true;
  }

  /**
   * Finds a car to mark for an Intercept job, putting one on the street if the block happens to
   * be empty. A job that cannot be started is worse than a job that is hard.
   */
  markTarget(x: number, y: number): TrafficCar | null {
    const car = this.nearestTo(x, y) ?? this.spawnNear(x, y, 120, 420) ?? this.spawnNear(x, y, 60, 900);
    if (car) car.fleeing = true;
    return car;
  }

  /** The nearest driveable civilian car to a point, for marking an Intercept target. */
  nearestTo(x: number, y: number, maxDistance = 1200): TrafficCar | null {
    let best: TrafficCar | null = null;
    let bestDistance = maxDistance;
    for (const c of this.cars) {
      if (c.wrecked) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestDistance) { bestDistance = d; best = c; }
    }
    return best;
  }

  private isDrivable(tx: number, ty: number): boolean {
    const t = this.map.at(tx, ty);
    return t === Tile.Road || t === Tile.Alley || t === Tile.Lot;
  }

  private spawnNear(px: number, py: number, min = SPAWN_MIN, max = SPAWN_MAX): TrafficCar | null {
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(min, max);
      const wx = px + Math.cos(a) * r;
      const wy = py + Math.sin(a) * r;
      const tx = Math.floor(wx / TILE);
      const ty = Math.floor(wy / TILE);
      if (!this.isDrivable(tx, ty)) continue;

      const dir = this.rng.pick(CARDINALS);
      if (!this.isDrivable(tx + dir.x, ty + dir.y)) continue;

      const car: TrafficCar = {
        // Sit in the middle of the tile and offset into the right-hand lane.
        x: (tx + 0.5) * TILE - dir.y * TILE * 0.22,
        y: (ty + 0.5) * TILE + dir.x * TILE * 0.22,
        angle: Math.atan2(dir.y, dir.x),
        speed: this.rng.range(110, 175),
        dirX: dir.x,
        dirY: dir.y,
        color: this.rng.pick(COLORS),
        length: this.rng.range(34, 42),
        width: 18,
        nextTurnAt: 0,
        wrecked: false,
        fleeing: false,
        damage: 0,
        shaveCooldown: 0,
      };
      this.cars.push(car);
      return car;
    }
    return null;
  }

  step(px: number, py: number, dt: number): void {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      // Wrecked cars are kept until they are well out of sight: a street you tore through
      // should still look torn up when you come back round the block.
      // A marked car is never quietly recycled: losing an Intercept target to the despawn
      // radius would blow the job through nothing the player did.
      if (!c.fleeing && Math.hypot(c.x - px, c.y - py) > DESPAWN) {
        this.cars.splice(i, 1);
        continue;
      }
      if (c.wrecked) continue;

      const aheadX = c.x + c.dirX * TILE * 0.75;
      const aheadY = c.y + c.dirY * TILE * 0.75;
      if (!this.isDrivable(Math.floor(aheadX / TILE), Math.floor(aheadY / TILE))) {
        this.turn(c);
      } else {
        c.nextTurnAt -= dt;
        if (c.nextTurnAt <= 0) {
          c.nextTurnAt = this.rng.range(2.5, 7);
          if (this.rng.chance(0.35)) this.turn(c);
        }
      }

      // A marked car drives like it knows: faster, and it turns at every chance it gets.
      const speed = c.fleeing ? c.speed * 1.75 : c.speed;
      c.x += c.dirX * speed * dt;
      c.y += c.dirY * speed * dt;
      c.angle = Math.atan2(c.dirY, c.dirX);
    }

    const alive = this.cars.reduce((n, c) => n + (c.wrecked ? 0 : 1), 0);
    if (alive < this.density) this.spawnNear(px, py);
  }

  private turn(c: TrafficCar): void {
    const tx = Math.floor(c.x / TILE);
    const ty = Math.floor(c.y / TILE);
    const options = CARDINALS.filter(
      (d) => !(d.x === -c.dirX && d.y === -c.dirY) && this.isDrivable(tx + d.x, ty + d.y),
    );
    if (options.length === 0) {
      c.dirX = -c.dirX;
      c.dirY = -c.dirY;
    } else {
      const d = this.rng.pick(options);
      c.dirX = d.x;
      c.dirY = d.y;
    }
    // Re-centre on the new lane so turns don't leave cars clipping kerbs.
    c.x = (tx + 0.5) * TILE - c.dirY * TILE * 0.22;
    c.y = (ty + 0.5) * TILE + c.dirX * TILE * 0.22;
  }
}
