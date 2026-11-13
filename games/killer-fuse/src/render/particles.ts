/**
 * The moving bits of an effect as plain numbers: square pixels thrown by a burst, rings that grow, text that rises
 * and sheets that play once. Time here is wall-clock seconds, so effects keep moving through a hit-stop.
 */
import type {
  BurstEffect,
  Effect,
  RingEffect,
  SpriteEffect,
  TextEffect,
  Tone,
} from "./effects.js";
import { VIEW_WIDTH } from "./layout.js";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived and seconds to live. */
  age: number;
  life: number;
  color: string;
  size: number;
  /** Pixels per second squared, downward. */
  gravity: number;
}

export interface Ring extends RingEffect {
  age: number;
}
export interface Rising extends TextEffect {
  age: number;
}
export interface Playing extends SpriteEffect {
  age: number;
}

export const RING_LIFE = 0.45;
export const TEXT_LIFE = 0.8;
/** More than this many particles and the oldest go: a pile-up of events must not cost frames. */
export const MAX_PARTICLES = 600;

export const BERRY_COLORS: readonly string[] = [
  "#b4f03c",
  "#7fd42a",
  "#ecffa6",
];
export const GOLD_COLORS: readonly string[] = ["#ffd23f", "#fff3a0", "#ff9d2e"];
export const WHITE_COLORS: readonly string[] = ["#ffffff", "#d8e6ff"];

/** The colours a tone means for a team; `ramp` is that team's four steps, dark to light. */
export function toneColors(
  tone: Tone,
  ramp: readonly string[],
): readonly string[] {
  if (tone === "berry") return BERRY_COLORS;
  if (tone === "gold") return GOLD_COLORS;
  if (tone === "white") return WHITE_COLORS;
  const bright = ramp.slice(2);
  return bright.length > 0 ? [...bright, "#ffffff"] : WHITE_COLORS;
}

/** The pixels of one burst, thrown evenly around the circle with `random` (0 to 1) varying each. */
export function burstParticles(
  burst: BurstEffect,
  colors: readonly string[],
  random: () => number,
): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < burst.count; i += 1) {
    const angle = ((i + random()) / burst.count) * Math.PI * 2;
    const speed = burst.speed * (0.35 + random() * 0.65);
    out.push({
      x: burst.x,
      y: burst.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - burst.speed * 0.25,
      age: 0,
      life: burst.life * (0.6 + random() * 0.4),
      color: colors[Math.floor(random() * colors.length)] ?? "#ffffff",
      size: random() < 0.3 ? 2 : 1,
      gravity: 160,
    });
  }
  return out;
}

export class EffectPool {
  particles: Particle[] = [];
  rings: Ring[] = [];
  texts: Rising[] = [];
  sprites: Playing[] = [];

  constructor(private readonly random: () => number = Math.random) {}

  /** Starts an effect. `ramp` gives a team's colours and `duration` a sheet's play time, 0 for an unknown sheet. */
  add(
    effect: Effect,
    ramp: (team: number) => readonly string[],
    duration: (sheet: string) => number,
  ): void {
    switch (effect.kind) {
      case "burst":
        this.push(
          burstParticles(
            effect,
            toneColors(effect.tone, ramp(effect.team)),
            this.random,
          ),
        );
        return;
      case "ring":
        this.rings.push({ ...effect, age: 0 });
        return;
      case "text":
        this.texts.push({ ...effect, age: 0 });
        return;
      case "sprite":
        if (duration(effect.sheet) > 0)
          this.sprites.push({ ...effect, age: 0 });
        return;
    }
  }

  push(particles: readonly Particle[]): void {
    this.particles.push(...particles);
    if (this.particles.length > MAX_PARTICLES)
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  /** Moves everything on by `seconds` and drops what has finished. */
  tick(seconds: number, duration: (sheet: string) => number): void {
    const dt = Math.max(0, seconds);
    for (const p of this.particles) {
      p.age += dt;
      p.vy += p.gravity * dt;
      p.x = (((p.x + p.vx * dt) % VIEW_WIDTH) + VIEW_WIDTH) % VIEW_WIDTH;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const ring of this.rings) ring.age += dt;
    this.rings = this.rings.filter((ring) => ring.age < RING_LIFE);
    for (const text of this.texts) text.age += dt;
    this.texts = this.texts.filter((text) => text.age < TEXT_LIFE);
    for (const sprite of this.sprites) sprite.age += dt;
    this.sprites = this.sprites.filter(
      (sprite) => sprite.age < duration(sprite.sheet),
    );
  }

  clear(): void {
    this.particles = [];
    this.rings = [];
    this.texts = [];
    this.sprites = [];
  }

  get count(): number {
    return (
      this.particles.length +
      this.rings.length +
      this.texts.length +
      this.sprites.length
    );
  }
}

/** The points of a one-pixel circle outline of whole radius `r` around the origin, each once. */
export function circlePoints(r: number): [number, number][] {
  const radius = Math.max(0, Math.round(r));
  if (radius === 0) return [[0, 0]];
  const seen = new Set<string>();
  const out: [number, number][] = [];
  const put = (x: number, y: number): void => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([x, y]);
  };
  let x = radius,
    y = 0,
    error = 1 - radius;
  while (x >= y) {
    for (const [a, b] of [
      [x, y],
      [y, x],
    ] as const) {
      put(a, b);
      put(-a, b);
      put(a, -b);
      put(-a, -b);
    }
    y += 1;
    if (error < 0) error += 2 * y + 1;
    else {
      x -= 1;
      error += 2 * (y - x) + 1;
    }
  }
  return out;
}

/** 0 to 1 with a small overshoot before settling: how a banner lands. */
export function easeOutBack(t: number): number {
  const x = Math.max(0, Math.min(1, t)) - 1;
  return 1 + 2.70158 * x * x * x + 1.70158 * x * x;
}
