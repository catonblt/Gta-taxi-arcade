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
