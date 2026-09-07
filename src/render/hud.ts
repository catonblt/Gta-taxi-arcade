import type { PadLayout } from '../core/input';
import { clamp } from '../core/math';
import type { Renderer } from './renderer';

export interface HudModel {
  speed: number;
  topSpeed: number;
  driftCharge: number;
  drifting: boolean;
  heatLevel: number;
  seen: boolean;
  pursuit: 'clear' | 'chase' | 'search';
  /** 0..1 through a hideout hold. */
  hideoutProgress: number;
  canRespray: boolean;
  /** Screen-space positions of every active pursuer, for the off-screen arrows. */
  pursuers: readonly { x: number; y: number }[];
  /** Screen-space job markers: offers and the current objective. */
  markers: readonly { x: number; y: number; color: string; label: string; objective: boolean }[];
  district: string;
  /** Where the top-right furniture ends, so the job banner can sit clear of the map. */
  topOffset: number;
  tiresShredded: boolean;
  multiplier: number;
  styleEvent: 'shave' | 'drift' | 'dodge' | 'break' | null;
  /** Transient feedback line: job taken, job blown, level shed. */
  toast: { text: string; color: string; alpha: number } | null;
  timeLeft: number;
  cash: number;
  job: { label: string; brief: string; payout: number; fareLeft: number; fareTotal: number; color: string; progress: string } | null;
  time: number;
  fps: number;
  showDebug: boolean;
}

const MAX_PIPS = 5;

export class Hud {
  constructor(private readonly r: Renderer) {}

  draw(model: HudModel, pads: PadLayout): void {
    const ctx = this.r.ctx;
    ctx.setTransform(this.r.dpr, 0, 0, this.r.dpr, 0, 0);
    this.drawClock(model);
    this.drawHeat(model);
    this.drawMarkers(model);
    this.drawPursuerArrows(model);
    if (model.job) this.drawJobBanner(model.job, model.topOffset);
    if (model.toast) this.drawToast(model.toast);
    if (model.hideoutProgress > 0.01) this.drawHold(model.hideoutProgress);
    if (model.canRespray) this.drawPrompt('RESPRAY — PULL IN', '#5adca0');
    this.drawPad(pads.driftX, pads.driftY, pads.radius, 'DRIFT', model.drifting);
    this.drawPad(pads.brakeX, pads.brakeY, pads.radius, 'BRAKE', false);
    this.drawSpeed(model);
    this.drawMultiplier(model);
    if (model.showDebug) {
      ctx.fillStyle = model.fps < 50 ? '#ff8080' : 'rgba(255,255,255,0.55)';
      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${model.fps.toFixed(0)} fps`, 12, 20);
    }
  }

  /**
   * The wanted badge carries two facts at once: how many pips are lit is what they want you
   * for, and whether the badge is PULSING is whether they can actually see you. GTA2 shook its
   * heads for the same reason — without that tell, escaping is luck instead of skill.
   */
  private drawHeat(model: HudModel): void {
    if (model.heatLevel === 0 && model.pursuit === 'clear') return;
    const ctx = this.r.ctx;
    const x = 16;
    const y = 62;
    const size = 13;
    const gap = 7;

    const pulse = model.seen ? 0.55 + 0.45 * Math.sin(model.time * 9) : 1;

    for (let i = 0; i < MAX_PIPS; i++) {
      const lit = i < model.heatLevel;
      const px = x + i * (size + gap);
      ctx.beginPath();
      // A chevron, not a star: this is a police radio call, not a score.
      ctx.moveTo(px, y + size);
      ctx.lineTo(px + size / 2, y);
      ctx.lineTo(px + size, y + size);
      ctx.lineTo(px + size / 2, y + size * 0.62);
      ctx.closePath();
      if (lit) {
        ctx.fillStyle = model.seen ? `rgba(216,58,68,${pulse})` : 'rgba(216,58,68,0.42)';
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    const label = model.seen ? 'SPOTTED' : model.pursuit === 'search' ? 'SEARCHING' : 'WANTED';
    ctx.fillStyle = model.seen ? `rgba(255,150,150,${pulse})` : 'rgba(255,255,255,0.45)';
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.letterSpacing = '2px';
    ctx.fillText(label, x, y + size + 7);
    ctx.letterSpacing = '0px';
  }

  /** The shift clock and the pile you have not banked yet. */
  private drawClock(model: HudModel): void {
    const ctx = this.r.ctx;
    const cx = this.r.cssWidth / 2;
    const urgent = model.timeLeft <= 15;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = urgent ? '#d83a44' : 'rgba(232,234,238,0.92)';
    ctx.font = '700 30px "Big Shoulders Display", Impact, ui-monospace, monospace';
    const seconds = Math.max(0, model.timeLeft);
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    ctx.fillText(`${mins}:${secs.toString().padStart(2, '0')}`, cx, 12);

    ctx.fillStyle = '#5adca0';
    ctx.font = '500 13px ui-monospace, monospace';
    ctx.fillText(`$${Math.floor(model.cash).toLocaleString('en-US')}`, cx, 44);

    if (model.tiresShredded) {
      // A shredded set changes how the car behaves for the rest of the night, so it has to be
      // on screen rather than something the player only feels and cannot name.
      ctx.fillStyle = '#d83a44';
      ctx.font = '600 10px ui-monospace, monospace';
      ctx.letterSpacing = '2px';
      ctx.fillText('TYRES GONE — FIND A RESPRAY', cx, 60);
      ctx.letterSpacing = '0px';
    }
  }

  /** In-world job pins, clamped to the screen edge when they are somewhere off it. */
  private drawMarkers(model: HudModel): void {
    const ctx = this.r.ctx;
    const cx = this.r.cssWidth / 2;
    const cy = this.r.cssHeight / 2;
    const inset = 40;

    for (const m of model.markers) {
      const onScreen =
        m.x > inset && m.x < this.r.cssWidth - inset && m.y > inset && m.y < this.r.cssHeight - inset;

      let x = m.x;
      let y = m.y;
      if (!onScreen) {
        const dx = m.x - cx;
        const dy = m.y - cy;
        const scale = Math.min(
          (cx - inset) / Math.max(Math.abs(dx), 1e-3),
          (cy - inset) / Math.max(Math.abs(dy), 1e-3),
        );
        x = cx + dx * scale;
        y = cy + dy * scale;
      }

      ctx.beginPath();
      ctx.arc(x, y, m.objective ? 13 : 10, 0, Math.PI * 2);
      ctx.strokeStyle = m.color;
      ctx.lineWidth = m.objective ? 3 : 2;
      ctx.stroke();
      ctx.fillStyle = `${m.color}22`;
      ctx.fill();

      ctx.fillStyle = m.color;
      ctx.font = '600 9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.letterSpacing = '1px';
      ctx.fillText(m.label, x, y + 16);
      ctx.letterSpacing = '0px';
    }
  }

  /** The job in hand: what it is, what it pays, and how long the client will wait. */
  private drawJobBanner(job: NonNullable<HudModel['job']>, top: number): void {
    const ctx = this.r.ctx;
    const w = Math.min(this.r.cssWidth - 32, 360);
    const x = (this.r.cssWidth - w) / 2;
    const y = top;

    ctx.fillStyle = 'rgba(11,13,16,0.72)';
    ctx.fillRect(x, y, w, 44);
    ctx.fillStyle = job.color;
    ctx.fillRect(x, y, 3, 44);

    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = job.color;
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.letterSpacing = '1.5px';
    ctx.fillText(job.label.toUpperCase(), x + 12, y + 8);
    ctx.letterSpacing = '0px';

    ctx.fillStyle = 'rgba(210,216,224,0.75)';
    ctx.font = '400 11px ui-monospace, monospace';
    ctx.fillText(job.progress, x + 12, y + 25);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#5adca0';
    ctx.font = '600 15px ui-monospace, monospace';
    ctx.fillText(`$${job.payout.toLocaleString('en-US')}`, x + w - 12, y + 10);

    // The fare's own clock. Empty it and the client walks — no payout, no time back.
    const t = clamp(job.fareLeft / job.fareTotal, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y + 41, w, 3);
    ctx.fillStyle = t < 0.25 ? '#d83a44' : job.color;
    ctx.fillRect(x, y + 41, w * t, 3);
  }

  /**
   * Arrows at the screen edge for pursuers you cannot see yet. The badge tells you they have
   * eyes on you; without this you have no way to act on that, because a phone screen is barely
   * wider than a city block and a car closing from a parallel street is simply invisible.
   */
  private drawPursuerArrows(model: HudModel): void {
    if (model.pursuers.length === 0) return;
    const ctx = this.r.ctx;
    const cx = this.r.cssWidth / 2;
    const cy = this.r.cssHeight / 2;
    const inset = 26;

    for (const p of model.pursuers) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const onScreen =
        p.x > inset && p.x < this.r.cssWidth - inset && p.y > inset && p.y < this.r.cssHeight - inset;
      if (onScreen) continue;

      const angle = Math.atan2(dy, dx);
      // Push out to the edge of an inset rectangle rather than a circle, so arrows sit in the
      // corners of the screen the way the threat actually lies.
      const halfW = cx - inset;
      const halfH = cy - inset;
      const scale = Math.min(halfW / Math.max(Math.abs(dx), 1e-3), halfH / Math.max(Math.abs(dy), 1e-3));
      const ex = cx + dx * scale;
      const ey = cy + dy * scale;

      const distance = Math.hypot(dx, dy);
      const alpha = clamp(1.15 - distance / 1400, 0.3, 0.95);

      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(angle);
      ctx.fillStyle = `rgba(216,58,68,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(-7, 7);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-7, -7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /** The hideout hold: free to use, paid for in seconds you are not earning. */
  private drawHold(progress: number): void {
    const ctx = this.r.ctx;
    const cx = this.r.cssWidth / 2;
    const cy = this.r.cssHeight * 0.36;
    const radius = 30;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.strokeStyle = '#a882f0';
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.fillStyle = 'rgba(230,220,255,0.9)';
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.letterSpacing = '2px';
    ctx.fillText('LYING LOW', cx, cy + radius + 10);
    ctx.letterSpacing = '0px';
  }

  /**
   * The combo, shown only when there is one. It sits by the speed readout because both answer
   * the same question — how well is this run going right now.
   */
  private drawMultiplier(model: HudModel): void {
    if (model.multiplier < 1.05) return;
    const ctx = this.r.ctx;
    const heat = clamp((model.multiplier - 1) / 2, 0, 1);
    const y = this.r.cssHeight - 66;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = `rgb(${(230 + heat * 25) | 0},${(190 - heat * 60) | 0},${(90 - heat * 30) | 0})`;
    ctx.font = '700 26px "Big Shoulders Display", Impact, ui-monospace, monospace';
    ctx.fillText(`x${model.multiplier.toFixed(1)}`, this.r.cssWidth / 2, y);

    const labels: Record<string, string> = { shave: 'CLOSE', drift: 'SLIDE', dodge: 'DODGED', break: '' };
    const label = model.styleEvent ? labels[model.styleEvent] : '';
    if (label) {
      ctx.fillStyle = 'rgba(255,225,170,0.8)';
      ctx.font = '600 10px ui-monospace, monospace';
      ctx.letterSpacing = '2px';
      ctx.fillText(label, this.r.cssWidth / 2, y - 26);
      ctx.letterSpacing = '0px';
    }
  }

  private drawToast(toast: NonNullable<HudModel['toast']>): void {
    const ctx = this.r.ctx;
    ctx.globalAlpha = toast.alpha;
    ctx.fillStyle = toast.color;
    ctx.font = '700 22px "Big Shoulders Display", Impact, ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '1px';
    ctx.fillText(toast.text.toUpperCase(), this.r.cssWidth / 2, this.r.cssHeight * 0.42);
    ctx.letterSpacing = '0px';
    ctx.globalAlpha = 1;
  }

  private drawPrompt(text: string, color: string): void {
    const ctx = this.r.ctx;
    ctx.fillStyle = color;
    ctx.font = '600 12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '2px';
    ctx.fillText(text, this.r.cssWidth / 2, this.r.cssHeight * 0.3);
    ctx.letterSpacing = '0px';
  }

  private drawPad(x: number, y: number, radius: number, label: string, active: boolean): void {
    const ctx = this.r.ctx;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = active ? 'rgba(230,180,90,0.22)' : 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = active ? 'rgba(240,200,120,0.75)' : 'rgba(255,255,255,0.22)';
    ctx.stroke();

    ctx.fillStyle = active ? 'rgba(255,225,170,0.95)' : 'rgba(255,255,255,0.45)';
    ctx.font = '600 12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
  }

  /**
   * Speed lives at the bottom, between the thumbs. The top of the screen belongs to the clock,
   * the wanted badge and the job in hand — three things that all want the eye at once.
   */
  private drawSpeed(model: HudModel): void {
    const ctx = this.r.ctx;
    const w = this.r.cssWidth;
    const barW = Math.min(190, w * 0.46);
    const x = (w - barW) / 2;
    const y = this.r.cssHeight - 40;

    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y, barW, 6);
    const t = clamp(model.speed / model.topSpeed, 0, 1);
    ctx.fillStyle = t > 0.92 ? '#ffd479' : '#7fd6a8';
    ctx.fillRect(x, y, barW * t, 6);

    if (model.driftCharge > 0.05) {
      const c = clamp(model.driftCharge / 1.8, 0, 1);
      ctx.fillStyle = model.driftCharge > 0.35 ? 'rgba(255,170,90,0.95)' : 'rgba(255,170,90,0.4)';
      ctx.fillRect(x, y + 9, barW * c, 4);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '600 13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${(model.speed * 0.26) | 0} MPH`, w / 2, y - 6);
  }
}
