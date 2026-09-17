/**
 * The engine's public API: the deterministic simulation, its tick driver, the input log it folds, room settings, the
 * bots, and the codec that validates a state at the checkpoint boundary. The engine imports nothing outside
 * `src/engine/` except wire type names from `src/shared/protocol.ts` (through `state.ts`; issue #254 moves them in).
 *
 * App and net code should come through here; tests may deep-import. What rendering may read is a narrower contract,
 * `view.ts` and `view-kit.ts` (docs/design/render-boundary.md), not this file. App and net importers still reach into
 * the modules directly: moving them is left to the layer work in #255.
 */

// The world: plain-data state, the commands that change it between ticks, and `step`, which is a loop over PHASES.
export * from "./game.js";
// The tick driver every replica runs, the rules version, and the canonical state hash.
export * from "./apply-tick.js";
// Log entries and their validation, and the fold of a rider's entries into held controls.
export * from "./input-log.js";
export * from "./room-settings.js";
export { BotController, BOT_ID_PREFIX } from "./bot-controller.js";
export {
  decodeGameState,
  encodeGameState,
  MAX_CHECKPOINT_BYTES,
} from "./codec/checkpoint.js";
// The tick contract, for documentation, tests and fault injection.
export type { DeathFact, TickContext, TickFact } from "./sim/context.js";
// Facts a match produces, as types: statistics, the shot log and highlight moments are written only by `recordFacts`.
export type { MatchPlayerStats, MatchStatsState } from "./match-stats.js";
export type { DecidedRound, RoundShot, ShotKill, Weapon } from "./shot-log.js";
export type { Moment, MomentKind } from "./moments.js";
// What a screen is given: `toView(state)` (exported with the world above) builds it.
export type { RiderView, ViewRules, WorldView } from "./view.js";
