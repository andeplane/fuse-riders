/** The online layer's public surface: the room as a `RollbackGame`, its runtime, and what it reports. */
export * from "./game.js";
export * from "./runtime.js";
export * from "./result.js";
export { hashPlain } from "./hash.js";
export { BOT_NAMES, botName, seatName } from "./names.js";
export { MAX_GAMES, MAX_NAME, MAX_WINS, teamOfSlot } from "./basics.js";
export type {
  BotLevel,
  GameEvent,
  MapId,
  RoundView,
  UnitView,
  VictoryKind,
} from "../engine/index.js";
