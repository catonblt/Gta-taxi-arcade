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

  private isDrivable(tx: number, ty: number): boolean {
    const t = this.map.at(tx, ty);
    return t === Tile.Road || t === Tile.Alley || t === Tile.Lot;
  }

  private spawnNear(px: number, py: number): void {
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(SPAWN_MIN, SPAWN_MAX);
      const wx = px + Math.cos(a) * r;
      const wy = py + Math.sin(a) * r;
      const tx = Math.floor(wx / TILE);
      const ty = Math.floor(wy / TILE);
      if (!this.isDrivable(tx, ty)) continue;

      const dir = this.rng.pick(CARDINALS);
      if (!this.isDrivable(tx + dir.x, ty + dir.y)) continue;

      this.cars.push({
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
      });
      return;
    }
  }

  step(px: number, py: number, dt: number): void {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (Math.hypot(c.x - px, c.y - py) > DESPAWN) {
        this.cars.splice(i, 1);
        continue;
      }

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

      c.x += c.dirX * c.speed * dt;
      c.y += c.dirY * c.speed * dt;
      c.angle = Math.atan2(c.dirY, c.dirX);
    }

    const target = this.density;
    if (this.cars.length < target) this.spawnNear(px, py);
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
