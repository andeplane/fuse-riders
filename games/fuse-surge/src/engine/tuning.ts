/**
 * Every number Fuse Surge plays by. Lengths are in units of 1/256 px (`U`), times in steps of 1/120 s, speeds in
 * units per step. Changing any of them changes the rules: bump `RULES` and re-record the golden.
 *
 * The deck runs along x: its edge over the pit is x = 0 and surges come from beyond its far end, travelling toward
 * the edge. y is height above the deck.
 */
export const CAPACITY = 5;
export const MIN_RIDERS = 2;
export const STEPS_PER_SECOND = 120;
export const STEPS_PER_TICK = 6;
/** Units per pixel. */
export const U = 256;

// ---- the deck ----
export const DECK_W = 960 * U;
/** A rider past this is over the pit. */
export const EDGE_X = 0;
/** Where everyone starts a round. */
export const START_X = 600 * U;
/** The last foothold: where a rider one hit from falling stands. */
export const LAST_X = 70 * U;
/** Where a rider knocked off the deck drifts to while falling. */
export const OUT_X = -70 * U;
/** How far below the deck a fallen rider drops before it rests. */
export const FALL_DEPTH = 420 * U;
export const SPAWN_X = DECK_W + 90 * U;
export const EXIT_X = -130 * U;
/** The flip gate: a flipping surge changes height as it crosses, well before the start line. */
export const GATE_X = 800 * U;

// ---- a rider ----
/** Half a rider's width plus half a surge's: closer than this along x, they overlap. */
export const REACH = 20 * U;
export const STAND_H = 84 * U;
export const DUCK_H = 44 * U;
/** A low surge strikes feet at or below this height. */
export const LOW_TOP = 40 * U;
/** A high surge strikes a head at or above this height. */
export const HIGH_BOTTOM = 56 * U;
/** Take-off speed and gravity: a held jump peaks near 149 px and lasts 83 steps. */
export const JUMP_V = 1830;
export const GRAVITY = 44;
/** Letting go of jump while rising faster than this cuts the rise to it: a tap is a hop. */
export const JUMP_CUT = 900;
/** Ducking in the air stops the rise and falls this hard: a dive. */
export const DIVE_GRAVITY = 132;
/** A jump pressed this many steps before landing still jumps. */
export const JUMP_BUFFER = 10;
/** The little hop a struck rider is thrown into. */
export const POP_V = 900;
/** The fastest any rider falls: a bound for the checkpoint. */
export const MAX_FALL_V = 4200;
export const MAX_Y = 40000;
export const KNOCK_SPEED = 5 * U;
export const WALK_SPEED = 384;
/** A struck rider reels for at least this long (and until it reaches its new foothold); nothing can strike it. */
export const REEL_STEPS = 36;
/** After reeling, a moment more in which nothing can strike. */
export const GRACE_STEPS = 30;
/** Clean dodges in a row that win a foothold back. */
export const STREAK_FOR_STEP = 5;

// ---- a match's settings ----
export const MIN_HITS = 1;
export const MAX_HITS = 9;
export const DEFAULT_HITS = 3;
export const MIN_SECONDS = 10;
export const MAX_SECONDS = 300;
export const DEFAULT_SECONDS = 60;
/** Round wins that take the match. */
export const MIN_TARGET = 1;
export const MAX_TARGET = 5;
export const DEFAULT_TARGET = 3;
/** The countdown before a round, and the pause after it. */
export const READY_STEPS = 3 * STEPS_PER_SECOND;
export const BREAK_STEPS = 3 * STEPS_PER_SECOND;

// ---- surges, by pace (0 chill, 1 standard, 2 frantic) ----
/** Units per step at the start of a round, and what a thousand steps add. */
export const SPEED_BASE = [410, 560, 700] as const;
export const SPEED_RAMP = [60, 88, 115] as const;
export const SPEED_MAX = 1700;
/** Steps between surges at the start of a round, what a thousand steps take off, and the floor. */
export const GAP_BASE = [200, 176, 150] as const;
export const GAP_SHRINK = [12, 15, 18] as const;
export const GAP_MIN = [96, 84, 76] as const;
/** The first surge of a round. */
export const FIRST_SPAWN = 40;
/** From this step on some surges come as a tight pair, this close together. */
export const PAIR_FROM = 15 * STEPS_PER_SECOND;
export const PAIR_GAP = [84, 76, 70] as const;
export const PAIR_CHANCE_MAX = 40;
/** From this step on some surges flip height at the gate. */
export const FLIP_FROM = 8 * STEPS_PER_SECOND;
export const FLIP_CHANCE_MAX = 35;
/** At most this many surges of one height in a row. */
export const MAX_RUN = 3;
/** More surges than this are never on the deck: a bound for the checkpoint. */
export const MAX_SURGES = 24;

/** The most a match can count: a round always awards a win, so a match is at most 5 × 4 + 1 rounds. */
export const MAX_ROUNDS = CAPACITY * (MAX_TARGET - 1) + 1;
/** A match's dodges and hits stay far below these (a surge at most every 70 steps, a hit at most every 66); the counts stop here. */
export const MOST_DODGES = 20000;
export const MOST_TAKEN = 5000;
/** The hit cue counts round and round below this. */
export const COUNTER = 1 << 16;
