import { TILE, Tile, type TileMap } from '../sim/tilemap';
import type { Camera } from './camera';

// Roads read lighter than the blocks around them: at a glance the player should see where they
// can go, not what they can hit.
const SURFACE: Record<Tile, string> = {
  [Tile.Road]: '#3c424b',
  [Tile.Alley]: '#31363d',
  [Tile.Lot]: '#4a483f',
  [Tile.Building]: '#0f1216',
  [Tile.Water]: '#0d1826',
  [Tile.Respray]: '#1f5c44',
  [Tile.Hideout]: '#3d2f52',
};

const DRIVABLE: Record<Tile, boolean> = {
  [Tile.Road]: true,
  [Tile.Alley]: true,
  [Tile.Lot]: true,
  [Tile.Building]: false,
  [Tile.Water]: false,
  [Tile.Respray]: true,
  [Tile.Hideout]: true,
};

/** Cheap deterministic per-tile jitter so blocks don't read as one flat slab. */
function tileShade(tx: number, ty: number): number {
  const h = Math.imul(tx * 73856093 ^ ty * 19349663, 0x45d9f3b);
  return ((h >>> 16) & 0xff) / 255;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  cssWidth = 0;
  cssHeight = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  resize(): void {
    // Cap DPR: a 3x buffer on a mid-range phone costs more than it shows.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssWidth = window.innerWidth;
    this.cssHeight = window.innerHeight;
    this.canvas.width = Math.round(this.cssWidth * this.dpr);
    this.canvas.height = Math.round(this.cssHeight * this.dpr);
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
  }

  beginWorld(camera: Camera): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.save();
    ctx.translate(this.cssWidth / 2, this.cssHeight / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);
  }

  endWorld(): void {
    this.ctx.restore();
  }

  /** Draws only the tiles the camera can actually see. */
  drawMap(map: TileMap, camera: Camera): void {
    const { ctx } = this;
    const halfW = this.cssWidth / (2 * camera.scale);
    const halfH = this.cssHeight / (2 * camera.scale);
    const x0 = Math.max(0, Math.floor((camera.x - halfW) / TILE));
    const x1 = Math.min(map.width - 1, Math.ceil((camera.x + halfW) / TILE));
    const y0 = Math.max(0, Math.floor((camera.y - halfH) / TILE));
    const y1 = Math.min(map.height - 1, Math.ceil((camera.y + halfH) / TILE));

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = map.at(tx, ty);
        const px = tx * TILE;
        const py = ty * TILE;
        ctx.fillStyle = SURFACE[tile];
        ctx.fillRect(px, py, TILE, TILE);

        if (tile === Tile.Building) {
          // Fake a little height: a roof inset that varies per tile so a block is not one slab.
          const shade = tileShade(tx, ty);
          const v = 22 + shade * 22;
          ctx.fillStyle = `rgb(${v | 0},${(v + 4) | 0},${(v + 10) | 0})`;
          ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
          // A lit window here and there, so the city looks inhabited at speed.
          if (shade > 0.86) {
            ctx.fillStyle = 'rgba(255,214,140,0.5)';
            ctx.fillRect(px + TILE * 0.32, py + TILE * 0.32, 7, 7);
          }
        } else if (tile === Tile.Road || tile === Tile.Alley) {
          // Lane dashes down the middle of straight road runs.
          const horizontal = map.at(tx - 1, ty) === tile && map.at(tx + 1, ty) === tile;
          const vertical = map.at(tx, ty - 1) === tile && map.at(tx, ty + 1) === tile;
          ctx.fillStyle = 'rgba(230,205,120,0.16)';
          if (horizontal && !vertical) ctx.fillRect(px + 8, py + TILE / 2 - 1, TILE - 16, 2);
          else if (vertical && !horizontal) ctx.fillRect(px + TILE / 2 - 1, py + 8, 2, TILE - 16);
        }

        // Kerbs: a pale lip wherever drivable ground meets a block. Cheap, and it makes the
        // street network legible in peripheral vision while you are watching the mirrors.
        if (DRIVABLE[tile]) {
          ctx.fillStyle = 'rgba(150,160,175,0.16)';
          if (!DRIVABLE[map.at(tx, ty - 1)]) ctx.fillRect(px, py, TILE, 4);
          if (!DRIVABLE[map.at(tx, ty + 1)]) ctx.fillRect(px, py + TILE - 4, TILE, 4);
          if (!DRIVABLE[map.at(tx - 1, ty)]) ctx.fillRect(px, py, 4, TILE);
          if (!DRIVABLE[map.at(tx + 1, ty)]) ctx.fillRect(px + TILE - 4, py, 4, TILE);
        } else if (tile === Tile.Respray || tile === Tile.Hideout) {
          ctx.strokeStyle = tile === Tile.Respray ? 'rgba(90,220,160,0.6)' : 'rgba(170,130,240,0.5)';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 6, py + 6, TILE - 12, TILE - 12);
        }
      }
    }
  }

  drawCar(
    x: number, y: number, angle: number,
    length: number, width: number, color: string,
    options: { headlights?: boolean; roofLight?: number; player?: boolean } = {},
  ): void {
    const { ctx } = this;

    // A ring under the player's car. In a five-car pile-up at the top of the ladder it is
    // genuinely easy to lose track of which one you are driving, and losing that is fatal.
    if (options.player) {
      ctx.beginPath();
      ctx.arc(x, y, length * 0.78, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(240,166,60,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-length / 2 + 2, -width / 2 + 3, length, width);

    ctx.fillStyle = color;
    ctx.fillRect(-length / 2, -width / 2, length, width);

    // Windscreen and roof, so heading is readable at a glance from above.
    ctx.fillStyle = 'rgba(15,20,28,0.85)';
    ctx.fillRect(-length * 0.06, -width / 2 + 2, length * 0.3, width - 4);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(-length / 2 + 2, -width / 2 + 2, length * 0.28, width - 4);

    if (options.headlights) {
      ctx.fillStyle = 'rgba(255,240,190,0.85)';
      ctx.fillRect(length / 2 - 3, -width / 2 + 2, 3, 3);
      ctx.fillRect(length / 2 - 3, width / 2 - 5, 3, 3);
    }
    if (options.roofLight !== undefined) {
      const flash = Math.sin(options.roofLight * 12) > 0;
      ctx.fillStyle = flash ? '#ff3b3b' : '#3b7bff';
      ctx.fillRect(-3, -width / 2 + 1, 6, width - 2);
    }

    ctx.restore();
  }
}
