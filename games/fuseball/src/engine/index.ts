/**
 * Fuseball's engine: deterministic integer rules with no imports from outside this folder. A change to what any of
 * it does must bump `RULES` and re-record the golden (`tests/golden.test.ts`) in the same commit.
 */
export const RULES = "fuseball-6";
export * from "./input.js";
export * from "./world.js";
export {
  MAP_IDS,
  MAPS,
  RANDOM,
  MAX_SEED,
  mapOf,
  arenaOf,
  isMapId,
  isSeed,
  isCircle,
  type MapId,
  type ArenaId,
  type MapDef,
  type Goal,
  type Rect,
  type Circle,
  type Pt,
  type Barrier,
  type Bumper,
  type Portal,
} from "./maps.js";
export { stepWorld, stepsPerTick, paceTick, slowed, winnerOf } from "./step.js";
export { botInput } from "./bot.js";
export {
  toView,
  type WorldView,
  type RiderView,
  type BubbleView,
  type BallView,
  type BarrierView,
} from "./view.js";
export { encodeWorld, decodeWorld, riderId } from "./codec.js";
export {
  CAPACITY,
  TARGET,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  COUNTDOWN_STEPS,
  ZAP_STEPS,
  FIELD_KICK,
  FIELD_COOL_STEPS,
  GATE_KNOCK,
  GATE_OPEN_STEPS,
  ZAP_SPEED,
  GOAL_FREEZE_STEPS,
  GOAL_STEPS,
  GOAL_TICKS,
  SPEED_FULL,
  MIN_SPEED,
  CLOUD_SPEED_EDGE,
  CLOUD_SPEED_CORE,
  SLOW_EASE_IN,
  SLOW_EASE_OUT,
  SLOW_HOLD_TICKS,
  TICKS_PER_SECOND,
} from "./tuning.js";
export { generateLevel, fallbackLevel, levelFaults } from "./generate.js";
export { freshBarriers, barrierUp, type BarrierState } from "./gadgets.js";
