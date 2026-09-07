import { describe, expect, it } from 'vitest';
import { Garage, AXES, MAX_LEVEL } from '../src/game/garage';
import { PARTS, partById } from '../src/data/parts';
import { VEHICLES, SLOTS_BY_TIER, vehicleById } from '../src/data/vehicles';

function rich(cash = 500000, rep = 100): Garage {
  const g = new Garage();
  g.cash = cash;
  g.rep = rep;
  return g;
}

describe('garage', () => {
  it('starts with the Beater and nothing else', () => {
    const g = new Garage();
    expect(g.current).toBe(VEHICLES[0].id);
    expect(Object.keys(g.owned)).toEqual([VEHICLES[0].id]);
    expect(g.inventory).toEqual([]);
  });

  it('will not sell you what you cannot afford', () => {
    const g = new Garage();
    g.cash = 10;
    expect(g.upgrade('engine')).toBe(false);
    expect(g.buyVehicle('muscle')).toBe(false);
    expect(g.buyPart('bumper')).toBe(false);
    expect(g.cash).toBe(10);
  });

  it('charges more for each step and stops at the cap', () => {
    const g = rich();
    const first = g.upgradeCost('engine');
    g.upgrade('engine');
    expect(g.upgradeCost('engine')).toBeGreaterThan(first);

    for (let i = 1; i < MAX_LEVEL; i++) g.upgrade('engine');
    expect(g.state.levels.engine).toBe(MAX_LEVEL);
    expect(g.upgradeCost('engine')).toBe(0);
    expect(g.upgrade('engine')).toBe(false);
  });

  it('makes every axis change the car it is meant to change', () => {
    const g = rich();
    const before = g.stats();
    for (let i = 0; i < MAX_LEVEL; i++) g.upgrade('engine');
    const engined = g.stats();
    expect(engined.accel).toBeGreaterThan(before.accel);
    expect(engined.topSpeed).toBeGreaterThan(before.topSpeed);
    expect(engined.grip).toBeCloseTo(before.grip, 5);

    for (let i = 0; i < MAX_LEVEL; i++) g.upgrade('tires');
    expect(g.stats().grip).toBeGreaterThan(engined.grip);
  });

  it('keeps upgrades per car, so a new car is a new project', () => {
    const g = rich();
    for (let i = 0; i < 3; i++) g.upgrade('engine');
    expect(g.state.levels.engine).toBe(3);

    g.buyVehicle('muscle');
    expect(g.current).toBe('muscle');
    expect(g.state.levels.engine).toBe(0);

    g.select('beater');
    expect(g.state.levels.engine).toBe(3);
  });

  it('keeps parts garage-wide, so a new car is not a fresh grind', () => {
    const g = rich();
    g.buyPart('bumper');
    expect(g.togglePart('bumper')).toBe(true);
    expect(g.state.parts).toContain('bumper');

    g.buyVehicle('muscle');
    expect(g.state.parts).toEqual([]);
    // The part is still owned — it just needs bolting onto the new car.
    expect(g.inventory).toContain('bumper');
    expect(g.togglePart('bumper')).toBe(true);
    expect(g.state.parts).toContain('bumper');
  });

  it('respects the slot count for the car it is fitted to', () => {
    const g = rich();
    const slots = SLOTS_BY_TIER[vehicleById(g.current).tier];
    const affordable = PARTS.slice(0, slots + 1);
    for (const part of affordable) g.buyPart(part.id);

    for (let i = 0; i < slots; i++) expect(g.togglePart(affordable[i].id)).toBe(true);
    expect(g.state.parts.length).toBe(slots);
    // One too many.
    expect(g.togglePart(affordable[slots].id)).toBe(false);

    // Take one off and the slot frees up.
    expect(g.togglePart(affordable[0].id)).toBe(true);
    expect(g.togglePart(affordable[slots].id)).toBe(true);
  });

  it('gates parts behind reputation, not just cash', () => {
    const g = rich(500000, 0);
    const gated = PARTS.find((p) => p.rep > 0);
    expect(gated).toBeDefined();
    expect(g.buyPart(gated!.id)).toBe(false);
    g.rep = gated!.rep;
    expect(g.buyPart(gated!.id)).toBe(true);
  });

  it('lets a fitted part actually bend the rules', () => {
    const g = rich();
    expect(g.modifiers().heatGain).toBe(1);
    g.buyPart('plates');
    g.togglePart('plates');
    expect(g.modifiers().heatGain).toBeLessThan(1);

    g.buyPart('turbo');
    const before = g.stats().topSpeed;
    g.togglePart('turbo');
    expect(g.stats().topSpeed).toBeGreaterThan(before);
  });

  it('never lets a part be bought twice', () => {
    const g = rich();
    expect(g.buyPart('bumper')).toBe(true);
    expect(g.buyPart('bumper')).toBe(false);
    expect(g.inventory.filter((p) => p === 'bumper').length).toBe(1);
  });

  it('round-trips a save', () => {
    const g = rich(9000, 30);
    g.upgrade('engine');
    g.upgrade('tires');
    g.buyVehicle('hatch');
    g.buyPart('scanner');
    g.togglePart('scanner');

    const restored = new Garage();
    restored.load(g.save());
    expect(restored.cash).toBe(g.cash);
    expect(restored.rep).toBe(g.rep);
    expect(restored.current).toBe(g.current);
    expect(restored.owned.beater.levels.engine).toBe(1);
    expect(restored.inventory).toEqual(['scanner']);
    expect(restored.state.parts).toEqual(['scanner']);
  });

  it('opens an old save that mentions things this build no longer has', () => {
    const g = rich();
    const data = g.save();
    data.owned.deloreanx = { levels: { engine: 3, tires: 3, suspension: 0, armor: 0 }, parts: ['flux'] };
    data.inventory.push('flux');
    data.current = 'deloreanx';

    const restored = new Garage();
    restored.load(data);
    expect(restored.owned.deloreanx).toBeUndefined();
    expect(restored.inventory).not.toContain('flux');
    expect(restored.owned[restored.current]).toBeDefined();
  });

  it('prices the catalogue so rarity climbs with cost and with rep', () => {
    for (const part of PARTS) {
      expect(partById(part.id)).toBe(part);
      expect(part.price).toBeGreaterThan(0);
    }
    const commons = PARTS.filter((p) => p.rarity === 'common');
    const legendaries = PARTS.filter((p) => p.rarity === 'legendary');
    expect(Math.max(...commons.map((p) => p.price))).toBeLessThan(
      Math.min(...legendaries.map((p) => p.price)),
    );
  });

  it('banks a shift and remembers the best one', () => {
    const g = new Garage();
    g.bank(1200);
    g.bank(400);
    expect(g.cash).toBe(1600);
    expect(g.shifts).toBe(2);
    expect(g.bestShift).toBe(1200);
  });

  it('keeps a maxed Beater a Beater', () => {
    const g = rich();
    for (const axis of AXES) for (let i = 0; i < MAX_LEVEL; i++) g.upgrade(axis);
    const maxedBeater = g.stats();
    // The roster is a set of personalities, not a ladder: full investment in the starter must
    // not overtake a car two tiers above it in a straight line.
    expect(maxedBeater.topSpeed).toBeLessThan(vehicleById('exotic').base.topSpeed);
  });
});
