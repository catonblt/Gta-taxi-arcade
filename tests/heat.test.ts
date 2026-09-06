import { describe, expect, it } from 'vitest';
import { Heat, HIDEOUT_SECONDS, MAX_HEAT } from '../src/sim/heat';
import { TileMap, TILE } from '../src/sim/tilemap';
import { FIXED_DT } from '../src/core/loop';

/** A road strip with one hideout bay and one respray bay in known places. */
function cityBlock(): TileMap {
  return new TileMap(
    [
      '########',
      '#......#',
      '#.H..R.#',
      '#......#',
      '########',
    ].join('\n'),
  );
}

const HIDEOUT = { x: 2.5 * TILE, y: 2.5 * TILE, vx: 0, vy: 0, speed: 0 };
const RESPRAY = { x: 5.5 * TILE, y: 2.5 * TILE, vx: 0, vy: 0, speed: 0 };
const STREET = { x: 3.5 * TILE, y: 1.5 * TILE, vx: 200, vy: 0, speed: 200 };

function run(heat: Heat, map: TileMap, seconds: number, at: { x: number; y: number; vx: number; vy: number; speed: number }, seen: boolean): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) heat.step(at, seen, map, FIXED_DT);
}

describe('heat', () => {
  it('accrues whole levels out of fractional crimes', () => {
    const heat = new Heat();
    heat.add(0.4);
    expect(heat.level).toBe(0);
    heat.add(0.7);
    expect(heat.level).toBe(1);
  });

  it('caps at the top rung', () => {
    const heat = new Heat();
    for (let i = 0; i < 40; i++) heat.add(1);
    expect(heat.level).toBe(MAX_HEAT);
  });

  it('keeps the level when they lose sight of you, and drops the pursuit', () => {
    const map = cityBlock();
    const heat = new Heat();
    heat.setLevel(2);
    run(heat, map, 1, STREET, true);
    expect(heat.pursuit).toBe('chase');
    expect(heat.seen).toBe(true);

    run(heat, map, 4, STREET, false);
    expect(heat.pursuit).toBe('search');

    run(heat, map, 12, STREET, false);
    // They stop looking, but you are still wanted for what you did: heat never decays on its own.
    expect(heat.pursuit).toBe('clear');
    expect(heat.level).toBe(2);
  });

  it('remembers where it last saw you, not where you are', () => {
    const map = cityBlock();
    const heat = new Heat();
    heat.setLevel(1);
    run(heat, map, 0.5, STREET, true);
    const seenAt = { x: heat.lastKnownX, y: heat.lastKnownY };

    run(heat, map, 2, { x: STREET.x + 600, y: STREET.y, vx: 200, vy: 0, speed: 200 }, false);
    expect(heat.lastKnownX).toBe(seenAt.x);
    expect(heat.searchErrorTiles({ x: STREET.x + 600, y: STREET.y })).toBeGreaterThan(5);
  });

  it('sheds a level for holding still in a hideout, unseen', () => {
    const map = cityBlock();
    const heat = new Heat();
    heat.setLevel(3);
    run(heat, map, HIDEOUT_SECONDS + 0.2, HIDEOUT, false);
    expect(heat.level).toBe(2);
  });

  it('will not let you hide while they can see you', () => {
    const map = cityBlock();
    const heat = new Heat();
    heat.setLevel(3);
    run(heat, map, HIDEOUT_SECONDS + 1, HIDEOUT, true);
    expect(heat.level).toBe(3);
  });

  it('will not let you hide at speed', () => {
    const map = cityBlock();
    const heat = new Heat();
    heat.setLevel(3);
    run(heat, map, HIDEOUT_SECONDS + 1, { ...HIDEOUT, vx: 220, speed: 220 }, false);
    expect(heat.level).toBe(3);
  });

  it('loses the hold if you pull out early', () => {
    const map = cityBlock();
    const heat = new Heat();
    heat.setLevel(2);
    run(heat, map, HIDEOUT_SECONDS * 0.7, HIDEOUT, false);
    expect(heat.hideoutProgress).toBeGreaterThan(0);
    run(heat, map, 3, STREET, false);
    expect(heat.hideoutProgress).toBe(0);
    expect(heat.level).toBe(2);
  });

  it('clears everything at a respray, but only when stopped on the bay', () => {
    const map = cityBlock();
    const heat = new Heat();
    heat.setLevel(4);
    expect(heat.canRespray(STREET, map)).toBe(false);
    expect(heat.canRespray({ ...RESPRAY, speed: 400 }, map)).toBe(false);
    expect(heat.canRespray(RESPRAY, map)).toBe(true);
    heat.respray();
    expect(heat.level).toBe(0);
    expect(heat.seen).toBe(false);
  });
});
