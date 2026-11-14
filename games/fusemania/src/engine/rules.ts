/**
 * Fusemania's numbers: timing windows, points, and what each power-up does. All times are milliseconds of song time.
 * Changing any of them changes the outcome of a recorded match, so it bumps `RULES` (`index.ts`).
 */

/** Players in one room. */
export const CAPACITY = 5;
/** Arrows: left, down, up, right. */
export const COLUMNS = 4;
/** One log tick of song time. */
export const TICK_MS = 50;
/** Song time before the music's first sample when a match starts: time to load the song and get ready. */
export const LEAD_IN_MS = 4000;
export const SOLO_LEAD_IN_MS = 2500;
/** Song time after the last note before the result. */
export const END_PAD_MS = 2500;

// ---- judgments ----
export const MARVELOUS = 0,
  PERFECT = 1,
  GREAT = 2,
  GOOD = 3,
  BOO = 4,
  MISS = 5,
  /** A hold or roll kept to its end, and one let go. */
  HELD = 6,
  DROPPED = 7,
  /** A mine set off. */
  MINED = 8;
export const COUNTS = 9;
/** Half-widths of the tap windows, best first: a press this far from a note or closer earns that judgment. */
export const WINDOWS = [22, 45, 90, 135, 180] as const;
export const WORST_WINDOW = WINDOWS[4];
/** A press this close to a mine sets it off. */
export const MINE_WINDOW = 70;
/** A hold let go may be caught again this long after; closer than this to its tail it counts as held. */
export const HOLD_GRACE_MS = 250;
/** A roll needs a tap at least this often. */
export const ROLL_GRACE_MS = 500;
/** Points by judgment. */
export const POINTS = [10, 9, 6, 3, 1, 0] as const;
export const HOLD_POINTS = 5;
export const MINE_PENALTY = 6;
/** The worst judgment that keeps a combo going. */
export const COMBO_KEEPS = GOOD;
/** What a rating is out of: every note Marvelous and every hold kept is this many. */
export const FULL_RATING = 1_000_000;

// ---- input timestamps ----
/**
 * A press is judged at the song time its device heard, not at the tick it was logged for. The log tick bounds it: a
 * timestamp is taken no further behind its tick than `LATE_MS` and no further ahead than `EARLY_MS`, so a note is
 * known missed once the room's clock is `LATE_MS` past its last window, and nothing a device claims reaches back
 * past that.
 */
export const LATE_MS = 250;
export const EARLY_MS = 150;
/** The widest song time an entry may name. */
export const MIN_SONG_MS = -60_000;
export const MAX_SONG_MS = 3_600_000;

// ---- modes ----
export const SCORE_MODE = 0,
  BATTLE_MODE = 1;
export const MODES = 2;

// ---- power-ups ----
export const NO_ITEM = 0,
  DRUNK = 1,
  WAVE = 2,
  BOOMERANG = 3,
  TORNADO = 4,
  HIDDEN = 5,
  FLIP = 6,
  TURBO = 7,
  BLACKOUT = 8,
  MINES = 9,
  LAG = 10,
  DOUBLE = 11,
  STAR = 12,
  SHIELD = 13;
export const ITEM_KINDS = 14;
/** Whether an item is thrown at the others (true) or used on its holder. */
export const isAttack = (item: number): boolean => item >= DRUNK && item <= LAG;
/** How long each lasts once it takes hold. */
export const ITEM_MS: readonly number[] = [
  0, 9000, 9000, 8000, 8000, 8000, 7000, 7000, 6000, 9000, 8000, 10_000, 5000,
  20_000,
];
/** An attack takes hold this long after it is thrown: a warning on the victim's screen, and time for the throw to reach every device. */
export const ATTACK_LEAD_MS = 1200;
/** How much of a rider's taps a mine attack turns into mines, out of 100. */
export const MINE_SHARE = 34;
/** A battle chart gives an item on the first note at or after every one of these, from `ITEM_FIRST_MS` after its first note. */
export const ITEM_EVERY_MS = 6500;
export const ITEM_FIRST_MS = 4000;
/** A bot throws what it holds this long after picking it up. */
export const BOT_ITEM_DELAY_MS = 1500;
/** Effects a rider can be under at once; a throw past this is dropped. */
export const MAX_EFFECTS = 12;
/**
 * The tuning table for battle drops, indexed by item kind (`NO_ITEM` first):
 *
 * - `ITEM_BASE` is how common each item is between riders who are level.
 * - `ITEM_POWER` rates each from 1 to 10: for an attack, how hard it is for the rider it lands on to keep hitting
 *   notes (Flip mirrors the columns and is close to the worst; Wave only sways them); for an item used on its holder,
 *   how much it is worth (Star plays for you; Shield only matters if somebody throws).
 *
 * A rider who is behind draws the high-power items more often and the low-power ones less, a rider who is ahead the
 * other way round, and by how much follows the score gap (see `itemEdge` and `itemWeights` in `play.ts`).
 */
//                                        -  DRU WAV BOO TOR HID FLI TUR BLA MIN LAG DOU STA SHI
export const ITEM_BASE: readonly number[] = [
  0, 10, 10, 10, 10, 10, 8, 10, 8, 10, 8, 10, 8, 10,
];
export const ITEM_POWER: readonly number[] = [
  0, 3, 2, 6, 5, 6, 10, 4, 8, 7, 7, 8, 9, 2,
];
/**
 * How far a full gap tilts the table, out of 1000: at 900 a power-10 item is 1.9 times as likely for a rider a full
 * gap behind and a tenth as likely for one a full gap ahead, and a power-1 item the reverse. 0 turns the balancing off.
 */
export const ITEM_TILT = 900;
/** The gap that counts as full: a rider this many percent of the leader's rating from the others' average. */
export const ITEM_GAP_FULL_PCT = 20;
/** The gap is measured against at least this much rating, so one early miss is not a landslide. */
export const ITEM_GAP_FLOOR = 50_000;

/** A bot's judgments out of 1000, best first (Marvelous, Perfect, Great, Good, Boo); the rest are misses. */
export const BOT_SKILL: readonly number[] = [430, 330, 150, 40, 15];
