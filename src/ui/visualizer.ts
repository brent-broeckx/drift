import type { NoteEvent } from '../audio/generator';
import type { MoodPreset } from '../audio/moods';

type Palette = MoodPreset['palette'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hue: number;
  alpha: number;
  age: number;
  life: number;
}

interface LivePalette {
  bg: [number, number, number];
  hues: number[];
  saturation: number;
  lightness: number;
}

const MAX_PARTICLES = 260;
const HUE_SLOTS = 4;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpHue = (a: number, b: number, t: number) => {
  const d = ((b - a + 540) % 360) - 180; // shortest way round the colour wheel
  return (a + d * t + 360) % 360;
};

function toLive(p: Palette): LivePalette {
  const hues = Array.from({ length: HUE_SLOTS }, (_, i) => p.hues[i % p.hues.length]);
  return { bg: [...p.background], hues, saturation: p.saturation, lightness: p.lightness };
}

/**
 * Full-screen canvas: soft glowing circles per note (y = pitch, size = velocity)
 * and a background pulse driven by an AnalyserNode.
 */
export class Visualizer {
  private readonly ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private current: LivePalette;
  private target: LivePalette;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private level = 0;
  private lastTime = performance.now();
  private buffer: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getAnalyser: () => AnalyserNode | null,
    palette: Palette,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
    this.current = toLive(palette);
    this.target = toLive(palette);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame((t) => this.frame(t));
  }

  setPalette(palette: Palette): void {
    this.target = toLive(palette);
  }

  spawn(e: NoteEvent): void {
    const { width: w, height: h } = this;
    const base = Math.min(w, h);
    // Pitch -> vertical position (high notes near the top).
    const t = Math.min(1, Math.max(0, (e.midi - 28) / (90 - 28)));
    const y = h * (0.9 - t * 0.8) + (Math.random() - 0.5) * h * 0.04;
    const hue = this.current.hues[e.midi % HUE_SLOTS] + (Math.random() - 0.5) * 16;
    const drift = this.reducedMotion ? 0 : 1;

    let p: Particle;
    if (e.voice === 'lead') {
      p = {
        x: w * (0.08 + Math.random() * 0.84),
        y,
        vx: (Math.random() - 0.5) * 6 * drift,
        vy: -(4 + Math.random() * 6) * drift,
        radius: base * (0.025 + e.velocity * 0.09),
        hue,
        alpha: 0.35 + e.velocity * 0.55,
        age: 0,
        life: 7 + Math.random() * 4,
      };
    } else if (e.voice === 'pad') {
      p = {
        x: w * (0.15 + Math.random() * 0.7),
        y,
        vx: (Math.random() - 0.5) * 3 * drift,
        vy: -1.5 * drift,
        radius: base * (0.14 + e.velocity * 0.3),
        hue,
        alpha: 0.16 + e.velocity * 0.12,
        age: 0,
        life: 9 + Math.random() * 3,
      };
    } else {
      p = {
        x: w * (0.3 + Math.random() * 0.4),
        y: h * 0.95,
        vx: 0,
        vy: -2 * drift,
        radius: base * (0.35 + e.velocity * 0.2),
        hue,
        alpha: 0.1,
        age: 0,
        life: 10,
      };
    }
    this.particles.push(p);
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private readLevel(): number {
    const analyser = this.getAnalyser();
    if (!analyser) return 0;
    if (this.buffer.length !== analyser.fftSize) this.buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (let i = 0; i < this.buffer.length; i++) sum += this.buffer[i] * this.buffer[i];
    const rms = Math.sqrt(sum / this.buffer.length);
    return Math.min(1, rms * 5);
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.updatePalette(dt);

    const target = this.readLevel();
    this.level += (target - this.level) * Math.min(1, dt * (target > this.level ? 6 : 2));

    const { ctx, width: w, height: h, current: c } = this;
    const [bh, bs, bl] = c.bg;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `hsl(${bh} ${bs}% ${bl}%)`;
    ctx.fillRect(0, 0, w, h);

    // Background pulse tied to overall output level.
    const pulseR = Math.max(w, h) * (0.55 + this.level * 0.25);
    const pulse = ctx.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, pulseR);
    pulse.addColorStop(0, `hsl(${c.hues[0]} ${c.saturation}% ${c.lightness * 0.5}% / ${0.06 + this.level * 0.22})`);
    pulse.addColorStop(1, `hsl(${c.hues[0]} ${c.saturation}% ${c.lightness * 0.5}% / 0)`);
    ctx.fillStyle = pulse;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'lighter';
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const progress = p.age / p.life;
      const fadeIn = Math.min(1, p.age / 0.25);
      const alpha = p.alpha * fadeIn * Math.pow(1 - progress, 1.15);
      const r = p.radius * (0.75 + 0.5 * Math.sqrt(progress));
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, `hsl(${p.hue} ${c.saturation}% ${Math.min(90, c.lightness + 15)}% / ${alpha})`);
      g.addColorStop(0.35, `hsl(${p.hue} ${c.saturation}% ${c.lightness}% / ${alpha * 0.45})`);
      g.addColorStop(1, `hsl(${p.hue} ${c.saturation}% ${c.lightness}% / 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      alive.push(p);
    }
    this.particles = alive;

    requestAnimationFrame((t) => this.frame(t));
  }

  private updatePalette(dt: number): void {
    const k = Math.min(1, dt * 1.2);
    const c = this.current;
    const t = this.target;
    c.bg = [lerpHue(c.bg[0], t.bg[0], k), lerp(c.bg[1], t.bg[1], k), lerp(c.bg[2], t.bg[2], k)];
    c.hues = c.hues.map((h, i) => lerpHue(h, t.hues[i], k));
    c.saturation = lerp(c.saturation, t.saturation, k);
    c.lightness = lerp(c.lightness, t.lightness, k);
  }
}
