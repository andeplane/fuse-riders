import type { Sprite } from "../pixel/sprite.js";
import { paintItem } from "./pot.js";

/**
 * The meat a camp imp's sack spills, placed pixel by pixel as the pot is: a roast drumstick lying on its side, its
 * browned meat lit from the upper left with a glint, and the bone's knob out to the left, 10 × 7 with its outline. Its
 * anchor is the middle of its base, on the floor.
 */
const ROWS = [
  "....kkkk..",
  "...kLZlLk.",
  "..kLllll9k",
  "kkkll999k.",
  "kBbk9999k.",
  "kbBkkkkk..",
  ".kk.......",
];

export const paintMeat = (): Sprite => paintItem(ROWS, 4);
export const MEAT = paintMeat();
