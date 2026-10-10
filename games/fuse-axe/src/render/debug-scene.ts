import type { HeroAnim, WorldView } from "../engine/view.js";
import {
  FLOOR_BOTTOM_PX,
  FLOOR_TOP_PX,
  VIEW_H,
  VIEW_W,
} from "../engine/view-kit.js";

/**
 * A TEMPORARY placeholder scene, until the pixel-art renderer replaces it: a dusk sky, the floor band with posts that
 * scroll with the camera, every figure as a box over its shadow and a swing as a blade. It is the app's one drawing seam,
 * `draw(ctx, view, frame)`: paint a whole native 320 × 180 frame of `view` into `ctx` (the page scales it up), where
 * `frame` counts 60 Hz frames and only animates scenery.
 */
export interface Paint {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void;
  fill(): void;
}

/** A hero or an enemy where the view puts it: `(x − camX, y − z)` on screen, its shadow at `(x − camX, y)`. */
interface Placed {
  x: number;
  y: number;
  z: number;
  facing: 1 | -1;
}

/** Heroes by seat, P1 to P5, as the lobby colours them. */
export const SEAT_COLORS = [
  "#2de2ff",
  "#ff4fa3",
  "#b6ff4d",
  "#ffc23d",
  "#a77bff",
] as const;
export const ENEMY_COLOR = "#ff3b3b";
export const BODY_W = 12,
  BODY_H = 28;
/** World pixels between the road's posts. */
export const POST_GAP = 40;
const SKY = "#24123a",
  HORIZON = "#5a2448",
  FLOOR = "#5b3f2b",
  EDGE = "#8a5a32",
  POST = "#1c120e",
  EMBERS = ["#ff8a1f", "#ffd23f"] as const,
  SHADOW = "rgba(0, 0, 0, 0.45)",
  EYE = "#ffffff";
export const BLADE = "#ffe9a8";
/** The blade's length in each swing of the combo. */
const BLADES: Partial<Record<HeroAnim, number>> = {
  attack1: 10,
  attack2: 10,
  attack3: 14,
};

export function draw(ctx: Paint, view: WorldView, frame: number): void {
  const camX = view.camX;
  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, VIEW_W, FLOOR_TOP_PX);
  ctx.fillStyle = HORIZON;
  ctx.fillRect(0, FLOOR_TOP_PX - 12, VIEW_W, 12);
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, FLOOR_TOP_PX, VIEW_W, VIEW_H - FLOOR_TOP_PX);
  ctx.fillStyle = EDGE;
  ctx.fillRect(0, FLOOR_TOP_PX, VIEW_W, 1);
  ctx.fillRect(0, FLOOR_BOTTOM_PX, VIEW_W, 1);
  // Posts along the far edge of the road, so the camera's scroll shows; their embers flicker with `frame`.
  const flicker = Math.floor(frame / 8);
  for (
    let post = Math.floor(camX / POST_GAP);
    post * POST_GAP < camX + VIEW_W;
    post++
  ) {
    const sx = post * POST_GAP - camX;
    ctx.fillStyle = POST;
    ctx.fillRect(sx, FLOOR_TOP_PX - 18, 3, 18);
    ctx.fillStyle = EMBERS[(post + flicker) % 2]!;
    ctx.fillRect(sx, FLOOR_TOP_PX - 20, 3, 2);
  }

  const figures: (Placed & { color: string; blade?: number })[] = [
    ...view.heroes.map((hero) => ({
      ...hero,
      color: SEAT_COLORS[hero.seat % SEAT_COLORS.length]!,
      blade: BLADES[hero.anim],
    })),
    ...view.enemies.map((enemy) => ({ ...enemy, color: ENEMY_COLOR })),
  ].sort((a, b) => a.y - b.y || a.z - b.z);
  ctx.fillStyle = SHADOW;
  for (const figure of figures) {
    ctx.beginPath();
    ctx.ellipse(figure.x - camX, figure.y, 7, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const figure of figures) {
    const left = figure.x - camX - BODY_W / 2,
      top = figure.y - figure.z - BODY_H;
    ctx.fillStyle = figure.color;
    ctx.fillRect(left, top, BODY_W, BODY_H);
    // The facing tick: an eye on the side the figure looks to.
    ctx.fillStyle = EYE;
    ctx.fillRect(
      figure.facing > 0 ? left + BODY_W - 3 : left + 1,
      top + 5,
      2,
      2,
    );
    // A swing: a blade out in front, longer for the finisher.
    if (figure.blade) {
      ctx.fillStyle = BLADE;
      ctx.fillRect(
        figure.facing > 0 ? left + BODY_W : left - figure.blade,
        top + 12,
        figure.blade,
        2,
      );
    }
  }
}
