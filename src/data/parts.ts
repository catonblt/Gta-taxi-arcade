export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/**
 * What a part can change. Everything here is read by the simulation — no part is decoration.
 * Stat multipliers fold into the car's numbers; the rest bend rules the game already has.
 */
export interface Modifiers {
  accel: number;
  topSpeed: number;
  grip: number;
  driftGrip: number;
  steerRate: number;
  brake: number;
  armor: number;
  /** Scales all heat gained from crimes and collisions. */
  heatGain: number;
  /** Scales heat gained specifically from shunting civilian traffic. */
  trafficHeat: number;
  /** Scales the impact taken from a police ram. */
  ramTaken: number;
  /** Scales cargo damage on impacts. */
  cargoDamage: number;
  /** Scales the drift-cancel exit boost. */
  driftBoost: number;
  /** Seconds of unbroken sight before the police call you spotted. */
  sightDelay: number;
  /** Scales every payout, fares and tips alike. */
  payout: number;
  /** Scales the fare clock on every job. */
  fareTime: number;
  /** Ceiling on the style multiplier. */
  maxMultiplier: number;
  /** Pursuer arrows shown even when the police have not spotted you. */
  alwaysShowPursuers: boolean;
  /** A police ram no longer breaks the combo. */
  ramKeepsCombo: boolean;
}

export function neutralModifiers(): Modifiers {
  return {
    accel: 1, topSpeed: 1, grip: 1, driftGrip: 1, steerRate: 1, brake: 1, armor: 1,
    heatGain: 1, trafficHeat: 1, ramTaken: 1, cargoDamage: 1, driftBoost: 1,
    sightDelay: 0, payout: 1, fareTime: 1, maxMultiplier: 3,
    alwaysShowPursuers: false, ramKeepsCombo: false,
  };
}

export interface Part {
  id: string;
  name: string;
  rarity: Rarity;
  /** What it does, in the player's words. */
  blurb: string;
  price: number;
  /** Rep needed before the part appears in the garage at all. */
  rep: number;
  apply: (m: Modifiers) => void;
}

export const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#96a0af',
  rare: '#5aa8dc',
  epic: '#a882f0',
  legendary: '#f0a63c',
};

/**
 * Rarity is utility, not raw power — the Hill Climb lesson. Mud Guards are Common and anchor a
 * quiet Ghost build; the Legendary Skim does nothing at all for a driver who cannot finish a
 * job. What you bolt on should say what kind of night you are planning.
 */
export const PARTS: readonly Part[] = [
  {
    id: 'bumper', name: 'Reinforced Bumper', rarity: 'common', price: 450, rep: 0,
    blurb: 'Takes the hit so the car does not. Rams hurt less.',
    apply: (m) => { m.armor *= 1.25; m.ramTaken *= 0.7; },
  },
  {
    id: 'guards', name: 'Mud Guards', rarity: 'common', price: 450, rep: 0,
    blurb: 'Clipping traffic draws far less attention.',
    apply: (m) => { m.trafficHeat *= 0.55; },
  },
  {
    id: 'scanner', name: 'Police Scanner', rarity: 'common', price: 600, rep: 0,
    blurb: 'You see them coming even before they see you.',
    apply: (m) => { m.alwaysShowPursuers = true; },
  },
  {
    id: 'softs', name: 'Soft Compound', rarity: 'common', price: 600, rep: 4,
    blurb: 'More grip, and a slide you can hold longer.',
    apply: (m) => { m.grip *= 1.09; m.driftGrip *= 1.12; },
  },
  {
    id: 'nitrous', name: 'Nitrous Shot', rarity: 'rare', price: 1400, rep: 10,
    blurb: 'Come out of a slide considerably faster than you went in.',
    apply: (m) => { m.driftBoost *= 1.7; },
  },
  {
    id: 'jammer', name: 'Radio Jammer', rarity: 'rare', price: 1600, rep: 14,
    blurb: 'They need a good look at you before anyone calls it in.',
    apply: (m) => { m.sightDelay += 1.2; },
  },
  {
    id: 'cage', name: 'Roll Cage', rarity: 'rare', price: 1400, rep: 12,
    blurb: 'The load rides out the knocks that used to ruin it.',
    apply: (m) => { m.cargoDamage *= 0.5; m.armor *= 1.15; },
  },
  {
    id: 'plates', name: 'Ghost Plates', rarity: 'epic', price: 3800, rep: 28,
    blurb: 'Nothing you do climbs the ladder as fast.',
    apply: (m) => { m.heatGain *= 0.62; },
  },
  {
    id: 'turbo', name: 'Overcharged Turbo', rarity: 'epic', price: 4200, rep: 34,
    blurb: 'More of everything at the top end.',
    apply: (m) => { m.topSpeed *= 1.12; m.accel *= 1.1; },
  },
  {
    id: 'pitbar', name: 'PIT Bar', rarity: 'epic', price: 3800, rep: 31,
    blurb: 'Trade paint with a cruiser and keep your combo.',
    apply: (m) => { m.ramKeepsCombo = true; m.ramTaken *= 0.55; },
  },
  {
    id: 'skim', name: 'The Skim', rarity: 'legendary', price: 9500, rep: 62,
    blurb: 'A cut off the top of everything you are paid.',
    apply: (m) => { m.payout *= 1.18; },
  },
  {
    id: 'kit', name: 'Getaway Kit', rarity: 'legendary', price: 9500, rep: 70,
    blurb: 'Clients wait longer. Every fare, every night.',
    apply: (m) => { m.fareTime *= 1.25; },
  },
  {
    id: 'showboat', name: 'Showboat Package', rarity: 'legendary', price: 11000, rep: 84,
    blurb: 'Raises the ceiling on what a clean run is worth.',
    apply: (m) => { m.maxMultiplier = 4.5; },
  },
];

export function partById(id: string): Part | undefined {
  return PARTS.find((p) => p.id === id);
}
