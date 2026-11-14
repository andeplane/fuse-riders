/**
 * Fuse Volley's engine: deterministic integer rules with no imports from outside this folder. A change to what any of
 * it does must bump `RULES` and re-record the golden (`tests/golden.test.ts`) in the same commit.
 */
export const RULES = "fuse-volley-5";
export * from "./input.js";
export {
  PHASES,
  SCORINGS,
  cloneWorld,
  courtOf,
  benched,
  benchTeam,
  teamOf,
  createWorld,
  isPlayerCount,
  otherSide,
  serve,
  targetOf,
  type Ball,
  type Blob,
  type Phase,
  type Scoring,
  type Side,
  type World,
} from "./world.js";
export { stepWorld, winnerOf, decided, kingsDecided } from "./step.js";
export {
  FORMATS,
  blobsFor,
  courtFor,
  formatFor,
  isFormat,
  DOUBLES,
  SINGLES,
  TRIPLES,
  type Court,
  type Format,
} from "./court.js";
export { botInput, BOT_LEVELS, isBotLevel, type BotLevel } from "./bot.js";
export {
  toView,
  type WorldView,
  type BlobView,
  type BallView,
} from "./view.js";
export { encodeWorld, decodeWorld, riderId } from "./codec.js";
export { seedOf } from "./math.js";
export {
  CAPACITY,
  RALLY_TARGET,
  CLASSIC_TARGET,
  SCORE_CAP,
  MOST_HITS,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
} from "./tuning.js";
