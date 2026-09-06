import { describe, expect, it } from 'vitest';
import { DISTRICTS, districtById, unlockedDistricts } from '../src/data/districts';
import { TileMap, Tile } from '../src/sim/tilemap';
import { PARTS } from '../src/data/parts';
import { DOCTRINE } from '../src/sim/police';
import { MAX_HEAT } from '../src/sim/heat';

describe('districts', () => {
  it('gets harder and pays more the further up you go', () => {
    for (let i = 1; i < DISTRICTS.length; i++) {
      expect(DISTRICTS[i].rep).toBeGreaterThan(DISTRICTS[i - 1].rep);
      expect(DISTRICTS[i].payout).toBeGreaterThan(DISTRICTS[i - 1].payout);
      expect(DISTRICTS[i].maxHeat).toBeGreaterThanOrEqual(DISTRICTS[i - 1].maxHeat);
      expect(DISTRICTS[i].heatFloor).toBeGreaterThanOrEqual(DISTRICTS[i - 1].heatFloor);
    }
  });

  it('opens the first district to a player with nothing', () => {
    expect(DISTRICTS[0].rep).toBe(0);
    expect(unlockedDistricts(0).length).toBe(1);
    expect(unlockedDistricts(9999).length).toBe(DISTRICTS.length);
  });

  it('gives every district somewhere to spawn, respray and hide', () => {
    for (const district of DISTRICTS) {
      const map = new TileMap(district.source);
      expect(map.width).toBeGreaterThan(40);
      expect(map.atWorld(map.spawn.x, map.spawn.y)).not.toBe(Tile.Building);
      expect(map.isSolidWorld(map.spawn.x, map.spawn.y)).toBe(false);
      expect(map.markers.filter((m) => m.kind === 'respray').length).toBeGreaterThan(0);
      // Without somewhere to lie low there is no way to shed heat except paying for it.
      expect(map.markers.filter((m) => m.kind === 'hideout').length).toBeGreaterThan(0);
    }
  });

  it('walls every district in, so nobody drives off the edge of the world', () => {
    for (const district of DISTRICTS) {
      const map = new TileMap(district.source);
      for (let x = 0; x < map.width; x++) {
        expect(map.isSolid(x, 0)).toBe(true);
        expect(map.isSolid(x, map.height - 1)).toBe(true);
      }
      for (let y = 0; y < map.height; y++) {
        expect(map.isSolid(0, y)).toBe(true);
        expect(map.isSolid(map.width - 1, y)).toBe(true);
      }
    }
  });

  it('falls back to the first district for an unknown id', () => {
    expect(districtById('atlantis').id).toBe(DISTRICTS[0].id);
  });

  it('has enough open road to be worth driving', () => {
    for (const district of DISTRICTS) {
      const map = new TileMap(district.source);
      let drivable = 0;
      for (let i = 0; i < map.tiles.length; i++) {
        if (map.tiles[i] !== Tile.Building && map.tiles[i] !== Tile.Water) drivable++;
      }
      const share = drivable / map.tiles.length;
      expect(share).toBeGreaterThan(0.25);
      expect(share).toBeLessThan(0.85);
    }
  });
});

describe('the ladder', () => {
  it('adds a new tactic at every rung rather than another car', () => {
    for (let level = 1; level <= MAX_HEAT; level++) {
      const rung = DOCTRINE[level];
      const below = DOCTRINE[level - 1];
      expect(rung.cars).toBeGreaterThan(below.cars);
      const tactics = (d: typeof rung) =>
        Number(d.intercept) + Number(d.roadblocks) + Number(d.spikes) + Number(d.helicopter) + Number(d.interceptors);
      // Every rung either introduces a tactic or is the last one, where the count is already full.
      expect(tactics(rung)).toBeGreaterThanOrEqual(tactics(below));
    }
    expect(DOCTRINE[MAX_HEAT].helicopter).toBe(true);
    expect(DOCTRINE[1].helicopter).toBe(false);
  });

  it('keeps the part shelf in step with the districts', () => {
    // Nothing should be reachable before the district that makes it necessary.
    const legendary = PARTS.filter((p) => p.rarity === 'legendary');
    expect(Math.min(...legendary.map((p) => p.rep))).toBeGreaterThan(DISTRICTS[2].rep);
  });
});
