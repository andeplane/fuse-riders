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
 * How likely each item is, by place: the leader's row first, the last place's row last (rows between are blended).
 * Indexed by item kind; the leader gets mostly mischief, the last place the strong ones.
 */
export const ITEM_WEIGHTS: readonly (readonly number[])[] = [
  [0, 12, 12, 8, 8, 10, 8, 8, 6, 6, 6, 4, 2, 10],
  [0, 8, 8, 10, 10, 8, 8, 8, 8, 10, 8, 12, 10, 4],
];

/** A bot's judgments out of 1000, best first (Marvelous, Perfect, Great, Good, Boo); the rest are misses. */
export const BOT_SKILL: readonly number[] = [430, 330, 150, 40, 15];
