import { GameLoop } from './core/loop';
import { TouchInput } from './core/input';
import { lerpAngle, lerp, clamp } from './core/math';
import { Rng } from './core/rng';
import docksSource from './data/districts/docks.city?raw';
import { VEHICLES } from './data/vehicles';
import { Car } from './sim/car';
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

function reset(): void {
  car.placeAt(map.spawn.x, map.spawn.y, 0);
  car.damage = 0;
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
});

function update(dt: number): void {
  input.update(dt);
  car.step(input.state, map, dt);
  traffic.step(car.x, car.y, dt);

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
        if (into > 130) fx.sparks(car.x + nx * 16, car.y + ny * 16, 5);
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
  renderer.drawCar(x, y, angle, car.stats.length, car.stats.width, vehicle.color, { headlights: true });
  renderer.endWorld();

  hud.draw(
    {
      speed: car.speed,
      topSpeed: car.stats.topSpeed,
      driftCharge: car.driftCharge,
      drifting: car.drifting,
      fps: loop.stats.fps,
      showDebug: debug,
    },
    input.layout(),
  );
}

const briefing = document.getElementById('briefing');
const startButton = document.getElementById('start');
startButton?.addEventListener('click', () => {
  briefing?.setAttribute('hidden', '');
  // Only start counting the world once the player's hands are on it.
  reset();
});

const loop = new GameLoop(update, render);
loop.start();

window.addEventListener('keydown', (e) => { if (e.code === 'KeyR') reset(); });

// Exposed so the headless harness can drive and inspect a real build.
(window as unknown as Record<string, unknown>).__getaway = { car, map, input, loop, camera, traffic, reset, clamp };
