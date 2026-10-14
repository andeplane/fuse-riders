/** Fuse Choppers' engine: deterministic rules with no imports from outside this folder. */
export const RULES = "fuse-choppers-1";
export * from "./settings.js";
export * from "./input.js";
export * from "./world.js";
export { stepWorld, roundDone, flying, played } from "./step.js";
export { botInput } from "./bot.js";
export {
  toView,
  type WorldView,
  type ChopperView,
  type FxKind,
} from "./view.js";
export { encodeWorld, decodeWorld, chopperId } from "./codec.js";
export { seedOf } from "./rng.js";
export {
  CAPACITY,
  COUNTDOWN_STEPS,
  STEPS_PER_TICK,
  OUTRO_STEPS,
} from "./tuning.js";
