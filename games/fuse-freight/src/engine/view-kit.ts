import { DOCKS, FLOOR, type Rect } from "./arena.js";
import { SUB } from "./math.js";

/**
 * The rule values the renderer draws with: the depot's fixed geometry in pixels, and the sizes and timers a frame's
 * numbers are measured against. They travel here as data, so the screen never reaches into the rules.
 */
const inPixels = (rect: Rect): Rect => ({
  left: rect.left / SUB,
  top: rect.top / SUB,
  right: rect.right / SUB,
  bottom: rect.bottom / SUB,
});
export const FLOOR_PX: Rect = inPixels(FLOOR);
export const DOCKS_PX: readonly Rect[] = DOCKS.map(inPixels);
export type { Rect };
export {
  VIEW_W,
  VIEW_H,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  CAPACITY,
  COUNTDOWN_STEPS,
  FINAL_STEPS,
  MAX_WAGONS,
  CARGO_KINDS,
  CUT_COOL,
  CUT_GUARD,
  FX_LIFE,
} from "./tuning.js";
