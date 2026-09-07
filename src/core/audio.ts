/**
 * Everything is synthesised at runtime: an engine that shifts through gears, a siren that wails
 * and gets louder as they close, and a procedural score that thickens with the wanted level.
 * No audio files means nothing to download and nothing to decode on a cold start.
 *
 * One rule holds the whole thing together: every voice is driven from `update`, which is called
 * from the render loop rather than the simulation loop. Audio is presentation. Driving it from
 * the simulation meant that pausing — which stops the simulation — left the engine oscillator
 * holding its last note forever.
 */

export type Scene = 'driving' | 'menu';

export interface AudioState {
  /** 0..1 of the car's top speed. */
  speedRatio: number;
  /** True while the player is on the throttle. */
  onThrottle: boolean;
  /** True while the police can actually see the player. */
  chase: boolean;
  /** Distance in world units to the nearest pursuer, or Infinity. */
  copDistance: number;
  /** 0..5. Drives how much of the score is playing. */
  heat: number;
  scene: Scene;
}

/** A minor pentatonic, which is most of why a few random notes sound deliberate. */
const SCALE = [0, 3, 5, 7, 10];
const ROOT_HZ = 55; // A1
const BAR_STEPS = 16;

/** Chord roots, in semitones from A. The progression the bass walks. */
const PROGRESSION = [0, 0, -4, -2];

function semitone(n: number): number {
  return ROOT_HZ * 2 ** (n / 12);
}

export class Audio {
  muted = false;
  /** Counts update calls, so a test can prove the audio is still being driven while paused. */
  updates = 0;
  lastScene: Scene = 'menu';

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;

  // --- Engine ---------------------------------------------------------------------------
  private engineSaw: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  // --- Siren ----------------------------------------------------------------------------
  private sirenOsc: OscillatorNode | null = null;
  private sirenFilter: BiquadFilterNode | null = null;
  private sirenGain: GainNode | null = null;

  // --- Score ----------------------------------------------------------------------------
  private nextStepTime = 0;
  private step = 0;
  private intensity = 0;

  /** Must be called from a real user gesture, or the browser will refuse to make a sound. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.master);

    // Engine: a saw for the note and a square an octave down for the weight of it, through a
    // filter that opens up with speed. Two voices is the difference between a car and a wasp.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 3;
    this.engineFilter.frequency.value = 400;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.sfxBus);

    this.engineSaw = ctx.createOscillator();
    this.engineSaw.type = 'sawtooth';
    this.engineSaw.frequency.value = 60;
    this.engineSaw.connect(this.engineFilter);
    this.engineSaw.start();

    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineSub.frequency.value = 30;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.45;
    this.engineSub.connect(subGain).connect(this.engineFilter);
    this.engineSub.start();

    // Siren: a square through a narrow bandpass reads as an electronic wail rather than a beep.
    this.sirenFilter = ctx.createBiquadFilter();
    this.sirenFilter.type = 'bandpass';
    this.sirenFilter.Q.value = 6;
    this.sirenFilter.frequency.value = 900;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenFilter.connect(this.sirenGain).connect(this.sfxBus);

    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'square';
    this.sirenOsc.frequency.value = 800;
    this.sirenOsc.connect(this.sirenFilter);
    this.sirenOsc.start();

    this.nextStepTime = ctx.currentTime;
  }

  /** Live gain values, for asserting that nothing is left holding a note. */
  levels(): { engine: number; siren: number; music: number; contextState: string } {
    return {
      engine: this.engineGain?.gain.value ?? -1,
      siren: this.sirenGain?.gain.value ?? -1,
      music: this.musicBus?.gain.value ?? -1,
      contextState: this.ctx?.state ?? 'none',
    };
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Called every rendered frame, driving, paused or in a menu. Nothing holds a note because
   * nothing is ever left un-updated.
   */
  update(state: AudioState, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const driving = state.scene === 'driving';
    this.updates++;
    this.lastScene = state.scene;

    this.updateEngine(state, now, driving);
    this.updateSiren(state, now, driving, dt);
    this.updateScore(state, now, driving);
  }

  private updateEngine(state: AudioState, now: number, driving: boolean): void {
    if (!this.engineSaw || !this.engineSub || !this.engineFilter || !this.engineGain) return;

    if (!driving) {
      // Ease off rather than cut: a hard stop clicks, and a held note is what this replaced.
      this.engineGain.gain.setTargetAtTime(0, now, 0.06);
      return;
    }

    const ratio = Math.min(Math.max(state.speedRatio, 0), 1);

    // Fake a five-speed box. Revs climb through a gear then drop as it shifts, which is most of
    // what makes an engine sound like it is working rather than sliding up a ramp.
    const gears = 5;
    const gear = Math.min(gears - 1, Math.floor(ratio * gears));
    const withinGear = ratio * gears - gear;
    const revs = 0.28 + withinGear * 0.72;

    const base = 46 + gear * 7;
    const frequency = base * (0.75 + revs * 0.85);
    this.engineSaw.frequency.setTargetAtTime(frequency, now, 0.04);
    this.engineSub.frequency.setTargetAtTime(frequency * 0.5, now, 0.04);
    this.engineFilter.frequency.setTargetAtTime(280 + revs * 900 + ratio * 700, now, 0.05);

    // Under load it is louder and brighter; coasting, it backs off.
    const load = state.onThrottle ? 1 : 0.55;
    this.engineGain.gain.setTargetAtTime((0.045 + revs * 0.05) * load, now, 0.05);
  }

  private updateSiren(state: AudioState, now: number, driving: boolean, dt: number): void {
    if (!this.sirenOsc || !this.sirenGain || !this.sirenFilter) return;

    if (!driving || state.copDistance === Infinity) {
      this.sirenGain.gain.setTargetAtTime(0, now, 0.08);
      return;
    }

    // Loudness by distance is a real signal, not decoration: it tells you how close they are
    // when the car itself is off the edge of the screen.
    const near = 260;
    const far = 1100;
    const proximity = 1 - Math.min(Math.max((state.copDistance - near) / (far - near), 0), 1);
    const level = proximity * (state.chase ? 0.075 : 0.035);
    this.sirenGain.gain.setTargetAtTime(level, now, 0.12);

    // Wail normally; yelp when they are right behind you.
    this.sirenPhase += dt * (proximity > 0.72 ? 3.4 : 1.05);
    const sweep = (Math.sin(this.sirenPhase * Math.PI * 2) + 1) * 0.5;
    const frequency = 620 + sweep * 520;
    this.sirenOsc.frequency.setTargetAtTime(frequency, now, 0.02);
    this.sirenFilter.frequency.setTargetAtTime(frequency, now, 0.02);
  }

  private sirenPhase = 0;

  /**
   * A step sequencer on a lookahead scheduler — the standard way to get steady timing out of
   * Web Audio, since the frame loop is far too jittery to trigger notes directly. Layers arrive
   * as the wanted level climbs, so the score is a readout of how much trouble you are in.
   */
  private updateScore(state: AudioState, now: number, driving: boolean): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;

    // In menus the score keeps going, quietly: it is the difference between a pause and a crash.
    const target = driving ? 0.055 + Math.min(state.heat, 5) * 0.012 : 0.03;
    bus.gain.setTargetAtTime(target, now, 0.4);

    const wanted = driving ? Math.min(state.heat, 5) : 0;
    this.intensity += (wanted - this.intensity) * 0.02;

    const bpm = 92 + wanted * 5;
    const stepDuration = 60 / bpm / 4;

    // Schedule a little ahead of the clock so jitter in the frame loop never becomes audible.
    while (this.nextStepTime < now + 0.12) {
      if (this.nextStepTime < now) this.nextStepTime = now;
      this.scheduleStep(this.step, this.nextStepTime, driving);
      this.step = (this.step + 1) % (BAR_STEPS * PROGRESSION.length);
      this.nextStepTime += stepDuration;
    }
  }

  private scheduleStep(step: number, time: number, driving: boolean): void {
    const inBar = step % BAR_STEPS;
    const bar = Math.floor(step / BAR_STEPS) % PROGRESSION.length;
    const root = PROGRESSION[bar];
    const level = this.intensity;

    // Bass: always there, the spine of the thing.
    if (inBar % 4 === 0 || (level > 1 && inBar % 8 === 6)) {
      this.pluck('sawtooth', semitone(root + (inBar % 8 === 6 ? 7 : 0)), time, 0.32, 0.5, 260);
    }

    if (!driving) return;

    // Kick from the first rung: the moment anyone is looking for you.
    if (level > 0.6 && (inBar === 0 || inBar === 8 || (level > 2.5 && inBar === 11))) {
      this.kick(time);
    }

    // Hats fill in as it gets worse.
    if (level > 1.4 && inBar % 4 === 2) this.hat(time, 0.16);
    if (level > 3 && inBar % 2 === 1) this.hat(time, 0.09);

    // A lead only at the top of the ladder, where the helicopter is.
    if (level > 3.6 && inBar % 2 === 0) {
      const note = SCALE[(inBar / 2 + bar) % SCALE.length];
      this.pluck('square', semitone(root + note + 24), time, 0.14, 0.055, 1800);
    }
  }

  private pluck(
    type: OscillatorType,
    frequency: number,
    time: number,
    duration: number,
    peak: number,
    cutoff: number,
  ): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter).connect(gain).connect(bus);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  private kick(time: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    // The drop is the kick: pitch falling fast is what the ear hears as a beater hitting a skin.
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.09);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.7, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);

    osc.connect(gain).connect(bus);
    osc.start(time);
    osc.stop(time + 0.26);
  }

  private hat(time: number, peak: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer();

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);

    source.connect(filter).connect(gain).connect(bus);
    source.start(time);
    source.stop(time + 0.07);
  }

  private noise: AudioBuffer | null = null;

  /** One second of noise, made once and reused by every hat and every impact. */
  private noiseBuffer(): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (this.noise) return this.noise;
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }

  /** Metal on metal. Louder and lower the harder it was. */
  thud(strength: number): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    const buffer = this.noiseBuffer();
    if (!ctx || !bus || !buffer) return;

    const time = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600 + strength * 1100;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.min(0.5, 0.12 + strength * 0.32), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16 + strength * 0.12);

    source.connect(filter).connect(gain).connect(bus);
    source.start(time);
    source.stop(time + 0.32);

    // A low thump under the crunch, so a heavy hit has weight.
    if (strength > 0.4) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, time);
      osc.frequency.exponentialRampToValueAtTime(38, time + 0.16);
      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(strength * 0.4, time);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
      osc.connect(thumpGain).connect(bus);
      osc.start(time);
      osc.stop(time + 0.22);
    }
  }

  /** Money landing: a rising third, which is the sound of good news in every arcade ever built. */
  chime(): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    [880, 1320, 1760].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = frequency;
      const at = ctx.currentTime + i * 0.075;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.15, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);
      osc.connect(gain).connect(bus);
      osc.start(at);
      osc.stop(at + 0.28);
    });
  }
}
