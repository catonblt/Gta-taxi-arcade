export const TILE = 64;

export const enum Tile {
  Road = 0,
  Alley = 1,
  Lot = 2,
  Building = 3,
  Water = 4,
  Respray = 5,
  Hideout = 6,
}

const CHAR_TO_TILE: Record<string, Tile> = {
  '.': Tile.Road,
  ',': Tile.Alley,
  '=': Tile.Lot,
  '#': Tile.Building,
  '~': Tile.Water,
  R: Tile.Respray,
  H: Tile.Hideout,
  P: Tile.Road,
};

/** Lateral grip multiplier per surface: loose concrete slides, asphalt bites. */
const GRIP: Record<Tile, number> = {
  [Tile.Road]: 1,
  [Tile.Alley]: 0.95,
  [Tile.Lot]: 0.78,
  [Tile.Building]: 1,
  [Tile.Water]: 1,
  [Tile.Respray]: 1,
  [Tile.Hideout]: 0.95,
};

export interface Marker {
  kind: 'respray' | 'hideout';
  x: number;
  y: number;
}

export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;
  readonly markers: Marker[] = [];
  readonly spawn = { x: 0, y: 0 };

  constructor(source: string) {
    const rows = source.split('\n').filter((r) => r.length > 0);
    this.height = rows.length;
    this.width = Math.max(...rows.map((r) => r.length));
    this.tiles = new Uint8Array(this.width * this.height);
    this.tiles.fill(Tile.Building);

    for (let y = 0; y < this.height; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        const tile = CHAR_TO_TILE[ch];
        if (tile === undefined) continue;
        this.tiles[y * this.width + x] = tile;
        const wx = (x + 0.5) * TILE;
        const wy = (y + 0.5) * TILE;
        if (ch === 'P') { this.spawn.x = wx; this.spawn.y = wy; }
        if (tile === Tile.Respray) this.markers.push({ kind: 'respray', x: wx, y: wy });
        if (tile === Tile.Hideout) this.markers.push({ kind: 'hideout', x: wx, y: wy });
      }
    }
  }

  at(tx: number, ty: number): Tile {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return Tile.Building;
    return this.tiles[ty * this.width + tx] as Tile;
  }

  atWorld(wx: number, wy: number): Tile {
    return this.at(Math.floor(wx / TILE), Math.floor(wy / TILE));
  }

  isSolid(tx: number, ty: number): boolean {
    const t = this.at(tx, ty);
    return t === Tile.Building || t === Tile.Water;
  }

  isSolidWorld(wx: number, wy: number): boolean {
    return this.isSolid(Math.floor(wx / TILE), Math.floor(wy / TILE));
  }

  gripAtWorld(wx: number, wy: number): number {
    return GRIP[this.atWorld(wx, wy)];
  }

  /** Bresenham-ish walk used for police line of sight: is the straight line unobstructed? */
  hasLineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(dist / (TILE * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isSolidWorld(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }
}
