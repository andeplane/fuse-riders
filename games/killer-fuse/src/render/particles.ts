/**
 * The moving bits of an effect as plain numbers: square pixels thrown by a burst, rings that grow, text that rises
 * sheets that play once and the after-images of fast units. Time here is wall-clock seconds.
 */
import type {
  BurstEffect,
  Effect,
  FlareEffect,
  FountainEffect,
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
  /** Seconds lived (negative: not yet started) and seconds to live. */
  age: number;
  life: number;
  color: string;
  /** Colours it passes through over its life instead of `color`. */
  colors?: readonly string[];
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
export interface Flare extends FlareEffect {
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
      age: -(burst.delay ?? 0),
      life: burst.life * (0.6 + random() * 0.4),
      color: colors[Math.floor(random() * colors.length)] ?? "#ffffff",
      size: burst.size ?? (random() < 0.3 ? 2 : 1),
      gravity: burst.gravity ?? 160,
    });
  }
  return out;
}

/** Pixels that leave a strip one after the other and rise without falling back. */
export function fountainParticles(
  fountain: FountainEffect,
  colors: readonly string[],
  random: () => number,
): Particle[] {
  return Array.from({ length: fountain.count }, () => ({
    x: fountain.x + (random() - 0.5) * fountain.width,
    y: fountain.y,
    vx: (random() - 0.5) * 6,
    vy: -(28 + random() * 26),
    age: -random() * fountain.seconds,
    life: 0.45 + random() * 0.25,
    color: colors[Math.floor(random() * colors.length)] ?? "#ffffff",
    size: 1,
    gravity: 0,
  }));
}

/** The colour of a particle now: its one colour, or its place along the colours it passes through. */
export function particleColor(p: Particle): string {
  const { colors } = p;
  if (!colors || colors.length === 0) return p.color;
  const at = Math.floor((Math.max(0, p.age) / p.life) * colors.length);
  return colors[Math.min(colors.length - 1, at)] ?? p.color;
}

/** What streams off a diving Queen: yellow, then white, orange, red and magenta as each speck ages. */
export const DIVE_COLORS: readonly string[] = [
  "#ffe14a",
  "#ffffff",
  "#ff9d2e",
  "#ff3b3b",
  "#ff2e9d",
];
/** Specks a second, and the least and most seconds each lives. */
export const DIVE_STREAM = { rate: 300, life: [0.3, 0.5] } as const;

/** `count` specks of the dive stream somewhere along a body `height` tall whose feet are at (x, y). */
export function diveStream(
  x: number,
  y: number,
  height: number,
  count: number,
  random: () => number,
): Particle[] {
  const [least, most] = DIVE_STREAM.life;
  return Array.from({ length: count }, (_, index) => ({
    x: x + (random() - 0.5) * 5,
    y: y - random() * height,
    vx: (random() - 0.5) * 10,
    vy: -(15 + random() * 30),
    age: 0,
    life: least + random() * (most - least),
    color: DIVE_COLORS[0] ?? "#ffffff",
    colors: DIVE_COLORS,
    // Every third is a fat one, so the stream still reads at game scale.
    size: index % 3 === 0 ? 2 : 1,
    gravity: 0,
  }));
}

/** One after-image: a unit's frame where it was. */
export interface Ghost {
  readonly slot: number;
  readonly team: number;
  readonly sheet: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly flip: boolean;
  /** Wall-clock second it was left. */
  readonly born: number;
}

/** A ghost is left every 20 ms and lives 200 ms, fading evenly: the arcade's dive and speed trail. */
export const GHOST_EVERY = 0.02,
  GHOST_LIFE = 0.2;

export class Ghosts {
  list: Ghost[] = [];
  private readonly last: (Ghost | undefined)[] = [];

  /** Leaves a ghost unless this slot left one too recently or has not moved since. */
  note(ghost: Ghost): void {
    const before = this.last[ghost.slot];
    if (
      before &&
      ghost.born >= before.born &&
      (ghost.born - before.born < GHOST_EVERY ||
        (before.x === ghost.x && before.y === ghost.y))
    )
      return;
    this.last[ghost.slot] = ghost;
    this.list.push(ghost);
  }

  /** Drops the ghosts that have faded, and any from a clock that has since gone back. */
  tick(now: number): void {
    this.list = this.list.filter(
      (ghost) => now >= ghost.born && now - ghost.born < GHOST_LIFE,
    );
  }

  /** How much of a ghost is left, 1 to 0. */
  static left(ghost: Ghost, now: number): number {
    return Math.max(0, Math.min(1, 1 - (now - ghost.born) / GHOST_LIFE));
  }

  clear(): void {
    this.list = [];
    this.last.length = 0;
  }
}

export class EffectPool {
  particles: Particle[] = [];
  rings: Ring[] = [];
  texts: Rising[] = [];
  sprites: Playing[] = [];
  flares: Flare[] = [];

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
      case "fountain":
        this.push(
          fountainParticles(
            effect,
            toneColors(effect.tone, ramp(effect.team)),
            this.random,
          ),
        );
        return;
      case "flare":
        this.flares.push({ ...effect, age: 0 });
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
      // One that has not started waits where it will appear.
      if (p.age < 0) continue;
      p.vy += p.gravity * dt;
      p.x = (((p.x + p.vx * dt) % VIEW_WIDTH) + VIEW_WIDTH) % VIEW_WIDTH;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const ring of this.rings) ring.age += dt;
    this.rings = this.rings.filter((ring) => ring.age < RING_LIFE);
    for (const flare of this.flares) flare.age += dt;
    this.flares = this.flares.filter((flare) => flare.age < flare.life);
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
    this.flares = [];
  }

  get count(): number {
    return (
      this.particles.length +
      this.rings.length +
      this.texts.length +
      this.sprites.length +
      this.flares.length
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

/** 0 to 1 passing a little beyond 1 before settling; `spring` is how far beyond (1.70158 gives a tenth). */
export function easeOutBack(t: number, spring = 1.70158): number {
  const x = Math.max(0, Math.min(1, t)) - 1;
  return 1 + (spring + 1) * x * x * x + spring * x * x;
}

/** Half the width of a filled disc of radius `r`, `dy` rows from its middle; -1 outside it. */
export function discHalfWidth(r: number, dy: number): number {
  return Math.abs(dy) > r ? -1 : Math.round(Math.sqrt(r * r - dy * dy));
}
