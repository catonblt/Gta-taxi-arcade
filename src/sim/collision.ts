import { TILE, type TileMap } from './tilemap';

interface Body {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  stats: { length: number; width: number };
}

/** How much of the impact speed is returned as bounce. Low: walls stop you, they don't launch you. */
const RESTITUTION = 0.18;

/**
 * Pushes a car body out of solid tiles and kills the velocity component going into the wall,
 * leaving the tangential component untouched — that preservation is what makes a glancing hit
 * redirect you down an alley instead of stopping the run dead ("contact steer").
 *
 * Returns the impact speed along the contact normal, or 0 for no contact.
 */
export function resolveMapCollision(body: Body, map: TileMap): number {
  const hl = body.stats.length * 0.5;
  const hw = body.stats.width * 0.5;
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);

  let pushX = 0;
  let pushY = 0;
  let contacts = 0;

  for (let i = 0; i < 4; i++) {
    const lx = i < 2 ? hl : -hl;
    const ly = i % 2 === 0 ? hw : -hw;
    const cx = body.x + lx * cos - ly * sin;
    const cy = body.y + lx * sin + ly * cos;

    const tx = Math.floor(cx / TILE);
    const ty = Math.floor(cy / TILE);
    if (!map.isSolid(tx, ty)) continue;

    // Shallowest escape from this tile's AABB, ignoring faces buried behind another solid tile
    // so a corner never gets squeezed sideways along a wall it is flush against.
    const left = cx - tx * TILE;
    const right = (tx + 1) * TILE - cx;
    const top = cy - ty * TILE;
    const bottom = (ty + 1) * TILE - cy;

    let best = Infinity;
    let bx = 0;
    let by = 0;
    if (!map.isSolid(tx - 1, ty) && left < best) { best = left; bx = -left; by = 0; }
    if (!map.isSolid(tx + 1, ty) && right < best) { best = right; bx = right; by = 0; }
    if (!map.isSolid(tx, ty - 1) && top < best) { best = top; bx = 0; by = -top; }
    if (!map.isSolid(tx, ty + 1) && bottom < best) { best = bottom; bx = 0; by = bottom; }
    if (best === Infinity) continue;

    pushX += bx;
    pushY += by;
    contacts++;
  }

  if (contacts === 0) return 0;

  pushX /= contacts;
  pushY /= contacts;
  const mag = Math.hypot(pushX, pushY);
  if (mag < 1e-4) return 0;

  body.x += pushX;
  body.y += pushY;

  const nx = pushX / mag;
  const ny = pushY / mag;
  const into = body.vx * nx + body.vy * ny;
  if (into >= 0) return 0;

  body.vx -= (1 + RESTITUTION) * into * nx;
  body.vy -= (1 + RESTITUTION) * into * ny;
  // Scrub a little tangential speed too, so scraping a wall is slower than driving clean.
  body.vx *= 0.94;
  body.vy *= 0.94;

  return -into;
}

interface PairBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stats: { length: number; width: number; mass: number };
}

/**
 * Car-on-car contact, resolved as a mass-weighted push apart plus an exchange of the closing
 * velocity. Approximating each car by a circle keeps this cheap and, more importantly, keeps
 * ramming predictable: heavier wins, and a glancing hit spins nobody out unfairly.
 *
 * Returns the closing speed of the impact, or 0 if the cars were not touching.
 */
export function resolveCarPair(a: PairBody, b: PairBody): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = (a.stats.length + b.stats.length) * 0.38;
  if (dist < 1e-4 || dist >= minDist) return 0;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;

  const total = a.stats.mass + b.stats.mass;
  const aShare = b.stats.mass / total;
  const bShare = a.stats.mass / total;
  a.x -= nx * overlap * aShare;
  a.y -= ny * overlap * aShare;
  b.x += nx * overlap * bShare;
  b.y += ny * overlap * bShare;

  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (closing <= 0) return 0;

  const impulse = closing * 1.4;
  a.vx -= impulse * nx * aShare;
  a.vy -= impulse * ny * aShare;
  b.vx += impulse * nx * bShare;
  b.vy += impulse * ny * bShare;

  return closing;
}
