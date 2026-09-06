// Lays down the base street grid for a district. The output .city file is a plain text grid that
// is then hand-edited (shortcuts, alleys, water, landmarks) — this only saves the tedious part.
// Usage: node tools/genmap.mjs docks 72 72
import { writeFileSync } from 'node:fs';

const [name = 'docks', wArg = '72', hArg = '72'] = process.argv.slice(2);
const W = Number(wArg);
const H = Number(hArg);
const BLOCK = 9; // arterial every 9 tiles
const ROAD_W = 2;

const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => '#'));

const isRoad = (i) => i % BLOCK < ROAD_W;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (isRoad(x) || isRoad(y)) grid[y][x] = '.';
  }
}

// Alley cutting through the middle of every other block, so there is always a rat run.
for (let by = 0; by * BLOCK < H; by++) {
  for (let bx = 0; bx * BLOCK < W; bx++) {
    if ((bx + by) % 2 !== 0) continue;
    const cx = bx * BLOCK + ROAD_W + 3;
    const cy = by * BLOCK + ROAD_W + 3;
    for (let y = by * BLOCK; y < Math.min((by + 1) * BLOCK, H); y++) {
      if (cx < W && grid[y][cx] === '#') grid[y][cx] = ',';
    }
    for (let x = bx * BLOCK; x < Math.min((bx + 1) * BLOCK, W); x++) {
      if (cy < H && grid[cy][x] === '#') grid[cy][x] = ',';
    }
  }
}

// ---- Authored features for The Docks -------------------------------------------------
// Hand-placed on top of the generated grid: the harbour, the container yard, and the
// landmarks that give the district its escape routes.
if (name === 'docks') {
  const set = (x, y, ch) => { if (y > 0 && y < H - 1 && x > 0 && x < W - 1) grid[y][x] = ch; };
  const rect = (x0, y0, x1, y1, ch) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ch);
  };

  // Harbour along the east edge, with a quay road hugging it. Water is a hard wall: it makes
  // the east side a dead end that punishes anyone who runs that way without a plan.
  rect(64, 30, W - 2, H - 2, '~');
  rect(62, 28, 63, H - 2, '.');
  rect(62, 28, W - 2, 29, '.');

  // Container yard: wide open concrete with stacks to weave through. This is the drift
  // playground and the best place to break line of sight in the whole district.
  rect(28, 46, 56, 60, '=');
  for (let y = 48; y <= 58; y += 3) {
    for (let x = 30; x <= 54; x += 5) rect(x, y, x + 2, y + 1, '#');
  }

  // Two long avenues cut across the block grid, so the map is not a pure chequerboard and
  // there is always a fast line that locals know and the police do not.
  rect(1, 22, W - 2, 23, '.');
  rect(36, 1, 37, H - 2, '.');

  // Landmarks. Respray garages sit off arterials; hideouts hide in alleys.
  set(10, 22, 'R');
  set(45, 37, 'R');
  set(59, 23, 'R');
  set(14, 14, 'H');
  set(50, 14, 'H');
  set(23, 41, 'H');
  set(41, 59, 'H');
  set(19, 22, 'P');
}

// Solid border so the player can never leave the authored map.
for (let x = 0; x < W; x++) { grid[0][x] = '#'; grid[H - 1][x] = '#'; }
for (let y = 0; y < H; y++) { grid[y][0] = '#'; grid[y][W - 1] = '#'; }

writeFileSync(
  new URL(`../src/data/districts/${name}.city`, import.meta.url),
  grid.map((row) => row.join('')).join('\n') + '\n',
);
console.log(`wrote ${name}.city (${W}x${H})`);
