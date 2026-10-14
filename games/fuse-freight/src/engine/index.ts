/** Fuse Freight's engine: deterministic rules with no imports from outside this folder. */
export const RULES = "fuse-freight-1";
export * from "./settings.js";
export * from "./input.js";
export * from "./world.js";
export { stepWorld, roundDone, places, nose, speedOf } from "./step.js";
export { botInput } from "./bot.js";
export {
  toView,
  type WorldView,
  type TrainView,
  type WagonView,
  type CartView,
  type FxView,
  type FxKind,
} from "./view.js";
export { encodeWorld, decodeWorld, trainId } from "./codec.js";
export { seedOf } from "./rng.js";
export { wagons } from "./trail.js";
export {
  CAPACITY,
  COUNTDOWN_STEPS,
  STEPS_PER_TICK,
  STEPS_PER_SECOND,
  OUTRO_STEPS,
  MAX_WAGONS,
} from "./tuning.js";
