// Public entry point of the Fuse Bombers engine. Everything outside src/engine/ imports from here.
// See docs/engine.md for the contract.

/**
 * The rules online peers compare (`<prefix>-<n>`): a change to how a logged room plays bumps `n` and re-records
 * the golden replay (`tests/online-golden.test.ts`) in the same commit.
 */
export const RULES = "fuse-bombers-1";

export {
  CARDS,
  DEFAULT_TUNING,
  DT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SUBSTEPS,
  TICK_HZ,
  WORLD_HEIGHT,
  WORLD_WIDTH,
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
export { DOWN, FIRE, INPUT_MASK, isInput, LEFT, RIGHT, UP } from "./input.js";
export { GHOST_FLIGHT, GUNSHIP_FLIGHT } from "./flight.js";
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
export {
  cellHard,
  cellSolid,
  gridHash,
  hardAt,
  segmentHit,
  solidAt,
} from "./grid.js";
export type { CellRect, Grid } from "./grid.js";

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
  TerrainView,
  TickEvent,
  TickEventType,
  Vec2,
} from "./types.js";
