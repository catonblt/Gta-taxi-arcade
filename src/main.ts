import { Audio } from './core/audio';
import { GameLoop } from './core/loop';
import { TouchInput } from './core/input';
import { lerpAngle, lerp, clamp } from './core/math';
import { Rng } from './core/rng';
import { DISTRICTS, districtById, type District } from './data/districts';
import { VEHICLES } from './data/vehicles';
import { PARTS } from './data/parts';
import { Garage } from './game/garage';
import { JOB_KINDS, Jobs } from './game/jobs';
import { clearSave, loadGarage, saveGarage } from './game/save';
import { Shift } from './game/shift';
import { GarageScreen } from './screens/garage';
import { PauseScreen } from './screens/pause';
import { MAX_MULTIPLIER, Style } from './game/style';
import { hideSummary, showSummary } from './screens/summary';
import { Car } from './sim/car';
import { Heat, HIDEOUT_SECONDS } from './sim/heat';
import { Police } from './sim/police';
import { TileMap } from './sim/tilemap';
import { Traffic } from './sim/traffic';
import { Camera } from './render/camera';
import { Fx } from './render/fx';
import { Hud, type HudModel } from './render/hud';
import { Minimap, type MinimapBlip } from './render/minimap';
import { Renderer } from './render/renderer';

type HudMarker = HudModel['markers'][number];

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new TouchInput(canvas);
const hud = new Hud(renderer);
const camera = new Camera();
const fx = new Fx();
const minimap = new Minimap();
let minimapReady = false;
const rng = new Rng(20260906);

const garage = new Garage();
loadGarage(garage);
const shift = new Shift(garage);
const heat = new Heat();
const car = new Car({ ...VEHICLES[0].base });

// The world is rebuilt per shift, because the district decides the map, the streets, and the
// police who work them. Everything downstream reads these through the current bindings.
let district: District = districtById(garage.district);
let map = new TileMap(district.source);
let traffic = new Traffic(map, rng, district.traffic);
let police = new Police(map, rng);
let jobs = new Jobs(map, rng, traffic);

car.placeAt(map.spawn.x, map.spawn.y, 0);
camera.snapTo(car.x, car.y);
minimap.build(map);
const style = new Style();
const garageScreen = new GarageScreen(garage, () => startShift(), () => saveGarage(garage));
const audio = new Audio();

let paused = false;
const pauseScreen = new PauseScreen(input.settings, audio, {
  onResume: () => togglePause(),
  onAbandon: () => { pauseScreen.hide(); paused = false; endShift(false); },
  onWipe: () => {
    clearSave();
    location.reload();
  },
  onSettingsChanged: () => saveSettings(),
});

/** Band around a car that counts as threading it: closer than this and you have hit it. */
const SHAVE_INNER = 30;
const SHAVE_OUTER = 50;
const SHAVE_MIN_SPEED = 150;
const SHAVE_COOLDOWN = 1.2;

/** Seconds of the BUSTED card before the summary appears. */
const BUST_HOLD = 1.8;
let bustedFor = 0;
let elapsed = 0;

/** Transient one-liners: what just happened, gone in a couple of seconds. */
const TOAST_SECONDS = 2;
let toastText = '';
let toastColor = '#e8eaee';
let toastLeft = 0;

/**
 * Haptics through the standard vibration API rather than a plugin, so it works identically in a
 * phone browser and inside the packaged app. Silently absent on devices that do not do this.
 */
function rumble(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers throw rather than no-op. Not worth a single dropped frame.
  }
}

function toast(text: string, color: string): void {
  toastText = text;
  toastColor = color;
  toastLeft = TOAST_SECONDS;
}

const SETTINGS_KEY = 'getaway.settings.v1';

function saveSettings(): void {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...input.settings, muted: audio.muted }),
    );
  } catch {
    // Storage refused; the choices simply will not survive a reload.
  }
}

function loadSettings(): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as {
      sensitivity?: number;
      mirrored?: boolean;
      scheme?: string;
      muted?: boolean;
    };
    if (typeof data.sensitivity === 'number') input.settings.sensitivity = clamp(data.sensitivity, 3, 12);
    if (typeof data.mirrored === 'boolean') input.settings.mirrored = data.mirrored;
    if (data.scheme === 'split' || data.scheme === 'halves' || data.scheme === 'oneThumb') {
      input.settings.scheme = data.scheme;
    }
    if (data.muted) audio.setMuted(true);
  } catch {
    // A corrupt settings blob is not worth refusing to start over.
  }
}
loadSettings();

/** Stops the clock without ending the night. A phone call is not a reason to lose a shift. */
function togglePause(): void {
  if (shift.state !== 'running') return;
  paused = !paused;
  if (paused) pauseScreen.show();
  else {
    pauseScreen.hide();
    pauseScreen.setDriving(true);
  }
}

function reset(): void {
  car.placeAt(map.spawn.x, map.spawn.y, 0);
  car.damage = 0;
  heat.reset();
  police.clear();
  jobs.reset();
  style.reset();
  traffic.clear();
  car.repairTires();
  bustedFor = 0;
  camera.snapTo(car.x, car.y);
}

/**
 * Pushes the garage build into the simulation. Every part is a rule change somewhere in here —
 * nothing on the parts list is decoration.
 */
function applyBuild(): void {
  const m = garage.modifiers();
  buildMods = m;
  car.stats = garage.stats();
  car.driftBoostScale = m.driftBoost;
  police.sightDelay = m.sightDelay;
  jobs.fareScale = m.fareTime;
  style.ceiling = m.maxMultiplier;
}

function startShift(): void {
  hideSummary();
  garageScreen.hide();

  // Rebuild the world for the chosen district before anything reads it.
  district = districtById(garage.district);
  map = new TileMap(district.source);
  traffic = new Traffic(map, rng, district.traffic);
  police = new Police(map, rng);
  jobs = new Jobs(map, rng, traffic);
  minimap.build(map);
  minimapReady = true;

  applyBuild();
  reset();
  heat.ceiling = district.maxHeat;
  heat.setLevel(district.heatFloor);
  shift.start();
  paused = false;
  pauseScreen.hide();
  pauseScreen.setDriving(true);
}

function endShift(busted: boolean): void {
  paused = false;
  pauseScreen.hide();
  pauseScreen.setDriving(false);
  shift.peakMultiplier = style.peak;
  if (busted) shift.busted(heat.level > 0, jobs.completed, jobs.blown);
  else shift.clockOut(jobs.completed, jobs.blown);

  // Rep is earned by variety and by driving well, never by grinding the same easy fare: it is
  // what opens the better parts, and later the harder districts.
  const earnedRep = jobs.completed * 2 + Math.round((style.peak - 1) * 2);
  garage.rep += earnedRep;
  saveGarage(garage);

  if (shift.summary) showSummary(shift.summary, garage.cash, earnedRep);
}

/** Reads the device's safe insets off the CSS probe in index.html. */
function safeArea() {
  const probe = document.getElementById('safe-area');
  if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
  const style = getComputedStyle(probe);
  return {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
}

function resize(): void {
  renderer.resize();
  camera.resize(renderer.cssWidth, renderer.cssHeight);
  input.resize(renderer.cssWidth, renderer.cssHeight, safeArea());
}
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);

let debug = new URLSearchParams(location.search).has('debug');
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') debug = !debug;
  if (e.code === 'KeyM') { audio.setMuted(!audio.muted); saveSettings(); }
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  // Debug: jump straight to a rung to exercise a doctrine without earning it first.
  const rung = Number(e.key);
  if (debug && rung >= 0 && rung <= 5 && e.key.length === 1) heat.setLevel(rung);
});

function update(dt: number): void {
  elapsed += dt;

  if (bustedFor > 0) {
    bustedFor -= dt;
    if (bustedFor <= 0) endShift(true);
    return;
  }
  if (shift.state !== 'running' || paused) return;

  shift.step(dt);
  if (shift.expired) { endShift(false); return; }

  input.update(dt);
  car.step(input.state, map, dt);
  traffic.step(car.x, car.y, dt);
  heat.step(car, police.anyoneSees(car.x, car.y, dt), map, dt);
  police.step(car, heat, dt);

  if (police.events.busted) {
    bustedFor = BUST_HOLD;
    rumble([40, 60, 120]);
    return;
  }

  stepStyle(dt);

  jobs.step(car, heat, dt);
  toastLeft = Math.max(0, toastLeft - dt);
  if (jobs.events.accepted) {
    toast(`${JOB_KINDS[jobs.events.accepted.kind].label} taken`, jobs.events.accepted.tier.color);
  }
  if (jobs.events.completed) {
    // Style is money: arriving mid-combo is worth multiples of arriving cold.
    const paid = Math.round(jobs.events.paid * style.multiplier * buildMods.payout * district.payout);
    shift.bookJob(jobs.events.completed, paid);
    toast(`Paid $${paid.toLocaleString('en-US')}`, '#5adca0');
    audio.chime();
    fx.sparks(car.x, car.y, 16);
  }
  if (jobs.events.failed) toast(jobs.events.failed.failReason, '#d83a44');
  if (heat.events.cooled) toast('Lost a level', '#a882f0');
  // A wall hit is what ruins a courier run — the load, not the car, is what you are paid for.
  if (car.events.impact > 90) jobs.damageCargo(car.events.impact * buildMods.cargoDamage);
  // Ramming a patrol car is its own kind of confession.
  if (police.events.ram > 150) heat.add(0.22 * buildMods.heatGain);

  // A respray bay is a drive-through: roll in slowly and the plates change. In the shift
  // economy this costs real money, which is what makes running for one a decision.
  if (heat.canRespray(car, map)) {
    heat.respray();
    // New plates and new rubber: the bay is the answer to a shredded set of tyres too.
    car.repairTires();
    fx.smoke(car.x, car.y, 0, 0, 14);
  }

  if (police.events.spiked && !car.tiresShredded) {
    car.tiresShredded = true;
    toast('Tyres gone', '#d83a44');
    audio.thud(1);
    rumble(60);
    fx.sparks(car.x, car.y, 18);
  }
  if (police.events.roadblockHit > 120) fx.sparks(car.x, car.y, 12);

  // Traffic is soft-bodied against the player: a shunt shoves it aside and costs you speed,
  // rather than stopping the run dead. Hitting walls is the real punishment.
  for (const t of traffic.cars) {
    const dx = t.x - car.x;
    const dy = t.y - car.y;
    const dist = Math.hypot(dx, dy);
    const minDist = (t.length + car.stats.length) * 0.38;
    if (dist > 0.001 && dist < minDist) {
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;
      t.x += nx * overlap;
      t.y += ny * overlap;
      car.x -= nx * overlap * 0.35;
      car.y -= ny * overlap * 0.35;
      const into = car.vx * nx + car.vy * ny;
      if (into > 0) {
        car.vx -= into * nx * 0.55;
        car.vy -= into * ny * 0.55;
        if (into > 130) {
        fx.sparks(car.x + nx * 16, car.y + ny * 16, 5);
          // Driving through the traffic rather than around it is how a quiet night ends.
        heat.add(0.3 * buildMods.heatGain * buildMods.trafficHeat);
        jobs.damageCargo(into * buildMods.cargoDamage);
        if (traffic.damage(t, into)) {
          jobs.countWreck();
          fx.sparks(t.x, t.y, 14);
          heat.add(0.35 * buildMods.heatGain * buildMods.trafficHeat);
        }
      }
      }
    }
  }

  if (car.drifting && car.slipAngle > 0.25 && car.speed > 90) {
    fx.smoke(car.x - Math.cos(car.angle) * 14, car.y - Math.sin(car.angle) * 14, car.vx, car.vy, 1);
    fx.skid(car.x - Math.cos(car.angle) * 14, car.y - Math.sin(car.angle) * 14, car.angle);
  }
  if (car.events.impact > 70) {
    fx.sparks(car.x, car.y, 8);
  }

  fx.step(dt);
  camera.follow(car.x, car.y, car.vx, car.vy, car.stats.topSpeed, dt);
}

/** Distance to the nearest pursuer, for a siren that gets louder as they close. */
function nearestCopDistance(): number {
  let nearest = Infinity;
  for (const cop of police.cops) {
    const d = Math.hypot(cop.car.x - car.x, cop.car.y - car.y);
    if (d < nearest) nearest = d;
  }
  return nearest;
}

/**
 * Audio is presentation, so it runs from the render loop rather than the simulation. Driving it
 * from `update` meant that pausing — which stops the simulation — left the engine holding its
 * last note indefinitely, and the same on any screen that ended the shift.
 */
let lastAudioTime = 0;

function updateAudio(): void {
  const now = performance.now();
  // Real elapsed time, clamped: a backgrounded tab must not hand the siren a half-second step.
  const dt = lastAudioTime === 0 ? 1 / 60 : clamp((now - lastAudioTime) / 1000, 0, 0.1);
  lastAudioTime = now;

  const driving = shift.state === 'running' && !paused && bustedFor <= 0;
  audio.update(
    {
      speedRatio: car.speed / car.stats.topSpeed,
      onThrottle: input.state.throttle > 0,
      chase: heat.seen,
      copDistance: driving ? nearestCopDistance() : Infinity,
      heat: heat.level,
      scene: driving ? 'driving' : 'menu',
    },
    dt,
  );
}

function render(alpha: number): void {
  updateAudio();
  const x = lerp(car.prevX, car.x, alpha);
  const y = lerp(car.prevY, car.y, alpha);
  const angle = lerpAngle(car.prevAngle, car.angle, alpha);

  renderer.beginWorld(camera);
  renderer.drawMap(map, camera);
  fx.draw(renderer.ctx);
  for (const t of traffic.cars) {
    const marked = jobs.active?.target === t;
    renderer.drawCar(
      t.x, t.y, t.angle, t.length, t.width,
      t.wrecked ? '#3a3a3a' : marked ? '#e8d44a' : t.color,
      { headlights: !t.wrecked },
    );
  }
  const heli = police.helicopter;
  if (heli.active) {
    // The light lands on the ground, and the machine sits above it.
    renderer.ctx.beginPath();
    renderer.ctx.arc(heli.x, heli.y, 320, 0, Math.PI * 2);
    renderer.ctx.fillStyle = 'rgba(255,240,190,0.07)';
    renderer.ctx.fill();
  }
  for (const strip of police.strips) {
    if (strip.spent) continue;
    renderer.ctx.save();
    renderer.ctx.translate(strip.x, strip.y);
    renderer.ctx.rotate(strip.angle);
    renderer.ctx.fillStyle = '#d8d0c0';
    renderer.ctx.fillRect(-strip.reach, -4, strip.reach * 2, 8);
    renderer.ctx.fillStyle = '#20262f';
    for (let i = -strip.reach + 6; i < strip.reach; i += 11) renderer.ctx.fillRect(i, -6, 3, 12);
    renderer.ctx.restore();
  }
  for (const block of police.roadblocks) {
    for (const parked of block.cars) {
      renderer.drawCar(parked.x, parked.y, parked.angle, parked.stats.length, parked.stats.width, '#1e2530', { roofLight: elapsed });
    }
  }
  for (const cop of police.cops) {
    const c = cop.car;
    renderer.drawCar(
      lerp(c.prevX, c.x, alpha), lerp(c.prevY, c.y, alpha), lerpAngle(c.prevAngle, c.angle, alpha),
      c.stats.length, c.stats.width, '#20262f', { headlights: true, roofLight: elapsed },
    );
  }
  renderer.drawCar(x, y, angle, car.stats.length, car.stats.width, garage.vehicle.color, { headlights: true, player: true });
  if (heli.active) {
    renderer.drawCar(heli.x, heli.y, elapsed * 0.6, 46, 16, '#161b22', { roofLight: elapsed });
  }
  renderer.endWorld();

  // The map answers "where can I go", which the edge arrows cannot: they only say where things
  // are, never whether there is a road between here and there.
  const blips: MinimapBlip[] = [];
  for (const marker of map.markers) {
    blips.push({ x: marker.x, y: marker.y, color: marker.kind === 'respray' ? '#5adca0' : '#a882f0' });
  }
  for (const offer of jobs.offers) {
    blips.push({ x: offer.pickupX, y: offer.pickupY, color: offer.tier.color, important: true });
  }
  const objective = jobs.objective();
  if (objective) blips.push({ x: objective.x, y: objective.y, color: jobs.active?.tier.color ?? '#5adca0', important: true });
  if (heat.seen || buildMods.alwaysShowPursuers) {
    for (const cop of police.cops) blips.push({ x: cop.car.x, y: cop.car.y, color: '#d83a44', important: true });
  }
  const safe = safeArea();
  minimap.draw(renderer, x, y, angle, blips, safe.top, safe.right);

  hud.draw(
    {
      speed: car.speed,
      topSpeed: car.stats.topSpeed,
      driftCharge: car.driftCharge,
      drifting: car.drifting,
      heatLevel: heat.level,
      seen: heat.seen,
      pursuit: heat.pursuit,
      hideoutProgress: heat.hideoutProgress / HIDEOUT_SECONDS,
      canRespray: heat.canRespray(car, map),
      markers: buildMarkers(),
      toast: toastLeft > 0 ? { text: toastText, color: toastColor, alpha: Math.min(1, toastLeft / 0.5) } : null,
      multiplier: style.multiplier,
      styleEvent: style.events.last,
      timeLeft: shift.timeLeft,
      cash: shift.pending,
      job: buildJobBanner(),
      // Without a scanner you only see them once they have seen you: the badge and the arrows
      // tell the same story, and buying the part is buying the story earlier.
      pursuers: (heat.seen || buildMods.alwaysShowPursuers ? police.cops : []).map((cop) => ({
        x: (cop.car.x - camera.x) * camera.scale + renderer.cssWidth / 2,
        y: (cop.car.y - camera.y) * camera.scale + renderer.cssHeight / 2,
      })),
      district: district.name,
      // Named for the first few seconds of a shift, then out of the way.
      controlLabelAlpha: clamp(1 - (shift.elapsed - 5) / 3, 0, 1),
      topOffset: minimap.box(renderer, safe.top, safe.right).size + safe.top + 22,
      tiresShredded: car.tiresShredded,
      time: elapsed,
      fps: loop.stats.fps,
      showDebug: debug,
    },
    input.hint(),
  );

  if (bustedFor > 0) drawBusted();
}

const briefing = document.getElementById('briefing');
const startButton = document.getElementById('start');
startButton?.addEventListener('click', () => {
  briefing?.setAttribute('hidden', '');
  // A real user gesture is the only moment a browser will let the audio context open.
  audio.start();
  // A returning player has something to spend; a new one has nothing to look at yet.
  if (garage.cash > 0 || garage.rep > 0) garageScreen.show();
  else startShift();
});
document.getElementById('again')?.addEventListener('click', () => {
  hideSummary();
  garageScreen.show();
});

/**
 * The flourishes: threading traffic, holding a slide, and a pursuer committing to a ram and
 * getting nothing. Each pays immediately and lifts the multiplier; a real crash takes it away.
 */
/** Rebuilt once per shift by applyBuild, read every frame by the rules below. */
let buildMods = garage.modifiers();

function stepStyle(dt: number): void {
  style.step(dt);

  if (car.drifting && car.slipAngle > 0.3 && car.speed > 120) style.drifting(dt);

  for (const t of traffic.cars) {
    t.shaveCooldown = Math.max(0, t.shaveCooldown - dt);
    if (t.wrecked || t.shaveCooldown > 0 || car.speed < SHAVE_MIN_SPEED) continue;
    const d = Math.hypot(t.x - car.x, t.y - car.y);
    if (d > SHAVE_INNER && d < SHAVE_OUTER) {
      style.closeShave();
      t.shaveCooldown = SHAVE_COOLDOWN;
    }
  }

  for (const cop of police.cops) {
    cop.shaveCooldown = Math.max(0, cop.shaveCooldown - dt);
    if (cop.shaveCooldown > 0 || police.events.ram > 0) continue;
    const d = Math.hypot(cop.car.x - car.x, cop.car.y - car.y);
    // A pursuer this close, this fast, that failed to make contact, has just been dodged.
    if (d > SHAVE_INNER && d < SHAVE_OUTER + 14 && cop.car.speed > 180 && car.speed > SHAVE_MIN_SPEED) {
      style.copDodge();
      cop.shaveCooldown = 1.6;
    }
  }

  const ram = police.events.ram * buildMods.ramTaken;
  const worstImpact = Math.max(car.events.impact, ram, police.events.roadblockHit);
  if (worstImpact > 60) audio.thud(Math.min(1, worstImpact / 320));
  if (worstImpact > 150) rumble(Math.min(40, Math.round(worstImpact / 8)));
  // A PIT bar means trading paint with a cruiser costs you nothing but the paint.
  const comboImpact = buildMods.ramKeepsCombo ? Math.max(car.events.impact, police.events.roadblockHit) : worstImpact;
  if (style.impact(comboImpact)) toast('Combo lost', '#d83a44');

  if (style.events.tip > 0) shift.tip(style.events.tip * buildMods.payout * district.payout);
}

function toScreen(wx: number, wy: number): { x: number; y: number } {
  return {
    x: (wx - camera.x) * camera.scale + renderer.cssWidth / 2,
    y: (wy - camera.y) * camera.scale + renderer.cssHeight / 2,
  };
}

function buildMarkers(): HudMarker[] {
  const markers: HudMarker[] = [];
  const objective = jobs.objective();
  if (objective) {
    const p = toScreen(objective.x, objective.y);
    markers.push({ ...p, color: jobs.active?.tier.color ?? '#5adca0', label: objective.label, objective: true });
  }
  for (const offer of jobs.offers) {
    const p = toScreen(offer.pickupX, offer.pickupY);
    markers.push({ ...p, color: offer.tier.color, label: `$${offer.payout}`, objective: false });
  }
  return markers;
}

function buildJobBanner(): HudModel['job'] {
  const job = jobs.active;
  if (!job) return null;
  const definition = JOB_KINDS[job.kind];
  const progress =
    job.kind === 'frenzy'
      ? `${job.wrecksDone} of ${job.wrecksNeeded} wrecked`
      : job.kind === 'courier'
        ? `Load ${Math.round(job.cargo * 100)}%`
        : definition.brief;
  return {
    label: definition.label,
    brief: definition.brief,
    payout: job.payout,
    fareLeft: job.fareLeft,
    fareTotal: job.fareTotal,
    color: job.tier.color,
    progress,
  };
}

function drawBusted(): void {
  const ctx = renderer.ctx;
  ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
  ctx.fillStyle = 'rgba(11,13,16,0.82)';
  ctx.fillRect(0, 0, renderer.cssWidth, renderer.cssHeight);
  ctx.fillStyle = '#c8323c';
  ctx.font = '900 54px "Big Shoulders Display", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BUSTED', renderer.cssWidth / 2, renderer.cssHeight / 2 - 12);
  ctx.fillStyle = 'rgba(230,234,238,0.7)';
  ctx.font = '400 13px ui-monospace, monospace';
  ctx.fillText('They boxed you in.', renderer.cssWidth / 2, renderer.cssHeight / 2 + 26);
}

const loop = new GameLoop(update, render);
loop.start();

window.addEventListener('keydown', (e) => { if (e.code === 'KeyR') reset(); });

// Exposed so the headless harness can drive and inspect a real build.
(window as unknown as Record<string, unknown>).__getaway = { car, input, loop, camera, heat, shift, garage, garageScreen, style, audio, startShift, reset, togglePause, clamp, MAX_MULTIPLIER,
  get minimapReady() { return minimapReady; },
  get traffic() { return traffic; }, get police() { return police; }, get jobs() { return jobs; },
  get map() { return map; }, get district() { return district; }, districts: DISTRICTS, vehicles: VEHICLES, parts: PARTS };
