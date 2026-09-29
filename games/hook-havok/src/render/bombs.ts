import Phaser from "phaser";
import { BOMB_VIEW, throwPreview, type WorldView } from "../engine/view.js";
import type { Burst, Cue } from "./feedback.js";
import { boil } from "./art.js";

/**
 * 11B bomb presentation: bombs, wind-ups, the local arc preview, blasts and
 * scorch marks. Cosmetic history only. Positions, fuses and blasts come from
 * the view; spin, squash, smoke and debris are derived here and never feed
 * back. Reduced motion keeps the bomb, its blink, the red radius ring, the
 * blast flash and the shockwave, and drops spin, squash, smoke, debris and
 * (in juice) shake.
 */
export interface BombKeeper {
  id: string;
  x: number;
  feet: number;
  facing: -1 | 1;
  charge: number;
  color: number;
  alpha: number;
}
export interface BombFrame {
  cues: Cue[];
  /** New blasts for camera juice, with whether they were near the local keeper. */
  bursts: { burst: Burst; color: number; local: boolean }[];
}
export interface Bombs {
  update(
    world: WorldView,
    ms: number,
    reduced: boolean,
    keepers: readonly BombKeeper[],
    color: (owner: string) => number,
    local?: { view: WorldView; aim?: { x: number; y: number } },
  ): BombFrame;
  reset(): void;
  destroy(): void;
}
interface Tracked {
  x: number;
  y: number;
  vy: number;
  at: number;
  spin: number;
  squash: number;
  trail: { x: number; y: number; at: number }[];
}
interface Fx {
  x: number;
  y: number;
  at: number;
  color: number;
  seed: number;
}
const FLASH = 140,
  WAVE = 420,
  DEBRIS = 800,
  SCORCH = 7000,
  TRAIL_MS = 380;

export function createBombs(scene: Phaser.Scene): Bombs {
  const scorch = scene.add.graphics().setDepth(3.5),
    smoke = scene.add.graphics().setDepth(12.2),
    body = scene.add.graphics().setDepth(12.6),
    glow = scene.add
      .graphics()
      .setDepth(13.6)
      .setBlendMode(Phaser.BlendModes.ADD);
  const tracked = new Map<number, Tracked>(),
    seenBlasts = new Map<number, number>(),
    blasts: Fx[] = [],
    marks: (Fx & { width: number })[] = [];
  let primed = false,
    lastMs = 0;
  const ledgeTop = (world: WorldView, x: number, y: number) =>
    world.platforms.find(
      ([px, py, w]) =>
        x >= px - 6 && x <= px + w + 6 && y >= py - 30 && y <= py + 12,
    );
  const paintBomb = (
    x: number,
    y: number,
    radius: number,
    spin: number,
    squash: number,
    tint: number,
    lit: number,
    alpha: number,
  ) => {
    const sx = 1 + squash * 0.3,
      sy = 1 - squash * 0.3;
    body
      .fillStyle(0x07090f, 0.35 * alpha)
      .fillEllipse(x + 2, y + radius * sy + 1, radius * 1.8, 4);
    body
      .fillStyle(0x0b0e18, alpha)
      .fillEllipse(x, y, (radius + 2) * 2 * sx, (radius + 2) * 2 * sy);
    // A halo in the owner's colour keeps the dark iron readable on dark stone.
    glow
      .fillStyle(lit > 0 ? 0xff3b30 : tint, (lit > 0 ? 0.5 : 0.3) * alpha)
      .fillCircle(x, y, radius * 2.1);
    body
      .fillStyle(lit > 0 ? 0xff3b30 : 0x3a4058, alpha)
      .fillEllipse(x, y, radius * 2 * sx, radius * 2 * sy);
    body
      .lineStyle(1.5, 0xe6e8f5, 0.8 * alpha)
      .strokeEllipse(x, y, radius * 2 * sx, radius * 2 * sy);
    // Owner band and highlight turn with the spin.
    const cx = Math.cos(spin),
      cy = Math.sin(spin);
    body
      .lineStyle(3, tint, alpha)
      .lineBetween(
        x - cx * radius * 0.9 * sx,
        y - cy * radius * 0.9 * sy,
        x + cx * radius * 0.9 * sx,
        y + cy * radius * 0.9 * sy,
      );
    body
      .fillStyle(0xfff1d1, 0.55 * alpha)
      .fillCircle(x - radius * 0.35, y - radius * 0.4 * sy, radius * 0.28);
    // Fuse cap on the rim, perpendicular to the band.
    const fx = x - cy * (radius + 2) * sx,
      fy = y + cx * (radius + 2) * sy;
    body
      .lineStyle(3, 0xc9a86a, alpha)
      .lineBetween(x - cy * radius * sx, y + cx * radius * sy, fx, fy);
    return { fx, fy };
  };
  return {
    update(world, ms, reduced, keepers, color, local) {
      const cues: Cue[] = [],
        bursts: BombFrame["bursts"] = [];
      const dt = Math.max(0, Math.min(50, ms - lastMs));
      lastMs = ms;
      scorch.clear();
      smoke.clear();
      body.clear();
      glow.clear();
      // Wind-up: the bomb held high, a glow that grows, a ring that fills.
      for (const k of keepers) {
        if (k.charge <= 0 || k.alpha < 0.5) continue;
        const hx = k.x + k.facing * 14,
          hy = k.feet - 70,
          full = k.charge >= 1,
          pulse = reduced ? 1 : 0.85 + Math.sin(ms / 70) * 0.15;
        glow
          .fillStyle(full ? 0xfff2c4 : k.color, 0.28 * pulse)
          .fillCircle(hx, hy, 12 + 18 * k.charge);
        paintBomb(
          hx,
          hy,
          BOMB_VIEW.radius * 0.85,
          -0.6 * k.facing,
          0,
          k.color,
          0,
          k.alpha,
        );
        glow
          .fillStyle(0xffd27a, 0.9)
          .fillCircle(
            hx - 6 * k.facing,
            hy - 9,
            2.5 + (reduced ? 0 : boil(Math.floor(ms / 45), k.x | 0)),
          );
        body
          .lineStyle(3, 0x0b0e18, 0.7 * k.alpha)
          .strokeCircle(k.x, k.feet - 31, 34);
        body.lineStyle(full ? 4 : 3, full ? 0xfff2c4 : k.color, k.alpha);
        body.beginPath();
        body.arc(
          k.x,
          k.feet - 31,
          34,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * Math.min(1, k.charge),
        );
        body.strokePath();
      }
      // The local thrower's arc: dots where a release now would send the bomb.
      if (local?.aim) {
        const points = throwPreview(local.view, local.aim);
        points.forEach((p, i) => {
          const last = i === points.length - 1,
            fade = 1 - i / (points.length + 4);
          body
            .fillStyle(0x0b0e18, 0.55 * fade)
            .fillCircle(p.x, p.y, last ? 5 : 3.8);
          body
            .fillStyle(last ? 0xff8f6b : 0xfff1d1, 0.9 * fade)
            .fillCircle(p.x, p.y, last ? 3.5 : 2.4);
        });
        const end = points.at(-1);
        if (end)
          body
            .lineStyle(1.5, 0xff8f6b, 0.45)
            .strokeCircle(end.x, end.y, BOMB_VIEW.blast);
      }
      // Live bombs.
      const live = new Set<number>();
      for (const b of world.bombs) {
        live.add(b.id);
        let t = tracked.get(b.id);
        if (!t) {
          t = {
            x: b.x,
            y: b.y,
            vy: b.vy,
            at: ms,
            spin: 0,
            squash: -1,
            trail: [],
          };
          tracked.set(b.id, t);
          if (primed) cues.push("hiss");
        }
        if (!reduced) t.spin += (b.vx / BOMB_VIEW.radius) * (dt / 1000);
        // A bounce flips a falling bomb upward: squash, and a clink when hard.
        if (t.vy > 120 && b.vy < 0) {
          t.squash = ms;
          if (t.vy > 260 && primed) cues.push("clink");
        }
        t.vy = b.vy;
        if (
          !reduced &&
          Math.hypot(b.vx, b.vy) > 60 &&
          ms - (t.trail[0]?.at ?? 0) > 35
        )
          t.trail.unshift({ x: b.x, y: b.y, at: ms });
        // Newest first, so old puffs and the overflow leave from the end.
        while (
          t.trail.length > 12 ||
          (t.trail.length && ms - t.trail.at(-1)!.at >= TRAIL_MS)
        )
          t.trail.pop();
        t.x = b.x;
        t.y = b.y;
        for (const p of t.trail) {
          const age = (ms - p.at) / TRAIL_MS;
          smoke
            .fillStyle(0xb4bad0, 0.42 * (1 - age))
            .fillCircle(p.x, p.y - age * 12, 3.5 + age * 8);
        }
        const squash =
          reduced || t.squash < 0 ? 0 : Math.max(0, 1 - (ms - t.squash) / 130);
        // Blink faster over the last half second (5 to 15 Hz), with the blast
        // area in red. Reduced motion holds a steady red instead of flashing.
        const late = b.fuse <= 30,
          period = late ? Math.max(2, Math.round(b.fuse / 5)) : 12,
          lit =
            late && (reduced || Math.floor(b.fuse / period) % 2 === 0) ? 1 : 0;
        const tint = color(b.owner);
        const { fx, fy } = paintBomb(
          b.x,
          b.y,
          BOMB_VIEW.radius,
          t.spin,
          squash,
          tint,
          lit,
          1,
        );
        const spark = reduced
          ? 1
          : 0.7 + boil(Math.floor(ms / 40), b.id % 97) * 0.3;
        glow.fillStyle(0xffc56b, 0.55).fillCircle(fx, fy, 6 * spark);
        glow.fillStyle(0xffffff, 0.95).fillCircle(fx, fy, 2.2);
        if (!reduced)
          for (let i = 0; i < 3; i++) {
            const a = ms / 60 + i * 2.1 + b.id;
            glow
              .lineStyle(1.5, 0xffe2a0, 0.8)
              .lineBetween(
                fx,
                fy,
                fx + Math.cos(a) * 7,
                fy + Math.sin(a) * 7 - 2,
              );
          }
        if (world.bombMode === "impact")
          body
            .lineStyle(1.5, 0xffe08a, 0.8)
            .strokeCircle(b.x, b.y, BOMB_VIEW.radius + 5);
        if (late) {
          const strength = 1 - b.fuse / 30;
          body
            .lineStyle(
              2 + strength * 2,
              0xff3b30,
              0.35 + 0.45 * lit + strength * 0.2,
            )
            .strokeCircle(b.x, b.y, BOMB_VIEW.blast);
          body
            .fillStyle(0xff3b30, 0.05 + 0.08 * strength)
            .fillCircle(b.x, b.y, BOMB_VIEW.blast);
        }
      }
      for (const id of tracked.keys()) if (!live.has(id)) tracked.delete(id);
      // New blasts: a flash, a shockwave, debris and a scorch on the ledge.
      for (const e of world.blasts) {
        if (seenBlasts.has(e.id)) continue;
        seenBlasts.set(e.id, ms);
        if (!primed) continue;
        const fx = {
          x: e.x,
          y: e.y,
          at: ms,
          color: color(e.owner),
          seed: e.id % 997,
        };
        blasts.push(fx);
        cues.push("boom");
        const near =
          !!local &&
          Math.hypot(local.view.x - e.x, local.view.feet - 26 - e.y) < 260;
        bursts.push({
          burst: { kind: "boom", x: e.x, y: e.y, at: ms },
          color: fx.color,
          local: near,
        });
        const top = ledgeTop(world, e.x, e.y);
        if (top) marks.push({ ...fx, y: top[1], width: 70 + (fx.seed % 20) });
      }
      for (const [id, at] of seenBlasts)
        if (ms - at > 2000 && !world.blasts.some((e) => e.id === id))
          seenBlasts.delete(id);
      while (blasts.length && ms - blasts[0]!.at > DEBRIS) blasts.shift();
      while (marks.length > 12 || (marks.length && ms - marks[0]!.at > SCORCH))
        marks.shift();
      for (const m of marks) {
        const fade = 1 - (ms - m.at) / SCORCH;
        scorch
          .fillStyle(0x07080d, 0.55 * fade)
          .fillEllipse(m.x, m.y + 2, m.width, 9);
        scorch.lineStyle(1.5, 0x07080d, 0.5 * fade);
        for (let i = 0; i < 6; i++) {
          const a =
            -Math.PI + (i + 0.5) * (Math.PI / 6) + boil(m.seed, i) * 0.2;
          scorch.lineBetween(
            m.x,
            m.y,
            m.x + Math.cos(a) * m.width * 0.6,
            m.y + Math.sin(a) * 18,
          );
        }
        scorch
          .fillStyle(0xff8a3d, 0.25 * Math.max(0, fade * 4 - 3))
          .fillEllipse(m.x, m.y + 1, m.width * 0.5, 4);
      }
      for (const fx of blasts) {
        const age = ms - fx.at;
        if (age < FLASH) {
          const f = 1 - age / FLASH;
          glow
            .fillStyle(0xffffff, 0.9 * f)
            .fillCircle(fx.x, fx.y, BOMB_VIEW.blast * (0.6 + 0.5 * (1 - f)));
          glow
            .fillStyle(0xffb347, 0.6 * f)
            .fillCircle(fx.x, fx.y, BOMB_VIEW.blast * 1.2);
        }
        if (age < WAVE) {
          const w = age / WAVE,
            r = 16 + (BOMB_VIEW.blast + 26) * Math.sqrt(w);
          body
            .lineStyle(7 * (1 - w) + 1.5, 0xfff2d6, 1 - w)
            .strokeCircle(fx.x, fx.y, r);
          body
            .lineStyle(2.5 * (1 - w) + 0.5, fx.color, 1 - w)
            .strokeCircle(fx.x, fx.y, r * 0.82);
        }
        if (reduced) continue;
        const d = age / DEBRIS;
        for (let i = 0; i < 16; i++) {
          const a = (fx.seed * 2.4 + i * 2.39996) % (Math.PI * 2),
            speed = 140 + ((fx.seed + i * 37) % 9) * 30,
            t = age / 1000,
            x = fx.x + Math.cos(a) * speed * t,
            y = fx.y + Math.sin(a) * speed * t - 60 * t + 900 * t * t;
          if (i % 3)
            body
              .fillStyle(0x151823, 1 - d)
              .fillRect(x - 2, y - 2, 4 + (i % 2) * 2, 3 + (i % 3));
          else glow.fillStyle(0xffc56b, 1 - d).fillCircle(x, y, 2);
        }
        smoke
          .fillStyle(0x3d4254, 0.35 * (1 - d))
          .fillCircle(fx.x, fx.y - d * 40, 26 + d * 50);
      }
      primed = true;
      return { cues, bursts };
    },
    reset() {
      tracked.clear();
      seenBlasts.clear();
      blasts.length = 0;
      marks.length = 0;
      primed = false;
    },
    destroy() {
      scorch.destroy();
      smoke.destroy();
      body.destroy();
      glow.destroy();
    },
  };
}
