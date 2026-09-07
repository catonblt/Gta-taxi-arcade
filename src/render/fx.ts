interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; alive: boolean;
  r: number; g: number; b: number;
}

/** Pooled particles: tyre smoke and impact debris. Never allocates during play. */
export class Fx {
  private readonly pool: Particle[] = [];
  private readonly skids: { x: number; y: number; a: number; life: number }[] = [];

  constructor(capacity = 220, private readonly skidCapacity = 300) {
    for (let i = 0; i < capacity; i++) {
      this.pool.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, alive: false, r: 200, g: 200, b: 200 });
    }
  }

  smoke(x: number, y: number, vx: number, vy: number, amount = 1): void {
    for (let i = 0; i < amount; i++) {
      const p = this.pool.find((q) => !q.alive);
      if (!p) return;
      p.alive = true;
      p.x = x; p.y = y;
      p.vx = vx * 0.12 + (Math.random() - 0.5) * 26;
      p.vy = vy * 0.12 + (Math.random() - 0.5) * 26;
      p.maxLife = p.life = 0.55 + Math.random() * 0.4;
      p.size = 5 + Math.random() * 7;
      p.r = 190; p.g = 190; p.b = 195;
    }
  }

  sparks(x: number, y: number, amount = 6): void {
    for (let i = 0; i < amount; i++) {
      const p = this.pool.find((q) => !q.alive);
      if (!p) return;
      p.alive = true;
      p.x = x; p.y = y;
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 180;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.maxLife = p.life = 0.25 + Math.random() * 0.25;
      p.size = 2 + Math.random() * 2.5;
      p.r = 255; p.g = 190; p.b = 90;
    }
  }

  skid(x: number, y: number, angle: number): void {
    if (this.skids.length >= this.skidCapacity) this.skids.shift();
    this.skids.push({ x, y, a: angle, life: 4.5 });
  }

  step(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
    }
    for (let i = this.skids.length - 1; i >= 0; i--) {
      this.skids[i].life -= dt;
      if (this.skids[i].life <= 0) this.skids.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const s of this.skids) {
      ctx.globalAlpha = Math.min(0.32, s.life / 4.5 * 0.32);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(s.x - Math.cos(s.a) * 7, s.y - Math.sin(s.a) * 7);
      ctx.lineTo(s.x + Math.cos(s.a) * 7, s.y + Math.sin(s.a) * 7);
      ctx.stroke();
    }
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = t * 0.5;
      ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.4 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
