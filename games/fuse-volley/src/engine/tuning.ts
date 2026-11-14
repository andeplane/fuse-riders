/**
 * Every number the simulation is tuned by. They come from disassembling the original Blobby Volley (volley.exe, a
 * Delphi 5 program); the address after each is where the exe holds it. The court is 800 × 600 px with y pointing up
 * from the bottom edge. Ball position and speed are in ball units of 1/32 px; blob x is in px, blob height and
 * vertical speed in 1/256 px. One step is 1/120 s, which is the exe's ball rate (four sub-steps per 33 ms frame).
 * Changing any of them changes the rules: bump `RULES` and re-record the golden.
 */

export const STEPS_PER_SECOND = 120;
/** Steps in one 50 ms log tick. */
export const STEPS_PER_TICK = 6;
/** Steps in one original 33 ms frame: touches are counted once a frame. */
export const FRAME_STEPS = 4;

/** Seats a room has: two for one blob a side, four for two a side, six for three a side. */
export const CAPACITY = 6;
export const RALLY_TARGET = 11,
  CLASSIC_TARGET = 15;
/** A match level at this many is decided by the next point: the score never runs past it. */
export const SCORE_CAP = 40;

/** Ball units per pixel. */
export const BU = 32;
/** Blob height units per pixel. */
export const HU = 256;

export const COURT_W = 800,
  COURT_H = 600;
/** The net's line. */
export const NET_X = 400;

// ---- the ball (units of 1/32 px) ----
/** The ball's radius in px. */
export const BALL_RADIUS = 32;
/** Lowest centre: on the sand (0x1080). */
export const BALL_FLOOR = 4224;
/** The side walls for the ball's centre (0x400, 0x6000). */
export const BALL_LEFT = 1024,
  BALL_RIGHT = 24576;
/** Where a serve hovers: x 200 or 600 px, 300 px up (0x2580). */
export const SERVE_X = [6400, 19200] as const,
  SERVE_Y = 9600;
/** Gravity: 3 units on even steps, 4 on odd (`lea ecx,[esi+2]`). */
export const BALL_GRAVITY = 3;
/** While falling, gravity eases by floor(floor(|vy| / 3) / 32) (`idiv 3`, `sar 5`). */
export const DRAG_DIV = 3,
  DRAG_SHIFT_DIV = 32;
/** Speed off a blob, along the contact normal (8.0 × 32.0). */
export const HIT_SPEED = 256;
/** Speed off the net's top (4.0 × 32.0). */
export const NET_SPEED = 128;
/** The sand keeps 3/4 of the ball's speed each way (`lea`, `sar 2`). */
export const FLOOR_KEEP_NUM = 3,
  FLOOR_KEEP_DEN = 4;
/** A push-out moves the ball a tenth of its new speed per pass, at most this many passes. */
export const PUSH_DIV = 10,
  PUSH_PASSES = 16;

// ---- the net (ball units unless named) ----
/** The net's rounded top: a point at (400, 329) px (400.0, 329.0). */
export const NET_TOP_X = NET_X * BU,
  NET_TOP_Y = 329 * BU;
/** Contact below 37 px from the top point, pushed out past 39 (1369.0, 1521.0). */
export const NET_HIT = 37 * BU,
  NET_OUT = 39 * BU;
/** The pole stops a ball whose bottom edge is at or below this height in px (0x142). */
export const POLE_TOP = 322;
/** The band, in px from the right wall's mirror, where a ball's near edge meets the pole (the exe's 380 ≤ edge < 410). */
export const POLE_LOW = 380,
  POLE_HIGH = 410;
/** Where the pole puts a ball it turns back: right of it, or left of it. */
export const POLE_PUT_RIGHT = 14176,
  POLE_PUT_LEFT = 11424;
/** The tunnelling guard (0x444100): the line a low ball may not cross, the band it may not be in, and where it goes. */
export const GUARD_LINE = 11776,
  GUARD_LOW = 11552,
  GUARD_HIGH = 14048,
  GUARD_Y = 10240,
  GUARD_PREV_Y = 10432,
  GUARD_PUT_RIGHT = 14080,
  GUARD_PUT_LEFT = 11520;

// ---- the blobs ----
/** Feet on the sand: 100 px up, in height units (`cmp [blob+0x14],0x64`). */
export const BLOB_FLOOR = 100 * HU;
/** How close a blob's centre comes to the net's line, px. */
export const NET_GAP = 40;
/** Blob centre x limits in px, left side and right side (0x168, 0x1b8, 0x320). */
export const BLOB_MIN = [0, 440] as const,
  BLOB_MAX = [360, 800] as const;
/** Where blobs start. */
export const BLOB_START = [200, 600] as const;

// ---- two a side ----
/**
 * The doubles court's width, px: the singles court's net, pole and heights on a beach 1.75 times as wide. A flat hit
 * from the back line just about carries over the net, so the back blob can still score but usually passes; at twice
 * the width bot matches ended a third of their rallies on a third touch that could not reach.
 */
export const TEAM_COURT_W = 1400;
/** Where a doubles side's two blobs start, px from the net. */
export const TEAM_FRONT = 180,
  TEAM_BACK = 490;
/** Teammates are solid to each other: two blob centres stay this far apart unless one is above the other's head. */
export const BLOB_HALF = 32;
/** A blob coming down on a teammate's head pops back up at this speed (height units a step) as it slides off. */
export const HEAD_BOUNCE = 1400;
// ---- three a side ----
/**
 * The three-a-side court's width, px: one big beach with the singles court's net, pole and heights, and no lanes, a
 * third of a side for each blob. Normal bots played rallies as long as doubles' (8 to 10 s, about 10 touches) on every
 * width from 1700 to 2100, each of the three taking its share; 2000 keeps the blobs big enough on a phone.
 */
export const TRIPLE_COURT_W = 2000;
/** Where a three-a-side side's blobs start, px from the net: front, middle (under the serve) and back. */
export const TRIPLE_FRONT = 180,
  TRIPLE_MID = 500,
  TRIPLE_BACK = 800;

// ---- three teams of two ----
/**
 * Three teams of two play king of the court on the doubles court: two teams play each rally while the third waits;
 * the side that loses a rally walks off and the waiting team comes on in its place and serves. First to the target
 * wins outright (no lead of two: with three teams a deuce never settles).
 */
export const KINGS_RALLY_TARGET = 11,
  KINGS_CLASSIC_TARGET = 7;
/** px per step, no inertia, the same in the air (the exe's 12 px a frame). */
export const RUN_SPEED = 3;
/** Jump launch in height units per step. The exe's 10 000 a frame, resampled to 120 Hz to keep its 264 px apex. */
export const JUMP_SPEED = 2575;
/** Gravity per step: this while jump is held, twice it otherwise (the exe's 800 and 1600 a frame). */
export const BLOB_GRAVITY = 50;
/** Squash frames 0–4; the animation moves one frame every `FRAME_STEPS`. */
export const SQUASH_FRAMES = 4;
/** Head and body circle centres above the feet in px, by squash frame (tables 0x44daf4 and 0x44db1c). */
export const HEAD_UP = [65, 60, 56, 51, 47] as const,
  BODY_UP = [32, 30, 27, 25, 22] as const;
/** Contact below these distances from the head's and the body's centre, pushed out past the second (3249.0, 3481.0, 4096.0, 4356.0). */
export const HEAD_HIT = 57 * BU,
  HEAD_OUT = 59 * BU,
  BODY_HIT = 64 * BU,
  BODY_OUT = 66 * BU;
/** A contact whose normal is within acos(0.7) of the ball's own path is a graze: it bounces but does not count. */
export const GRAZE_NUM = 7,
  GRAZE_DEN = 10;

// ---- the rules ----
/** A side's fourth touch in a row is a fault. */
export const MAX_TOUCHES = 3;
/** Contact on more than this many frames in a row is carrying. */
export const MAX_HOLD = 40;
/** A ball this far past the net (px from 400) clears the other side's touch count (13120 and 12480 units). */
export const CLEAR_RIGHT = 13120,
  CLEAR_LEFT = 12480;
/** A served ball that nobody has touched falls after 5 s. */
export const SERVE_TIMEOUT = 5 * STEPS_PER_SECOND;
/** After a point the ball settles for 2 s, then the next serve waits for both blobs to land. */
export const DEAD_STEPS = 2 * STEPS_PER_SECOND;

/** Cosmetic counters wrap here, so they stay small integers for ever. */
export const COUNTER = 0x10000;
/** The last step a world may reach: 207 days of play. */
export const MAX_STEP = 0x7fff_ffff;

// ---- bounds the codec checks ----
/** Ball speed never leaves this: a hit is 256 along the normal and gravity tops out near 400 falling. */
export const BALL_MAX_SPEED = 1024;
/** Blob vertical speed never leaves this. */
export const BLOB_MAX_VY = JUMP_SPEED;
export const BLOB_MIN_VY = -8 * JUMP_SPEED;
/** The highest a blob can be: a held jump's apex, with room. */
export const BLOB_CEILING = BLOB_FLOOR + 300 * HU;
/** The ball has no ceiling; the codec refuses anything past this, far above any reachable height. */
export const BALL_CEILING = 8000 * BU;
/** Counted touches one match reports per blob, at most (repeats `MOST_HITS` in `basics.ts`). */
export const MOST_HITS = 20000;
