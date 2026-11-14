/**
 * Fuse Surge's engine: deterministic integer rules with no imports from outside this folder. A change to what any of
 * it does must bump `RULES` and re-record the golden (`tests/golden.test.ts`) in the same commit.
 */
export const RULES = "fuse-surge-1";
export * from "./input.js";
export {
  DEFAULT_RULES,
  HIGH,
  LOW,
  PACES,
  PHASES,
  REASONS,
  cloneWorld,
  createWorld,
  footholdX,
  gapAt,
  isHits,
  isPace,
  isPlayerCount,
  isSeconds,
  isTarget,
  limitOf,
  slotsOf,
  speedAt,
  startRound,
  type Kind,
  type Pace,
  type Phase,
  type Reason,
  type Rider,
  type Rules,
  type Surge,
  type World,
} from "./world.js";
export { clears, stepWorld, winnersOf } from "./step.js";
export {
  BOT_LEVELS,
  botInput,
  isBotLevel,
  planInput,
  type BotLevel,
} from "./bot.js";
export {
  secondsLeft,
  toView,
  type RiderView,
  type SurgeView,
  type WorldView,
} from "./view.js";
export { decodeWorld, encodeWorld, riderId } from "./codec.js";
export { seedOf } from "./math.js";
export {
  CAPACITY,
  DEFAULT_HITS,
  DEFAULT_SECONDS,
  DEFAULT_TARGET,
  MAX_HITS,
  MAX_ROUNDS,
  MAX_SECONDS,
  MAX_TARGET,
  MIN_HITS,
  MIN_RIDERS,
  MIN_SECONDS,
  MIN_TARGET,
  MOST_DODGES,
  MOST_TAKEN,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  STREAK_FOR_STEP,
} from "./tuning.js";
