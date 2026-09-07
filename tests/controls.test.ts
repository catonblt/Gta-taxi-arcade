import { describe, expect, it } from 'vitest';
import { Controls, SCHEMES, type SchemeId } from '../src/core/controls';
import { FIXED_DT } from '../src/core/loop';

const W = 412;
const H = 892;

function controls(scheme: SchemeId, mirrored = false): Controls {
  const c = new Controls();
  c.settings.scheme = scheme;
  c.settings.mirrored = mirrored;
  c.resize(W, H);
  return c;
}

function settle(c: Controls, seconds = 0.4): void {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) c.update(FIXED_DT);
}

/** The bottom of the screen, where thumbs actually are. */
const LOW = H * 0.85;

describe('split hands', () => {
  it('steers right and drifts at the same time, on different thumbs', () => {
    const c = controls('split');
    // Left thumb lands in the steering half and slides right.
    c.down(1, 100, LOW);
    c.move(1, 100 + 400, LOW);
    // Right thumb holds the drift side.
    c.down(2, 330, H * 0.55);
    settle(c);

    expect(c.state.steer).toBeGreaterThan(0.9);
    expect(c.state.drift).toBe(true);
    // This is the whole point: the old scheme could not produce these two together.
    expect(c.state.throttle).toBe(1);
  });

  it('steers left and drifts at the same time', () => {
    const c = controls('split');
    c.down(1, 160, LOW);
    c.move(1, 160 - 400, LOW);
    c.down(2, 330, H * 0.55);
    settle(c);
    expect(c.state.steer).toBeLessThan(-0.9);
    expect(c.state.drift).toBe(true);
  });

  it('is analog: sliding half as far turns half as hard', () => {
    const c = controls('split');
    const travelish = 90;
    c.down(1, 120, LOW);
    c.move(1, 120 + travelish, LOW);
    settle(c, 0.6);
    const partial = c.state.steer;
    expect(partial).toBeGreaterThan(0.1);
    expect(partial).toBeLessThan(0.95);

    c.move(1, 120 + travelish * 3, LOW);
    settle(c, 0.6);
    expect(c.state.steer).toBeGreaterThan(partial);
  });

  it('centres when the steering thumb lifts', () => {
    const c = controls('split');
    c.down(1, 120, LOW);
    c.move(1, 420, LOW);
    settle(c);
    expect(c.state.steer).toBeGreaterThan(0.5);
    c.up(1);
    settle(c, 0.6);
    expect(Math.abs(c.state.steer)).toBeLessThan(0.02);
  });

  it('reverses immediately after the thumb has run past full lock', () => {
    const c = controls('split');
    c.down(1, 60, LOW);
    c.move(1, 60 + 900, LOW); // far beyond full lock
    settle(c);
    expect(c.state.steer).toBeCloseTo(1, 1);

    // Coming back a short way must start unwinding at once, not eat the overshoot first.
    c.move(1, 60 + 900 - 60, LOW);
    settle(c, 0.3);
    expect(c.state.steer).toBeLessThan(0.95);
  });

  it('mirrors the whole layout, steering on the right and actions on the left', () => {
    const c = controls('split', true);
    // Right thumb steers now.
    c.down(1, W - 60, LOW);
    c.move(1, W - 60 - 400, LOW);
    // Left thumb drifts.
    c.down(2, 60, H * 0.55);
    settle(c);
    expect(c.state.steer).toBeLessThan(-0.9);
    expect(c.state.drift).toBe(true);
  });

  it('keeps the brake off the drift zone', () => {
    const c = controls('split');
    const brake = c.hint().pads.find((p) => p.label === 'BRAKE');
    expect(brake).toBeDefined();
    c.down(1, brake!.x, brake!.y);
    settle(c);
    expect(c.state.brake).toBe(1);
    expect(c.state.drift).toBe(false);
    expect(c.state.throttle).toBe(0);
  });

  it('ignores touches up in the HUD', () => {
    const c = controls('split');
    c.down(1, 100, 20);
    c.move(1, 400, 20);
    settle(c);
    expect(c.state.steer).toBe(0);
    expect(c.state.drift).toBe(false);
  });
});

describe('screen halves', () => {
  it('puts drift and brake in the centre, off both steering halves', () => {
    const c = controls('halves');
    const drift = c.hint().pads.find((p) => p.label === 'DRIFT')!;
    const brake = c.hint().pads.find((p) => p.label === 'BRAKE')!;
    // Both pads must sit near the middle, reachable by whichever thumb is not steering.
    expect(Math.abs(drift.x - W / 2)).toBeLessThan(W * 0.3);
    expect(Math.abs(brake.x - W / 2)).toBeLessThan(W * 0.3);

    // Steer right with one thumb, drift with the other.
    c.down(1, W - 40, LOW);
    c.down(2, drift.x, drift.y);
    settle(c);
    expect(c.state.steer).toBeGreaterThan(0.9);
    expect(c.state.drift).toBe(true);
  });

  it('still steers by which half is held', () => {
    const c = controls('halves');
    c.down(1, 40, H * 0.6);
    settle(c);
    expect(c.state.steer).toBeLessThan(-0.9);
  });
});

describe('one thumb', () => {
  it('breaks traction when the turn is committed to, with no drift button', () => {
    const c = controls('oneThumb');
    c.down(1, W / 2, H * 0.6);
    c.move(1, W / 2 + 40, H * 0.6);
    settle(c, 0.6);
    expect(c.state.steer).toBeGreaterThan(0);
    expect(c.state.drift).toBe(false);

    c.move(1, W / 2 + 600, H * 0.6);
    settle(c, 0.6);
    expect(c.state.steer).toBeGreaterThan(0.85);
    expect(c.state.drift).toBe(true);
  });

  it('offers a brake without needing a second hand for anything else', () => {
    const c = controls('oneThumb');
    expect(c.hint().pads.some((p) => p.label === 'BRAKE')).toBe(true);
  });
});

describe('every scheme', () => {
  it('never lets steering and drift need the same thumb', () => {
    for (const scheme of SCHEMES) {
      const c = controls(scheme.id);
      // Drive steering to full lock however this scheme does it, then ask for drift.
      c.down(1, scheme.id === 'halves' ? W - 30 : 90, LOW);
      c.move(1, scheme.id === 'halves' ? W - 30 : 90 + 500, LOW);
      settle(c);
      expect(Math.abs(c.state.steer)).toBeGreaterThan(0.9);

      const drift = c.hint().pads.find((p) => p.label === 'DRIFT');
      const zone = c.hint().zones.find((z) => z.label === 'DRIFT');
      if (drift) {
        c.down(2, drift.x, drift.y);
      } else if (zone) {
        c.down(2, zone.x + zone.w / 2, zone.y + zone.h / 2);
      }
      settle(c, 0.2);

      // One-thumb drifts from the steering itself; the others must manage it on a second thumb.
      expect(c.state.drift).toBe(true);
      expect(Math.abs(c.state.steer)).toBeGreaterThan(0.9);
    }
  });

  it('keeps the throttle on unless the brake is held', () => {
    for (const scheme of SCHEMES) {
      const c = controls(scheme.id);
      settle(c, 0.1);
      expect(c.state.throttle).toBe(1);
      const brake = c.hint().pads.find((p) => p.label === 'BRAKE')!;
      c.down(9, brake.x, brake.y);
      settle(c, 0.1);
      expect(c.state.throttle).toBe(0);
      expect(c.state.brake).toBe(1);
    }
  });

  it('forgets every finger when the window loses focus', () => {
    const c = controls('split');
    c.down(1, 90, LOW);
    c.move(1, 400, LOW);
    c.down(2, 330, H * 0.6);
    settle(c);
    c.clearPointers();
    settle(c, 0.6);
    expect(Math.abs(c.state.steer)).toBeLessThan(0.02);
    expect(c.state.drift).toBe(false);
  });
});

describe('pad targets', () => {
  it('forgives a thumb that lands just outside the brake, in every scheme', () => {
    for (const scheme of SCHEMES) {
      const c = controls(scheme.id);
      const brake = c.hint().pads.find((p) => p.label === 'BRAKE')!;
      // Just past the drawn edge, low — the kind of miss a thumb makes rolling down without
      // looking. Falling through to the drift zone reads to the player as the brake not
      // working at all. Probing downwards keeps this away from any neighbouring pad.
      c.down(1, brake.x, brake.y + brake.r * 1.15);
      settle(c, 0.1);
      expect(c.state.brake, `${scheme.id} brake near-miss`).toBe(1);
    }
  });
});

describe('the centre cluster', () => {
  it('gives the gap between drift and brake to whichever is nearer', () => {
    const c = controls('halves');
    const drift = c.hint().pads.find((p) => p.label === 'DRIFT')!;
    const brake = c.hint().pads.find((p) => p.label === 'BRAKE')!;
    const midpoint = (drift.x + brake.x) / 2;

    // A shade to the brake side of dead centre must brake, not drift.
    c.down(1, midpoint + (brake.x - drift.x) * 0.15, drift.y);
    settle(c, 0.1);
    expect(c.state.brake).toBe(1);
    expect(c.state.drift).toBe(false);
    c.up(1);

    // And a shade to the drift side must drift.
    c.down(2, midpoint + (drift.x - brake.x) * 0.15, drift.y);
    settle(c, 0.1);
    expect(c.state.drift).toBe(true);
    expect(c.state.brake).toBe(0);
  });
});
