/**
 * One unit's own motion for one step: controls to velocity, then a move against the solid platforms with the
 * horizontal wrap. It touches nothing but the unit, so the bots' navigation can fly trial moves through the very
 * same function the round uses (nav.ts).
 */
import { WIDTH, wrapX, type Arena, type Rect } from "./maps.js";
import {
  COYOTE_STEPS,
  DIVE_ACCEL,
  DIVE_ACCEL_X,
  DIVE_SPEED,
  FLAP_STEPS,
  FLAP_THRUST,
  FLY_ACCEL,
  FLY_DRAG,
  FLY_GRAVITY,
  FLY_GRAVITY_LIGHT,
  FLY_MAX_RISE,
  FLY_SPEED,
  FLY_TERMINAL,
  JUMP_CUT,
  JUMP_SPEED,
  PRESS_BUFFER,
  QUEEN_HALF,
  QUEEN_HEIGHT,
  REST_SPEED,
  RUN_SPEED,
  SPEED_RISE,
  TAKEOFF_STEPS,
  TAKEOFF_THRUST,
  WARRIOR_HALF,
  WARRIOR_HEIGHT,
  WING_WALK_ACCEL,
  WING_WALK_DEN,
  WING_WALK_DRAG,
  WING_WALK_NUM,
  WORKER_ACCEL,
  WORKER_AIR_DRAG,
  WORKER_GRAVITY,
  WORKER_GROUND_DRAG,
  WORKER_HALF,
  WORKER_HEIGHT,
  WORKER_TERMINAL,
  speedy,
  type Ratio,
} from "./tuning.js";
import type { Input, Unit, UnitKind } from "./types.js";

export const NEUTRAL: Input = {
  left: false,
  right: false,
  down: false,
  held: false,
  pressed: false,
};

export const halfOf = (kind: UnitKind): number =>
  kind === "queen"
    ? QUEEN_HALF
    : kind === "warrior"
      ? WARRIOR_HALF
      : WORKER_HALF;
export const heightOf = (kind: UnitKind): number =>
  kind === "queen"
    ? QUEEN_HEIGHT
    : kind === "warrior"
      ? WARRIOR_HEIGHT
      : WORKER_HEIGHT;

/** `value` moved toward `target` by at most `by`. */
export function approach(value: number, target: number, by: number): number {
  if (value < target) return Math.min(target, value + by);
  return Math.max(target, value - by);
}

export const dirOf = (input: Input): -1 | 0 | 1 =>
  input.right === input.left ? 0 : input.right ? 1 : -1;

/** A body's box against one solid, the solid shifted by `shift` for the wrap. Touching edges do not overlap. */
function hits(
  x: number,
  y: number,
  half: number,
  height: number,
  solid: Rect,
  shift: number,
): boolean {
  const left = solid.x + shift;
  return (
    x + half > left &&
    x - half < left + solid.w &&
    y > solid.y &&
    y - height < solid.y + solid.h
  );
}

const SHIFTS = [0, -WIDTH, WIDTH] as const;

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** What a move ran into: a wall, the ceiling or a platform top (`ground`, its index). */
export interface Contact {
  wall: boolean;
  ceiling: boolean;
  ground: number;
}

/**
 * Moves a body by its velocity, horizontally and then vertically, stopping it at the first solid on each axis. Every
 * speed is below the thinnest platform, so nothing tunnels.
 */
export function moveBody(
  body: Body,
  half: number,
  height: number,
  arena: Arena,
): Contact {
  const contact: Contact = { wall: false, ceiling: false, ground: -1 };
  let x = body.x + body.vx;
  for (const solid of arena.solids)
    for (const shift of SHIFTS)
      if (hits(x, body.y, half, height, solid, shift)) {
        x =
          body.vx > 0
            ? solid.x + shift - half
            : solid.x + shift + solid.w + half;
        contact.wall = true;
      }
  body.x = wrapX(x);
  let y = body.y + body.vy;
  for (let i = 0; i < arena.solids.length; i += 1) {
    const solid = arena.solids[i]!;
    for (const shift of SHIFTS)
      if (hits(body.x, y, half, height, solid, shift)) {
        if (body.vy > 0) {
          y = solid.y;
          contact.ground = i;
        } else {
          y = solid.y + solid.h + height;
          contact.ceiling = true;
        }
      }
  }
  if (y - height < 0) {
    y = height;
    contact.ceiling = true;
  }
  body.y = y;
  return contact;
}

/** `value` scaled by a ratio, truncated toward zero. */
const share = (value: number, [num, den]: Ratio): number =>
  Math.trunc((value * num) / den);

/**
 * Horizontal speed after one step of steering: `accel` toward `dir` up to `top`, and `drag` whenever the unit is not
 * pushing along its motion (coasting, turning, or faster than `top` after a bounce).
 */
export function steer(
  vx: number,
  dir: -1 | 0 | 1,
  accel: number,
  top: number,
  drag: Ratio,
): number {
  const along = dir !== 0 && vx * dir >= 0 && vx * dir <= top;
  let next = along ? vx : vx - share(vx, drag);
  if (dir === 0) return Math.abs(next) < REST_SPEED ? 0 : next;
  if (next * dir < top) next = dir * Math.min(top, next * dir + accel);
  return next;
}

/** Ends every flap and the take-off push. */
function fold(unit: Unit): void {
  unit.flaps.fill(0);
  unit.takeoff = 0;
}

/**
 * Whether a press takes effect this step. A press that comes while it cannot (`legal` false) is remembered for
 * PRESS_BUFFER steps and fires as soon as it can.
 */
function buffered(unit: Unit, input: Input, legal: boolean): boolean {
  const wants = input.pressed || unit.buffer > 0;
  if (wants && legal) {
    unit.buffer = 0;
    return true;
  }
  unit.buffer = input.pressed ? PRESS_BUFFER : Math.max(0, unit.buffer - 1);
  return false;
}

/** A Warrior's or Queen's vertical controls for one step: take-off, flaps, dive and gravity. */
function fly(unit: Unit, input: Input, grounded: boolean): void {
  if (unit.kind === "queen" && !grounded && input.down) {
    if (!unit.downHeld) fold(unit);
    unit.diving = unit.diving || !unit.downHeld;
  } else unit.diving = false;
  const press = buffered(unit, input, unit.stun === 0 && !unit.diving);
  if (unit.diving) {
    unit.vy = Math.min(unit.vy + DIVE_ACCEL, DIVE_SPEED);
    return;
  }
  if (press && grounded) {
    // A take-off is not a flap, and it ends any that were running.
    fold(unit);
    unit.takeoff = TAKEOFF_STEPS;
    unit.light = true;
    unit.flapped = true;
  } else if (press) {
    const free = unit.flaps.indexOf(0);
    if (free >= 0) {
      unit.flaps[free] = FLAP_STEPS;
      unit.flapped = true;
    }
  }
  let thrust = 0;
  if (unit.takeoff > 0) {
    thrust += TAKEOFF_THRUST;
    unit.takeoff -= 1;
  }
  for (let i = 0; i < unit.flaps.length; i += 1)
    if (unit.flaps[i]! > 0) {
      thrust += FLAP_THRUST;
      unit.flaps[i] = unit.flaps[i]! - 1;
    }
  const rise = unit.speed ? share(FLY_MAX_RISE, SPEED_RISE) : FLY_MAX_RISE;
  const gravity = unit.light ? FLY_GRAVITY_LIGHT : FLY_GRAVITY;
  unit.vy = Math.max(-rise, Math.min(FLY_TERMINAL, unit.vy + gravity - thrust));
}

/** One step of a Worker's, Warrior's or Queen's own motion under `input`. */
export function moveUnit(unit: Unit, input: Input, arena: Arena): void {
  const dir = dirOf(input);
  if (dir !== 0) unit.facing = dir;
  const grounded = unit.ground >= 0;
  unit.flapped = false;
  if (unit.kind === "worker") {
    unit.diving = false;
    unit.vx = steer(
      unit.vx,
      dir,
      WORKER_ACCEL,
      speedy(RUN_SPEED, unit.speed),
      grounded ? WORKER_GROUND_DRAG : WORKER_AIR_DRAG,
    );
    if (buffered(unit, input, grounded || unit.coyote > 0)) {
      unit.vy = -speedy(JUMP_SPEED, unit.speed);
      unit.jumping = true;
      unit.flapped = true;
      unit.coyote = 0;
    } else if (unit.jumping && (!input.held || unit.vy >= 0)) {
      if (unit.vy < 0) unit.vy = Math.trunc(unit.vy / JUMP_CUT);
      unit.jumping = false;
    }
    if (unit.coyote > 0) unit.coyote -= 1;
    unit.vy = Math.min(unit.vy + WORKER_GRAVITY, WORKER_TERMINAL);
  } else {
    fly(unit, input, grounded);
    const walk = Math.trunc((RUN_SPEED * WING_WALK_NUM) / WING_WALK_DEN);
    unit.vx = steer(
      unit.vx,
      dir,
      unit.diving ? DIVE_ACCEL_X : grounded ? WING_WALK_ACCEL : FLY_ACCEL,
      speedy(grounded ? walk : FLY_SPEED, unit.speed),
      grounded ? WING_WALK_DRAG : FLY_DRAG,
    );
  }
  if (unit.stun > 0) unit.stun -= 1;
  unit.downHeld = input.down;
  const contact = moveBody(unit, halfOf(unit.kind), heightOf(unit.kind), arena);
  if (contact.wall) unit.vx = 0;
  if (contact.ground >= 0 || contact.ceiling) unit.vy = 0;
  if (contact.ground >= 0) {
    unit.jumping = false;
    unit.light = false;
    unit.diving = false;
    fold(unit);
  } else if (grounded && !unit.flapped && unit.kind === "worker")
    unit.coyote = COYOTE_STEPS;
  unit.ground = contact.ground;
}
