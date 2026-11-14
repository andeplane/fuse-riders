/**
 * Fusemania's engine: deterministic rules with no imports from outside this folder. Judging is integer arithmetic
 * on song-time milliseconds, and chance is a hash of the match's seed, so every device folds the same match. A
 * change to what any of it does, the bundled charts included, must bump `RULES`.
 */
export const RULES = "fusemania-1";
export * from "./rules.js";
export {
  MAX_SIMFILE_BYTES,
  SimfileError,
  parseSimfile,
  writeSsc,
  type ChartNote,
  type NoteKind,
  type SimChart,
  type Simfile,
  type TimingData,
} from "./simfile.js";
export { createTiming, type Timing } from "./timing.js";
export {
  HOLD,
  MINE,
  ROLL,
  TAP,
  compileSteps,
  type StepNote,
  type Steps,
} from "./steps.js";
export {
  createLibrary,
  type ChartInfo,
  type Library,
  type SongInfo,
  type SongSource,
} from "./library.js";
export {
  AUTO,
  KEPT,
  NO_HOLD,
  NO_JUDGMENT,
  UP,
  addEffect,
  advance,
  createPlayer,
  finish,
  hash,
  press,
  release,
  turnedMine,
  under,
  wasHit,
  type Effect,
  type PlayContext,
  type Player,
} from "./play.js";
export {
  RELEASE,
  USE,
  cloneWorld,
  createWorld,
  forecast,
  isCode,
  itemNotes,
  ranking,
  rating,
  stepWorld,
  type Entrant,
  type Input,
  type Pending,
  type Phase,
  type World,
} from "./world.js";
export { toView, type PlayerView, type WorldView } from "./view.js";
export { ITEM_HINTS, ITEM_NAMES, JUDGMENT_NAMES } from "./view-kit.js";
export { decodeWorld, encodeWorld } from "./codec.js";
