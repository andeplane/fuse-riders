/**
 * Elasto Fuse's engine: deterministic rules with no imports from outside this folder. The physics runs on doubles
 * with exact operations only (`math.ts`), so every device computes the same bits. A change to what any of it does,
 * the levels included, must bump `RULES` and re-record the golden (`tests/golden.test.ts`) in the same commit.
 */
export const RULES = "elasto-fuse-2";
export * from "./input.js";
export {
  DEAD,
  FINISHED,
  PHASES,
  RIDING,
  createWorld,
  isLevel,
  levelOf,
  ranking,
  stepWorld,
  type Phase,
  type Rider,
  type Status,
  type World,
} from "./world.js";
export {
  toView,
  centiseconds,
  type BikeView,
  type RiderStatus,
  type RiderView,
  type WheelView,
  type WorldView,
} from "./view.js";
export { encodeWorld, decodeWorld, riderId } from "./codec.js";
export { LEVELS, LEVEL_COUNT } from "./levels.js";
export { compile, inAir, levelProblem, type Level } from "./level.js";
export { resetBike, stepBike, type Bike } from "./bike.js";
export {
  CAPACITY,
  COUNTDOWN,
  SOLO_COUNTDOWN,
  RACE_GRACE,
  RACE_LIMIT,
  RESPAWN,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
} from "./tuning.js";
