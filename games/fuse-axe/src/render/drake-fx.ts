import { FLAME, flamePx } from "../engine/view-kit.js";
import type { MountView } from "../engine/view.js";
import { fill, type Pen } from "./pen.js";
import { UNLIT } from "./pixel/palette.js";

/**
 * An ember drake's breath until the drake has art of its own: a stream of fire from its mouth to the flame's front
 * (`flamePx`) along the drake's facing, `FLAME_ROW` rows over its feet, in columns two pixels wide that widen toward
 * the front and lick up and down with the 60 Hz frame: a dark ember rim round orange, a gold body and a white-hot
 * core. A pure function of the beast, the camera and the frame; nothing lands off screen (`pen.ts`).
 */
export const FLAME_ROW = 18;
/** The bands from the rim in, each by its half-height at the mouth. */
const BANDS = [
  [UNLIT["="]!, 4],
  [UNLIT["~"]!, 3],
  [UNLIT.f!, 2],
  [UNLIT.F!, 1],
] as const;

/** Every breathing drake's flame, in the view's order. */
export function drawFlames<Image>(
  pen: Pen<Image>,
  mounts: readonly MountView[],
  camX: number,
  frame: number,
): void {
  for (const mount of mounts) {
    if (mount.anim !== "breathe") continue;
    const front = Math.floor(flamePx(mount.animStep)),
      mouth = FLAME.mouth,
      row = Math.floor(mount.y - mount.z) - FLAME_ROW,
      sx = Math.floor(mount.x - camX);
    for (let d = mouth; d < front; d += 2) {
      // A column's height grows from the mouth to the front, and flickers by a pixel as the frames go by.
      const grow = 1 + (2 * (d - mouth)) / FLAME.length,
        lick = (((d >> 1) + (frame >> 2)) % 3) - 1,
        x = mount.facing > 0 ? sx + d : sx - d - 2;
      for (const [color, half] of BANDS) {
        const h = Math.max(1, Math.round(half * grow));
        pen.fillStyle = color;
        fill(pen, x, row - h + lick, 2, 2 * h);
      }
    }
  }
}
