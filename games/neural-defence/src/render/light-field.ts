import { seededRandom } from "./neuron-form.js";

/**
 * Emissive light for the battlefield: soft glows, sparks and embers drawn
 * additively over the board by a GPU renderer. Everything here is cosmetic
 * and derived from presentation time; nothing reads or changes world state.
 *
 * Each instance is eight floats: x, y (board units), size (board-unit
 * radius), r, g, b (0–1), alpha, and falloff sharpness (≈2 soft glow, ≈14 hot
 * spark).
 */
export const LIGHT_STRIDE = 8;

/**
 * Board units to canvas CSS pixels (an SVG CTM relative to the canvas), plus
 * the canvas size in CSS pixels. Measured before a frame's DOM writes so
 * drawing never forces a synchronous layout.
 */
export interface LightTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  width: number;
  height: number;
}
export interface LightRenderer {
  draw(instances: Float32Array, count: number, transform: LightTransform): void;
}

export type Rgb = readonly [number, number, number];
export function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const WHITE: Rgb = [1, 1, 1];

export interface BurstSpec {
  count: number;
  /** Ground speed, board units per second. */
  speed: readonly [number, number];
  /** Initial upward speed, board units per second. */
  lift: readonly [number, number];
  /** Lifetime, ms. */
  life: readonly [number, number];
  size: readonly [number, number];
  /** Colour at birth, fading to `color`. */
  hot: Rgb;
  color: Rgb;
  alpha: number;
  sharpness: number;
  gravity: number;
  /** Fraction of velocity lost per second. */
  drag: number;
  /** Starting height above the ground. */
  height?: number;
}
interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  born: number;
  life: number;
  size: number;
  hot: Rgb;
  color: Rgb;
  alpha: number;
  sharpness: number;
  gravity: number;
  drag: number;
}
/** A flash that swells and fades without moving. */
interface Flash {
  x: number;
  y: number;
  born: number;
  life: number;
  size: number;
  color: Rgb;
  alpha: number;
}

const GROUND_DEPTH = 0.72;

export class LightField {
  private buffer: Float32Array;
  private count = 0;
  private particles: Particle[] = [];
  private flashes: Flash[] = [];
  private last = Number.NaN;

  constructor(private readonly budget = 3000) {
    this.buffer = new Float32Array(budget * LIGHT_STRIDE);
  }

  get size(): number {
    return this.count;
  }
  get instances(): Float32Array {
    return this.buffer;
  }
  get live(): number {
    return this.particles.length + this.flashes.length;
  }

  /** Start a frame; static and dynamic lights are added again every frame. */
  begin(): void {
    this.count = 0;
  }

  add(
    x: number,
    y: number,
    size: number,
    color: Rgb,
    alpha: number,
    sharpness = 2.5,
  ): void {
    if (this.count >= this.budget || alpha <= 0.002 || size <= 0) return;
    const o = this.count++ * LIGHT_STRIDE;
    const b = this.buffer;
    b[o] = x;
    b[o + 1] = y;
    b[o + 2] = size;
    b[o + 3] = color[0];
    b[o + 4] = color[1];
    b[o + 5] = color[2];
    b[o + 6] = alpha;
    b[o + 7] = sharpness;
  }

  flash(
    x: number,
    y: number,
    now: number,
    size: number,
    color: Rgb,
    alpha: number,
    life: number,
  ): void {
    this.flashes.push({ x, y, born: now, life, size, color, alpha });
  }

  burst(
    x: number,
    y: number,
    now: number,
    seed: number,
    spec: BurstSpec,
  ): void {
    const random = seededRandom(seed);
    const pick = ([low, high]: readonly [number, number]) =>
      low + random() * (high - low);
    const room = this.budget - this.particles.length;
    for (let i = 0; i < Math.min(spec.count, room); i++) {
      const angle = random() * Math.PI * 2;
      const speed = pick(spec.speed);
      this.particles.push({
        x,
        y,
        z: spec.height ?? 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * GROUND_DEPTH,
        vz: pick(spec.lift),
        born: now,
        life: pick(spec.life),
        size: pick(spec.size),
        hot: spec.hot,
        color: spec.color,
        alpha: spec.alpha,
        sharpness: spec.sharpness,
        gravity: spec.gravity,
        drag: spec.drag,
      });
    }
  }

  /** Advance sparks and flashes, adding the visible ones to this frame. */
  step(now: number, reducedMotion: boolean): void {
    // Integrate with a clamped step so a stalled tab resumes calmly.
    const dt = Number.isNaN(this.last)
      ? 0
      : Math.min(0.05, Math.max(0, now - this.last) / 1000);
    this.last = now;
    if (reducedMotion) {
      this.particles = [];
      this.flashes = [];
      return;
    }
    this.flashes = this.flashes.filter((f) => {
      const t = (now - f.born) / f.life;
      if (t >= 1) return false;
      if (t < 0) return true;
      const swell = 0.55 + 0.45 * Math.min(1, t * 4);
      this.add(f.x, f.y, f.size * swell, f.color, f.alpha * (1 - t) ** 2, 2);
      this.add(
        f.x,
        f.y,
        f.size * 0.3 * swell,
        WHITE,
        f.alpha * (1 - t) ** 3,
        4,
      );
      return true;
    });
    this.particles = this.particles.filter((p) => {
      const t = (now - p.born) / p.life;
      if (t >= 1) return false;
      if (t < 0) return true;
      const damping = Math.exp(-p.drag * dt);
      p.vx *= damping;
      p.vy *= damping;
      p.vz -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z < 0) {
        // Land and skid: sparks bounce low, then settle on the ground.
        p.z = 0;
        p.vz = -p.vz * 0.35;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      const u = Math.min(1, t * 2.2);
      const color: Rgb = [
        p.hot[0] + (p.color[0] - p.hot[0]) * u,
        p.hot[1] + (p.color[1] - p.hot[1]) * u,
        p.hot[2] + (p.color[2] - p.hot[2]) * u,
      ];
      const fade = t < 0.1 ? t / 0.1 : 1 - ((t - 0.1) / 0.9) ** 1.5;
      this.add(p.x, p.y - p.z, p.size, color, p.alpha * fade, p.sharpness);
      return true;
    });
  }
}

/** Presets tuned against the board's scale (a hex is about 60 units across). */
export const SPARKS = (color: Rgb): BurstSpec => ({
  count: 16,
  speed: [40, 150],
  lift: [30, 110],
  life: [260, 620],
  size: [2.2, 4],
  hot: [1, 0.96, 0.85],
  color,
  alpha: 1,
  sharpness: 9,
  gravity: 380,
  drag: 2.2,
  height: 8,
});
export const EMBERS: BurstSpec = {
  count: 42,
  speed: [20, 120],
  lift: [60, 190],
  life: [700, 1700],
  size: [2.2, 4.8],
  hot: [1, 0.95, 0.75],
  color: [1, 0.36, 0.08],
  alpha: 1,
  sharpness: 7,
  gravity: 150,
  drag: 1.4,
  height: 12,
};
export const CYTOPLASM = (color: Rgb): BurstSpec => ({
  count: 28,
  speed: [30, 110],
  lift: [40, 130],
  life: [600, 1300],
  size: [2.5, 5],
  hot: [1, 1, 1],
  color,
  alpha: 0.9,
  sharpness: 5,
  gravity: 260,
  drag: 1.8,
  height: 6,
});
export const SPROUT = (color: Rgb): BurstSpec => ({
  count: 18,
  speed: [4, 22],
  lift: [25, 60],
  life: [900, 1800],
  size: [1.8, 3.4],
  hot: [1, 1, 1],
  color,
  alpha: 0.85,
  sharpness: 6,
  gravity: -6,
  drag: 0.8,
  height: 2,
});
