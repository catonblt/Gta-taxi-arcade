import { clamp, damp } from '../core/math';

/** World units across the screen's short edge. Lower = closer in. */
const VIEW_MIN = 560;

export class Camera {
  x = 0;
  y = 0;
  scale = 1;
  private leadX = 0;
  private leadY = 0;

  resize(cssWidth: number, cssHeight: number): void {
    this.scale = Math.min(cssWidth, cssHeight) / VIEW_MIN;
  }

  /**
   * Follows the car but leads it in the direction of travel, so at speed you see where you are
   * going rather than where you have been. The lead is smoothed, never snapped.
   */
  follow(x: number, y: number, vx: number, vy: number, topSpeed: number, dt: number): void {
    const speed = Math.hypot(vx, vy);
    const lead = clamp(speed / topSpeed, 0, 1) * 170;
    const dirX = speed > 1 ? vx / speed : 0;
    const dirY = speed > 1 ? vy / speed : 0;
    const k = 1 - damp(3.2, dt);
    this.leadX += (dirX * lead - this.leadX) * k;
    this.leadY += (dirY * lead - this.leadY) * k;

    const targetX = x + this.leadX;
    const targetY = y + this.leadY;
    const followK = 1 - damp(9, dt);
    this.x += (targetX - this.x) * followK;
    this.y += (targetY - this.y) * followK;
  }

  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.leadX = 0;
    this.leadY = 0;
  }
}
