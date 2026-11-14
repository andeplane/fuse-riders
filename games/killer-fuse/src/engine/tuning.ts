/**
 * Every number the rules run on. Lengths are art pixels times `S` (integer subpixels), speeds are subpixels per
 * 60 Hz step, times are steps. The values are Killer Queen Black's, whose unit ("u") is 11 art pixels here; a comment
 * says so where a value is ours instead (docs/engine.md lists the deliberate differences).
 */

/** Subpixels per art pixel. All state is integers in this unit. */
export const S = 1024;
/** Simulation steps per second. */
export const TICK_HZ = 60;
export const MAX_PLAYERS = 6;
/** Bump on any behaviour change: peers on different rules refuse each other. */
export const RULES = "killer-fuse-4";

/** One Black unit in subpixels. */
export const UNIT = 11 * S;
const px = (value: number): number => Math.round(value * S);
/** A length, a speed and an acceleration given in Black units, units a second and units a second squared. */
export const u = (value: number): number => Math.round(value * UNIT);
const ups = (value: number): number => Math.round((value * UNIT) / TICK_HZ);
const ups2 = (value: number): number =>
  Math.round((value * UNIT) / (TICK_HZ * TICK_HZ));
const seconds = (value: number): number => Math.round(value * TICK_HZ);
/** A fraction as two integers, so the arithmetic stays integer. */
export type Ratio = readonly [num: number, den: number];

/** Speed gate multiplier on run, flight and snail speed: 1.3. */
export const SPEED_NUM = 13,
  SPEED_DEN = 10;
export const speedy = (value: number, speed: boolean): number =>
  speed ? Math.trunc((value * SPEED_NUM) / SPEED_DEN) : value;

// --- Running and steering -------------------------------------------------------------------------------------------
/** A Worker runs at 7 u/s (77 px/s). */
export const RUN_SPEED = ups(7);
/** A winged unit walks at 5.6 u/s and flies at 6 u/s. */
export const WING_WALK_SPEED = ups(5.6),
  FLY_SPEED = ups(6);
/**
 * Change of horizontal speed per step toward the held direction: a Worker on the ground or in the air (30 u/s²), a
 * winged unit in the air (30 u/s²), a winged unit walking (10 u/s²) and a diving Queen (50 u/s²).
 */
export const WORKER_ACCEL = ups2(30),
  FLY_ACCEL = ups2(30),
  WING_WALK_ACCEL = ups2(10),
  DIVE_ACCEL_X = ups2(50);
/**
 * Drag: the share of its horizontal speed a unit loses per step while it is not pushing along its motion. A Worker
 * stops dead on the ground (60/s) and keeps little in the air (10.28/s); a winged unit glides on (2/s) and slides a
 * little when it walks (16/s). A stunned unit loses 1/s.
 */
export const WORKER_GROUND_DRAG: Ratio = [1, 1],
  WORKER_AIR_DRAG: Ratio = [6, 35],
  FLY_DRAG: Ratio = [1, 30],
  WING_WALK_DRAG: Ratio = [4, 15],
  STUN_DRAG: Ratio = [1, 60];
/** Below this speed a unit that is not steering stops. */
export const REST_SPEED = 40;

// --- Worker jump ----------------------------------------------------------------------------------------------------
/** Gravity on a Worker (80 u/s²), and the weaker one after walking off a ledge without jumping (56 u/s²). */
export const WORKER_GRAVITY = ups2(80),
  WORKER_GRAVITY_LEDGE = ups2(56);
/** A jump launches at 14 u/s (154 px/s); a Worker never rises faster, nor falls faster than 11.3 u/s. */
export const JUMP_SPEED = ups(14),
  WORKER_TERMINAL = ups(11.3);
/**
 * While the button stays held the jump is pushed up: 100 u/s² on its first JUMP_HOLD_STEPS steps (which pins the
 * speed at the launch speed), then a push that eases from 32 u/s² to nothing over JUMP_RELIEF_STEPS steps. A full
 * jump tops out 3.8 u (42 px) up.
 */
export const JUMP_HOLD_STEPS = 9,
  JUMP_HOLD_FORCE = ups2(100),
  JUMP_RELIEF_STEPS = 30;
export const JUMP_RELIEF: readonly number[] = Array.from(
  { length: JUMP_RELIEF_STEPS + 1 },
  (_, k) => ups2((32 * (JUMP_RELIEF_STEPS - k)) / JUMP_RELIEF_STEPS),
);
/**
 * Letting go ends the push. Within the first JUMP_CUT_STEPS steps it also pulls down 200 u/s² for one step (a short
 * hop); later in the hold phase the push fades over two steps (20 then 4.7 u/s²).
 */
export const JUMP_CUT_STEPS = 3,
  JUMP_CUT_FORCE = ups2(200),
  JUMP_EASE: readonly [number, number] = [ups2(20), ups2(4.7)];
/** A Worker that walked off a ledge may still jump for this many steps. */
export const COYOTE_STEPS = 3;
/**
 * A jump or flap press that comes up to this many steps before it can take effect (in the air just before a Worker
 * lands, in a stun, in a dive) still fires (0.05 s).
 */
export const PRESS_BUFFER = 3;

// --- Flight ---------------------------------------------------------------------------------------------------------
/**
 * A press in the air starts a flap: an upward push of FLAP_THRUST per step for FLAP_STEPS steps (60 u/s² for 0.3 s).
 * Up to MAX_FLAPS run at once and add up. Speed is never set, only pushed, and there is no cooldown: one flap about
 * balances gravity, two overlapping ones climb. Holding the button does nothing.
 */
export const FLAP_THRUST = ups2(60),
  FLAP_STEPS = 18,
  MAX_FLAPS = 5;
/** Gravity on a winged unit in the air (50 u/s²). */
export const FLY_GRAVITY = ups2(50);
/** The original's quirk: after a take-off from the ground gravity is weaker (35 u/s²) until the next landing. */
export const FLY_GRAVITY_LIGHT = ups2(35);
/** A press on the ground is not a flap: it pushes up this hard for this many steps (190 u/s²). */
export const TAKEOFF_THRUST = ups2(190),
  TAKEOFF_STEPS = 3;
/** Fastest climb and fastest fall without diving (10 u/s). A speed gate multiplies a Warrior's climb by 1.15. */
export const FLY_MAX_RISE = ups(10),
  FLY_TERMINAL = ups(10);
export const SPEED_RISE: Ratio = [23, 20];
/** The speed one whole flap adds, and the presses a second that hold a height (2.8, rounded). */
export const FLAP_IMPULSE = FLAP_THRUST * FLAP_STEPS;
export const HOVER_HZ = Math.round((FLY_GRAVITY * TICK_HZ) / FLAP_IMPULSE);
/**
 * Queen dive: pressing down in the air starts it and holding down keeps it. She falls at DIVE_SPEED (20 u/s) from
 * its first step on; releasing down or landing ends it. A dive that clips a platform corner while she moves sideways
 * slower than DIVE_NUDGE_SPEED slides past it, by at most DIVE_NUDGE.
 */
export const DIVE_SPEED = ups(20),
  DIVE_NUDGE_SPEED = ups(1.5),
  DIVE_NUDGE = px(3);
/** A unit that hits a ceiling or wall bounces back with this share of its speed; a Queen does not bounce. */
export const BOUNCE: Ratio = [3, 5],
  CEILING_BOUNCE_MAX = ups(4);

// --- Bodies -----------------------------------------------------------------------------------------------------------
/**
 * The upright movement boxes, half width and height; `y` is the feet. The boxes per state (dashing, flying), the hit
 * boxes and the weapons are tables in shapes.ts. A Worker is 6 by 13, a Warrior 6 by 16, a Queen 5 by 21 standing.
 */
export const WORKER_HALF = u(0.2755),
  WORKER_HEIGHT = u(1.18);
export const WARRIOR_HALF = u(0.2605),
  WARRIOR_HEIGHT = u(1.432);
export const QUEEN_HALF = u(0.2235),
  QUEEN_HEIGHT = u(1.912);
/** What a Worker touches piles, holes, loose berries and the snail's mouth with: 8 wide. */
export const REACH_HALF = px(4);

// --- Sword combat -----------------------------------------------------------------------------------------------------
/** An attack press that cannot start an attack yet is remembered this many steps. */
export const ATTACK_BUFFER = 6;
/**
 * An attack counts its steps from 1 on the press. It is lethal through step LETHAL, the dash lasts as long, the
 * cooldown runs to step PERIOD, and the next attack may start the step after.
 */
export const WARRIOR_LETHAL = 19,
  WARRIOR_PERIOD = 44,
  QUEEN_LETHAL = 17,
  QUEEN_PERIOD = 36;
/** A Warrior's dash speed on each of its steps: 20 u/s easing out to 15 (a quintic over 0.33 s). */
export const WARRIOR_DASH: readonly number[] = Array.from(
  { length: WARRIOR_LETHAL },
  (_, k) => {
    const t = k / TICK_HZ / 0.33 - 1;
    return ups(20 - 5 * (t * t * t * t * t + 1));
  },
);
/** A Queen's dash is a flat 16 u/s. Out of a dive she first drops DASH_DROP. */
export const QUEEN_DASH = ups(16),
  DASH_DROP = u(0.8);
/**
 * A glance or a bump stuns both for 0.35 s and throws them apart at 30 u/s along the line between them; a stunned
 * unit moves at most 10 u/s sideways, so that is all of the throw it keeps.
 */
export const STUN_STEPS = seconds(0.35),
  STUN_SPEED = ups(10),
  KNOCK_SPEED = ups(30);
/** Bodies that overlap by less than this vertically bounce head on feet instead of bumping; restitution 4. */
export const HEAD_OVERLAP = u(0.2),
  HEAD_RESTITUTION = 4;

// --- Death -----------------------------------------------------------------------------------------------------------
/** Respawn 3.2 s after death, invulnerable for 2.2 s more. */
export const RESPAWN_STEPS = seconds(3.2);
export const RESPAWN_INVULN = seconds(2.2);
/** A Queen hatches in the air this far above her egg. */
export const HATCH_LIFT = px(22);
/** Queen lives: the third death loses the game. */
export const QUEEN_EGGS = 3;

/**
 * A game ends after five minutes of play (ours): the step after this many decides it by eggs left, then berries
 * banked, then the snail's distance to each goal, then the seed's coin flip (see `decideByTime` in step.ts).
 */
export const TIME_LIMIT = seconds(300);

// --- Berries -------------------------------------------------------------------------------------------------------
/** A berry is 5 across (ours, from arcade footage). */
export const BERRY_HALF = px(2.5),
  BERRY_HEIGHT = px(5);
/** Reach of a pile and of a hive hole around their centres (ours). */
export const PILE_HALF = px(8),
  PILE_HEIGHT = px(12);
export const HOLE_HALF = px(3);
/**
 * Loose berry physics: gravity 10 u/s², at most 20 u/s on each axis, drag 3/s on the ground and 0.8/s in the air, and
 * a bounce off platforms that keeps 0.4 of the speed.
 */
export const BERRY_GRAVITY = ups2(10),
  BERRY_MAX = ups(20),
  BERRY_GROUND_DRAG: Ratio = [1, 20],
  BERRY_AIR_DRAG: Ratio = [1, 75],
  BERRY_BOUNCE: Ratio = [2, 5],
  BERRY_REST_SPEED = 60;
/** A grounded unit that cannot pick a resting berry up kicks it straight up at 5 u/s. */
export const KICK_LIFT = ups(5);
/** Steps before a kicked or dropped berry can be kicked or picked up again (ours). */
export const KICK_WAIT = 14;
/** A loose berry this close to an open hole fills it (0.17 u). */
export const HOLE_SNAP = u(0.17);
/**
 * Banking: the Worker sits in the hole for DEPOSIT_STEPS (1.5 s), then the berry counts; DEPOSIT_EXIT steps later
 * (0.56 s) it pops out at (2, 5) u/s.
 */
export const DEPOSIT_STEPS = seconds(1.5),
  DEPOSIT_EXIT = seconds(0.56),
  DEPOSIT_POP_X = ups(2),
  DEPOSIT_POP_Y = ups(5);

// --- Gates -----------------------------------------------------------------------------------------------------------
/** A gate's trigger box is 17 by 26. */
export const GATE_HALF = px(8.5),
  GATE_HEIGHT = px(26);
/** A Worker offers its berry for 0.5 s, then is locked in for 2 s: 2.5 s in all. */
export const GATE_OFFER = seconds(0.5),
  GATE_LOCK = seconds(2);
export const GATE_STEPS = GATE_OFFER + GATE_LOCK;
/** Invulnerability on leaving a gate or a hive hole. */
export const GATE_INVULN = seconds(2.2);

// --- Snail -----------------------------------------------------------------------------------------------------------
/** 0.8 u/s with a plain rider, reached at 2.6 u/s²; a speed rider multiplies it by 1.3. */
export const SNAIL_SPEED = ups(0.8),
  SNAIL_ACCEL = ups2(2.6);
/** The snail's body is 26 by 17 (ours, from arcade footage). */
export const SNAIL_HALF = px(13),
  SNAIL_HEIGHT = px(17);
/** How far in front of the snail an enemy Worker is caught (ours). */
export const MOUTH_REACH = px(8);
/** A meal lasts 5 s, 3.5 s with a speed rider. */
export const EAT_STEPS = seconds(5),
  EAT_STEPS_SPEED = seconds(3.5);
/** Steps after leaving the snail, or its mouth, before the same Worker can mount or be caught again. */
export const MOUNT_WAIT = seconds(0.5);
/** A rider hops off at 45 degrees with this speed on each axis (ours). */
export const DISMOUNT_SPEED = ups(8);
