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

describe('reverse', () => {
  /** Drives forward, then parks by holding the brake — the state a player reverses out of. */
  function parked(): { car: Car; map: TileMap } {
    const map = openMap(64);
    const car = new Car({ ...VEHICLES[0].base });
    car.placeAt(TILE * 32, TILE * 32, 0);
    run(car, map, 2);
    run(car, map, 3, { throttle: 0, brake: 1 });
    return { car, map };
  }

  it('reverses when the brake is re-pressed after parking, at human speed', () => {
    const { car, map } = parked();
    const restingX = car.x;

    // Let go and press again a fifth of a second later — a normal, deliberate double tap.
    // The car has already rolled away under its own throttle by then, which is exactly the
    // case that used to leave reverse unarmed and made this feel intermittent.
    run(car, map, 0.2, { throttle: 1, brake: 0 });
    run(car, map, 1.2, { throttle: 0, brake: 1 });
    expect(car.x).toBeLessThan(restingX);
  });

  it('reverses on a slower double tap too', () => {
    const { car, map } = parked();
    const restingX = car.x;
    run(car, map, 0.4, { throttle: 1, brake: 0 });
    run(car, map, 1.2, { throttle: 0, brake: 1 });
    expect(car.x).toBeLessThan(restingX);
  });

  it('still just brakes when stopping from speed, rather than lurching backwards', () => {
    const map = openMap(64);
    const car = new Car({ ...VEHICLES[0].base });
    car.placeAt(TILE * 32, TILE * 32, 0);
    run(car, map, 2);
    const movingX = car.x;
    run(car, map, 4, { throttle: 0, brake: 1 });
    expect(car.speed).toBeLessThan(1);
    expect(car.x).toBeGreaterThan(movingX); // it stopped ahead, it did not reverse
  });

  it('does not reverse when braking long after driving away', () => {
    const { car, map } = parked();
    // Drive off properly, then brake somewhere else entirely: that is a stop, not a reverse.
    run(car, map, 2.5, { throttle: 1, brake: 0 });
    const beforeBrake = car.x;
    run(car, map, 1.5, { throttle: 0, brake: 1 });
    expect(car.x).toBeGreaterThan(beforeBrake);
  });
});

/** The slip angle the tyres bite hardest at, mirrored from car.ts for readable assertions. */
const PEAK_SLIP_GUESS = 0.22;

describe('the grip curve', () => {
  /** Brings a car up to speed on open road, ready to be asked for a corner. */
  function rolling(seconds = 3): { car: Car; map: TileMap } {
    const map = openMap(120);
    const car = new Car({ ...VEHICLES[0].base });
    car.placeAt(TILE * 60, TILE * 60, 0);
    run(car, map, seconds);
    return { car, map };
  }

  it('has a limit: gentle cornering holds, but asking for too much breaks traction', () => {
    const map = openMap(120);

    const gentle = new Car({ ...VEHICLES[0].base });
    gentle.placeAt(TILE * 60, TILE * 60, 0);
    run(gentle, map, 3);
    run(gentle, map, 0.8, { steer: 0.35 });

    const greedy = new Car({ ...VEHICLES[0].base });
    greedy.placeAt(TILE * 60, TILE * 60, 0);
    run(greedy, map, 3);
    run(greedy, map, 0.8, { steer: 1 });

    // A flat grip value would give these two the same character, just scaled. A curve means
    // the gentle one stays in the grippy region while the greedy one goes over the peak.
    expect(gentle.slipAngle).toBeLessThan(PEAK_SLIP_GUESS);
    expect(greedy.slipAngle).toBeGreaterThan(gentle.slipAngle * 2);
  });

  it('keeps sliding after the drift button is released, instead of snapping straight', () => {
    const { car, map } = rolling();
    run(car, map, 1, { steer: 1, drift: true });
    const slidingAt = car.slipAngle;
    expect(slidingAt).toBeGreaterThan(0.4);

    // Let go of everything and count how long the car stays genuinely sideways. Under a plain
    // damper this collapsed almost immediately; past the peak the tyres cannot haul it back.
    let stillSliding = 0;
    for (let i = 0; i < Math.round(1.5 / FIXED_DT); i++) {
      car.step(input({ steer: 0 }), map, FIXED_DT);
      if (car.slipAngle > 0.25) stillSliding += FIXED_DT;
    }
    expect(stillSliding).toBeGreaterThan(0.25);
  });

  it('lets countersteer catch a slide faster than holding the turn in', () => {
    const map = openMap(120);

    const held = new Car({ ...VEHICLES[0].base });
    held.placeAt(TILE * 60, TILE * 60, 0);
    run(held, map, 3);
    run(held, map, 1, { steer: 1, drift: true });
    run(held, map, 0.5, { steer: 1 });

    const caught = new Car({ ...VEHICLES[0].base });
    caught.placeAt(TILE * 60, TILE * 60, 0);
    run(caught, map, 3);
    run(caught, map, 1, { steer: 1, drift: true });
    run(caught, map, 0.5, { steer: -1 }); // opposite lock

    expect(caught.slipAngle).toBeLessThan(held.slipAngle);
  });

  it('rotates the car harder when trailing the brake into a corner', () => {
    const map = openMap(120);

    const coasting = new Car({ ...VEHICLES[0].base });
    coasting.placeAt(TILE * 60, TILE * 60, 0);
    run(coasting, map, 3);
    const coastStart = coasting.angle;
    run(coasting, map, 0.5, { steer: 1 });
    const coastTurned = Math.abs(coasting.angle - coastStart);

    const trailing = new Car({ ...VEHICLES[0].base });
    trailing.placeAt(TILE * 60, TILE * 60, 0);
    run(trailing, map, 3);
    const trailStart = trailing.angle;
    run(trailing, map, 0.5, { steer: 1, throttle: 0, brake: 1 });
    const trailTurned = Math.abs(trailing.angle - trailStart);

    // Braking is a cornering tool, not only a way to stop.
    expect(trailTurned).toBeGreaterThan(coastTurned);
  });

  it('makes a maxed grip upgrade genuinely hold a corner the base car cannot', () => {
    const map = openMap(120);
    const base = new Car({ ...VEHICLES[0].base });
    const upgraded = new Car({ ...VEHICLES[0].base, grip: VEHICLES[0].base.grip * 1.45 });
    base.placeAt(TILE * 60, TILE * 60, 0);
    upgraded.placeAt(TILE * 60, TILE * 60, 0);
    run(base, map, 3);
    run(upgraded, map, 3);
    run(base, map, 0.9, { steer: 1 });
    run(upgraded, map, 0.9, { steer: 1 });
    expect(upgraded.slipAngle).toBeLessThan(base.slipAngle);
  });
});

describe('parking in a bay', () => {
  it('stays put when the brake is first pressed while already stopped', () => {
    const map = openMap(64);
    const car = new Car({ ...VEHICLES[0].base });
    car.placeAt(TILE * 32, TILE * 32, 0);

    // Sitting still, as though rolled to a stop in a hideout bay. Pressing the brake here has to
    // mean "stay", not "reverse" — otherwise lying low quietly backs you out of the bay.
    const restingX = car.x;
    run(car, map, 3, { throttle: 0, brake: 1 });
    expect(car.speed).toBeLessThan(1);
    expect(Math.abs(car.x - restingX)).toBeLessThan(1);
  });

  it('still backs out on a deliberate second tap from that same standstill', () => {
    const map = openMap(64);
    const car = new Car({ ...VEHICLES[0].base });
    car.placeAt(TILE * 32, TILE * 32, 0);
    run(car, map, 1, { throttle: 0, brake: 1 });
    const restingX = car.x;

    run(car, map, 0.15, { throttle: 0, brake: 0 });
    run(car, map, 1, { throttle: 0, brake: 1 });
    expect(car.x).toBeLessThan(restingX - 5);
  });
});
