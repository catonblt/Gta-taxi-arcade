import { approach, clamp } from './math';

/**
 * Everything the simulation is allowed to know about the player's hands. Control schemes write
 * into this and nothing else, so a new scheme never touches the car code.
 */
export interface InputState {
  /** -1 full left .. +1 full right */
  steer: number;
  throttle: number;
  brake: number;
  drift: boolean;
  /** True on the frame drift was released, for drift-cancel exit boosts. */
  driftReleased: boolean;
}

export interface InputSettings {
  /** How fast steering reaches full lock, in units per second. Higher = twitchier. */
  sensitivity: number;
  /** Swaps the drift and brake pads for left-handed players. */
  leftHanded: boolean;
}

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PadLayout {
  driftX: number;
  driftY: number;
  brakeX: number;
  brakeY: number;
  radius: number;
}

type Role = 'steer' | 'drift' | 'brake';

/**
 * Default touch scheme: the car drives itself, the left half of the screen steers left and the
 * right half steers right, with drift and brake on thumb pads in the bottom corners. No gestures,
 * no floating stick, never more than two fingers.
 */
export class TouchInput {
  readonly state: InputState = { steer: 0, throttle: 1, brake: 0, drift: false, driftReleased: false };
  readonly settings: InputSettings = { sensitivity: 6.5, leftHanded: false };

  private readonly pointers = new Map<number, Role>();
  private readonly pointerPos = new Map<number, number>();
  private readonly keys = new Set<string>();
  private width = 1;
  private height = 1;
  /** Device insets: the gesture bar and the notch are not places to put a thumb pad. */
  private safe: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  private driftWasHeld = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.pointers.clear();
      this.pointerPos.clear();
      this.keys.clear();
    });
  }

  resize(width: number, height: number, safe?: SafeArea): void {
    this.width = width;
    this.height = height;
    if (safe) this.safe = safe;
  }

  /** Pad geometry in CSS pixels, shared with the HUD so what is drawn is what is hit. */
  layout(): PadLayout {
    const radius = clamp(Math.min(this.width, this.height) * 0.11, 44, 92);
    const margin = radius + Math.min(this.width, this.height) * 0.05;
    const y = this.height - margin - this.safe.bottom;
    const right = this.width - margin - this.safe.right;
    const left = margin + this.safe.left;
    return this.settings.leftHanded
      ? { driftX: left, driftY: y, brakeX: right, brakeY: y, radius }
      : { driftX: right, driftY: y, brakeX: left, brakeY: y, radius };
  }

  /** Folds held inputs into InputState. Called once per fixed step. */
  update(dt: number): void {
    const s = this.state;
    let target = 0;
    for (const [id, role] of this.pointers) {
      if (role !== 'steer') continue;
      const x = this.pointerPos.get(id);
      if (x === undefined) continue;
      target += x < this.width * 0.5 ? -1 : 1;
    }
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) target -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) target += 1;
    target = clamp(target, -1, 1);

    // Ramp rather than snap: gives held zones an analog feel and stops on/off wobble at speed.
    // Returning to centre is quicker than reaching lock, which keeps corrections crisp.
    const rate = this.settings.sensitivity * (target === 0 ? 1.7 : 1);
    s.steer = approach(s.steer, target, rate * dt);

    const driftHeld = this.hasRole('drift') || this.keys.has('Space');
    s.driftReleased = this.driftWasHeld && !driftHeld;
    this.driftWasHeld = driftHeld;
    s.drift = driftHeld;

    const braking = this.hasRole('brake') || this.keys.has('ArrowDown') || this.keys.has('KeyS');
    s.brake = braking ? 1 : 0;
    s.throttle = braking ? 0 : 1;
  }

  private hasRole(role: Role): boolean {
    for (const r of this.pointers.values()) if (r === role) return true;
    return false;
  }

  private roleAt(x: number, y: number): Role {
    const pad = this.layout();
    const hit = pad.radius * 1.25;
    if (Math.hypot(x - pad.driftX, y - pad.driftY) <= hit) return 'drift';
    if (Math.hypot(x - pad.brakeX, y - pad.brakeY) <= hit) return 'brake';
    return 'steer';
  }

  private readonly onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, this.roleAt(e.clientX, e.clientY));
    this.pointerPos.set(e.pointerId, e.clientX);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    // A steering thumb may slide across the centre line to change direction; pad roles are
    // fixed at touch-down so a drifting thumb never accidentally becomes a steer input.
    this.pointerPos.set(e.pointerId, e.clientX);
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.pointerPos.delete(e.pointerId);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
}
