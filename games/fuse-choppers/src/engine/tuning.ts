import { px } from "./math.js";

/**
 * Balance constants. Distances are in sub-units (`px(n)` is n pixels), velocities in sub-units per step and
 * accelerations in sub-units per step per step; the simulation runs `STEPS_PER_SECOND` steps a second.
 */
export const STEPS_PER_SECOND = 60;
/** Log ticks are 50 ms, so each folds three steps. */
export const STEPS_PER_TICK = 3;
/** The camera's field: what every screen shows, whatever its size. */
export const VIEW_W = 960;
export const VIEW_H = 540;
/** Seats per room, as in every Fuse game. */
export const CAPACITY = 5;

// ---- the round ----
export const COUNTDOWN_STEPS = 150;
/** After the round is decided, the world runs on this long before the room moves on. */
export const OUTRO_STEPS = 180;

// ---- scrolling and the crush zone ----
export const SCROLL_START = px(1.1);
export const SCROLL_MAX = px(1.95);
/** Steps of play for the scroll to climb from start to max. */
export const SCROLL_RAMP_STEPS = 4800;
/** How far the crush zone gains on the camera each step, so the field narrows. */
export const CRUSH_GROW = px(0.06);
/** The crush zone's width at the start of play. */
export const CRUSH_START = px(36);
/** Its speed once the camera has stopped at the exit. */
export const CRUSH_FINALE = px(1.15);

// ---- rocks thrown out of the crush zone ----
export const ROCK_WARNING_STEPS = 55;
export const ROCK_GRAVITY = px(0.045);
export const ROCK_LIFE = 420;

// ---- a chopper ----
/** Half the hitbox: forgiving, smaller than the sprite. */
export const CHOPPER_HW = px(17);
export const CHOPPER_HH = px(10);
export const GRAVITY = px(0.21);
export const LIFT = px(0.43);
export const MAX_RISE = px(4.3);
export const MAX_FALL = px(5.4);
/** The W/S experiment: direct thrust up or down, damped hover when neither is held. */
export const THRUST = px(0.3);
export const THRUST_GRAVITY = px(0.012);
export const THRUST_MAX = px(4);
export const H_ACCEL = px(0.22);
export const H_DRAG = px(0.14);
/** Airspeed relative to the scroll. */
export const MAX_AIRSPEED = px(2.7);
export const TURBO_AIRSPEED = px(3.8);
/** How close to the right edge of the camera a chopper may fly. */
export const RIGHT_MARGIN = px(26);

// ---- being knocked about ----
/** Steps of wobble after a hit: lift and steering work at `STUN_LIFT`/1000 and `STUN_STEER`/1000. */
export const STUN_LIFT = 780;
export const STUN_STEER = 600;
export const SHIELD_GRACE = 50;
/** Steps after GO a chopper hovers for if its pilot has not touched lift yet: nobody falls out of the sky unready. */
export const START_HOVER = 120;

// ---- guns ----
export const FIRE_COOLDOWN = 20;
export const TRIPLE_COOLDOWN = 12;
export const BULLET_SPEED = px(7.5);
export const BULLET_LIFE = 80;
export const BULLET_R = px(5);
export const BULLET_PUSH = px(2.4);
export const BULLET_LIFT_PUSH = px(0.9);
export const BULLET_STUN = 36;

// ---- bumping ----
export const BUMP_R = px(17);
export const BUMP_PUSH = px(1.6);
export const BUMP_STUN = 18;

// ---- enemies ----
export const DRONE_HW = px(20);
export const DRONE_HH = px(12);
export const DRONE_HP = 3;
export const DRONE_DRIFT = px(0.55);
export const DRONE_CHARGE = 36;
export const BOLT_SPEED = px(3.4);
export const BOLT_R = px(6);
export const BOLT_PUSH = px(3.3);
export const BOLT_STUN = 42;
export const BOLT_LIFE = 260;

// ---- power-ups ----
export const PICKUP_R = px(16);
export const TRIPLE_STEPS = 420;
export const TURBO_STEPS = 360;
export const SCRAMBLE_STEPS = 240;
export const SHOCK_RADIUS = px(300);
export const SHOCK_PUSH = px(7);
export const SHOCK_STUN = 50;

// ---- bounds, for the checkpoint guard ----
export const MAX_BULLETS = 60;
export const MAX_BOLTS = 40;
export const MAX_ROCKS = 16;
export const MAX_DRONES = 12;
export const MAX_PICKUPS = 16;
export const MAX_FX = 64;
/** Effects older than this many steps leave the world. */
export const FX_LIFE = 45;
