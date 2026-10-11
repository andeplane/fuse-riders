/** Fuse Axe's engine: deterministic rules with no imports from outside this folder. */
export const RULES = "fuse-axe-14";
export * from "./input.js";
export {
  carryOf,
  createWorld,
  defeated,
  spawnEnemy,
  stageCleared,
  showsGo,
  ENEMY_STATES,
  FX_KINDS,
  HERO_STATES,
  SPAWNS,
  type Carry,
  type Enemy,
  type EnemyState,
  type Fx,
  type FxKind,
  type Hero,
  type HeroEntry,
  type HeroState,
  type Item,
  type Spell,
  type World,
} from "./world.js";
export { revive, step, stepTick } from "./step.js";
export { botInput } from "./bot.js";
export { sendImp } from "./imps.js";
export {
  toView,
  type BossView,
  type EnemyAnim,
  type EnemyView,
  type FxView,
  type HeroAnim,
  type HeroView,
  type ItemView,
  type SpellView,
  type WorldView,
} from "./view.js";
export {
  STAGE_1,
  STAGE_2,
  STAGES,
  planOf,
  waveSpawns,
  type ImpCue,
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
  MAX_POTS,
  SPELLS,
  SPELL_KINDS,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  TIERS,
  enemyMaxHp,
  type EnemyKind,
  type HeroKind,
  type ItemKind,
  type SpellKind,
  type Tier,
} from "./tuning.js";
