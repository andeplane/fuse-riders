/**
 * Every number the rules run on. Lengths are art pixels times `S` (integer subpixels), speeds are subpixels per
 * 60 Hz step, times are steps. A comment says where each value comes from: "original" is a published Killer Queen
 * figure (docs/BRIEF.md), "ours" is a value we chose and settled with headless bot runs (docs/balance.md).
 */

/** Subpixels per art pixel. All state is integers in this unit. */
export const S = 1024;
/** Simulation steps per second. */
export const TICK_HZ = 60;
export const MAX_PLAYERS = 6;
/** Bump on any behaviour change: peers on different rules refuse each other. */
export const RULES = "killer-fuse-1";

const px = (value: number): number => Math.round(value * S);
const perSecond = (pixels: number): number =>
  Math.round((pixels * S) / TICK_HZ);
const seconds = (value: number): number => Math.round(value * TICK_HZ);

/** Speed gate multiplier, 1.35 (original), as a ratio so the arithmetic stays integer. */
export const SPEED_NUM = 27,
  SPEED_DEN = 20;
export const speedy = (value: number, speed: boolean): number =>
  speed ? Math.trunc((value * SPEED_NUM) / SPEED_DEN) : value;

// --- Running -------------------------------------------------------------------------------------------------------
/** Run speed 62.5 px/s: crosses the 480 px screen in 7.7 s (original). */
export const RUN_SPEED = perSecond(62.5);
/** A winged unit walks at 0.84 times run speed (original). */
export const WING_WALK_NUM = 21,
  WING_WALK_DEN = 25;
/** Horizontal speed in flight (ours: the same as running, so a Warrior neither outruns nor trails a Worker). */
export const FLY_SPEED = RUN_SPEED;
/** Change of horizontal speed per step toward the held direction (ours: near-instant on the ground, softer in air). */
export const GROUND_ACCEL = 400,
  AIR_ACCEL = 300,
  FLY_ACCEL = 170;

// --- Worker jump (ours; the original publishes no numbers) --------------------------------------------------------
/** Gravity on Workers. With JUMP_SPEED a full jump rises 50 px, clearing one 44 px platform level. */
export const WORKER_GRAVITY = 164;
export const JUMP_SPEED = px(4);
export const WORKER_TERMINAL = px(5);
/** Releasing the button while rising divides the upward speed by this once: jump height follows hold time. */
export const JUMP_CUT = 2;
/** One step of coyote time, no jump buffer (original). */
export const COYOTE_STEPS = 1;

// --- Flight (ours) ---------------------------------------------------------------------------------------------------
/** Gravity on Warriors and Queens: lighter than a Worker's so flight floats. */
export const FLY_GRAVITY = 100;
/** Each press adds this much upward speed. Hovering needs FLY_GRAVITY * 60 / FLAP_IMPULSE = 8.6 presses a second. */
export const FLAP_IMPULSE = 700;
/** A flap first slows any faster fall to this, so one press always catches the unit. */
export const FLAP_CATCH = 400;
/** Fastest climb, and fastest fall without diving. */
export const FLY_MAX_RISE = px(2.2);
export const FLY_TERMINAL = px(2.6);
/** Queen dive: straight down at this speed while down is held in the air, steering at a share of flight speed. */
export const DIVE_SPEED = px(4.6);
export const DIVE_STEER_NUM = 1,
  DIVE_STEER_DEN = 2;

// --- Bodies (ours), half width and height in subpixels; `y` is the feet ------------------------------------------
export const WORKER_HALF = px(5),
  WORKER_HEIGHT = px(12);
/** A Warrior keeps the Worker's box so a gate transformation can never embed it in a wall. */
export const WARRIOR_HALF = px(5),
  WARRIOR_HEIGHT = px(12);
export const QUEEN_HALF = px(7),
  QUEEN_HEIGHT = px(14);

// --- Combat (ours unless noted) -----------------------------------------------------------------------------------
/** Between two military units, the one whose centre is at least this much higher at contact kills. */
export const HEIGHT_ADVANTAGE = px(4);
/** Units that touch without a kill bounce apart at this speed, with a small hop. */
export const BOUNCE_SPEED = px(2.2),
  BOUNCE_HOP = px(1);
/** An invulnerable Worker shoves a military unit it touches this hard. */
export const BUMP_SPEED = px(2.6),
  BUMP_HOP = px(1.2);

// --- Death -----------------------------------------------------------------------------------------------------------
/** Respawn delay (brief: start 3 s, tune). */
export const RESPAWN_STEPS = seconds(3);
/** Invulnerability after a respawn (ours). */
export const RESPAWN_INVULN = seconds(1.5);
/** Queen lives: the third death loses the game (original). */
export const QUEEN_EGGS = 3;

// --- Berries -------------------------------------------------------------------------------------------------------
export const BERRY_HALF = px(3),
  BERRY_HEIGHT = px(6);
/** Reach of a pile and of a hive hole around their centres (ours). */
export const PILE_HALF = px(8),
  PILE_HEIGHT = px(12);
export const HOLE_HALF = px(4);
/** Loose berry physics (ours): gravity, kick, bounce and floor friction as ratios. */
export const BERRY_GRAVITY = 150,
  BERRY_TERMINAL = px(5),
  KICK_SPEED = px(2.4),
  KICK_LIFT = px(2.6),
  BERRY_BOUNCE_NUM = 2,
  BERRY_BOUNCE_DEN = 5,
  BERRY_FRICTION_NUM = 9,
  BERRY_FRICTION_DEN = 10,
  BERRY_REST_SPEED = 60;
/** Steps before a kicked or dropped berry can be kicked or picked up again. */
export const KICK_WAIT = 14;
/** Berries regrow 90 s after the piles run dry (original). */
export const REGROW_STEPS = seconds(90);

// --- Gates -----------------------------------------------------------------------------------------------------------
export const GATE_HALF = px(7),
  GATE_HEIGHT = px(16);
/** Standing time in a gate (brief: start 2.5 s). */
export const GATE_STEPS = seconds(2.5);
/** Invulnerability on leaving a gate (ours). */
export const GATE_INVULN = seconds(2);

// --- Snail -----------------------------------------------------------------------------------------------------------
/** 5.6 px/s with a plain rider (original); a speed rider multiplies it by 1.35. */
export const SNAIL_SPEED = perSecond(5.6);
export const SNAIL_HALF = px(10),
  SNAIL_HEIGHT = px(10);
/** How far in front of the snail an enemy Worker is caught. */
export const MOUTH_REACH = px(8);
/** Eating halts the snail for 3.67 s (original); a speed rider's snail eats 1.35 times faster. */
export const EAT_STEPS = seconds(3.67);
/** Steps after leaving the snail before the same Worker can mount again (ours). */
export const MOUNT_WAIT = seconds(0.75);
/** Invulnerability of a Worker freed from the snail's mouth (ours). */
export const FREED_INVULN = seconds(1);
