import Phaser from "phaser";
import type { Burst } from "./feedback.js";
import { boil } from "./art.js";

/**
 * 10D spectacle: turns feedback bursts into longer-lived cosmetic particles
 * and camera feedback. Presentation only: it reads bursts and view positions,
 * never inputs or rules, and reduced motion drops shake, zoom and trails.
 */
export interface Keeper {
  id: string;
  x: number;
  y: number;
  color: number;
  swinging: boolean;
  alpha: number;
}
export interface Juice {
  update(
    ms: number,
    bursts: readonly { burst: Burst; color: number; local: boolean }[],
    keepers: readonly Keeper[],
    reduced: boolean,
  ): void;
  /** True for the victim's first frames after a hit: draw them white. */
  flashing(id: string, ms: number): boolean;
  destroy(): void;
}
interface Particle {
  kind: "spark" | "crack" | "confetti" | "streak" | "ring";
  x: number;
  y: number;
  vx: number;
  vy: number;
  at: number;
  life: number;
  color: number;
  seed: number;
}
const MAX_PARTICLES = 220,
  TRAIL = 12;

export function createJuice(scene: Phaser.Scene, zoom: number): Juice {
  const g = scene.add.graphics().setDepth(13.5),
    glow = scene.add
      .graphics()
      .setDepth(13.4)
      .setBlendMode(Phaser.BlendModes.ADD);
  const seen = new Map<string, number>(),
    hits = new Map<string, number>(),
    trails = new Map<string, { x: number; y: number }[]>();
  let particles: Particle[] = [],
    punchUntil = 0,
    still = false;
  const spawn = (p: Omit<Particle, "seed">, count: number) => {
    // Reduced motion keeps only the static crack decal; paintBurst still
    // draws each cue's silhouette.
    if (still && p.kind !== "crack") return;
    for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++)
      particles.push({ ...p, seed: i + (p.at % 997) });
  };
  const react = (
    burst: Burst,
    color: number,
    local: boolean,
    reduced: boolean,
  ) => {
    const camera = scene.cameras.main;
    const kick = (duration: number, intensity: number, punch: number) => {
      if (reduced) return;
      camera.shake(duration, intensity / zoom);
      if (punch) {
        camera.setZoom(zoom * (1 + punch));
        punchUntil = burst.at + 90;
      }
    };
    switch (burst.kind) {
      case "attach":
        spawn(
          {
            kind: "spark",
            x: burst.x,
            y: burst.y,
            vx: 0,
            vy: 0,
            at: burst.at,
            life: 260,
            color: 0xffd89a,
          },
          10,
        );
        spawn(
          {
            kind: "crack",
            x: burst.x,
            y: burst.y,
            vx: 0,
            vy: 0,
            at: burst.at,
            life: 1400,
            color: 0x05060b,
          },
          1,
        );
        break;
      case "impact":
        if (burst.target) hits.set(burst.target, burst.at);
        spawn(
          {
            kind: "ring",
            x: burst.x,
            y: burst.y,
            vx: 0,
            vy: 0,
            at: burst.at,
            life: 320,
            color: 0xfff2d6,
          },
          1,
        );
        spawn(
          {
            kind: "spark",
            x: burst.x,
            y: burst.y,
            vx: 0,
            vy: 0,
            at: burst.at,
            life: 340,
            color,
          },
          14,
        );
        kick(local ? 180 : 120, local ? 0.012 : 0.006, local ? 0.025 : 0.012);
        break;
      case "pop":
        spawn(
          {
            kind: "confetti",
            x: burst.x,
            y: burst.y,
            vx: 0,
            vy: 0,
            at: burst.at,
            life: 700,
            color: burst.color ?? color,
          },
          18,
        );
        spawn(
          {
            kind: "ring",
            x: burst.x,
            y: burst.y,
            vx: 0,
            vy: 0,
            at: burst.at,
            life: 260,
            color: burst.color ?? color,
          },
          1,
        );
        kick(90, 0.004, 0);
        break;
      case "vanish":
        spawn(
          {
            kind: "streak",
            x: burst.x,
            y: burst.y,
            vx: 0,
            vy: 0,
            at: burst.at,
            life: 700,
            color,
          },
          1,
        );
        spawn(
          {
            kind: "spark",
            x: burst.x,
            y: Math.min(880, burst.y),
            vx: 0,
            vy: 0,
            at: burst.at,
            life: 500,
            color,
          },
          16,
        );
        kick(260, local ? 0.014 : 0.007, local ? 0.03 : 0);
        break;
      case "boom":
        // Every blast shakes the room; one near you punches the zoom too.
        kick(local ? 320 : 220, local ? 0.02 : 0.009, local ? 0.04 : 0.012);
        break;
      case "shield":
        // A Shield that absorbed a blast bursts into shards of its bubble.
        spawn(
          {
            kind: "ring",
            x: burst.x,
            y: burst.y - 28,
            vx: 0,
            vy: 0,
            at: burst.at,
            life: 420,
            color: burst.color ?? color,
          },
          1,
        );
        spawn(
          {
            kind: "spark",
            x: burst.x,
            y: burst.y - 28,
            vx: 0,
            vy: 0,
            at: burst.at,
            life: 520,
            color: burst.color ?? color,
          },
          14,
        );
        break;
      case "blasted":
        hits.set(burst.target ?? "", burst.at);
        spawn(
          {
            kind: "spark",
            x: burst.x,
            y: burst.y,
            vx: 0,
            vy: 0,
            at: burst.at,
            life: 520,
            color,
          },
          18,
        );
        break;
      default:
        break;
    }
  };
  return {
    update(ms, bursts, keepers, reduced) {
      still = reduced;
      for (const { burst, color, local } of bursts) {
        // Colour separates two keepers' same-kind cues at one spot and time.
        const key = `${burst.kind}:${burst.at}:${Math.round(burst.x)}:${Math.round(burst.y)}:${color}`;
        if (seen.has(key)) continue;
        seen.set(key, ms);
        react(burst, color, local, reduced);
      }
      for (const [key, at] of seen) if (ms - at > 1000) seen.delete(key);
      const camera = scene.cameras.main;
      if (punchUntil && ms > punchUntil) {
        camera.setZoom(zoom);
        punchUntil = 0;
      }
      g.clear();
      glow.clear();
      // Swing ribbons: fading, tapered, additive trails behind fast swings.
      for (const k of keepers) {
        const trail = trails.get(k.id) ?? [];
        if (k.swinging && !reduced && k.alpha > 0.5)
          trail.unshift({ x: k.x, y: k.y });
        else trail.splice(Math.max(0, trail.length - 2));
        trail.length = Math.min(trail.length, TRAIL);
        trails.set(k.id, trail);
        for (let i = 1; i < trail.length; i++) {
          const t = i / TRAIL,
            a = trail[i - 1]!,
            b = trail[i]!;
          glow
            .lineStyle(14 * (1 - t), k.color, 0.28 * (1 - t))
            .lineBetween(a.x, a.y, b.x, b.y);
        }
      }
      for (const id of trails.keys())
        if (!keepers.some((k) => k.id === id)) trails.delete(id);
      particles = particles.filter((p) => ms - p.at < p.life);
      for (const p of particles) {
        const age = (ms - p.at) / p.life,
          fade = 1 - age,
          angle = (p.seed * 2.39996) % (Math.PI * 2),
          speed = 60 + ((p.seed * 37) % 11) * 12;
        switch (p.kind) {
          case "spark": {
            const r = 4 + age * speed * 0.9,
              x = p.x + Math.cos(angle) * r,
              y = p.y + Math.sin(angle) * r + age * age * 30;
            glow
              .lineStyle(2.2 * fade + 0.5, p.color, fade)
              .lineBetween(
                x,
                y,
                x - Math.cos(angle) * 9 * fade,
                y - Math.sin(angle) * 9 * fade,
              );
            break;
          }
          case "crack": {
            // An inked crack where the hook bit stone, fading slowly.
            g.lineStyle(2, p.color, 0.8 * fade);
            for (let i = 0; i < 4; i++) {
              const a = angle + i * 1.57 + boil(p.seed, i) * 0.4,
                len = 8 + Math.abs(boil(p.seed, i + 4)) * 8;
              g.lineBetween(
                p.x,
                p.y,
                p.x + Math.cos(a) * len,
                p.y + Math.sin(a) * len,
              );
            }
            break;
          }
          case "confetti": {
            const t = age * 0.7,
              x = p.x + Math.cos(angle) * speed * 1.8 * t,
              y =
                p.y + Math.sin(angle) * speed * 1.8 * t - 90 * t + 260 * t * t,
              spin = ms / 90 + p.seed;
            g.fillStyle(p.seed % 3 ? p.color : 0xfff4dc, fade);
            g.fillRect(
              x - 3 * Math.abs(Math.cos(spin)),
              y - 2,
              6 * Math.abs(Math.cos(spin)) + 1,
              4,
            );
            break;
          }
          case "ring":
            g.lineStyle(4 * fade + 1, p.color, fade).strokeCircle(
              p.x,
              p.y,
              8 + age * 44,
            );
            glow
              .fillStyle(p.color, 0.35 * fade)
              .fillCircle(p.x, p.y, 10 + age * 30);
            break;
          case "streak": {
            // A knockout streak: a light column rising from the fall point.
            const height = 520 * Math.min(1, age * 3);
            glow
              .fillStyle(p.color, 0.55 * fade)
              .fillRect(p.x - 10 * fade, 900 - height, 20 * fade, height);
            glow
              .fillStyle(0xffffff, 0.7 * fade)
              .fillRect(p.x - 3 * fade, 900 - height, 6 * fade, height);
            break;
          }
        }
      }
    },
    flashing(id, ms) {
      const at = hits.get(id);
      // No white flash under reduced motion.
      return !still && at !== undefined && ms - at >= 0 && ms - at < 70;
    },
    destroy() {
      g.destroy();
      glow.destroy();
    },
  };
}
