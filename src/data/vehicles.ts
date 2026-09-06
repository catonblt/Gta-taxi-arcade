export interface VehicleStats {
  /** Forward acceleration in world units/s^2. */
  accel: number;
  topSpeed: number;
  /** Lateral grip as an exponential bleed rate per second. Higher = sticks harder. */
  grip: number;
  /** Grip while the drift button is down. The gap between the two IS the drift. */
  driftGrip: number;
  /** Peak yaw rate in radians/s at the sweet-spot speed. */
  steerRate: number;
  brake: number;
  /** Ram authority and inertia. Heavier shrugs off cops but turns lazily. */
  mass: number;
  /** Collision damage absorbed before the shift is at risk. */
  armor: number;
  length: number;
  width: number;
}

export interface Vehicle {
  id: string;
  name: string;
  blurb: string;
  tier: number;
  price: number;
  /** Body colour used by the placeholder vector art. */
  color: string;
  base: VehicleStats;
}

/**
 * The starter is deliberately slow and loose: the brief is that the game must not start easy, and
 * the Beater is where that promise is kept. Later cars are personalities, not strict upgrades —
 * the Mule wins Intercept work that the Vector cannot touch.
 */
export const VEHICLES: readonly Vehicle[] = [
  {
    id: 'beater',
    name: 'Beater',
    blurb: 'Someone else’s problem until tonight. Slow, soft, and honest about it.',
    tier: 0,
    price: 0,
    color: '#8a8f7a',
    base: { accel: 210, topSpeed: 330, grip: 15, driftGrip: 2.6, steerRate: 2.9, brake: 320, mass: 1, armor: 30, length: 36, width: 18 },
  },
  {
    id: 'hatch',
    name: 'Pocket Rocket',
    blurb: 'Nimble, fragile, allergic to roadblocks. Lives in the alleys.',
    tier: 1,
    price: 4200,
    color: '#e0603a',
    base: { accel: 280, topSpeed: 385, grip: 17.5, driftGrip: 3.0, steerRate: 3.4, brake: 400, mass: 0.85, armor: 26, length: 34, width: 17 },
  },
  {
    id: 'mule',
    name: 'Mule',
    blurb: 'A van with a grudge. Cargo work and putting cruisers into walls.',
    tier: 1,
    price: 5600,
    color: '#5d7f9e',
    base: { accel: 195, topSpeed: 345, grip: 13, driftGrip: 3.6, steerRate: 2.4, brake: 300, mass: 1.7, armor: 62, length: 44, width: 21 },
  },
  {
    id: 'muscle',
    name: 'Warhorse',
    blurb: 'Straight lines and bad decisions. Bring grip upgrades.',
    tier: 2,
    price: 11500,
    color: '#b8323c',
    base: { accel: 330, topSpeed: 455, grip: 12, driftGrip: 2.2, steerRate: 2.7, brake: 380, mass: 1.35, armor: 44, length: 40, width: 19 },
  },
];

/** Police vehicles, kept in the same shape as player cars so they share the physics exactly. */
export const POLICE: Record<'cruiser' | 'interceptor', VehicleStats> = {
  // Quicker than the Beater in a straight line and grippier through corners, on purpose: the
  // starter car cannot outrun even the first rung, so escaping has to mean LOSING them —
  // breaking line of sight and turning off your own escape line — not holding the throttle down.
  cruiser: { accel: 255, topSpeed: 372, grip: 16, driftGrip: 2.9, steerRate: 2.8, brake: 350, mass: 1.15, armor: 45, length: 38, width: 19 },
  interceptor: { accel: 305, topSpeed: 430, grip: 17, driftGrip: 2.6, steerRate: 3.0, brake: 390, mass: 1.3, armor: 60, length: 40, width: 19 },
};

export function vehicleById(id: string): Vehicle {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}
