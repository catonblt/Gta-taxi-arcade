import { describe, expect, it } from 'vitest';
import { Car } from '../src/sim/car';
import { TileMap, TILE } from '../src/sim/tilemap';
import { VEHICLES } from '../src/data/vehicles';
import type { InputState } from '../src/core/input';
import { FIXED_DT } from '../src/core/loop';

function openMap(size = 24): TileMap {
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    rows.push(y === 0 || y === size - 1 ? '#'.repeat(size) : '#' + '.'.repeat(size - 2) + '#');
  }
  return new TileMap(rows.join('\n'));
}

function input(over: Partial<InputState> = {}): InputState {
  return { steer: 0, throttle: 1, brake: 0, drift: false, driftReleased: false, ...over };
}

function run(car: Car, map: TileMap, seconds: number, over: Partial<InputState> = {}): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) car.step(input(over), map, FIXED_DT);
}

describe('car physics', () => {
  it('reaches the top speed printed in its data sheet', () => {
    const map = openMap(64);
    const stats = { ...VEHICLES[0].base };
    const car = new Car(stats);
    car.placeAt(TILE * 2, TILE * 32, 0);
    run(car, map, 6);
    // Within 3% of the advertised figure: the number on the upgrade screen must be the truth.
    expect(car.speed).toBeGreaterThan(stats.topSpeed * 0.97);
    expect(car.speed).toBeLessThan(stats.topSpeed * 1.03);
  });

  it('gets most of the way to top speed inside three seconds', () => {
    const map = openMap(64);
    const stats = { ...VEHICLES[0].base };
    const car = new Car(stats);
    car.placeAt(TILE * 2, TILE * 32, 0);
    run(car, map, 3);
    expect(car.speed).toBeGreaterThan(stats.topSpeed * 0.9);
  });

  it('is deterministic for identical input', () => {
    const map = openMap();
    const a = new Car({ ...VEHICLES[0].base });
    const b = new Car({ ...VEHICLES[0].base });
    a.placeAt(TILE * 5, TILE * 5, 0.3);
    b.placeAt(TILE * 5, TILE * 5, 0.3);
    run(a, map, 2, { steer: 0.6 });
    run(b, map, 2, { steer: 0.6 });
    expect([a.x, a.y, a.angle]).toEqual([b.x, b.y, b.angle]);
  });

  it('slides when drifting and grips when not', () => {
    const map = openMap(64);
    const gripped = new Car({ ...VEHICLES[0].base });
    const sliding = new Car({ ...VEHICLES[0].base });
    gripped.placeAt(TILE * 32, TILE * 32, 0);
    sliding.placeAt(TILE * 32, TILE * 32, 0);
    run(gripped, map, 3);
    run(sliding, map, 3);
    run(gripped, map, 0.8, { steer: 1 });
    run(sliding, map, 0.8, { steer: 1, drift: true });
    // The gripped car should still be pointing roughly where it is going; the drifting one
    // should be visibly sideways. That gap is the whole reason the drift button exists.
    expect(gripped.slipAngle).toBeLessThan(0.2);
    expect(sliding.slipAngle).toBeGreaterThan(0.45);
    expect(sliding.driftCharge).toBeGreaterThan(0.35);
  });

  it('pays out a drift-cancel boost on release', () => {
    const map = openMap(64);
    const car = new Car({ ...VEHICLES[0].base });
    car.placeAt(TILE * 32, TILE * 32, 0);
    run(car, map, 3);
    run(car, map, 0.8, { steer: 1, drift: true });
    const before = car.speed;
    car.step(input({ steer: 1, drift: false, driftReleased: true }), map, FIXED_DT);
    expect(car.events.boosted).toBe(true);
    expect(car.speed).toBeGreaterThan(before);
  });

  it('parks and stays parked while the brake is held', () => {
    const map = openMap(64);
    const car = new Car({ ...VEHICLES[0].base });
    car.placeAt(TILE * 32, TILE * 32, 0);
    run(car, map, 2);
    expect(car.speed).toBeGreaterThan(100);

    // Hold the brake from motion: the car should stop and stay stopped, not roll backwards.
    run(car, map, 4, { throttle: 0, brake: 1 });
    expect(car.speed).toBeLessThan(1);
    const restingX = car.x;
    run(car, map, 3, { throttle: 0, brake: 1 });
    expect(Math.abs(car.x - restingX)).toBeLessThan(1);
  });

  it('reverses when the brake is pressed again from a standstill', () => {
    const map = openMap(64);
    const car = new Car({ ...VEHICLES[0].base });
    car.placeAt(TILE * 32, TILE * 32, 0);
    run(car, map, 2);
    run(car, map, 3, { throttle: 0, brake: 1 });
    const stoppedX = car.x;

    // Release, then press again: now it backs up.
    run(car, map, 0.2, { throttle: 0, brake: 0 });
    run(car, map, 1.2, { throttle: 0, brake: 1 });
    expect(car.x).toBeLessThan(stoppedX - 5);
  });

  it('never leaves the car inside a wall', () => {
    const map = openMap(24);
    const car = new Car({ ...VEHICLES[0].base });
    car.placeAt(TILE * 12, TILE * 12, 0);
    run(car, map, 8); // long enough to slam the far wall at speed
    expect(map.isSolidWorld(car.x, car.y)).toBe(false);
    expect(car.events.impact).toBeGreaterThanOrEqual(0);
  });
});
