import { px } from "./math.js";

/**
 * Balance constants. Distances are in sub-units (`px(n)` is n pixels), speeds in sub-units per step and headings in
 * `DIRS` per turn; the simulation runs `STEPS_PER_SECOND` steps a second.
 */
export const STEPS_PER_SECOND = 60;
/** Log ticks are 50 ms, so each folds three steps. */
export const STEPS_PER_TICK = 3;
/** The field every screen shows, whatever its size. */
export const VIEW_W = 960;
export const VIEW_H = 540;
/** Seats per room, as in every Fuse game. */
export const CAPACITY = 5;

// ---- the round ----
export const COUNTDOWN_STEPS = 180;
/** After the whistle the world holds this long before the room moves on. */
export const OUTRO_STEPS = 180;
/** The last stretch of a round, when the screen calls for one last delivery. */
export const FINAL_STEPS = 600;

// ---- a train ----
/** Speed of an empty train; each wagon it pulls costs `SPEED_LOSS`. */
export const SPEED = px(2.6);
export const SPEED_LOSS = px(0.06);
/** Heading change per step while a steer is held: about 4.2°, a turning circle some 70 px across. */
export const TURN = 12;
/** How far ahead of the locomotive's centre its nose is, and the nose's reach: what collects and what cuts. */
export const NOSE = px(9);
export const NOSE_R = px(10);
/** Two locomotives closer than twice this bump. */
export const LOCO_R = px(16);
/** The locomotive's half-width: how close its centre may come to a wall. */
export const LOCO_HALF = px(13);
/** A coupled wagon's reach, and a loose cart's. */
export const WAGON_R = px(11);
export const CART_R = px(15);
/** Path distance from the locomotive's centre to the first wagon's, and between wagons. */
export const FIRST_GAP = px(40);
export const GAP = px(34);
/** The trail is laid a crumb every `CRUMB` along the path, `TRAIL` crumbs long: enough for `MAX_WAGONS`. */
export const CRUMB = px(7);
export const MAX_WAGONS = 8;
export const TRAIL =
  Math.ceil((FIRST_GAP + (MAX_WAGONS - 1) * GAP) / CRUMB) + 3;

// ---- theft ----
/** Steps a cut-loose cart cannot be collected by anyone, so the thief cannot take it straight back up. */
export const CUT_COOL = 42;
/** Steps the rest of a cut train cannot be cut again, so one pass takes one bite. */
export const CUT_GUARD = 36;
/** How hard cut carts scatter, and how fast they slow down (7/8 a step). */
export const SCATTER = px(1.6);
export const SCATTER_MIN = px(0.5);

// ---- bumps ----
/** Steps a locomotive's bumps and wall knocks make no new effect, so a scrape is one clank. */
export const BUMP_COOL = 12;

// ---- cargo ----
/** Loose carts the depot keeps topped up to: `LOOSE_BASE + LOOSE_PER_TRAIN` for every train. */
export const LOOSE_BASE = 4;
export const LOOSE_PER_TRAIN = 2;
/** Steps between two deliveries of a new cart. */
export const SPAWN_EVERY = 50;
/** Each train's first cart lies this far along its heading at the start, the same for everyone. */
export const START_CART = px(120);
export const MAX_LOOSE = 40;
/** Kinds of cargo a cart can carry: crates, barrels, coal and timber. They only look different. */
export const CARGO_KINDS = 4;

// ---- bounds, for the checkpoint guard ----
export const MAX_FX = 64;
/** Effects older than this many steps leave the world. */
export const FX_LIFE = 60;
export const MAX_SCORE = 10_000;
