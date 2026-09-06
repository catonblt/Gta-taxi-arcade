/**
 * Everything is synthesised at runtime — an engine note that tracks the throttle, a two-tone
 * siren that only sounds while they can actually see you, and short hits for contact and cash.
 * No audio files means nothing to download and nothing to decode on a cold start.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  private engine: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private siren: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;

  muted = false;

  /** Must be called from a real user gesture, or the browser will refuse to make a sound. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    // Engine: a saw through a moving lowpass. Cheap, and it reads as a labouring old car.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engine = ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engine.frequency.value = 60;
    this.engine.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engine.start();

    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.siren = ctx.createOscillator();
    this.siren.type = 'square';
    this.siren.frequency.value = 640;
    this.siren.connect(this.sirenGain).connect(this.master);
    this.siren.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  /**
   * Called every frame. `speedRatio` drives the engine note; `chase` is the seen flag, so the
   * siren is audible exactly when the badge is pulsing — the same information, through the ear.
   */
  update(speedRatio: number, chase: boolean, time: number): void {
    if (!this.ctx || !this.engine || !this.engineGain || !this.engineFilter) return;
    const r = Math.min(Math.max(speedRatio, 0), 1);
    this.engine.frequency.value = 52 + r * 118;
    this.engineFilter.frequency.value = 320 + r * 900;
    this.engineGain.gain.value = 0.05 + r * 0.07;

    if (this.siren && this.sirenGain) {
      // Two tones a fifth apart, swapped twice a second.
      this.siren.frequency.value = Math.sin(time * 6) > 0 ? 660 : 880;
      this.sirenGain.gain.value = chase ? 0.05 : 0;
    }
  }

  /** A short filtered noise burst: metal on metal. */
  thud(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const duration = 0.18;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700 + strength * 900;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(0.5, 0.12 + strength * 0.3);
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
  }

  /** Two quick rising blips. Money landing. */
  chime(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const at = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + 0.24);
    });
  }
}
