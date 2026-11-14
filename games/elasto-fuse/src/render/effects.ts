import { hexA } from "./palette.js";

/**
 * The picture's own sparks: apple pops, crash bursts, finish sparkles and the dust a driven wheel throws. They live in
 * world units, move by the wall clock and never reach the simulation. The list is bounded, so a long race cannot grow
 * it.
 */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived and to live. */
  age: number;
  life: number;
  size: number;
  color: string;
  /** How hard it falls, world units a second squared. */
  fall: number;
  /** The rider slot whose pane shows it, or −1 for every pane. */
  tag: number;
}

export const MAX_PARTICLES = 400;

export interface Effects {
  burst(
    x: number,
    y: number,
    color: string,
    count: number,
    speed: number,
    options?: {
      life?: number;
      size?: number;
      fall?: number;
      up?: number;
      tag?: number;
    },
  ): void;
  /** One puff of dust thrown from (x, y) the way (dx, dy) points. */
  dust(
    x: number,
    y: number,
    dx: number,
    dy: number,
    color: string,
    tag: number,
  ): void;
  step(seconds: number): void;
  /** Draws the sparks a pane following rider `tag` shows. */
  draw(g: CanvasRenderingContext2D, tag: number): void;
  clear(): void;
  readonly count: number;
}

export function createEffects(random: () => number): Effects {
  let list: Particle[] = [];
  const add = (particle: Particle) => {
    if (list.length >= MAX_PARTICLES) list.shift();
    list.push(particle);
  };
  return {
    burst(x, y, color, count, speed, options = {}) {
      for (let i = 0; i < count; i++) {
        const angle = random() * Math.PI * 2,
          v = speed * (0.35 + random() * 0.65);
        add({
          x,
          y,
          vx: Math.cos(angle) * v,
          vy: Math.sin(angle) * v + (options.up ?? 0),
          age: 0,
          life: (options.life ?? 0.6) * (0.6 + random() * 0.4),
          size: (options.size ?? 0.08) * (0.6 + random() * 0.6),
          color,
          fall: options.fall ?? 6,
          tag: options.tag ?? -1,
        });
      }
    },
    dust(x, y, dx, dy, color, tag) {
      add({
        x,
        y,
        vx: dx * (1.5 + random() * 2) + (random() - 0.5),
        vy: dy * (1.5 + random() * 2) + random() * 1.5,
        age: 0,
        life: 0.25 + random() * 0.25,
        size: 0.05 + random() * 0.05,
        color,
        fall: 4,
        tag,
      });
    },
    step(seconds) {
      const dt = Math.max(0, Math.min(0.1, seconds));
      for (const p of list) {
        p.age += dt;
        p.vy -= p.fall * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      list = list.filter((p) => p.age < p.life);
    },
    draw(g, tag) {
      for (const p of list) {
        if (p.tag !== -1 && p.tag !== tag) continue;
        const left = 1 - p.age / p.life;
        g.fillStyle = hexA(p.color, left);
        g.beginPath();
        g.arc(p.x, p.y, p.size * (0.5 + left * 0.5), 0, Math.PI * 2);
        g.fill();
      }
    },
    clear() {
      list = [];
    },
    get count() {
      return list.length;
    },
  };
}
