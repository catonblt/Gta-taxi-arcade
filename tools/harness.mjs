// Headless play harness: boots the real build in Chromium at phone size, drives scripted input,
// and reports crashes, frame budget and where the car ended up. This is the regression gate that
// runs on every change — screenshots land in shots/.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { mkdirSync } from 'node:fs';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const PORT = 5199;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const path = join(ROOT, rel === '/' ? 'index.html' : rel);
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(PORT, r));

mkdirSync(new URL('../shots/', import.meta.url).pathname, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// Google Fonts is unreachable from this container's proxy; the page falls back by design.
const IGNORED = ['favicon', 'fonts.googleapis.com', 'fonts.gstatic.com'];
page.on('requestfailed', (r) => { if (!IGNORED.some((i) => r.url().includes(i))) errors.push(`request failed: ${r.url()}`); });
page.on('console', (m) => {
  const text = m.text();
  if (m.type() !== 'error') return;
  if (IGNORED.some((i) => text.includes(i)) || text.includes('ERR_CONNECTION_RESET')) return;
  errors.push(text);
});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__getaway !== undefined, null, { timeout: 5000 });
await page.click('#start');

const shot = async (name) => page.screenshot({ path: new URL(`../shots/${name}.png`, import.meta.url).pathname });

// Scripted drive: accelerate, corner, drift, and finish with a deliberate wall hit.
const script = [
  ['launch', 600, []],
  ['straight', 1500, []],
  ['left', 900, ['ArrowLeft']],
  ['drift-right', 1400, ['ArrowRight', 'Space']],
  ['straight2', 1200, []],
  ['brake', 700, ['ArrowDown']],
];

for (const [name, ms, keys] of script) {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
  await shot(name);
}

// Screenshots stall the renderer, so measure a clean window with no tooling in the way:
// hold the throttle down and let it drive while nothing else touches the page.
// Back to the spawn and straight down the avenue: this window measures both frame cost and
// that the car actually reaches the speed its data sheet promises in the real build.
await page.evaluate(() => {
  const g = window.__getaway;
  g.reset();
  g.traffic.density = 0;
  g.traffic.clear();
  g.loop.resetPerf();
});
await page.waitForTimeout(3200);

const clear = await page.evaluate(() => ({
  speed: Math.round(window.__getaway.car.speed),
  topSpeed: window.__getaway.car.stats.topSpeed,
}));

// --- Pursuit: put the player on rung 2 and confirm the police actually turn up, get eyes on,
// and then lose them when the player is no longer there to be seen.
await page.evaluate(() => {
  const g = window.__getaway;
  g.reset();
  g.heat.setLevel(2);
});
await page.waitForTimeout(6000);
await shot('pursuit');
const chase = await page.evaluate(() => {
  const g = window.__getaway;
  return { cops: g.police.cops.length, pursuit: g.heat.pursuit, level: g.heat.level };
});

// Vanish: drop the player across the map so nobody can see them, and watch the chase decay.
await page.evaluate(() => {
  const g = window.__getaway;
  // Across the district, on the far arterial: out of every sight line, still on a real road.
  g.car.placeAt(g.map.spawn.x + 2400, g.map.spawn.y, 0);
  g.camera.snapTo(g.car.x, g.car.y);
});
await page.waitForTimeout(3500);
const lost = await page.evaluate(() => ({
  pursuit: window.__getaway.heat.pursuit,
  seen: window.__getaway.heat.seen,
  level: window.__getaway.heat.level,
}));

// --- A full shift, driven by the clock: take a job, deliver it, and check the money and the
// time both land. Teleporting between pins is not a play-through, but it does prove the loop
// closes: offer -> accept -> deliver -> paid -> clock extended -> summary.
await page.evaluate(() => window.__getaway.startShift());
await page.waitForTimeout(500);
const loop = await page.evaluate(async () => {
  const g = window.__getaway;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const offered = g.jobs.offers.length;
  // Prefer a delivery job so the pickup -> drop -> paid -> clock path is the one exercised.
  const deliverable = ['courier', 'getaway', 'ghost'];
  const offer = g.jobs.offers.find((o) => deliverable.includes(o.kind)) ?? g.jobs.offers[0];
  g.car.placeAt(offer.pickupX, offer.pickupY, 0);
  await wait(200);
  const took = g.jobs.active?.kind ?? null;

  const clockBefore = g.shift.timeLeft;
  const job = g.jobs.active;
  let paid = 0;
  if (job && job.kind !== 'frenzy' && job.kind !== 'intercept') {
    g.car.placeAt(job.dropX, job.dropY, 0);
    await wait(200);
    paid = g.shift.pending;
  }
  return {
    offered, took, paid, clockBefore, clockAfter: g.shift.timeLeft, jobs: g.jobs.completed,
    blown: g.jobs.blown,
    stillActive: g.jobs.active?.kind ?? null,
    heat: g.heat.level,
    drop: job ? [Math.round(job.dropX), Math.round(job.dropY)] : null,
    carAt: [Math.round(g.car.x), Math.round(g.car.y)],
  };
});

// Run the clock out and confirm the shift closes itself and banks what was earned.
await page.evaluate(() => { window.__getaway.shift.timeLeft = 0.05; });
await page.waitForTimeout(700);
await shot('summary');
const ended = await page.evaluate(() => ({
  state: window.__getaway.shift.state,
  banked: window.__getaway.shift.summary?.banked ?? -1,
  career: window.__getaway.career.cash,
  summaryVisible: !document.getElementById('summary').hasAttribute('hidden'),
}));

await page.click('#again');
await page.waitForTimeout(300);

// Streets back on: the perf window that matters is the busy one.
await page.evaluate(() => {
  const g = window.__getaway;
  g.reset();
  g.traffic.density = 20;
  g.loop.resetPerf();
});
await page.waitForTimeout(2500);

const report = await page.evaluate(() => {
  const g = window.__getaway;
  return {
    fps: g.loop.stats.fps,
    ticks: g.loop.stats.ticks,
    frameMs: Number(g.loop.stats.frameMs.toFixed(2)),
    worstMs: Number(g.loop.stats.worstMs.toFixed(2)),
    spikes: g.loop.stats.spikes,
    frames: g.loop.stats.ticks,
    x: Math.round(g.car.x), y: Math.round(g.car.y),
    speed: Math.round(g.car.speed),
    trafficCars: g.traffic.cars.length,
    damage: Math.round(g.car.damage),
    inSolid: g.map.isSolidWorld(g.car.x, g.car.y),
  };
});

await browser.close();
server.close();

console.log(JSON.stringify({ ...report, clearRunSpeed: clear.speed, topSpeed: clear.topSpeed, chase, lost, loop, ended }, null, 2));
if (errors.length) {
  console.error('PAGE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
if (report.inSolid) { console.error('FAIL: car ended up inside a solid tile'); process.exit(1); }
if (chase.cops < 2) { console.error(`FAIL: rung 2 only fielded ${chase.cops} cars`); process.exit(1); }
if (chase.pursuit !== 'chase') { console.error(`FAIL: police never got eyes on (${chase.pursuit})`); process.exit(1); }
if (lost.seen || lost.pursuit === 'chase') { console.error('FAIL: police kept eyes on a player who was not there'); process.exit(1); }
if (lost.level !== 2) { console.error(`FAIL: heat decayed on its own to ${lost.level}`); process.exit(1); }
if (loop.offered === 0) { console.error('FAIL: no work was offered'); process.exit(1); }
if (!loop.took) { console.error('FAIL: driving onto a pin did not take the job'); process.exit(1); }
if (loop.paid <= 0) { console.error('FAIL: a completed delivery paid nothing'); process.exit(1); }
if (loop.paid > 0 && loop.clockAfter <= loop.clockBefore) {
  console.error('FAIL: a delivery paid cash but put no time back on the clock');
  process.exit(1);
}
if (ended.state !== 'over' || !ended.summaryVisible) { console.error('FAIL: the shift never closed out'); process.exit(1); }
if (ended.banked !== ended.career) { console.error(`FAIL: banked ${ended.banked} but career holds ${ended.career}`); process.exit(1); }
// Headless Chromium does not pace rAF at a real 60Hz, so fps here is informational only.
// The meaningful budget is our own per-frame cost: 16.6ms is the wall, 8ms leaves headroom
// for a mid-range phone doing the same work on a slower core.
// A stray spike is GC or a compositor hitch; a stream of them is our problem. Gate on the rate.
if (report.spikes > report.ticks * 0.01) {
  console.error(`FAIL: ${report.spikes} frames over 8ms (worst ${report.worstMs}ms)`);
  process.exit(1);
}
if (clear.speed < clear.topSpeed * 0.9) {
  console.error(`FAIL: only reached ${clear.speed} of ${clear.topSpeed} on an empty straight`);
  process.exit(1);
}
if (report.ticks < 200) { console.error(`FAIL: only ${report.ticks} sim ticks ran`); process.exit(1); }
console.log('harness OK');
