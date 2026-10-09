// The aiming aids drawn on a loaded castle: the dotted guide, the READY pulse and, for humans, the gates and crates
// the current angle would pass through. All of it comes from the engine's prediction; nothing here decides a rule.
import type Phaser from "phaser";
import type { RoundView, Trajectory, Vec2 } from "../engine/index.js";

const INK = 0x1b1d26;

export interface GuideStyle {
  /** Ticks of the predicted path shown; the rest stays hidden, so timing remains the skill. */
  readonly ticks: number;
  /** Radius of the first dot; later dots shrink. */
  readonly radius: number;
  readonly alpha: number;
  /** A white glint on each dot, so the guide pops on a TV. */
  readonly shine: boolean;
}

/** Humans get a bold guide; bots a thinner, shorter one, so a player's own guide stands out among six. */
export const HUMAN_GUIDE: GuideStyle = {
  ticks: 30,
  radius: 7,
  alpha: 1,
  shine: true,
};
/** A human ghost's drop guide: bold, but only the first stretch of the fall. */
export const GHOST_GUIDE: GuideStyle = {
  ticks: 22,
  radius: 6,
  alpha: 1,
  shine: true,
};
export const BOT_GUIDE: GuideStyle = {
  ticks: 18,
  radius: 4.5,
  alpha: 0.8,
  shine: false,
};

/** Dots every other tick in the player's colour, each with a dark outline so it reads on sky, sun and snow. */
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
    for (let i = 2; i < end; i += 2) {
      const p = points[i];
      if (p) g.fillCircle(p.x, p.y, radius(i) + pad);
    }
  }
  if (!style.shine) return;
  g.fillStyle(0xffffff, 0.9);
  for (let i = 2; i < end; i += 2) {
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
  const [r, width] = bold ? [19 + 5 * pulse, 6] : [17, 3];
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
): void {
  const pad = 7 + 3 * (0.5 + 0.5 * Math.sin(time / 110));
  const stroke = (draw: () => void) => {
    g.lineStyle(9, INK, 0.75);
    draw();
    g.lineStyle(5, color);
    draw();
  };
  for (const { gateId } of path.gates) {
    const gate = view.gates.find((x) => x.id === gateId);
    if (!gate) continue;
    const [w, h] = [gate.width + 2 * pad + 14, gate.height + 2 * pad + 16];
    stroke(() => g.strokeRoundedRect(gate.x - w / 2, gate.y - h / 2, w, h, 10));
  }
  for (const { crateId } of path.crates) {
    const crate = view.crates.find((x) => x.id === crateId);
    if (crate)
      stroke(() => g.strokeCircle(crate.x, crate.y, crate.radius + pad + 4));
  }
}
