// Lays down a district's street grid and stamps its authored features on top. The output .city
// file is a plain text grid that can then be hand-edited; this only saves the tedious part.
//
// Usage: node tools/genmap.mjs            (regenerates every district)
//        node tools/genmap.mjs downtown   (just one)
import { writeFileSync } from 'node:fs';

const LEGEND = { road: '.', alley: ',', lot: '=', building: '#', water: '~', respray: 'R', hideout: 'H', spawn: 'P' };

/**
 * Each district is a different driving problem, not a reskin: how far apart the junctions are,
 * how wide the roads run, and how often there is a way through a block at all.
 */
const DISTRICTS = {
  docks: { size: 72, block: 9, roadWidth: 2, alleyEvery: 2, features: docks },
  downtown: { size: 72, block: 7, roadWidth: 2, alleyEvery: 1, features: downtown },
  industrial: { size: 76, block: 11, roadWidth: 2, alleyEvery: 3, features: industrial },
  hills: { size: 80, block: 13, roadWidth: 3, alleyEvery: 4, features: hills },
};

function build(name, spec) {
  const { size: W, block: BLOCK, roadWidth: ROAD_W, alleyEvery } = spec;
  const H = W;
  const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => LEGEND.building));

  const isRoad = (i) => i % BLOCK < ROAD_W;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isRoad(x) || isRoad(y)) grid[y][x] = LEGEND.road;
    }
  }

  // A rat run through some blocks, so there is always a way off the arterials.
  for (let by = 0; by * BLOCK < H; by++) {
    for (let bx = 0; bx * BLOCK < W; bx++) {
      if ((bx + by) % alleyEvery !== 0) continue;
      const cx = bx * BLOCK + ROAD_W + Math.floor((BLOCK - ROAD_W) / 2);
      const cy = by * BLOCK + ROAD_W + Math.floor((BLOCK - ROAD_W) / 2);
      for (let y = by * BLOCK; y < Math.min((by + 1) * BLOCK, H); y++) {
        if (cx < W && grid[y][cx] === LEGEND.building) grid[y][cx] = LEGEND.alley;
      }
      for (let x = bx * BLOCK; x < Math.min((bx + 1) * BLOCK, W); x++) {
        if (cy < H && grid[cy][x] === LEGEND.building) grid[cy][x] = LEGEND.alley;
      }
    }
  }

  const api = {
    W, H, BLOCK, ROAD_W,
    set: (x, y, ch) => { if (y > 0 && y < H - 1 && x > 0 && x < W - 1) grid[y][x] = ch; },
    rect: (x0, y0, x1, y1, ch) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) api.set(x, y, ch);
    },
    at: (x, y) => grid[y]?.[x],
  };
  spec.features(api);

  // A solid border, so the player can never leave the authored map.
  for (let x = 0; x < W; x++) { grid[0][x] = LEGEND.building; grid[H - 1][x] = LEGEND.building; }
  for (let y = 0; y < H; y++) { grid[y][0] = LEGEND.building; grid[y][W - 1] = LEGEND.building; }

  writeFileSync(
    new URL(`../src/data/districts/${name}.city`, import.meta.url),
    grid.map((row) => row.join('')).join('\n') + '\n',
  );
  console.log(`wrote ${name}.city (${W}x${H})`);
}

// ---- The Docks: wide, open, forgiving to navigate. The teaching ground. --------------------
function docks({ W, H, set, rect }) {
  // Harbour along the east edge with a quay hugging it. Water is a hard wall, so running east
  // without a plan is a dead end that costs you the chase.
  rect(64, 30, W - 2, H - 2, LEGEND.water);
  rect(62, 28, 63, H - 2, LEGEND.road);
  rect(62, 28, W - 2, 29, LEGEND.road);

  // Container yard: open concrete with stacks to weave through, and the best place in the
  // district to break a sight line.
  rect(28, 46, 56, 60, LEGEND.lot);
  for (let y = 48; y <= 58; y += 3) {
    for (let x = 30; x <= 54; x += 5) rect(x, y, x + 2, y + 1, LEGEND.building);
  }

  // Two avenues cut across the block grid, so the map is not a pure chequerboard.
  rect(1, 22, W - 2, 23, LEGEND.road);
  rect(36, 1, 37, H - 2, LEGEND.road);

  set(10, 22, LEGEND.respray);
  set(45, 37, LEGEND.respray);
  set(59, 23, LEGEND.respray);
  set(14, 14, LEGEND.hideout);
  set(50, 14, LEGEND.hideout);
  set(23, 41, LEGEND.hideout);
  set(41, 59, LEGEND.hideout);
  set(19, 22, LEGEND.spawn);
}

// ---- Downtown: tight, dense, and full of corners. The combo playground. ---------------------
function downtown({ W, H, set, rect }) {
  // A park breaks the grid and gives one wide-open space to build a slide through.
  rect(30, 30, 41, 41, LEGEND.lot);
  rect(34, 34, 37, 37, LEGEND.building);

  // A plaza and two one-way canyons: long straights that funnel into tight junctions, which is
  // where roadblocks bite hardest.
  rect(1, 15, W - 2, 16, LEGEND.road);
  rect(1, 57, W - 2, 58, LEGEND.road);
  rect(15, 1, 16, H - 2, LEGEND.road);
  rect(57, 1, 58, H - 2, LEGEND.road);

  set(9, 15, LEGEND.respray);
  set(63, 57, LEGEND.respray);
  set(15, 45, LEGEND.respray);
  set(22, 22, LEGEND.hideout);
  set(49, 22, LEGEND.hideout);
  set(22, 49, LEGEND.hideout);
  set(49, 49, LEGEND.hideout);
  set(36, 8, LEGEND.hideout);
  set(16, 15, LEGEND.spawn);
}

// ---- Industrial: yards, dead ends, and long detours. Bad routes get punished. ---------------
function industrial({ W, H, set, rect, at }) {
  // Big fenced yards: drivable, but with only one or two ways out.
  for (const [x, y] of [[14, 14], [46, 16], [18, 48], [50, 50]]) {
    rect(x, y, x + 12, y + 10, LEGEND.lot);
    for (let i = 0; i < 4; i++) rect(x + 2 + i * 3, y + 3, x + 3 + i * 3, y + 7, LEGEND.building);
  }

  // Wall off a handful of junctions so the grid cannot be trusted: the local knowledge this
  // district rewards is knowing which turns are lies.
  for (const [x, y] of [[22, 33], [44, 22], [11, 55], [55, 44], [33, 66]]) {
    rect(x, y, x + 1, y + 1, LEGEND.building);
  }

  // One long spine that actually crosses the district, for anyone who knows it is there.
  rect(1, 37, W - 2, 38, LEGEND.road);

  set(8, 37, LEGEND.respray);
  set(62, 37, LEGEND.respray);
  set(37, 62, LEGEND.respray);
  for (const [x, y] of [[16, 16], [48, 18], [20, 50], [52, 52], [37, 8]]) {
    if (at(x, y) !== LEGEND.building) set(x, y, LEGEND.hideout);
    else set(x, y + 1, LEGEND.hideout);
  }
  set(5, 37, LEGEND.spawn);
}

// ---- The Hills: fast, wide, and short on alternatives. Nowhere to duck. ---------------------
function hills({ W, H, set, rect }) {
  // Sweeping ring road, and very few ways across it: at this speed the map is about commitment.
  rect(1, 6, W - 2, 8, LEGEND.road);
  rect(1, H - 9, W - 2, H - 7, LEGEND.road);
  rect(6, 1, 8, H - 2, LEGEND.road);
  rect(W - 9, 1, W - 7, H - 2, LEGEND.road);

  // A reservoir in the middle. Big, hard, and unforgiving of a missed corner.
  rect(30, 30, 50, 50, LEGEND.water);
  rect(28, 28, 52, 29, LEGEND.road);
  rect(28, 51, 52, 52, LEGEND.road);

  // Two crossings only.
  rect(38, 28, 40, 52, LEGEND.building);
  rect(28, 28, 29, 52, LEGEND.road);
  rect(51, 28, 52, 52, LEGEND.road);

  set(20, 7, LEGEND.respray);
  set(60, H - 8, LEGEND.respray);
  set(7, 20, LEGEND.hideout);
  set(W - 8, 60, LEGEND.hideout);
  set(20, 20, LEGEND.hideout);
  set(60, 60, LEGEND.hideout);
  set(10, 7, LEGEND.spawn);
}

const only = process.argv[2];
for (const [name, spec] of Object.entries(DISTRICTS)) {
  if (only && only !== name) continue;
  build(name, spec);
}
