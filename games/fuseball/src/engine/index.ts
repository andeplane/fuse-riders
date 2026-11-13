/** Fuseball's engine: deterministic integer rules with no imports from outside this folder. */
export const RULES = "fuseball-1";
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
export { stepWorld } from "./step.js";
export {
  CAPACITY,
  TARGET,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  CLOUD_STEPS_PER_TICK,
  COUNTDOWN_STEPS,
  ZAP_STEPS,
} from "./tuning.js";
