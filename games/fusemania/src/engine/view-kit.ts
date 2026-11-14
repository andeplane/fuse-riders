/**
 * What the renderer may read of the engine beside the view itself: the chart's static data and the rule values and
 * pure helpers a picture needs (which notes are hit, which a mine attack has turned, which carry a power-up).
 * Nothing here changes a match.
 */
export {
  BATTLE_MODE,
  BLACKOUT,
  BOO,
  BOOMERANG,
  COLUMNS,
  DOUBLE,
  DROPPED,
  DRUNK,
  FLIP,
  FULL_RATING,
  GOOD,
  GREAT,
  HELD,
  HIDDEN,
  ITEM_KINDS,
  ITEM_MS,
  LAG,
  MARVELOUS,
  MINED,
  MINES,
  MISS,
  NO_ITEM,
  PERFECT,
  SCORE_MODE,
  SHIELD,
  STAR,
  TORNADO,
  TURBO,
  WAVE,
  WINDOWS,
  isAttack,
} from "./rules.js";
export { HOLD, MINE, ROLL, TAP, type StepNote, type Steps } from "./steps.js";
export { turnedMine, under, wasHit, type Effect } from "./play.js";
export { itemNotes } from "./world.js";

/** What each judgment is called on screen, by its number. */
export const JUDGMENT_NAMES = [
  "MARVELOUS",
  "PERFECT",
  "GREAT",
  "GOOD",
  "BOO",
  "MISS",
  "HELD",
  "DROPPED",
  "MINE",
] as const;

/** What each power-up is called, by its number; the first is "nothing". */
export const ITEM_NAMES = [
  "",
  "DRUNK",
  "WAVE",
  "BOOMERANG",
  "TORNADO",
  "HIDDEN",
  "FLIP",
  "TURBO",
  "BLACKOUT",
  "MINES",
  "LAG",
  "DOUBLE",
  "STAR",
  "SHIELD",
] as const;

/** One line on what each power-up does, by its number. */
export const ITEM_HINTS = [
  "",
  "Their arrows sway from side to side",
  "Their arrows surge and stall",
  "Their arrows fly out and come back",
  "Their columns swirl around each other",
  "Their arrows fade out before the targets",
  "Their columns swap sides",
  "Their arrows come twice as fast",
  "Their field goes dark between beats",
  "Some of their arrows turn into mines",
  "Their picture runs behind the music",
  "Your notes score double",
  "Every note is Marvelous for you",
  "Blocks the next attack on you",
] as const;
