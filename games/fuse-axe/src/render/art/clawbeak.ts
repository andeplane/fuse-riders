import { MASTER } from "../pixel/palette.js";
import type { Sprite } from "../pixel/sprite.js";

/**
 * The clawbeak until it has art of its own: a flat silhouette placed pixel by pixel, facing right — a beaked head on a
 * long neck, a teal body with its tail raised behind, and two clawed legs. Its back is about the saddle's height
 * (`CLAWBEAK.saddle`) over its feet, where the scene seats the rider; its anchor is between its feet, on the floor.
 */
const ROWS = [
  "......................kkkk....",
  ".....................kYYYYk...",
  "....................kYYkYYkk..",
  "....................kYyyyNNNk.",
  ".....................kyykkNNk.",
  ".....................kyyk.kk..",
  ".....................kyyk.....",
  "...........kkkkkkkkkkyyyk.....",
  "kk.......kkYYYYYYYYYYyyk......",
  "kYkk...kkYYYYYYYYYyyyyk.......",
  ".kYYkkkYYYYYYyyyyyyyyyk.......",
  "..kYYYYYyyyyyyyyyyyyyk........",
  "...kkyyyyyyyyyyyy&&&k.........",
  ".....kk&&&&&&&&&&&kk..........",
  ".......kkk&&&kk&&k............",
  ".........k&&k.k&&k............",
  ".........k&&k..k&&k...........",
  "........k&&k...k&&k...........",
  "........k&k.....k&k...........",
  ".......kNNk.....kNNk..........",
  "......kNNNk....kNNNk..........",
  "......kkkk.....kkkkk..........",
];

export function paintClawbeak(): Sprite {
  const keys = [...new Set(ROWS.join(""))].filter((key) => key !== ".");
  const palette = Object.fromEntries(keys.map((key) => [key, MASTER[key]!]));
  return {
    w: 30,
    h: ROWS.length,
    ax: 13,
    ay: ROWS.length - 1,
    palette,
    rows: ROWS,
  };
}

export const CLAWBEAK_SPRITE = paintClawbeak();
