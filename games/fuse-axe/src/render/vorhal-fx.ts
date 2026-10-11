import { SIGIL } from "../engine/view-kit.js";
import type { EnemyView, SigilView } from "../engine/view.js";
import { fill, type Pen } from "./pen.js";
import { MASTER, UNLIT } from "./pixel/palette.js";
import type { Point } from "./pixel/rig.js";

/**
 * Vorhal's fire spell and horns until he has art of his own. A sigil glows on the floor as a ring of ember that blinks
 * faster as its eruption nears (`drawSigils`, under the figures); its pillar of fire rises from the floor in bands, a
 * dark ember rim round orange, gold and a white-hot core, licking with the 60 Hz frame (`drawPillars`, over them). His
 * horns curl up either side of the ogre figure's skull (`drawHorns`). Pure functions of the view, the camera and the
 * frame; an odd age or position draws nothing amiss, and nothing lands off screen (`pen.ts`).
 */
export const PILLAR_H = 72;
const RING = [
  [-10, 0, 3, 1],
  [7, 0, 3, 1],
  [-8, -2, 16, 1],
  [-8, 2, 16, 1],
  [-2, -1, 4, 3],
] as const;
const BANDS = [
  [UNLIT["="]!, 0],
  [UNLIT["~"]!, 2],
  [UNLIT.f!, 4],
  [UNLIT.F!, 6],
] as const;

/** Every sigil still glowing: on for most of its delay, blinking every 4 frames in its last third. */
export function drawSigils<Image>(
  pen: Pen<Image>,
  sigils: readonly SigilView[],
  camX: number,
  frame: number,
): void {
  for (const { x, y, age } of sigils) {
    if (!(age < SIGIL.delay)) continue;
    if (3 * age > 2 * SIGIL.delay && Math.floor(frame / 4) % 2) continue;
    const sx = Math.floor(x - camX),
      sy = Math.floor(y);
    pen.fillStyle = 3 * age > 2 * SIGIL.delay ? UNLIT.f! : UNLIT["~"]!;
    for (const [dx, dy, w, h] of RING) fill(pen, sx + dx, sy + dy, w, h);
  }
}

/** Every pillar burning: it shoots up from the floor over its first steps, then licks a pixel either way. */
export function drawPillars<Image>(
  pen: Pen<Image>,
  sigils: readonly SigilView[],
  camX: number,
  frame: number,
): void {
  for (const { x, y, age } of sigils) {
    const burnt = age - SIGIL.delay;
    if (!(burnt >= 0 && burnt < SIGIL.burn)) continue;
    const sx = Math.floor(x - camX),
      sy = Math.floor(y) + 2,
      h = Math.min(PILLAR_H, 12 * (burnt + 1)),
      lick = ((Math.floor(frame / 3) + sx) % 3) - 1;
    for (const [color, inset] of BANDS) {
      pen.fillStyle = color;
      const half = SIGIL.half - inset;
      fill(pen, sx - half + lick, sy - h + inset, 2 * half, h - inset);
    }
  }
}

/** Vorhal's horns either side of the top of his skull (`crown`, from his feet facing right). */
export function drawHorns<Image>(
  pen: Pen<Image>,
  enemy: EnemyView,
  [cx, cy]: Point,
  camX: number,
): void {
  const sx = Math.floor(enemy.x - camX) + enemy.facing * cx,
    sy = Math.floor(enemy.y) - Math.floor(enemy.z) + cy;
  for (const side of [-1, 1]) {
    const x = sx + side * 4;
    pen.fillStyle = UNLIT.k!;
    fill(pen, x - 1, sy - 4, 3, 6);
    pen.fillStyle = MASTER.B!;
    fill(pen, x, sy - 1, 1, 3);
    fill(pen, x + side, sy - 3, 1, 2);
  }
}
