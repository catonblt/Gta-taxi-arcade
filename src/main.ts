import { GameLoop } from './core/loop';
import { TouchInput } from './core/input';
import { lerpAngle, lerp, clamp } from './core/math';
import { Rng } from './core/rng';
import docksSource from './data/districts/docks.city?raw';
import { VEHICLES } from './data/vehicles';
import { Car } from './sim/car';
import { Heat, HIDEOUT_SECONDS } from './sim/heat';
import { Police } from './sim/police';
import { TileMap } from './sim/tilemap';
import { Traffic } from './sim/traffic';
import { Camera } from './render/camera';
import { Fx } from './render/fx';
import { Hud } from './render/hud';
import { Renderer } from './render/renderer';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new TouchInput(canvas);
const hud = new Hud(renderer);
const camera = new Camera();
const fx = new Fx();
const rng = new Rng(20260906);

const map = new TileMap(docksSource);
const vehicle = VEHICLES[0];
const car = new Car({ ...vehicle.base });
car.placeAt(map.spawn.x, map.spawn.y, 0);
camera.snapTo(car.x, car.y);

const traffic = new Traffic(map, rng, 20);
const heat = new Heat();
const police = new Police(map, rng);

/** Seconds of the BUSTED card before the night restarts. */
const BUST_HOLD = 2.4;
let bustedFor = 0;
let elapsed = 0;

function reset(): void {
  car.placeAt(map.spawn.x, map.spawn.y, 0);
  car.damage = 0;
  heat.reset();
  police.clear();
  bustedFor = 0;
  camera.snapTo(car.x, car.y);
}

function resize(): void {
  renderer.resize();
  camera.resize(renderer.cssWidth, renderer.cssHeight);
  input.resize(renderer.cssWidth, renderer.cssHeight);
}
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);

let debug = new URLSearchParams(location.search).has('debug');
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') debug = !debug;
  // Debug: jump straight to a rung to exercise a doctrine without earning it first.
  const rung = Number(e.key);
  if (debug && rung >= 0 && rung <= 5 && e.key.length === 1) heat.setLevel(rung);
});

function update(dt: number): void {
  elapsed += dt;

  if (bustedFor > 0) {
    bustedFor -= dt;
    if (bustedFor <= 0) reset();
    return;
  }

  input.update(dt);
  car.step(input.state, map, dt);
  traffic.step(car.x, car.y, dt);
  heat.step(car, police.anyoneSees(car.x, car.y), map, dt);
  police.step(car, heat, dt);

  if (police.events.busted) {
    bustedFor = BUST_HOLD;
    return;
  }
  // Ramming a patrol car is its own kind of confession.
  if (police.events.ram > 150) heat.add(0.22);

  // A respray bay is a drive-through: roll in slowly and the plates change. In the shift
  // economy this costs real money, which is what makes running for one a decision.
  if (heat.canRespray(car, map)) {
    heat.respray();
    fx.smoke(car.x, car.y, 0, 0, 14);
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
        heat.add(0.3);
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

function render(alpha: number): void {
  const x = lerp(car.prevX, car.x, alpha);
  const y = lerp(car.prevY, car.y, alpha);
  const angle = lerpAngle(car.prevAngle, car.angle, alpha);

  renderer.beginWorld(camera);
  renderer.drawMap(map, camera);
  fx.draw(renderer.ctx);
  for (const t of traffic.cars) {
    renderer.drawCar(t.x, t.y, t.angle, t.length, t.width, t.color, { headlights: true });
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
  renderer.drawCar(x, y, angle, car.stats.length, car.stats.width, vehicle.color, { headlights: true });
  renderer.endWorld();

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
      pursuers: police.cops.map((cop) => ({
        x: (cop.car.x - camera.x) * camera.scale + renderer.cssWidth / 2,
        y: (cop.car.y - camera.y) * camera.scale + renderer.cssHeight / 2,
      })),
      time: elapsed,
      fps: loop.stats.fps,
      showDebug: debug,
    },
    input.layout(),
  );

  if (bustedFor > 0) drawBusted();
}

const briefing = document.getElementById('briefing');
const startButton = document.getElementById('start');
startButton?.addEventListener('click', () => {
  briefing?.setAttribute('hidden', '');
  // Only start counting the world once the player's hands are on it.
  reset();
});

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
(window as unknown as Record<string, unknown>).__getaway = { car, map, input, loop, camera, traffic, heat, police, reset, clamp };
