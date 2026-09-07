import docksSource from './districts/docks.city?raw';
import downtownSource from './districts/downtown.city?raw';
import industrialSource from './districts/industrial.city?raw';
import hillsSource from './districts/hills.city?raw';

export interface District {
  id: string;
  name: string;
  blurb: string;
  source: string;
  /** Reputation needed before the district will take your calls. */
  rep: number;
  /** Scales every fare and tip earned here. */
  payout: number;
  /** How far up the ladder the police in this district are willing to go. */
  maxHeat: number;
  /** Heat you carry from the moment you arrive. Nowhere past the Docks is quiet. */
  heatFloor: number;
  traffic: number;
}

/**
 * Difficulty climbs by district, and districts are gated on reputation — so escalation is
 * something the player chooses and earns, never a hidden score that quietly rubber-bands the
 * game to match their car. Upgrades buy ACCESS to harder, better-paid ground; the ground you
 * have already learned stays exactly as hard as it was.
 */
export const DISTRICTS: readonly District[] = [
  {
    id: 'docks',
    name: 'The Docks',
    blurb: 'Wide, open and slow to pay. The police here field one car and mean it.',
    source: docksSource,
    rep: 0,
    payout: 1,
    maxHeat: 3,
    heatFloor: 0,
    traffic: 20,
  },
  {
    id: 'downtown',
    name: 'Downtown',
    blurb: 'Traffic everywhere and a junction every second. Roadblocks bite here.',
    source: downtownSource,
    rep: 18,
    payout: 1.4,
    maxHeat: 4,
    heatFloor: 1,
    traffic: 32,
  },
  {
    id: 'industrial',
    name: 'The Yards',
    blurb: 'Dead ends and long detours. Take the wrong turn and they close it behind you.',
    source: industrialSource,
    rep: 55,
    payout: 1.85,
    maxHeat: 5,
    heatFloor: 1,
    traffic: 15,
  },
  {
    id: 'hills',
    name: 'The Hills',
    blurb: 'Fast, empty and nowhere to hide. They will put a helicopter over you.',
    source: hillsSource,
    rep: 110,
    payout: 2.4,
    maxHeat: 5,
    heatFloor: 2,
    traffic: 11,
  },
];

export function districtById(id: string): District {
  return DISTRICTS.find((d) => d.id === id) ?? DISTRICTS[0];
}

export function unlockedDistricts(rep: number): readonly District[] {
  return DISTRICTS.filter((d) => rep >= d.rep);
}
