import { describe, expect, it } from 'vitest';
import { MAX_MULTIPLIER, Style } from '../src/game/style';
import { FIXED_DT } from '../src/core/loop';

function coast(style: Style, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) style.step(FIXED_DT);
}

describe('style', () => {
  it('starts flat and pays nothing for driving in a straight line', () => {
    const style = new Style();
    coast(style, 3);
    expect(style.multiplier).toBe(1);
    expect(style.events.tip).toBe(0);
  });

  it('pays a tip the moment a flourish happens', () => {
    const style = new Style();
    style.step(FIXED_DT);
    style.closeShave();
    expect(style.events.tip).toBeGreaterThan(0);
    expect(style.multiplier).toBeGreaterThan(1);
  });

  it('pays later flourishes more than earlier ones', () => {
    const style = new Style();
    style.step(FIXED_DT);
    style.closeShave();
    const first = style.events.tip;

    style.step(FIXED_DT);
    for (let i = 0; i < 5; i++) style.closeShave();
    style.step(FIXED_DT);
    style.closeShave();
    expect(style.events.tip).toBeGreaterThan(first);
  });

  it('caps the multiplier', () => {
    const style = new Style();
    for (let i = 0; i < 200; i++) { style.step(FIXED_DT); style.copDodge(); }
    expect(style.multiplier).toBe(MAX_MULTIPLIER);
  });

  it('holds the combo through a grace period, then bleeds it', () => {
    const style = new Style();
    for (let i = 0; i < 8; i++) { style.step(FIXED_DT); style.closeShave(); }
    const built = style.multiplier;

    coast(style, 1.5);
    expect(style.multiplier).toBe(built); // still inside the grace window

    coast(style, 4);
    expect(style.multiplier).toBeLessThan(built);
  });

  it('breaks the combo on a real crash but not on a scrape', () => {
    const style = new Style();
    for (let i = 0; i < 8; i++) { style.step(FIXED_DT); style.closeShave(); }
    expect(style.impact(40)).toBe(false);
    expect(style.multiplier).toBeGreaterThan(1);

    expect(style.impact(300)).toBe(true);
    expect(style.multiplier).toBe(1);
  });

  it('remembers the best run of the shift even after a crash', () => {
    const style = new Style();
    for (let i = 0; i < 12; i++) { style.step(FIXED_DT); style.copDodge(); }
    const peak = style.peak;
    expect(peak).toBeGreaterThan(1);
    style.impact(400);
    expect(style.multiplier).toBe(1);
    expect(style.peak).toBe(peak);
  });
});
