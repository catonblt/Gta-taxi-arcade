import { neutralModifiers, partById, type Modifiers } from '../data/parts';
import { SLOTS_BY_TIER, VEHICLES, vehicleById, type VehicleStats } from '../data/vehicles';

export type UpgradeAxis = 'engine' | 'tires' | 'suspension' | 'armor';

export const AXES: readonly UpgradeAxis[] = ['engine', 'tires', 'suspension', 'armor'];

export const AXIS_LABEL: Record<UpgradeAxis, string> = {
  engine: 'Engine',
  tires: 'Tires',
  suspension: 'Suspension',
  armor: 'Armour',
};

export const AXIS_BLURB: Record<UpgradeAxis, string> = {
  engine: 'Pull away harder, and run faster once you are moving.',
  tires: 'Hold the road, and hold a slide once you break it.',
  suspension: 'Turns in quicker, stops in less.',
  armor: 'Shrugs off walls, rams and roadblocks.',
};

/** Six steps per axis. Enough to feel, few enough to finish. */
export const MAX_LEVEL = 6;
const BASE_COST = 280;
const COST_GROWTH = 1.4;

export interface CarState {
  levels: Record<UpgradeAxis, number>;
  /** Part ids currently bolted on, up to the car's slot count. */
  parts: string[];
}

export interface GarageSave {
  version: 1;
  cash: number;
  rep: number;
  shifts: number;
  bestShift: number;
  current: string;
  district: string;
  owned: Record<string, CarState>;
  /** Parts bought, wherever they are currently fitted. */
  inventory: string[];
}

function freshCar(): CarState {
  return { levels: { engine: 0, tires: 0, suspension: 0, armor: 0 }, parts: [] };
}

/**
 * Per-car levels and a garage-wide parts collection. Buying a new car means a fresh set of
 * levels to grow — so the car is its own project, the Hill Climb way — but never means
 * re-earning your parts, which is the part of that model built to sell you out of a grind.
 */
export class Garage {
  cash = 0;
  rep = 0;
  shifts = 0;
  bestShift = 0;
  current = VEHICLES[0].id;
  /** The district the next shift will run in. */
  district = 'docks';
  readonly owned: Record<string, CarState> = { [VEHICLES[0].id]: freshCar() };
  readonly inventory: string[] = [];

  /** Called by the shift when the night closes on the player's terms. */
  bank(amount: number): void {
    this.cash += amount;
    this.shifts++;
    if (amount > this.bestShift) this.bestShift = amount;
  }

  get vehicle() {
    return vehicleById(this.current);
  }

  get state(): CarState {
    return this.owned[this.current] ?? freshCar();
  }

  slots(vehicleId = this.current): number {
    return SLOTS_BY_TIER[vehicleById(vehicleId).tier] ?? 2;
  }

  /** Cost of the next step on an axis. Rises with the level and with the car's tier. */
  upgradeCost(axis: UpgradeAxis, vehicleId = this.current): number {
    const level = this.owned[vehicleId]?.levels[axis] ?? 0;
    if (level >= MAX_LEVEL) return 0;
    const tierFactor = 1 + vehicleById(vehicleId).tier * 0.75;
    return Math.round(BASE_COST * tierFactor * COST_GROWTH ** level);
  }

  canUpgrade(axis: UpgradeAxis): boolean {
    const cost = this.upgradeCost(axis);
    return cost > 0 && this.cash >= cost;
  }

  upgrade(axis: UpgradeAxis): boolean {
    if (!this.canUpgrade(axis)) return false;
    this.cash -= this.upgradeCost(axis);
    this.state.levels[axis]++;
    return true;
  }

  buyVehicle(id: string): boolean {
    const vehicle = vehicleById(id);
    if (this.owned[id] || this.cash < vehicle.price) return false;
    this.cash -= vehicle.price;
    this.owned[id] = freshCar();
    this.current = id;
    return true;
  }

  select(id: string): boolean {
    if (!this.owned[id]) return false;
    this.current = id;
    return true;
  }

  buyPart(id: string): boolean {
    const part = partById(id);
    if (!part || this.inventory.includes(id)) return false;
    if (this.cash < part.price || this.rep < part.rep) return false;
    this.cash -= part.price;
    this.inventory.push(id);
    return true;
  }

  /** Parts move between cars freely; only the slot count limits what a car can carry. */
  togglePart(id: string): boolean {
    if (!this.inventory.includes(id)) return false;
    const fitted = this.state.parts;
    const at = fitted.indexOf(id);
    if (at >= 0) {
      fitted.splice(at, 1);
      return true;
    }
    if (fitted.length >= this.slots()) return false;
    fitted.push(id);
    return true;
  }

  /** Everything the current build changes about the rules, folded into one object. */
  modifiers(): Modifiers {
    const m = neutralModifiers();
    const levels = this.state.levels;

    // Levels are percentages of the car's own numbers, so a fully built Beater is still a
    // Beater — the roster stays a set of personalities rather than a ladder.
    m.accel *= 1 + levels.engine * 0.07;
    m.topSpeed *= 1 + levels.engine * 0.055;
    m.grip *= 1 + levels.tires * 0.075;
    m.driftGrip *= 1 + levels.tires * 0.05;
    m.steerRate *= 1 + levels.suspension * 0.05;
    m.brake *= 1 + levels.suspension * 0.07;
    m.armor *= 1 + levels.armor * 0.16;

    for (const id of this.state.parts) partById(id)?.apply(m);
    return m;
  }

  /** The car as it will actually drive tonight. */
  stats(): VehicleStats {
    const base = this.vehicle.base;
    const m = this.modifiers();
    return {
      ...base,
      accel: base.accel * m.accel,
      topSpeed: base.topSpeed * m.topSpeed,
      grip: base.grip * m.grip,
      driftGrip: base.driftGrip * m.driftGrip,
      steerRate: base.steerRate * m.steerRate,
      brake: base.brake * m.brake,
      armor: base.armor * m.armor,
    };
  }

  save(): GarageSave {
    return {
      version: 1,
      cash: this.cash,
      rep: this.rep,
      shifts: this.shifts,
      bestShift: this.bestShift,
      current: this.current,
      district: this.district,
      owned: JSON.parse(JSON.stringify(this.owned)) as Record<string, CarState>,
      inventory: [...this.inventory],
    };
  }

  load(data: GarageSave): void {
    this.cash = data.cash;
    this.rep = data.rep;
    this.shifts = data.shifts;
    this.bestShift = data.bestShift;
    for (const key of Object.keys(this.owned)) delete this.owned[key];
    // Ignore anything the current build no longer knows about, so an old save still opens.
    for (const [id, car] of Object.entries(data.owned ?? {})) {
      if (!VEHICLES.some((v) => v.id === id)) continue;
      this.owned[id] = { levels: { ...freshCar().levels, ...car.levels }, parts: (car.parts ?? []).filter((p) => partById(p)) };
    }
    if (Object.keys(this.owned).length === 0) this.owned[VEHICLES[0].id] = freshCar();
    this.current = this.owned[data.current] ? data.current : Object.keys(this.owned)[0];
    this.district = data.district ?? 'docks';
    this.inventory.length = 0;
    for (const id of data.inventory ?? []) if (partById(id)) this.inventory.push(id);
  }
}
