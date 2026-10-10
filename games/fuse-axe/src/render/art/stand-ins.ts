import type { Palette } from "../pixel/palette.js";
import type { Sprite } from "../pixel/sprite.js";

/**
 * Flat stand-ins for figures whose art has not been drawn yet: the sack imp and the magic pot, each a few rectangles
 * of colour, so the scene draws them (and anything else without art) rather than stopping. The art replaces them.
 */

/** One rectangle of a palette key: its top-left, width and height. */
type Rect = readonly [key: string, x: number, y: number, w: number, h: number];

/** A sprite `w` × `h` painted from `rects` in order, its feet at the bottom row's middle. */
export function rectSprite(
  w: number,
  h: number,
  palette: Palette,
  rects: readonly Rect[],
): Sprite {
  const grid = Array.from({ length: h }, () => Array<string>(w).fill("."));
  for (const [key, x, y, rw, rh] of rects)
    for (let row = y; row < y + rh; row++)
      for (let col = x; col < x + rw; col++) grid[row]![col] = key;
  return {
    w,
    h,
    ax: w >> 1,
    ay: h - 1,
    palette,
    rows: grid.map((row) => row.join("")),
  };
}

const IMP_PALETTE: Palette = {
  B: "#2f55c8",
  b: "#1d2f7a",
  f: "#0b0614",
  e: "#ffd23f",
  S: "#b08850",
  s: "#6b4a2a",
};

/** A small blue-hooded imp with its sack on its back, facing right, in every anim. */
export const IMP_STAND_IN = rectSprite(14, 20, IMP_PALETTE, [
  ["S", 0, 5, 6, 9],
  ["s", 1, 4, 4, 1],
  ["B", 4, 6, 8, 10],
  ["b", 4, 13, 8, 3],
  ["B", 5, 1, 7, 6],
  ["B", 4, 0, 3, 2],
  ["f", 8, 3, 4, 3],
  ["e", 10, 4, 1, 1],
  ["b", 5, 16, 2, 4],
  ["b", 9, 16, 2, 4],
]);

/** A magic pot, in the HUD's pot colours. */
export const POT_STAND_IN = rectSprite(
  7,
  7,
  { P: "#262e8c", L: "#3c5ce0", g: "#78b4ff" },
  [
    ["P", 2, 0, 3, 1],
    ["P", 0, 1, 7, 6],
    ["L", 1, 2, 3, 3],
    ["g", 1, 2, 1, 1],
  ],
);
