import type Phaser from "phaser";
import type { Burst } from "./feedback.js";

/** Small costume silhouettes supplement colour and the persistent P1–P5 labels. */
const CRESTS = [
  [-8, 0, -5, -13, 4, -3, 8, 0],
  [-9, 0, -8, -12, -1, -5, 4, -14, 9, 0],
  [-9, 0, -16, -6, -12, -15, -5, -8, 7, 0],
  [-8, 0, -14, -10, -4, -7, 0, -16, 4, -7, 11, -10, 8, 0],
  [-10, 0, -11, -11, -4, -5, 0, -14, 4, -5, 11, -11, 10, 0],
] as const;

export function paintCrest(
  g: Phaser.GameObjects.Graphics,
  slot: number,
  color: number,
): void {
  const points = CRESTS[slot] ?? CRESTS[0];
  g.clear().lineStyle(2.5, 0x141623).fillStyle(color).beginPath();
  g.moveTo(points[0], points[1] - 68);
  for (let i = 2; i < points.length; i += 2)
    g.lineTo(points[i]!, points[i + 1]! - 68);
  g.closePath().fillPath().strokePath();
}

/** Bounded ink/metal strokes; endpoints always come directly from the view. */
export function paintTether(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  x: number,
  y: number,
  color: number,
  attached: boolean,
  alpha: number,
): void {
  g.lineStyle(attached ? 6 : 4, 0x111521, alpha * 0.8).lineBetween(
    sx,
    sy,
    x,
    y,
  );
  g.lineStyle(attached ? 3 : 2, color, alpha).lineBetween(sx, sy, x, y);
  const dx = x - sx,
    dy = y - sy,
    length = Math.hypot(dx, dy);
  if (length > 1) {
    const count = Math.min(36, Math.floor(length / 18));
    g.lineStyle(1, 0xfff1d1, alpha * 0.7);
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1),
        px = sx + dx * t,
        py = sy + dy * t;
      g.lineBetween(
        px - (dy / length) * 2,
        py + (dx / length) * 2,
        px + (dy / length) * 2 + (dx / length) * 3,
        py - (dx / length) * 2 + (dy / length) * 3,
      );
    }
  }
  if (attached) g.lineStyle(2, 0xffe8b5, alpha).strokeCircle(x, y, 7);
}

export function paintBurst(
  g: Phaser.GameObjects.Graphics,
  burst: Burst,
  ms: number,
  reduced: boolean,
): void {
  const age = Math.max(0, Math.min(1, (ms - burst.at) / 400));
  const alpha = 1 - age;
  const { x, y, kind } = burst;
  if (reduced) {
    g.lineStyle(2, burst.color ?? 0xffe5b2, alpha * 0.6).strokeCircle(
      x,
      y - 3,
      7,
    );
    return;
  }
  const ground = kind === "land" || kind === "jump";
  const impact = kind === "impact" || kind === "pop";
  if (kind === "vanish" || kind === "respawn") {
    const arriving = kind === "respawn";
    const radius = arriving ? 10 + age * 28 : 12 + age * 18;
    g.lineStyle(2, arriving ? 0xaee8e5 : 0xe4c197, alpha * 0.8).strokeEllipse(
      x,
      y - 2,
      radius * 2,
      radius * 0.45,
    );
    for (let i = 0; i < 7; i++) {
      const px = x + Math.sin(i * 2.4) * radius;
      const py = y - 12 - age * (22 + i * 5);
      g.lineStyle(2, arriving ? 0xe0ffef : 0xdac1ff, alpha * 0.65).lineBetween(
        px,
        py,
        px,
        py + 4 + alpha * 4,
      );
    }
    return;
  }
  if (ground) {
    for (let i = 0; i < 8; i++) {
      g.fillStyle(i % 2 ? 0xc5bbc1 : 0x777c9b, alpha * 0.55).fillEllipse(
        x + (i - 3.5) * (3 + age * 10),
        y - 2 - Math.sin(i + 1) ** 2 * age * 14,
        4 + age * 8,
        2 + alpha * 3,
      );
    }
    return;
  }
  if (impact || kind === "attach") {
    const radius = (impact ? 12 : 6) + age * (impact ? 36 : 18);
    g.lineStyle(
      impact ? 3 : 2,
      burst.color ?? 0xffe8ae,
      alpha * 0.8,
    ).strokeCircle(x, y, radius);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + 0.2;
      const inner = radius * 0.65,
        outer = radius + (i % 2 ? 6 : 13) * alpha;
      g.lineStyle(
        i % 2 ? 2 : 3,
        i % 2 ? 0xc5e5ee : (burst.color ?? 0xffd385),
        alpha,
      ).lineBetween(
        x + Math.cos(a) * inner,
        y + Math.sin(a) * inner,
        x + Math.cos(a) * outer,
        y + Math.sin(a) * outer,
      );
    }
    if (burst.direction !== undefined) {
      const dx = Math.cos(burst.direction),
        dy = Math.sin(burst.direction);
      for (let i = -1; i <= 1; i++) {
        const offset = i * 7;
        g.lineStyle(i === 0 ? 4 : 2, 0xfff3d1, alpha * 0.9).lineBetween(
          x - dy * offset + dx * (8 + age * 16),
          y + dx * offset + dy * (8 + age * 16),
          x - dy * offset + dx * (22 + age * 40),
          y + dx * offset + dy * (22 + age * 40),
        );
      }
    }
    return;
  }
  g.lineStyle(
    2,
    kind === "fire" ? 0xffd58b : 0xb9ded7,
    alpha * 0.7,
  ).strokeEllipse(x, y - 32, 16 + age * 40, 26 + age * 30);
}

/** Decorative dressing is below platform tops and has no collision authority. */
export function dressPlatform(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  index: number,
): void {
  g.lineStyle(3, 0xf0d9b0, 0.48).lineBetween(
    x + 6,
    y + 2,
    x + width - 6,
    y + 2,
  );
  g.lineStyle(1, 0xfff0d1, 0.6).lineBetween(
    x + 10,
    y + 1,
    x + width * 0.36,
    y + 1,
  );
  if (![1, 3, 6].includes(index)) return;
  const bx = x + width * 0.25,
    by = y + 27,
    length = 52 + index * 3;
  g.fillStyle(0x171d31, 0.9)
    .lineStyle(2, 0x4d4c65, 0.9)
    .beginPath()
    .moveTo(bx - 12, by)
    .lineTo(bx + 12, by)
    .lineTo(bx + 10, by + length)
    .lineTo(bx, by + length - 9)
    .lineTo(bx - 10, by + length + 4)
    .closePath()
    .fillPath()
    .strokePath();
  g.lineStyle(1, 0xaa9470, 0.7).lineBetween(
    bx - 7,
    by + 8,
    bx - 7,
    by + length - 11,
  );
  g.lineStyle(1.5, 0xd5b779, 0.8).strokeCircle(bx + 1, by + 19, 4);
}
