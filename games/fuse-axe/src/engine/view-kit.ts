import {
  CAMERA_END,
  FLOOR_BOTTOM,
  FLOOR_TOP,
  STAGE_LENGTH,
  SUB,
} from "./tuning.js";

/** The engine constants the renderer may read, in whole pixels where they are distances. */
export {
  VIEW_W,
  VIEW_H,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  CAPACITY,
  HERO_KINDS,
  LAND_STEPS,
} from "./tuning.js";
export { HERO_STATES } from "./world.js";

/** The floor band's top and bottom screen rows. */
export const FLOOR_TOP_PX = FLOOR_TOP / SUB;
export const FLOOR_BOTTOM_PX = FLOOR_BOTTOM / SUB;
/** Stage 1's length and the furthest the camera's left edge goes. */
export const STAGE_LENGTH_PX = STAGE_LENGTH / SUB;
export const CAMERA_END_PX = CAMERA_END / SUB;
