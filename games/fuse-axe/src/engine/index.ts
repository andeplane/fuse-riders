/** Fuse Axe's engine: deterministic rules with no imports from outside this folder. */
export const RULES = "fuse-axe-2";
export * from "./input.js";
export {
  createWorld,
  spawnEnemy,
  ENEMY_STATES,
  FX_KINDS,
  HERO_STATES,
  SPAWNS,
  type Enemy,
  type EnemyState,
  type Fx,
  type FxKind,
  type Hero,
  type HeroEntry,
  type HeroState,
  type World,
} from "./world.js";
export { step, stepTick } from "./step.js";
export {
  toView,
  type EnemyAnim,
  type EnemyView,
  type FxView,
  type HeroAnim,
  type HeroView,
  type WorldView,
} from "./view.js";
export { seedOf } from "./rng.js";
export {
  CAPACITY,
  ENEMY_KINDS,
  HERO_KINDS,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  type EnemyKind,
  type HeroKind,
} from "./tuning.js";
