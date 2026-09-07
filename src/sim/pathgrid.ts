import { TILE, type TileMap } from './tilemap';

/**
 * A breadth-first distance field over drivable tiles, rebuilt a couple of times a second from
 * whatever the police are currently converging on. Every pursuer reads the same field, so a
 * carful of cops costs the same to steer as one, and they naturally fan out around corners
 * instead of nose-to-tailing down a single path.
 */
export class PathGrid {
  private readonly dist: Int32Array;
  private readonly queue: Int32Array;
  goalTx = -1;
  goalTy = -1;

  constructor(private readonly map: TileMap) {
    const cells = map.width * map.height;
    this.dist = new Int32Array(cells);
    this.queue = new Int32Array(cells);
  }

  compute(goalTx: number, goalTy: number): void {
    const { map, dist, queue } = this;
    if (goalTx < 0 || goalTy < 0 || goalTx >= map.width || goalTy >= map.height) return;
    if (map.isSolid(goalTx, goalTy)) return;

    dist.fill(-1);
    this.goalTx = goalTx;
    this.goalTy = goalTy;

    let head = 0;
    let tail = 0;
    const start = goalTy * map.width + goalTx;
    dist[start] = 0;
    queue[tail++] = start;

    while (head < tail) {
      const index = queue[head++];
      const x = index % map.width;
      const y = (index / map.width) | 0;
      const d = dist[index] + 1;

      for (let i = 0; i < 4; i++) {
        const nx = x + (i === 0 ? 1 : i === 1 ? -1 : 0);
        const ny = y + (i === 2 ? 1 : i === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const ni = ny * map.width + nx;
        if (dist[ni] !== -1 || map.isSolid(nx, ny)) continue;
        dist[ni] = d;
        queue[tail++] = ni;
      }
    }
  }

  /** Steps remaining to the goal, or -1 if this tile cannot reach it. */
  distanceAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return -1;
    return this.dist[ty * this.map.width + tx];
  }

  /**
   * The world-space point to aim at from here: walks downhill through the field, then skips
   * ahead while the straight line stays clear so cars cut corners instead of tracing tile centres.
   */
  waypointFrom(wx: number, wy: number, lookahead = 5): { x: number; y: number } | null {
    let tx = Math.floor(wx / TILE);
    let ty = Math.floor(wy / TILE);
    let here = this.distanceAt(tx, ty);
    if (here < 0) return null;

    let bestX = wx;
    let bestY = wy;
    for (let step = 0; step < lookahead; step++) {
      let nextX = -1;
      let nextY = -1;
      let best = here;
      for (let i = 0; i < 4; i++) {
        const nx = tx + (i === 0 ? 1 : i === 1 ? -1 : 0);
        const ny = ty + (i === 2 ? 1 : i === 3 ? -1 : 0);
        const d = this.distanceAt(nx, ny);
        if (d >= 0 && d < best) { best = d; nextX = nx; nextY = ny; }
      }
      if (nextX < 0) break;

      const cx = (nextX + 0.5) * TILE;
      const cy = (nextY + 0.5) * TILE;
      // Only accept the longer sight-line if it is genuinely unobstructed.
      if (!this.map.hasLineOfSight(wx, wy, cx, cy)) break;
      bestX = cx;
      bestY = cy;
      tx = nextX;
      ty = nextY;
      here = best;
    }

    return { x: bestX, y: bestY };
  }
}
