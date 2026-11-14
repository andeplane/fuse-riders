/**
 * Fuseball's engine: deterministic integer rules with no imports from outside this folder. A change to what any of
 * it does must bump `RULES` and re-record the golden (`tests/golden.test.ts`) in the same commit.
 */
export const RULES = "fuseball-3";
export * from "./input.js";
export * from "./world.js";
export {
  MAP_IDS,
  MAPS,
  mapOf,
  isMapId,
  isCircle,
  type MapId,
  type MapDef,
  type Goal,
  type Rect,
  type Circle,
  type Pt,
} from "./maps.js";
export { stepWorld, stepsPerTick, slowed, winnerOf } from "./step.js";
export { botInput } from "./bot.js";
export {
  toView,
  type WorldView,
  type RiderView,
  type BubbleView,
  type BallView,
} from "./view.js";
export { encodeWorld, decodeWorld, riderId } from "./codec.js";
export {
  CAPACITY,
  TARGET,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  CLOUD_STEPS_PER_TICK,
  COUNTDOWN_STEPS,
  ZAP_STEPS,
} from "./tuning.js";
