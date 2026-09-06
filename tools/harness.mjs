// Headless play harness: boots the real production build in Chromium at phone size, drives it
// through the game's actual phases, and gates on what would ruin a session — frame cost, a car
// that cannot reach its own top speed, a pursuit that never forms, an escape that does not work,
// a loop that does not pay. Screenshots land in shots/.
//
// Usage: npm run harness
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const SHOTS = new URL('../shots/', import.meta.url).pathname;
const PORT = 5199;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// Google Fonts is unreachable through this container's proxy and the page falls back by design.
const IGNORED_ERRORS = ['favicon', 'fonts.googleapis.com', 'fonts.gstatic.com', 'ERR_CONNECTION_RESET'];

const server = createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const path = join(ROOT, rel === '/' ? 'index.html' : rel);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2 });

const errors = [];
const ignorable = (text) => IGNORED_ERRORS.some((i) => text.includes(i));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('requestfailed', (r) => { if (!ignorable(r.url())) errors.push(`request failed: ${r.url()}`); });
page.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text()); });

const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
const wait = (ms) => page.waitForTimeout(ms);
const read = (fn) => page.evaluate(fn);

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__getaway !== undefined, null, { timeout: 5000 });
await shot('briefing');
await page.click('#start');

// --- Phase 1: driving. A scripted run through the streets, with a screenshot per beat. ------
for (const [name, ms, keys] of [
  ['launch', 600, []],
  ['straight', 1500, []],
  ['left', 900, ['ArrowLeft']],
  ['drift-right', 1400, ['ArrowRight', 'Space']],
  ['straight2', 1200, []],
  ['brake', 700, ['ArrowDown']],
]) {
  for (const key of keys) await page.keyboard.down(key);
  await wait(ms);
  for (const key of keys) await page.keyboard.up(key);
  await shot(name);
}

// --- Phase 2: the car's own numbers, on an empty street with nothing to thread. --------------
await read(() => {
  const g = window.__getaway;
  g.reset();
  g.traffic.density = 0;
  g.traffic.clear();
  g.loop.resetPerf();
});
await wait(3200);
const straightLine = await read(() => ({
  speed: Math.round(window.__getaway.car.speed),
  topSpeed: window.__getaway.car.stats.topSpeed,
}));

// --- Phase 3: a pursuit forms. Put the player on rung two and let dispatch do its work. ------
await read(() => {
  const g = window.__getaway;
  g.reset();
  g.traffic.density = 20;
  g.heat.setLevel(2);
});
await wait(6000);
await shot('pursuit');
const chase = await read(() => {
  const g = window.__getaway;
  return { cops: g.police.cops.length, pursuit: g.heat.pursuit, level: g.heat.level };
});

// --- Phase 4: the intended escape. Park in a hideout bay and lie low. ------------------------
// Teleporting across the map is NOT escaping: dispatch keeps sending fresh units to wherever
// you are while the hunt is live. Breaking their line of sight and holding still is the way out.
// Brake first, then pull in: with an auto-throttle the car drives itself off the bay in the
// half second between being placed and the brake landing.
await page.keyboard.down('ArrowDown');
await wait(400);
await read(() => {
  const g = window.__getaway;
  // The bay furthest from where they last had eyes on you. Ducking into a garage one block
  // from the chase does not work, by design: their search sweep still covers it.
  const bay = g.map.markers
    .filter((m) => m.kind === 'hideout')
    .sort(
      (a, b) =>
        Math.hypot(b.x - g.heat.lastKnownX, b.y - g.heat.lastKnownY) -
        Math.hypot(a.x - g.heat.lastKnownX, a.y - g.heat.lastKnownY),
    )[0];
  g.car.placeAt(bay.x, bay.y, 0);
  g.camera.snapTo(g.car.x, g.car.y);
  g.police.clear();
});
await wait(7500);
await page.keyboard.up('ArrowDown');
const laidLow = await read(() => ({
  pursuit: window.__getaway.heat.pursuit,
  level: window.__getaway.heat.level,
  speed: Math.round(window.__getaway.car.speed),
}));

// --- Phase 5: the shift loop closes. Offer, accept, deliver, get paid, get time back. --------
await read(() => window.__getaway.startShift());
await wait(500);
const shiftLoop = await read(async () => {
  const g = window.__getaway;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  const offered = g.jobs.offers.length;
  const deliverable = ['courier', 'getaway', 'ghost'];
  const offer = g.jobs.offers.find((o) => deliverable.includes(o.kind)) ?? g.jobs.offers[0];
  g.car.placeAt(offer.pickupX, offer.pickupY, 0);
  await pause(200);

  const took = g.jobs.active?.kind ?? null;
  const job = g.jobs.active;
  const clockBefore = g.shift.timeLeft;
  if (job) {
    g.car.placeAt(job.dropX, job.dropY, 0);
    await pause(200);
  }
  return {
    offered, took,
    paid: Math.round(g.shift.pending),
    clockBefore, clockAfter: g.shift.timeLeft,
    jobs: g.jobs.completed,
  };
});

// --- Phase 6: style pays, and a crash takes it back. ----------------------------------------
const style = await read(() => {
  const g = window.__getaway;
  g.style.reset();
  const before = g.shift.pending;
  for (let i = 0; i < 6; i++) {
    g.style.step(1 / 60);
    g.style.closeShave();
    g.shift.tip(g.style.events.tip);
  }
  const multiplier = g.style.multiplier;
  const earned = Math.round(g.shift.pending - before);
  g.style.impact(400);
  return { multiplier, earned, afterCrash: g.style.multiplier, peak: g.style.peak };
});

// --- Phase 7: the shift closes itself and banks the night. -----------------------------------
await read(() => { window.__getaway.shift.timeLeft = 0.05; });
await wait(700);
await shot('summary');
const ended = await read(() => ({
  state: window.__getaway.shift.state,
  banked: window.__getaway.shift.summary?.banked ?? -1,
  career: window.__getaway.garage.cash,
  summaryVisible: !document.getElementById('summary').hasAttribute('hidden'),
}));
// "To the garage" now opens the garage between shifts, rather than starting one blind.
await page.click('#again');
await wait(300);
const garageOpened = await read(() => !document.getElementById('garage').hasAttribute('hidden'));

// --- Phase 8: the garage. Money buys a faster car, the build reaches the simulation, and the
// whole thing survives a reload.
const garage = await read(async () => {
  const g = window.__getaway;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  g.garage.cash = 60000;
  g.garage.rep = 40;
  const beforeTop = g.garage.stats().topSpeed;
  g.garage.upgrade('engine');
  g.garage.upgrade('engine');
  const afterTop = g.garage.stats().topSpeed;

  g.garage.buyPart('plates');
  g.garage.togglePart('plates');
  const heatGain = g.garage.modifiers().heatGain;

  g.garageScreen.show();
  await pause(150);
  const rows = document.querySelectorAll('#g-upgrades .row').length;
  const cars = document.querySelectorAll('#g-cars .car').length;
  const parts = document.querySelectorAll('#g-parts .row').length;
  g.garageScreen.hide();

  // The car the player actually drives must pick the build up.
  g.startShift();
  await pause(120);
  return {
    beforeTop: Math.round(beforeTop), afterTop: Math.round(afterTop), heatGain,
    drivenTop: Math.round(g.car.stats.topSpeed),
    rows, cars, parts,
    saved: localStorage.getItem('getaway.save.v1') !== null,
  };
});
await read(() => { window.__getaway.garageScreen.show(); });
await wait(200);
await shot('garage');
await read(() => { window.__getaway.garageScreen.hide(); });

// --- Phase 9: the perf window that matters — busy streets, live pursuit, nothing stalling. ---
await read(() => {
  const g = window.__getaway;
  g.heat.setLevel(3);
  g.loop.resetPerf();
});
await wait(3000);
const perf = await read(() => {
  const g = window.__getaway;
  return {
    fps: Math.round(g.loop.stats.fps),
    worstMs: Number(g.loop.stats.worstMs.toFixed(2)),
    spikes: g.loop.stats.spikes,
    frames: g.loop.stats.ticks,
    traffic: g.traffic.cars.length,
    cops: g.police.cops.length,
    inSolid: g.map.isSolidWorld(g.car.x, g.car.y),
  };
});

await browser.close();
server.close();

console.log(JSON.stringify({ straightLine, chase, laidLow, shiftLoop, style, ended, garage, perf }, null, 2));

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(errors.length === 0, `page errors:\n  ${errors.join('\n  ')}`);
check(
  straightLine.speed >= straightLine.topSpeed * 0.9,
  `only reached ${straightLine.speed} of ${straightLine.topSpeed} on an empty straight`,
);
check(chase.cops >= 2, `rung 2 only fielded ${chase.cops} cars`);
check(chase.pursuit === 'chase', `police never got eyes on the player (${chase.pursuit})`);
// Passing traffic can nudge a parked car; what matters is that it stays well under the speed
// at which lying low stops counting.
check(laidLow.speed <= 15, `could not hold still in a hideout bay (${laidLow.speed} u/s)`);
check(laidLow.level === 1, `lying low did not shed a level (heat ${laidLow.level})`);
check(shiftLoop.offered > 0, 'no work was offered');
check(shiftLoop.took !== null, 'driving onto a pin did not take the job');
check(shiftLoop.paid > 0, 'a completed delivery paid nothing');
check(shiftLoop.clockAfter > shiftLoop.clockBefore, 'a delivery paid cash but put no time back on the clock');
check(style.earned > 0 && style.multiplier > 1, 'flourishes paid nothing');
check(style.afterCrash === 1, 'a crash did not break the combo');
check(ended.state === 'over' && ended.summaryVisible, 'the shift never closed out');
check(garageOpened, 'the summary did not lead into the garage');
check(ended.banked === ended.career, `banked ${ended.banked} but the career holds ${ended.career}`);
check(garage.afterTop > garage.beforeTop, 'buying engine levels did not make the car faster');
check(garage.drivenTop === garage.afterTop, 'the car on the street is not the car in the garage');
check(garage.heatGain < 1, 'a fitted part did not reach the rules');
check(garage.rows === 4 && garage.cars >= 6 && garage.parts > 0, 'the garage screen did not render its lists');
check(garage.saved, 'the garage was never written to storage');
check(!perf.inSolid, 'the car ended up inside a solid tile');
check(perf.frames > 120, `only ${perf.frames} sim ticks ran`);
// A stray spike is GC; a stream of them is our problem. 8ms leaves room for a slower phone core.
check(perf.spikes <= perf.frames * 0.01, `${perf.spikes} frames over 8ms (worst ${perf.worstMs}ms)`);

if (failures.length > 0) {
  console.error(`\nFAIL:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nharness OK');
