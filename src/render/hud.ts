import type { PadLayout } from '../core/input';
import { clamp } from '../core/math';
import type { Renderer } from './renderer';

export interface HudModel {
  speed: number;
  topSpeed: number;
  driftCharge: number;
  drifting: boolean;
  fps: number;
  showDebug: boolean;
}

export class Hud {
  constructor(private readonly r: Renderer) {}

  draw(model: HudModel, pads: PadLayout): void {
    const ctx = this.r.ctx;
    ctx.setTransform(this.r.dpr, 0, 0, this.r.dpr, 0, 0);
    this.drawPad(pads.driftX, pads.driftY, pads.radius, 'DRIFT', model.drifting);
    this.drawPad(pads.brakeX, pads.brakeY, pads.radius, 'BRAKE', false);
    this.drawSpeed(model);
    if (model.showDebug) {
      ctx.fillStyle = model.fps < 50 ? '#ff8080' : 'rgba(255,255,255,0.55)';
      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${model.fps.toFixed(0)} fps`, 12, 20);
    }
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

  private drawSpeed(model: HudModel): void {
    const ctx = this.r.ctx;
    const w = this.r.cssWidth;
    const barW = Math.min(190, w * 0.42);
    const x = w - barW - 16;
    const y = 24;

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
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${(model.speed * 0.26) | 0} MPH`, x + barW, y + 18);
  }
}
