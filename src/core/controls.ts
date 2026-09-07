import { approach, clamp } from './math';

/**
 * Everything the simulation is allowed to know about the player's hands. Schemes write into this
 * and nothing else, so adding a scheme never touches the car.
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

export type SchemeId = 'split' | 'halves' | 'oneThumb';

export interface SchemeInfo {
  id: SchemeId;
  name: string;
  blurb: string;
  /** What the sensitivity slider means under this scheme. */
  sensitivityLabel: string;
}

export const SCHEMES: readonly SchemeInfo[] = [
  {
    id: 'split',
    name: 'Split hands',
    blurb: 'One thumb steers by sliding, the other holds drift. Nothing shares a thumb.',
    sensitivityLabel: 'How far to slide for full lock',
  },
  {
    id: 'halves',
    name: 'Screen halves',
    blurb: 'Hold a side of the screen to turn that way. Drift and brake sit in the middle.',
    sensitivityLabel: 'How fast the wheel winds on',
  },
  {
    id: 'oneThumb',
    name: 'One thumb',
    blurb: 'Drag anywhere to steer, and commit hard to break traction. Playable one-handed.',
    sensitivityLabel: 'How far to slide for full lock',
  },
];

export interface ControlSettings {
  scheme: SchemeId;
  /** 3 (slow, long slide) .. 12 (twitchy, short slide). */
  sensitivity: number;
  /** Puts steering on the right and the actions on the left. */
  mirrored: boolean;
}

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** What the HUD should draw. The input layer owns its own layout; the HUD only renders it. */
export interface ControlHint {
  /** The live steering track, drawn where the thumb actually landed. */
  track: { x: number; y: number; halfWidth: number; knob: number } | null;
  /** Large hold-anywhere regions, drawn as a soft wash. */
  zones: { x: number; y: number; w: number; h: number; label: string; active: boolean }[];
  pads: { x: number; y: number; r: number; label: string; active: boolean }[];
}

type Role = 'steer' | 'drift' | 'brake' | 'none';

interface Pointer {
  role: Role;
  x: number;
  y: number;
  /** Where this pointer first landed, for relative steering. */
  originX: number;
}

/** Below this fraction of the screen height, touches are controls; above it, they are HUD. */
const CONTROL_TOP = 0.28;
/** Thumb movement inside this is treated as holding still. */
const DEAD_ZONE = 5;
/**
 * How far past a pad's drawn edge still counts as hitting it. Thumbs are imprecise and land by
 * feel rather than by sight; a near miss on the brake used to fall through to the drift zone,
 * which looks exactly like the brake having failed.
 */
const PAD_HIT = 1.3;
/** How quickly analog steering follows the thumb. High: the thumb IS the wheel. */
const ANALOG_SMOOTHING = 22;

/**
 * The whole control layer, with no DOM in it, so every scheme can be driven from a test rather
 * than from a browser and a pair of thumbs.
 *
 * The rule that shapes all three schemes: steering lives under one thumb and actions under the
 * other, and they never overlap. Drifting through a corner means steering and drifting at the
 * same time, so any layout where those two share a thumb is broken however it is tuned.
 */
export class Controls {
  readonly state: InputState = { steer: 0, throttle: 1, brake: 0, drift: false, driftReleased: false };
  readonly settings: ControlSettings = { scheme: 'split', sensitivity: 7, mirrored: false };

  private readonly pointers = new Map<number, Pointer>();
  private readonly keys = new Set<string>();
  private width = 1;
  private height = 1;
  private safe: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  private driftWasHeld = false;

  resize(width: number, height: number, safe?: SafeArea): void {
    this.width = width;
    this.height = height;
    if (safe) this.safe = safe;
  }

  /** Distance the thumb slides for full lock, from the sensitivity setting. */
  private travel(): number {
    const shortEdge = Math.min(this.width, this.height);
    // 3 -> a long, deliberate slide; 12 -> a flick.
    const fraction = 0.52 - this.settings.sensitivity * 0.031;
    return clamp(shortEdge * fraction, 42, 260);
  }

  /** True when the steering hand is on the left of the screen. */
  private steerOnLeft(): boolean {
    return !this.settings.mirrored;
  }

  private brakePad(): { x: number; y: number; r: number } {
    const r = clamp(Math.min(this.width, this.height) * 0.098, 40, 84);
    const margin = r + Math.min(this.width, this.height) * 0.045;
    const y = this.height - margin - this.safe.bottom;
    // The brake sits in the outer corner of the action side, where the thumb rests.
    const x = this.steerOnLeft() ? this.width - margin - this.safe.right : margin + this.safe.left;
    return { x, y, r };
  }

  private centrePads(): { drift: { x: number; y: number; r: number }; brake: { x: number; y: number; r: number } } {
    const r = clamp(Math.min(this.width, this.height) * 0.088, 36, 74);
    const y = this.height - r - Math.min(this.width, this.height) * 0.045 - this.safe.bottom;
    const gap = r * 1.4;
    const left = { x: this.width / 2 - gap, y, r };
    const right = { x: this.width / 2 + gap, y, r };
    // Mirroring swaps which of the pair is drift, so the same thumb keeps the same job.
    return this.settings.mirrored ? { drift: left, brake: right } : { drift: right, brake: left };
  }

  private controlTop(): number {
    return this.height * CONTROL_TOP + this.safe.top;
  }

  /** Which job a touch at this point takes on, decided once when the finger lands. */
  private roleAt(x: number, y: number): Role {
    if (y < this.controlTop()) return 'none';
    const scheme = this.settings.scheme;

    if (scheme === 'oneThumb') {
      const brake = this.brakePad();
      if (Math.hypot(x - brake.x, y - brake.y) <= brake.r * PAD_HIT) return 'brake';
      return 'steer';
    }

    if (scheme === 'halves') {
      // These two sit side by side, so a generous hit radius makes them overlap. Resolve to
      // whichever is actually nearer rather than whichever happens to be tested first —
      // otherwise the gap between them silently belongs to one of the pair.
      const { drift, brake } = this.centrePads();
      const toDrift = Math.hypot(x - drift.x, y - drift.y);
      const toBrake = Math.hypot(x - brake.x, y - brake.y);
      if (toDrift <= drift.r * PAD_HIT || toBrake <= brake.r * PAD_HIT) {
        return toDrift <= toBrake ? 'drift' : 'brake';
      }
      return 'steer';
    }

    // Split hands: the screen is cut down the middle, one job each side. The brake is the only
    // pad that has to be aimed at; everything else is a half-screen target.
    const onSteerSide = this.steerOnLeft() ? x < this.width * 0.5 : x >= this.width * 0.5;
    if (onSteerSide) return 'steer';
    const brake = this.brakePad();
    if (Math.hypot(x - brake.x, y - brake.y) <= brake.r * PAD_HIT) return 'brake';
    return 'drift';
  }

  down(id: number, x: number, y: number): void {
    const role = this.roleAt(x, y);
    this.pointers.set(id, { role, x, y, originX: x });
  }

  move(id: number, x: number, y: number): void {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    pointer.x = x;
    pointer.y = y;

    // Let the thumb run past full lock without losing the input, but pull the origin along so
    // that reversing direction responds immediately instead of eating the overshoot first.
    const travel = this.travel();
    const offset = x - pointer.originX;
    if (offset > travel) pointer.originX = x - travel;
    if (offset < -travel) pointer.originX = x + travel;
  }

  up(id: number): void {
    this.pointers.delete(id);
  }

  clearPointers(): void {
    this.pointers.clear();
    this.keys.clear();
  }

  keyDown(code: string): void {
    this.keys.add(code);
  }

  keyUp(code: string): void {
    this.keys.delete(code);
  }

  /** Folds held inputs into InputState. Called once per fixed step. */
  update(dt: number): void {
    const s = this.state;
    const scheme = this.settings.scheme;

    let target = 0;
    let analog = false;

    for (const pointer of this.pointers.values()) {
      if (pointer.role !== 'steer') continue;
      if (scheme === 'halves') {
        target += pointer.x < this.width * 0.5 ? -1 : 1;
      } else {
        const offset = pointer.x - pointer.originX;
        const magnitude = Math.abs(offset) < DEAD_ZONE ? 0 : offset;
        target += clamp(magnitude / this.travel(), -1, 1);
        analog = true;
      }
    }

    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) target -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) target += 1;
    target = clamp(target, -1, 1);

    if (analog) {
      // The thumb is the wheel: follow it closely, smoothing only the jitter.
      s.steer = approach(s.steer, target, ANALOG_SMOOTHING * dt);
    } else {
      // On/off input has to be ramped or the car snaps between locks. Centring is quicker than
      // reaching lock, which keeps corrections crisp.
      const rate = this.settings.sensitivity * (target === 0 ? 1.7 : 1);
      s.steer = approach(s.steer, target, rate * dt);
    }

    // One-thumb has no drift button: committing hard to a corner is what breaks traction.
    const autoDrift = scheme === 'oneThumb' && Math.abs(s.steer) > 0.8;
    const driftHeld = autoDrift || this.hasRole('drift') || this.keys.has('Space');
    s.driftReleased = this.driftWasHeld && !driftHeld;
    this.driftWasHeld = driftHeld;
    s.drift = driftHeld;

    const braking = this.hasRole('brake') || this.keys.has('ArrowDown') || this.keys.has('KeyS');
    s.brake = braking ? 1 : 0;
    s.throttle = braking ? 0 : 1;
  }

  private hasRole(role: Role): boolean {
    for (const pointer of this.pointers.values()) if (pointer.role === role) return true;
    return false;
  }

  private steeringPointer(): Pointer | null {
    for (const pointer of this.pointers.values()) if (pointer.role === 'steer') return pointer;
    return null;
  }

  /** Everything the HUD needs to draw the controls, including where the thumb currently is. */
  hint(): ControlHint {
    const scheme = this.settings.scheme;
    const top = this.controlTop();
    const bottom = this.height - top;
    const half = this.width * 0.5;
    const steerLeft = this.steerOnLeft();
    const hint: ControlHint = { track: null, zones: [], pads: [] };

    const steering = this.steeringPointer();
    if (steering && scheme !== 'halves') {
      hint.track = {
        x: steering.originX,
        y: steering.y,
        halfWidth: this.travel(),
        knob: clamp((steering.x - steering.originX) / this.travel(), -1, 1),
      };
    }

    if (scheme === 'split') {
      hint.zones.push({
        x: steerLeft ? 0 : half, y: top, w: half, h: bottom,
        label: 'STEER', active: steering !== null,
      });
      hint.zones.push({
        x: steerLeft ? half : 0, y: top, w: half, h: bottom,
        label: 'DRIFT', active: this.hasRole('drift'),
      });
      const brake = this.brakePad();
      hint.pads.push({ ...brake, label: 'BRAKE', active: this.hasRole('brake') });
    } else if (scheme === 'halves') {
      hint.zones.push({ x: 0, y: top, w: half, h: bottom, label: '', active: this.leftHeld() });
      hint.zones.push({ x: half, y: top, w: half, h: bottom, label: '', active: this.rightHeld() });
      const { drift, brake } = this.centrePads();
      hint.pads.push({ ...drift, label: 'DRIFT', active: this.hasRole('drift') });
      hint.pads.push({ ...brake, label: 'BRAKE', active: this.hasRole('brake') });
    } else {
      const brake = this.brakePad();
      hint.pads.push({ ...brake, label: 'BRAKE', active: this.hasRole('brake') });
    }

    return hint;
  }

  private leftHeld(): boolean {
    for (const p of this.pointers.values()) if (p.role === 'steer' && p.x < this.width * 0.5) return true;
    return false;
  }

  private rightHeld(): boolean {
    for (const p of this.pointers.values()) if (p.role === 'steer' && p.x >= this.width * 0.5) return true;
    return false;
  }
}
