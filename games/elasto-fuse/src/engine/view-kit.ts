/**
 * The engine data the renderer may read beside the view: the levels' geometry and the sizes things collide with, in
 * world units with y up. What is drawn where the rules collide comes from here, so what you see is what plays.
 */
export { LEVELS, LEVEL_COUNT } from "./levels.js";
export {
  GRAVITY_DOWN,
  GRAVITY_LEFT,
  GRAVITY_RIGHT,
  GRAVITY_UP,
  inAir,
  type Level,
  type LevelObject,
  type Point,
} from "./level.js";
export {
  BODY_UP,
  HEAD_AHEAD,
  HEAD_RADIUS,
  HEAD_UP,
  OBJECT_RADIUS,
  WHEEL_DX,
  WHEEL_DY,
  WHEEL_RADIUS,
} from "./bike.js";
export {
  CAPACITY,
  COUNTDOWN,
  RACE_GRACE,
  RACE_LIMIT,
  RESPAWN,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
} from "./tuning.js";
export { centiseconds } from "./view.js";
