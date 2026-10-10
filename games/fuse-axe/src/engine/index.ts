/** Fuse Axe's engine: deterministic rules with no imports from outside this folder. */
export const RULES = "fuse-axe-3";
export * from "./input.js";
export {
  createWorld,
  spawnEnemy,
  stageCleared,
  showsGo,
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
export {
  STAGE_1,
  waveSpawns,
  type Placed,
  type Side,
  type Spawn,
  type StagePlan,
  type Wave,
} from "./stages.js";
export { seedOf } from "./rng.js";
export { decodeWorld, encodeWorld } from "./codec.js";
export {
  CAPACITY,
  ENEMY_KINDS,
  HERO_KINDS,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  TIERS,
  enemyMaxHp,
  type EnemyKind,
  type HeroKind,
  type Tier,
} from "./tuning.js";
