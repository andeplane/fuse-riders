// Public entry point of the Fuse Bombers engine. Everything outside src/engine/ imports from here.
// See docs/engine.md for the contract.

export {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  CARDS,
  DEFAULT_TUNING,
  DT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SUBSTEPS,
  TICK_HZ,
  resolveTuning,
  secondsToTicks,
} from "./tuning.js";
export type { Card, Tuning } from "./tuning.js";

export {
  createRound,
  damageScale,
  fuseProgress,
  futureAngle,
  ghostOf,
  isGhostLoaded,
  isLoaded,
  step,
  view,
} from "./round.js";
export { predictGhostBomb, predictTrajectory } from "./predict.js";
export { BOT_DIFFICULTIES, createBot } from "./bot.js";
export type { Bot, BotConfig, BotDifficulty } from "./bot.js";
export type {
  ImpactKind,
  PredictOptions,
  Trajectory,
  TrajectoryImpact,
} from "./predict.js";
export { createMatch, nextRoundConfig, recordRoundResult } from "./match.js";
export type { MatchConfig, MatchState } from "./match.js";
export {
  castleCenter,
  gatePositionAt,
  ghostPositionAt,
  launcherPivot,
  launchState,
} from "./geometry.js";
export { surfaceAt } from "./terrain.js";

export type {
  Castle,
  CastleStats,
  CastleView,
  Crate,
  CrateView,
  Gate,
  GateView,
  Ghost,
  GhostView,
  Rocket,
  RocketView,
  RoundConfig,
  RoundPhase,
  RoundResult,
  RoundState,
  RoundView,
  Terrain,
  TerrainView,
  TickEvent,
  TickEventType,
  Vec2,
} from "./types.js";
