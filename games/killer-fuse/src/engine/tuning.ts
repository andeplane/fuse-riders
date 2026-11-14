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
export const RULES = "killer-fuse-3";

const px = (value: number): number => Math.round(value * S);
const perSecond = (pixels: number): number =>
  Math.round((pixels * S) / TICK_HZ);
const seconds = (value: number): number => Math.round(value * TICK_HZ);
/** A fraction as two integers, so the arithmetic stays integer. */
export type Ratio = readonly [num: number, den: number];

/** Speed gate multiplier, 1.35 (original), as a ratio so the arithmetic stays integer. */
export const SPEED_NUM = 27,
  SPEED_DEN = 20;
export const speedy = (value: number, speed: boolean): number =>
  speed ? Math.trunc((value * SPEED_NUM) / SPEED_DEN) : value;

// --- Running and steering (Killer Queen Black decompile, scaled; 1 unit there is about 11 px here) -----------------
/** Run speed 62.5 px/s: crosses the 480 px screen in 7.7 s (original). */
export const RUN_SPEED = perSecond(62.5);
/** A winged unit walks at 0.84 times run speed (original). */
export const WING_WALK_NUM = 21,
  WING_WALK_DEN = 25;
/** Horizontal speed in flight (ours: the same as running; the decompile has 66 px/s). */
export const FLY_SPEED = RUN_SPEED;
/**
 * Change of horizontal speed per step toward the held direction: a Worker on the ground or in the air (30 u/s²), a
 * winged unit in the air (30 u/s²), a winged unit walking (10 u/s²) and a diving Queen (50 u/s²).
 */
export const WORKER_ACCEL = 94,
  FLY_ACCEL = 94,
  WING_WALK_ACCEL = 31,
  DIVE_ACCEL_X = 156;
/**
 * Drag: the share of its horizontal speed a unit loses per step while it is not pushing along its motion. A Worker
 * stops dead on the ground (60/s) and keeps little in the air (10.28/s); a winged unit glides on (2/s) and slides a
 * little when it walks (16/s).
 */
export const WORKER_GROUND_DRAG: Ratio = [1, 1],
  WORKER_AIR_DRAG: Ratio = [6, 35],
  FLY_DRAG: Ratio = [1, 30],
  WING_WALK_DRAG: Ratio = [4, 15];
/** Below this speed a unit that is not steering stops. */
export const REST_SPEED = 40;

// --- Worker jump (ours; the original publishes no numbers) --------------------------------------------------------
/** Gravity on Workers. With JUMP_SPEED a full jump rises 38 px: one 30 px platform level and the ledge on it. */
export const WORKER_GRAVITY = 164;
export const JUMP_SPEED = px(3.6);
export const WORKER_TERMINAL = px(5);
/** Releasing the button while rising divides the upward speed by this once: jump height follows hold time. */
export const JUMP_CUT = 2;
/** One step of coyote time (original). */
export const COYOTE_STEPS = 1;
/**
 * A jump or flap press that comes up to this many steps before it can take effect (in the air just before a Worker
 * lands, in a stun, in a dive) still fires (0.05 s, Killer Queen Black).
 */
export const PRESS_BUFFER = 3;

// --- Flight (Killer Queen Black decompile, scaled) ----------------------------------------------------------------
/**
 * A press in the air starts a flap: an upward push of FLAP_THRUST per step for FLAP_STEPS steps (60 u/s² for 0.3 s).
 * Up to MAX_FLAPS run at once and add up. Speed is never set, only pushed, and there is no cooldown: one flap about
 * balances gravity, two overlapping ones climb. Holding the button does nothing.
 */
export const FLAP_THRUST = 188,
  FLAP_STEPS = 18,
  MAX_FLAPS = 5;
/** Gravity on a winged unit in the air (50 u/s²). */
export const FLY_GRAVITY = 156;
/** The original's quirk: after a take-off from the ground gravity is weaker (35 u/s²) until the next landing. */
export const FLY_GRAVITY_LIGHT = 110;
/** A press on the ground is not a flap: it pushes up this hard for this many steps (190 u/s², about 85 px/s). */
export const TAKEOFF_THRUST = 594,
  TAKEOFF_STEPS = 3;
/** Fastest climb and fastest fall without diving. A speed gate multiplies the climb by 1.15. */
export const FLY_MAX_RISE = px(1.6),
  FLY_TERMINAL = px(1.83);
export const SPEED_RISE: Ratio = [23, 20];
/** The speed one whole flap adds, and the presses a second that hold a height (2.8, rounded). */
export const FLAP_IMPULSE = FLAP_THRUST * FLAP_STEPS;
export const HOVER_HZ = Math.round((FLY_GRAVITY * TICK_HZ) / FLAP_IMPULSE);
/**
 * Queen dive: pressing down in the air starts it and holding down keeps it; her fall speeds up by DIVE_ACCEL a step
 * (about 750 px/s²) to DIVE_SPEED (220 px/s; arcade footage gives 216). Releasing down or landing ends it.
 */
export const DIVE_SPEED = px(3.67),
  DIVE_ACCEL = 213;
/** Steps after a bounce or a shove in which a unit cannot flap (0.35 s). */
export const STUN_STEPS = seconds(0.35);

// --- Bodies, half width and height in subpixels; `y` is the feet. Measured from arcade footage at half scale ----
/** A Worker is 8 by 12. */
export const WORKER_HALF = px(4),
  WORKER_HEIGHT = px(12);
/**
 * A Warrior and a Queen share one box, 10 by 17, as in the original. A Worker grows into it in a gate, so every gate
 * has that much room around it (a map test checks it).
 */
export const WARRIOR_HALF = px(5),
  WARRIOR_HEIGHT = px(17);
export const QUEEN_HALF = WARRIOR_HALF,
  QUEEN_HEIGHT = WARRIOR_HEIGHT;

// --- Combat (ours unless noted) -----------------------------------------------------------------------------------
/** Between two military units, the one whose duel line (see `duelY`) is at least this much higher at contact kills. */
export const HEIGHT_ADVANTAGE = px(4);
/**
 * Unverified: with no clear height advantage, a military unit facing an enemy that faces away kills it ("hit from
 * behind"). Arcade sources describe only the height rule and a bounce; this stays one flag until the decompile
 * settles it.
 */
export const BACKSTAB = true;
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

/**
 * A game ends after five minutes of play (ours): the step after this many decides it by eggs left, then berries
 * banked, then the snail's distance to each goal, then the seed's coin flip (see `decideByTime` in step.ts).
 */
export const TIME_LIMIT = seconds(300);

// --- Berries -------------------------------------------------------------------------------------------------------
/** A berry is 5 across (original, at half scale). */
export const BERRY_HALF = px(2.5),
  BERRY_HEIGHT = px(5);
/** Reach of a pile and of a hive hole around their centres (ours). */
export const PILE_HALF = px(8),
  PILE_HEIGHT = px(12);
export const HOLE_HALF = px(3);
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
/** The snail's body is 26 by 17 (original, at half scale). */
export const SNAIL_HALF = px(13),
  SNAIL_HEIGHT = px(17);
/** How far in front of the snail an enemy Worker is caught. */
export const MOUTH_REACH = px(8);
/** Eating halts the snail for 3.67 s (original); a speed rider's snail eats 1.35 times faster. */
export const EAT_STEPS = seconds(3.67);
/** Steps after leaving the snail before the same Worker can mount again (ours). */
export const MOUNT_WAIT = seconds(0.75);
/** Invulnerability of a Worker freed from the snail's mouth (ours). */
export const FREED_INVULN = seconds(1);
