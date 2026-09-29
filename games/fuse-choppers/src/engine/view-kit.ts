/**
 * The engine functions the renderer may run: the cave's geometry is a pure function of the round seed, so a frame
 * carries the seed and the screen rebuilds the rock, platforms and saws from it rather than receiving them.
 */
export {
  COL,
  SEG,
  COLUMNS,
  EXIT_X,
  CAMERA_END,
  PICKUP_KINDS,
  terrain,
  segmentsNear,
  sawY,
  type Platform,
  type Saw,
  type PickupKind,
} from "./level.js";
export {
  VIEW_W,
  VIEW_H,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  CAPACITY,
  COUNTDOWN_STEPS,
  ROCK_WARNING_STEPS,
  TRIPLE_STEPS,
  TURBO_STEPS,
  SCRAMBLE_STEPS,
  FX_LIFE,
} from "./tuning.js";
export { SUB } from "./math.js";
