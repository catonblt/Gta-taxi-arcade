import { clamp } from './math';

export const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 5;

export interface LoopStats {
  fps: number;
  /** Milliseconds spent in update+render for the last frame. */
  frameMs: number;
  /** Worst frame since start, ignoring warm-up. The number that actually matters on a phone. */
  worstMs: number;
  /** Frames that blew the 8ms working budget. A handful is GC; a stream is a real problem. */
  spikes: number;
  ticks: number;
}

/**
 * Fixed-timestep simulation decoupled from rendering: `update` always sees FIXED_DT so the
 * physics stay deterministic, `render` gets an alpha in [0,1) for interpolating between the
 * last two sim states.
 */
export class GameLoop {
  readonly stats: LoopStats = { fps: 0, frameMs: 0, worstMs: 0, spikes: 0, ticks: 0 };

  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private rafId = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private frames = 0;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number) => void,
  ) {}

  /** Clears perf counters so a measurement window can exclude warm-up or tooling stalls. */
  resetPerf(): void {
    this.stats.worstMs = 0;
    this.stats.spikes = 0;
    this.frames = 0;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    // Clamp so a backgrounded tab does not unleash a burst of catch-up steps.
    const elapsed = clamp((now - this.lastTime) / 1000, 0, 0.25);
    this.lastTime = now;
    const started = now;

    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.update(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
      this.stats.ticks++;
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = 0;

    this.render(this.accumulator / FIXED_DT);

    this.stats.frameMs = performance.now() - started;
    this.frames++;
    // Skip warm-up frames: first-paint costs say nothing about sustained performance.
    if (this.frames > 30) {
      if (this.stats.frameMs > this.stats.worstMs) this.stats.worstMs = this.stats.frameMs;
      if (this.stats.frameMs > 8) this.stats.spikes++;
    }
    this.fpsAccum += elapsed;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.stats.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
  };
}
