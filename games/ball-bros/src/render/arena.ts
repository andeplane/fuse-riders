import Phaser from "phaser";
import type { BallView, Impact } from "../engine/view.js";
import { COLORS, effectAge } from "./present.js";

interface Spark {
  x: number;
  y: number;
  born: number;
  slot: number;
  core: boolean;
}
export interface ArenaRenderer {
  ready: Promise<void>;
  paint(view: BallView, now: number): void;
  impact(event: Impact, now: number): void;
  destroy(): void;
}

/** Phaser has no simulation, timers, input or audio; the app supplies one presentation clock. */
export function createRenderer(parent: HTMLElement): ArenaRenderer {
  let graphics: Phaser.GameObjects.Graphics;
  let booted = false,
    destroyed = false,
    scope = "",
    lastTick = -1;
  const trails = new Map<number, { x: number; y: number }[]>();
  let sparks: Spark[] = [];
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const ready = new Promise<void>((r, fail) => {
    resolve = r;
    reject = fail;
  });
  const deadline = setTimeout(
    () => reject(new Error("Arena loading timed out")),
    15000,
  );
  class ArenaScene extends Phaser.Scene {
    create(): void {
      if (destroyed) return;
      clearTimeout(deadline);
      graphics = this.add.graphics();
      booted = true;
      game.loop.stop();
      resolve();
    }
  }
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: 1000,
    height: 1000,
    backgroundColor: "#080e20",
    banner: false,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    scene: ArenaScene,
    render: { antialias: true },
    fps: { target: 60, smoothStep: false },
  });
  let last = 0;
  return {
    ready,
    impact(e, now) {
      if (e.kind !== "wall" && e.kind !== "launch")
        sparks.push({
          x: e.x,
          y: e.y,
          born: now,
          slot: e.slot,
          core: e.kind === "core",
        });
      sparks = sparks.slice(-60);
    },
    paint(v, now) {
      if (!booted || destroyed || !v.arena) return;
      if (scope !== v.matchId || v.tick < lastTick || v.tick - lastTick > 5) {
        trails.clear();
        sparks = [];
      }
      scope = v.matchId;
      lastTick = v.tick;
      const s = v.arena,
        r = v.rules,
        g = graphics;
      g.clear();
      const outline = r.vertices.map((p) => new Phaser.Math.Vector2(p.x, p.y));
      g.fillStyle(0x101e32);
      g.fillPoints(
        outline.map((p) => new Phaser.Math.Vector2(p.x, p.y + 6)),
        true,
      );
      g.fillStyle(0x0b1729);
      g.fillPoints(outline, true);
      g.lineStyle(12, 0x39cbef, 0.045);
      g.strokePoints(outline, true);
      g.lineStyle(2, 0x6db1c8, 0.35);
      g.strokePoints(outline, true);
      g.lineStyle(1, 0x578899, 0.08);
      g.strokeCircle(500, 500, 105);
      g.strokeCircle(500, 500, 110);
      for (const b of s.bases) {
        const color = COLORS[b.slot]!;
        const half = (r.paddleHalf * r.paddle) / b.radius;
        if (!b.alive) {
          g.lineStyle(1, color, 0.12);
          g.strokeCircle(b.x, b.y, r.core + 5);
          continue;
        }
        g.fillStyle(color, 0.035);
        g.fillCircle(b.x, b.y, r.paddleMin);
        // Faint limits show the available reach without cluttering the field.
        g.lineStyle(1, color, b.bot ? 0.045 : 0.12);
        g.strokeCircle(b.x, b.y, r.paddleMin);
        g.strokeCircle(b.x, b.y, r.paddleMax);
        g.lineStyle(1, color, 0.13);
        g.strokeCircle(b.x, b.y, b.radius);
        for (const block of b.blocks) {
          if (!block.alive) continue;
          const x = b.x + block.x,
            y = b.y + block.y;
          g.fillStyle(0x010610, 0.8);
          g.fillRoundedRect(x - 6, y - 3, 12, 12, 2);
          g.fillStyle(color, 0.2);
          g.fillRoundedRect(x - 9, y - 9, 18, 18, 3);
          g.fillStyle(color, 0.9);
          g.fillRoundedRect(x - 6, y - 6, 12, 12, 2);
          g.fillStyle(0xffffff, 0.5);
          g.fillRect(x - 4, y - 5, 8, 2);
        }
        for (const [width, alpha] of [
          [22, 0.07],
          [15, 0.17],
          [r.paddleThick * 2, 1],
        ] as const) {
          g.lineStyle(width, color, alpha);
          g.beginPath();
          g.arc(b.x, b.y, b.radius, b.angle - half, b.angle + half);
          g.strokePath();
        }
        for (const angle of [b.angle - half, b.angle + half]) {
          g.fillStyle(color);
          g.fillCircle(
            b.x + Math.cos(angle) * b.radius,
            b.y + Math.sin(angle) * b.radius,
            r.paddleThick,
          );
        }
        const exposed = !b.blocks.some((k) => k.alive);
        g.fillStyle(color, exposed ? 0.23 + Math.sin(now / 100) * 0.1 : 0.12);
        g.fillCircle(b.x, b.y, r.core + 10);
        g.lineStyle(2, color, 0.65);
        g.strokeCircle(b.x, b.y, r.core + 5);
        g.fillStyle(color);
        g.fillCircle(b.x, b.y, r.core);
        // A tiny visor gives the core a character without importing another game's avatar system.
        g.fillStyle(0x081525);
        g.fillRoundedRect(b.x - 12, b.y - 6, 24, 11, 4);
        g.fillStyle(0xffffff);
        g.fillRect(b.x - 7, b.y - 3, 4, 4);
        g.fillRect(b.x + 3, b.y - 3, 4, 4);
      }
      for (const b of s.balls) {
        const owner = s.bases.find((p) => p.id === b.owner),
          color = owner ? COLORS[owner.slot]! : 0xddefff;
        const trail = trails.get(b.id) ?? [];
        if (!b.held && s.phase === "playing") {
          trail.push({ x: b.x, y: b.y });
          if (trail.length > 16) trail.shift();
        } else trail.length = 0;
        trails.set(b.id, trail);
        for (let i = 1; i < trail.length; i++) {
          g.lineStyle(
            1 + (i / trail.length) * 8,
            color,
            (i / trail.length) * 0.4,
          );
          g.lineBetween(
            trail[i - 1]!.x,
            trail[i - 1]!.y,
            trail[i]!.x,
            trail[i]!.y,
          );
        }
        g.fillStyle(color, 0.09);
        g.fillCircle(b.x, b.y, 19);
        g.fillStyle(color, 0.25);
        g.fillCircle(b.x, b.y, 11);
        g.fillStyle(color);
        g.fillCircle(b.x, b.y, r.ballRadius);
        g.fillStyle(0xffffff);
        g.fillCircle(b.x - 1, b.y - 1, 3.5);
      }
      sparks = sparks.filter((p) => now - p.born < (p.core ? 700 : 320));
      for (const p of sparks) {
        const age = effectAge(now, p.born, p.core ? 700 : 320),
          color = COLORS[p.slot] ?? 0xddefff;
        g.lineStyle(2, color, 1 - age);
        g.strokeCircle(p.x, p.y, age * (p.core ? 75 : 22));
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4,
            distance = age * (p.core ? 90 : 30);
          g.fillStyle(color, 1 - age);
          g.fillRect(
            p.x + Math.cos(a) * distance - 2,
            p.y + Math.sin(a) * distance - 2,
            4,
            4,
          );
        }
      }
      if (game.loop.running) game.loop.stop();
      game.step(now, last ? Math.min(50, Math.max(0, now - last)) : 16.667);
      last = now;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(deadline);
      game.destroy(true);
      if (booted) game.step(0, 0);
    },
  };
}
