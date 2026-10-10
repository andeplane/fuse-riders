// The aiming aids drawn on a loaded castle: the dotted guide, the READY pulse and, for humans, the gates and crates
// the current angle would pass through. All of it comes from the engine's prediction; nothing here decides a rule.
// They are drawn in screen space (the HUD camera), so sizes are screen pixels whatever the world camera's zoom.
import type Phaser from "phaser";
import type { RoundView, Trajectory, Vec2 } from "../engine/index.js";

const INK = 0x1b1d26;

/** World to screen for HUD drawing: where a world point lands on screen, and how long a world length looks. */
export interface Projection {
  point(x: number, y: number): Vec2;
  size(length: number): number;
}

export interface GuideStyle {
  /** Ticks of the predicted path shown; the rest stays hidden, so timing remains the skill. */
  readonly ticks: number;
  /** Ticks between dots. */
  readonly stride: number;
  /** Radius of the first dot; later dots shrink. */
  readonly radius: number;
  readonly alpha: number;
  /** A white glint on each dot, so the guide pops on a TV. */
  readonly shine: boolean;
}

/** Humans get a bold guide; bots a thinner, shorter one, so a player's own guide stands out among six. */
export const HUMAN_GUIDE: GuideStyle = {
  ticks: 30,
  stride: 3,
  radius: 5,
  alpha: 1,
  shine: true,
};
/** A human ghost's drop guide: bold, but only the first stretch of the fall. */
export const GHOST_GUIDE: GuideStyle = {
  ticks: 45,
  stride: 3,
  radius: 4.5,
  alpha: 1,
  shine: true,
};
export const BOT_GUIDE: GuideStyle = {
  ticks: 18,
  stride: 3,
  radius: 3.5,
  alpha: 0.8,
  shine: false,
};

/** Dots every `stride` ticks of screen-space `points` in the player's colour, outlined to read on sky and rock. */
export function drawGuide(
  g: Phaser.GameObjects.Graphics,
  points: readonly Vec2[],
  color: number,
  style: GuideStyle,
): void {
  const end = Math.min(points.length, style.ticks + 1);
  const radius = (i: number) => style.radius * (1 - (0.45 * i) / style.ticks);
  for (const [fill, pad, alpha] of [
    [INK, 2.5, 0.8 * style.alpha],
    [color, 0, style.alpha],
  ] as const) {
    g.fillStyle(fill, alpha);
    for (let i = style.stride; i < end; i += style.stride) {
      const p = points[i];
      if (p) g.fillCircle(p.x, p.y, radius(i) + pad);
    }
  }
  if (!style.shine) return;
  g.fillStyle(0xffffff, 0.9);
  for (let i = style.stride; i < end; i += style.stride) {
    const [p, r] = [points[i], radius(i)];
    if (p) g.fillCircle(p.x - r * 0.3, p.y - r * 0.3, r * 0.35);
  }
}

/** A thick ring pulsing around a human's launcher while it is loaded; bots get a thin, steady one. */
export function drawReady(
  g: Phaser.GameObjects.Graphics,
  pivot: Vec2,
  color: number,
  time: number,
  bold: boolean,
): void {
  const pulse = bold ? 0.5 + 0.5 * Math.sin(time / 110) : 0;
  const [r, width] = bold ? [11 + 3 * pulse, 4] : [10, 2];
  g.lineStyle(width + 4, INK, 0.75).strokeCircle(pivot.x, pivot.y, r);
  g.lineStyle(width, color, 0.7 + 0.3 * pulse);
  g.strokeCircle(pivot.x, pivot.y, r);
}

/** Brackets in the player's colour around each gate and crate the full predicted path passes through. */
export function drawTargets(
  g: Phaser.GameObjects.Graphics,
  view: RoundView,
  path: Trajectory,
  color: number,
  time: number,
  to: Projection,
): void {
  const pad = 4 + 2 * (0.5 + 0.5 * Math.sin(time / 110));
  const stroke = (draw: () => void) => {
    g.lineStyle(7, INK, 0.75);
    draw();
    g.lineStyle(4, color);
    draw();
  };
  for (const { gateId } of path.gates) {
    const gate = view.gates.find((x) => x.id === gateId);
    if (!gate) continue;
    const c = to.point(gate.x, gate.y);
    const w = to.size(gate.width + 14) + 2 * pad;
    const h = to.size(gate.height + 16) + 2 * pad;
    stroke(() => g.strokeRoundedRect(c.x - w / 2, c.y - h / 2, w, h, 6));
  }
  for (const { crateId } of path.crates) {
    const crate = view.crates.find((x) => x.id === crateId);
    if (!crate) continue;
    const c = to.point(crate.x, crate.y);
    stroke(() => g.strokeCircle(c.x, c.y, to.size(crate.radius) + pad + 3));
  }
}
