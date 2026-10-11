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

export function paintPot(): Sprite {
  const keys = [...new Set(ROWS.join(""))].filter((key) => key !== ".");
  const palette = Object.fromEntries(keys.map((key) => [key, MASTER[key]!]));
  return {
    w: 8,
    h: ROWS.length,
    ax: 3,
    ay: ROWS.length - 2,
    palette,
    rows: ROWS,
  };
}

export const POT = paintPot();
