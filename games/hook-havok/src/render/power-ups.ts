import type Phaser from "phaser";
import type { KeeperView, PowerKind, WorldView } from "../engine/view.js";
/** Colour and names per power-up; icons are drawn by `paintPowerIcon`. */
export const POWER_STYLE: Record<
  PowerKind,
  { color: number; css: string; name: string; short: string }
> = {
  triple: {
    color: 0x96f1b9,
    css: "#96f1b9",
    name: "Triple jump",
    short: "TRIPLE",
  },
  shield: { color: 0x89d9ff, css: "#89d9ff", name: "Shield", short: "SHIELD" },
  cluster: {
    color: 0xffa05a,
    css: "#ffa05a",
    name: "Cluster bomb",
    short: "CLUSTER",
  },
  harpoon: {
    color: 0xe08cff,
    css: "#e08cff",
    name: "Harpoon",
    short: "HARPOON",
  },
  dash: { color: 0xffe45c, css: "#ffe45c", name: "Dash bump", short: "DASH" },
};
const INK = 0xefffe6;
/** Units above the feet of a keeper's power icon; their label sits above it. */
export const POWER_ICON_RISE = 88;
/** A kind's glyph, `s` about half its width. Static: reduced motion keeps it. */
export function paintPowerIcon(
  g: Phaser.GameObjects.Graphics,
  kind: PowerKind,
  x: number,
  y: number,
  s: number,
  alpha = 1,
): void {
  const color = POWER_STYLE[kind].color;
  g.lineStyle(Math.max(1.5, s / 3.5), INK, 0.95 * alpha);
  switch (kind) {
    case "triple":
      for (const dy of [-0.55, 0.05, 0.65])
        g.lineBetween(
          x - s * 0.8,
          y + dy * s + s * 0.35,
          x,
          y + dy * s - s * 0.3,
        ).lineBetween(
          x,
          y + dy * s - s * 0.3,
          x + s * 0.8,
          y + dy * s + s * 0.35,
        );
      break;
    case "shield":
      g.beginPath()
        .moveTo(x - s * 0.9, y - s * 0.8)
        .lineTo(x + s * 0.9, y - s * 0.8)
        .lineTo(x + s * 0.75, y + s * 0.25)
        .lineTo(x, y + s)
        .lineTo(x - s * 0.75, y + s * 0.25)
        .closePath()
        .strokePath();
      break;
    case "cluster":
      g.fillStyle(INK, 0.95 * alpha).fillCircle(x, y + s * 0.15, s * 0.45);
      for (const a of [-2.4, -1.57, -0.74])
        g.fillStyle(color, alpha).fillCircle(
          x + Math.cos(a) * s * 0.85,
          y + s * 0.15 + Math.sin(a) * s * 0.85,
          s * 0.26,
        );
      break;
    case "harpoon":
      // A barbed tip pointing in, and the line it pulls back along.
      g.lineBetween(x - s, y, x + s * 0.9, y)
        .lineBetween(x - s, y, x - s * 0.35, y - s * 0.55)
        .lineBetween(x - s, y, x - s * 0.35, y + s * 0.55)
        .lineBetween(x + s * 0.9, y, x + s * 0.55, y - s * 0.5)
        .lineBetween(x + s * 0.9, y, x + s * 0.55, y + s * 0.5);
      break;
    case "dash":
      g.lineBetween(x + s * 0.1, y - s * 0.7, x + s * 0.8, y).lineBetween(
        x + s * 0.8,
        y,
        x + s * 0.1,
        y + s * 0.7,
      );
      for (const [dy, len] of [
        [-0.45, 0.8],
        [0, 1.1],
        [0.45, 0.8],
      ] as const)
        g.lineBetween(x - s, y + dy * s, x - s + len * s, y + dy * s);
      break;
  }
}
/** Pads; the draw and cooldown come from the view, the bob is cosmetic. */
export function paintPowerUps(
  g: Phaser.GameObjects.Graphics,
  pickups: WorldView["pickups"],
  ms: number,
  reduced: boolean,
): void {
  for (const p of pickups) {
    const color = p.kind ? POWER_STYLE[p.kind].color : 0x8d96b8;
    const active = !!p.kind;
    const y = p.y + (active && !reduced ? Math.sin(ms / 500 + p.x) * 3 : 0);
    g.lineStyle(2, color, active ? 0.65 : 0.22).strokeEllipse(
      p.x,
      p.y + 27,
      46,
      9,
    );
    g.fillStyle(color, active ? 0.14 : 0.03).fillCircle(p.x, y, 25);
    g.lineStyle(2, color, active ? 1 : 0.25).strokeCircle(p.x, y, 18);
    if (!active) continue;
    g.fillStyle(0x0b1020, 0.6).fillCircle(p.x, y, 15);
    paintPowerIcon(g, p.kind as PowerKind, p.x, y, 9);
  }
}
/**
 * A keeper's active power: a small icon over the head with a ring of time
 * left, pips for the jumps or throws it gives, the Shield bubble and dash
 * streaks. Reduced motion keeps the icons and drops the shimmer and streaks.
 */
export function paintKeeperPower(
  g: Phaser.GameObjects.Graphics,
  keeper: Pick<KeeperView, "power" | "playing" | "connected">,
  body: Pick<
    WorldView,
    | "x"
    | "feet"
    | "respawn"
    | "airJump"
    | "bonusJumps"
    | "dash"
    | "vx"
    | "vy"
    | "doubleJump"
  >,
  ms: number,
  reduced: boolean,
): void {
  const p = keeper.power;
  if (!p.kind || !keeper.playing || !keeper.connected || body.respawn) return;
  const style = POWER_STYLE[p.kind],
    { x, feet } = body,
    ending = p.seconds <= 2,
    blink = ending && !reduced ? 0.55 + 0.45 * Math.sin(ms / 70) : 1;
  if (p.kind === "shield") {
    const shimmer = reduced ? 0 : ms / 400;
    g.fillStyle(style.color, 0.1 * blink).fillEllipse(x, feet - 28, 56, 72);
    g.lineStyle(2, style.color, 0.85 * blink).strokeEllipse(
      x,
      feet - 28,
      56,
      72,
    );
    g.lineStyle(2, 0xffffff, 0.55 * blink);
    g.beginPath();
    g.arc(x, feet - 28, 25, shimmer - 2.5, shimmer - 1.7);
    g.strokePath();
  }
  if (p.kind === "dash" && body.dash > 0 && !reduced) {
    const speed = Math.hypot(body.vx, body.vy) || 1,
      ux = body.vx / speed,
      uy = body.vy / speed;
    for (const [side, len] of [
      [-12, 26],
      [0, 40],
      [12, 26],
    ] as const) {
      const sx = x - uy * side,
        sy = feet - 28 + ux * side;
      g.lineStyle(3, style.color, 0.7).lineBetween(
        sx - ux * 18,
        sy - uy * 18,
        sx - ux * (18 + len),
        sy - uy * (18 + len),
      );
    }
  }
  // Icon over the hat (the label moves up for it), the ring of time left around it.
  const iy = feet - POWER_ICON_RISE;
  g.fillStyle(0x0b1020, 0.85).fillCircle(x, iy, 12);
  g.lineStyle(2, style.color, 0.3).strokeCircle(x, iy, 12);
  g.lineStyle(3, style.color, blink);
  g.beginPath();
  g.arc(
    x,
    iy,
    12,
    -Math.PI / 2,
    -Math.PI / 2 + Math.PI * 2 * Math.max(0, p.left),
  );
  g.strokePath();
  paintPowerIcon(g, p.kind, x, iy, 6.5, blink);
  // Pips: air jumps left for Triple jump and Dash bump, throws for Cluster bomb.
  const total =
      p.kind === "triple"
        ? 2
        : p.kind === "dash"
          ? 1
          : p.kind === "cluster"
            ? 3
            : 0,
    left =
      p.kind === "cluster"
        ? p.charges
        : Math.min(total, Number(body.airJump) + body.bonusJumps);
  for (let i = 0; i < total; i++) {
    const px = x + 19 + i * 9;
    g.fillStyle(0x0b1020, 0.8).fillCircle(px, iy, 4.6);
    if (i < left) g.fillStyle(style.color, 1).fillCircle(px, iy, 3.3);
    else g.lineStyle(1.5, style.color, 0.6).strokeCircle(px, iy, 3);
  }
}
