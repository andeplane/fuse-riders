/** Fuse Axe's engine: deterministic rules with no imports from outside this folder. */
export const RULES = "fuse-axe-1";
export * from "./input.js";
export {
  createWorld,
  HERO_STATES,
  SPAWNS,
  type Hero,
  type HeroEntry,
  type HeroState,
  type World,
} from "./world.js";
export { step, stepTick } from "./step.js";
export {
  toView,
  type HeroAnim,
  type HeroView,
  type WorldView,
} from "./view.js";
export { seedOf } from "./rng.js";
export {
  CAPACITY,
  HERO_KINDS,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  type HeroKind,
} from "./tuning.js";
