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
// Whether a dispatched car has a sight line at exactly six seconds is geometry, not design.
// The invariant worth asserting is that driving in a straight line at rung two GETS you found —
// so poll for it, and report how long it took, which is a useful number in its own right.
let contactAt = null;
for (let elapsed = 0; elapsed < 18000 && contactAt === null; elapsed += 500) {
  await wait(500);
  const state = await read(() => window.__getaway.heat.pursuit);
  if (state === 'chase') contactAt = elapsed + 500;
}
await shot('pursuit');
const chase = await read(() => {
  const g = window.__getaway;
  return { cops: g.police.cops.length, level: g.heat.level };
});
chase.contactMs = contactAt;

// --- Phase 3b: the police must actually be driving. They run the player's physics, and the
// tyre model has a grip peak they can fall off exactly like a player can — but without eyes to
// see it coming. A chase full of spun-out cruisers is no chase, so sample them over a window
// and check how many are sideways or stationary.
const pursuitQuality = await read(async () => {
  const g = window.__getaway;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  let samples = 0;
  let spun = 0;
  let crawling = 0;
  let fastest = 0;
  // Enough samples for the ratio to mean something. At six polls a single unlucky corner moved
  // the result from 0% to 33%, which is a coin toss dressed up as a gate.
  for (let i = 0; i < 18; i++) {
    await pause(320);
    for (const cop of g.police.cops) {
      samples++;
      if (cop.car.slipAngle > 0.7) spun++;
      if (cop.car.speed < 40) crawling++;
      fastest = Math.max(fastest, Math.round(cop.car.speed));
    }
  }
  return { samples, spun, crawling, fastest };
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

// --- Phase 9: every district loads, is drivable from its spawn, and has the landmarks the
// escape systems depend on. A district with no respray bay is a district you cannot survive.
const districts = await read(async () => {
  const g = window.__getaway;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  for (const d of g.districts) {
    g.garage.rep = 999;
    g.garage.district = d.id;
    g.startShift();
    // Long enough for a standing start to cover real ground: the Beater needs about a second
    // to be unambiguously moving.
    await pause(1000);
    out.push({
      id: d.id,
      spawnSolid: g.map.isSolidWorld(g.car.x, g.car.y),
      resprays: g.map.markers.filter((m) => m.kind === 'respray').length,
      hideouts: g.map.markers.filter((m) => m.kind === 'hideout').length,
      moved: Math.round(Math.hypot(g.car.x - g.map.spawn.x, g.car.y - g.map.spawn.y)),
      heatFloor: g.heat.level,
      ceiling: g.heat.ceiling,
    });
  }
  return out;
});

// --- Phase 10: the top of the ladder. A helicopter that holds you through walls, and strips
// laid across the road ahead.
await read(() => {
  const g = window.__getaway;
  g.garage.rep = 999;
  g.garage.district = 'hills';
  g.startShift();
  g.heat.setLevel(5);
});
await wait(7000);
await shot('heat5');
const topRung = await read(() => {
  const g = window.__getaway;
  return {
    heliActive: g.police.helicopter.active,
    strips: g.police.strips.length,
    roadblocks: g.police.roadblocks.length,
    cops: g.police.cops.length,
    level: g.heat.level,
  };
});

// --- Phase 11: pause stops the clock, and the settings actually reach the input layer.
await read(() => {
  const g = window.__getaway;
  g.garage.district = 'docks';
  g.startShift();
});
await wait(400);
await page.click('#pause-button');
await wait(150);
await shot('paused');
const pauseCheck = await read(async () => {
  const g = window.__getaway;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const before = g.shift.timeLeft;
  await pause(700);
  const held = g.shift.timeLeft;

  const slider = document.getElementById('set-sensitivity');
  slider.value = '11';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  const sensitivity = g.input.settings.sensitivity;

  // Mirroring must move the whole layout, not just relabel it: the brake pad is the visible
  // proof, since it is the one control with a fixed position.
  const brakeBefore = g.input.hint().pads.find((p) => p.label === 'BRAKE').x;
  document.getElementById('set-hand-right').click();
  const brakeAfter = g.input.hint().pads.find((p) => p.label === 'BRAKE').x;
  const mirrored = g.input.settings.mirrored;
  document.getElementById('set-hand-left').click();

  // Every scheme must be reachable from the pause screen.
  const schemeButtons = document.querySelectorAll('#set-schemes .toggle').length;

  return {
    clockHeld: Math.abs(held - before) < 0.01,
    sensitivity,
    padsSwapped: Math.abs(brakeAfter - brakeBefore) > 80 && mirrored,
    schemeButtons,
    stored: localStorage.getItem('getaway.settings.v1') !== null,
  };
});
await page.click('#resume');
await wait(400);
const resumed = await read(async () => {
  const g = window.__getaway;
  const before = g.shift.timeLeft;
  await new Promise((r) => setTimeout(r, 500));
  return { running: g.shift.timeLeft < before, minimapDrawn: g.minimapReady };
});

// --- Phase 12: the engine must not hold a note when the simulation stops. Audio is driven from
// the render loop precisely so that pausing cannot strand an oscillator.
await read(() => {
  const g = window.__getaway;
  g.garage.district = 'docks';
  g.startShift();
});
await wait(1200);
const soundDriving = await read(() => ({
  ...window.__getaway.audio.levels(),
  scene: window.__getaway.audio.lastScene,
  updates: window.__getaway.audio.updates,
}));

await read(() => window.__getaway.togglePause());
await wait(900);
const soundPaused = await read(() => ({
  ...window.__getaway.audio.levels(),
  scene: window.__getaway.audio.lastScene,
  updates: window.__getaway.audio.updates,
}));

await read(() => {
  const g = window.__getaway;
  g.togglePause();
  g.shift.timeLeft = 0.05;
});
await wait(1200);
const soundEnded = await read(() => ({
  ...window.__getaway.audio.levels(),
  scene: window.__getaway.audio.lastScene,
  updates: window.__getaway.audio.updates,
}));
await read(() => window.__getaway.garageScreen.hide());

// --- Phase 13: the perf window that matters — busy streets, live pursuit, nothing stalling. ---
await read(() => {
  const g = window.__getaway;
  g.garage.district = 'downtown';
  g.startShift();
  g.heat.setLevel(4);
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

console.log(JSON.stringify({ straightLine, chase, pursuitQuality, laidLow, shiftLoop, style, ended, garage, districts, topRung, pauseCheck, resumed, soundDriving, soundPaused, soundEnded, perf }, null, 2));

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(errors.length === 0, `page errors:\n  ${errors.join('\n  ')}`);
check(
  straightLine.speed >= straightLine.topSpeed * 0.9,
  `only reached ${straightLine.speed} of ${straightLine.topSpeed} on an empty straight`,
);
check(chase.cops >= 2, `rung 2 only fielded ${chase.cops} cars`);
check(chase.contactMs !== null, 'a straight-line runner at rung two was never found at all');
check(
  chase.contactMs === null || chase.contactMs <= 15000,
  `rung two took ${chase.contactMs}ms to make contact — too long to feel hunted`,
);
// Passing traffic can nudge a parked car; what matters is that it stays well under the speed
// at which lying low stops counting.
// Measured baseline on the current physics: about 16% spun and 25% crawling across 36 samples,
// steady over repeated runs. The limits sit above that with headroom so ordinary variation does
// not fail the build, while a real collapse — most of the force sideways, or nobody able to get
// a car up to speed — still trips it.
check(
  pursuitQuality.spun <= pursuitQuality.samples * 0.3,
  `${pursuitQuality.spun} of ${pursuitQuality.samples} pursuer samples were spun out`,
);
check(
  pursuitQuality.crawling <= pursuitQuality.samples * 0.45,
  `${pursuitQuality.crawling} of ${pursuitQuality.samples} pursuer samples were barely moving`,
);
check(
  pursuitQuality.fastest > 300,
  `no pursuer got above ${pursuitQuality.fastest} — the police cannot drive their own car`,
);
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
for (const d of districts) {
  check(!d.spawnSolid, `${d.id} spawns the player inside a wall`);
  check(d.resprays > 0, `${d.id} has no respray bay`);
  check(d.hideouts > 0, `${d.id} has nowhere to lie low`);
  check(d.moved > 50, `${d.id} is not drivable from its spawn`);
  check(d.heatFloor >= 0 && d.ceiling >= d.heatFloor, `${d.id} has an impossible heat range`);
}
check(pauseCheck.clockHeld, 'pausing did not stop the shift clock');
check(pauseCheck.sensitivity === 11, 'the sensitivity slider did not reach the input layer');
check(pauseCheck.padsSwapped, 'mirroring did not move the layout to the other hand');
check(pauseCheck.schemeButtons === 3, `expected 3 control schemes in settings, found ${pauseCheck.schemeButtons}`);
check(pauseCheck.stored, 'settings were never written to storage');
check(resumed.running, 'the clock did not restart after resuming');
check(resumed.minimapDrawn, 'the minimap was never built for this district');
check(topRung.heliActive, 'rung 5 never put a helicopter up');
check(topRung.cops >= 4, `rung 5 only fielded ${topRung.cops} cars`);
// The bug this replaced: audio ran from the simulation loop, so pausing stopped updating it and
// the engine oscillator held its last note. Being still driven is the thing worth asserting.
check(soundPaused.updates > soundDriving.updates, 'audio stopped being driven while paused');
check(soundEnded.updates > soundPaused.updates, 'audio stopped being driven after the shift ended');
check(soundPaused.scene === 'menu', 'a paused game still reports itself as driving');
check(soundEnded.scene === 'menu', 'a finished shift still reports itself as driving');
if (soundDriving.contextState === 'running') {
  check(soundPaused.engine < 0.005, `the engine held a note while paused (gain ${soundPaused.engine})`);
  check(soundEnded.engine < 0.005, `the engine held a note after the shift (gain ${soundEnded.engine})`);
  check(soundPaused.siren < 0.005, `the siren held a note while paused (gain ${soundPaused.siren})`);
}
check(!perf.inSolid, 'the car ended up inside a solid tile');
check(perf.frames > 120, `only ${perf.frames} sim ticks ran`);
// A stray spike is GC; a stream of them is our problem. 8ms leaves room for a slower phone core.
check(perf.spikes <= perf.frames * 0.01, `${perf.spikes} frames over 8ms (worst ${perf.worstMs}ms)`);

if (failures.length > 0) {
  console.error(`\nFAIL:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nharness OK');
