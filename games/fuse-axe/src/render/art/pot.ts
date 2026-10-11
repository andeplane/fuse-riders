import { MASTER } from "../pixel/palette.js";
import type { Sprite } from "../pixel/sprite.js";

/**
 * The magic pot an imp's sack spills, placed pixel by pixel as it is too small for the rig: a leather stopper, a
 * rolled rim over a short neck, a round belly of blue glaze lit from the upper left with a white glint, 8 × 10 with
 * its outline. Its anchor is the middle of its base, on the floor.
 */
const ROWS = [
  "..kkkk..",
  "..kLlk..",
  ".kUUu@k.",
  "..k@@k..",
  ".kUuu@k.",
  "kUZuuu@k",
  "kUuuu@@k",
  "kuuu@@@k",
  ".k@@@@k.",
  "..kkkk..",
];

/** An item placed pixel by pixel in master-palette keys, anchored at column `ax` of the row above its last. */
export function paintItem(rows: readonly string[], ax: number): Sprite {
  const keys = [...new Set(rows.join(""))].filter((key) => key !== ".");
  const palette = Object.fromEntries(keys.map((key) => [key, MASTER[key]!]));
  return {
    w: rows[0]!.length,
    h: rows.length,
    ax,
    ay: rows.length - 2,
    palette,
    rows,
  };
}

export const paintPot = (): Sprite => paintItem(ROWS, 3);

export const POT = paintPot();
