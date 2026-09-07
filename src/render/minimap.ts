import { TILE, Tile, type TileMap } from '../sim/tilemap';
import type { Renderer } from './renderer';

/** How much of the city the map shows, in tiles across. Enough to plan the next two junctions. */
const RANGE_TILES = 30;

const TILE_COLOR: Record<Tile, string> = {
  [Tile.Road]: '#5c6774',
  [Tile.Alley]: '#454e59',
  [Tile.Lot]: '#5f5c4e',
  [Tile.Building]: '#12161c',
  [Tile.Water]: '#0d1826',
  [Tile.Respray]: '#2f7f5e',
  [Tile.Hideout]: '#5b478a',
};

export interface MinimapBlip {
  x: number;
  y: number;
  color: string;
  /** Draws larger and brighter: the thing the player is meant to be looking at. */
  important?: boolean;
}

/**
 * The district is drawn once, a pixel per tile, and thereafter the map is one scaled blit of a
 * crop. Route knowledge is the deepest skill this game has — knowing which alley goes through and
 * which junction is a trap — and none of it can be learned from a screen that only ever shows the
 * next two blocks.
 */
export class Minimap {
  private surface: HTMLCanvasElement | null = null;

  /** Call whenever the district changes. Cheap: one pass over the tile array. */
  build(map: TileMap): void {
    const canvas = document.createElement('canvas');
    canvas.width = map.width;
    canvas.height = map.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const image = ctx.createImageData(map.width, map.height);
    for (let i = 0; i < map.tiles.length; i++) {
      const color = TILE_COLOR[map.tiles[i] as Tile] ?? TILE_COLOR[Tile.Building];
      image.data[i * 4] = parseInt(color.slice(1, 3), 16);
      image.data[i * 4 + 1] = parseInt(color.slice(3, 5), 16);
      image.data[i * 4 + 2] = parseInt(color.slice(5, 7), 16);
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    this.surface = canvas;
  }

  /** Screen box the map occupies, so the HUD can lay out around it. */
  box(r: Renderer, safeTop: number, safeRight: number): { x: number; y: number; size: number } {
    const size = Math.min(122, Math.max(84, r.cssWidth * 0.28));
    return { x: r.cssWidth - size - 14 - safeRight, y: 14 + safeTop, size };
  }

  draw(
    r: Renderer,
    playerX: number,
    playerY: number,
    playerAngle: number,
    blips: readonly MinimapBlip[],
    safeTop: number,
    safeRight: number,
  ): void {
    const surface = this.surface;
    if (!surface) return;

    const ctx = r.ctx;
    const { x, y, size } = this.box(r, safeTop, safeRight);
    const half = RANGE_TILES / 2;
    const centreTx = playerX / TILE;
    const centreTy = playerY / TILE;
    const scale = size / RANGE_TILES;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();

    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(x, y, size, size);

    // Nearest-neighbour: the city reads as blocks, and smoothing turns it into fog.
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(
      surface,
      centreTx - half, centreTy - half, RANGE_TILES, RANGE_TILES,
      x, y, size, size,
    );
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;

    const toMap = (wx: number, wy: number) => ({
      x: x + (wx / TILE - centreTx + half) * scale,
      y: y + (wy / TILE - centreTy + half) * scale,
    });

    for (const blip of blips) {
      const p = toMap(blip.x, blip.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, blip.important ? 3.4 : 2.4, 0, Math.PI * 2);
      ctx.fillStyle = blip.color;
      ctx.fill();
    }

    // The player as an arrow, because on a map that never rotates, heading is the useful part.
    ctx.save();
    ctx.translate(x + size / 2, y + size / 2);
    ctx.rotate(playerAngle);
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-3.5, 3.2);
    ctx.lineTo(-3.5, -3.2);
    ctx.closePath();
    ctx.fillStyle = '#f0a63c';
    ctx.fill();
    ctx.restore();

    ctx.restore();

    ctx.strokeStyle = 'rgba(150,160,175,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  }
}
