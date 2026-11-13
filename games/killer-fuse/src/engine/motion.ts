/**
 * One unit's own motion for one step: controls to velocity, then a move against the solid platforms with the
 * horizontal wrap. It touches nothing but the unit, so the bots' navigation can fly trial moves through the very
 * same function the round uses (nav.ts).
 */
import { WIDTH, wrapX, type Arena, type Rect } from "./maps.js";
import {
  AIR_ACCEL,
  COYOTE_STEPS,
  DIVE_SPEED,
  DIVE_STEER_DEN,
  DIVE_STEER_NUM,
  FLAP_CATCH,
  FLAP_IMPULSE,
  FLY_ACCEL,
  FLY_GRAVITY,
  FLY_MAX_RISE,
  FLY_SPEED,
  FLY_TERMINAL,
  GROUND_ACCEL,
  JUMP_CUT,
  JUMP_SPEED,
  QUEEN_HALF,
  QUEEN_HEIGHT,
  RUN_SPEED,
  WARRIOR_HALF,
  WARRIOR_HEIGHT,
  WING_WALK_DEN,
  WING_WALK_NUM,
  WORKER_GRAVITY,
  WORKER_HALF,
  WORKER_HEIGHT,
  WORKER_TERMINAL,
  speedy,
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

/** One step of a Worker's, Warrior's or Queen's own motion under `input`. */
export function moveUnit(unit: Unit, input: Input, arena: Arena): void {
  const dir = dirOf(input);
  if (dir !== 0) unit.facing = dir;
  const grounded = unit.ground >= 0;
  unit.flapped = false;
  unit.diving = false;
  if (unit.kind === "worker") {
    unit.vx = approach(
      unit.vx,
      dir * speedy(RUN_SPEED, unit.speed),
      grounded ? GROUND_ACCEL : AIR_ACCEL,
    );
    if (input.pressed && (grounded || unit.coyote > 0)) {
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
    const walk = Math.trunc((RUN_SPEED * WING_WALK_NUM) / WING_WALK_DEN);
    let top = speedy(grounded ? walk : FLY_SPEED, unit.speed);
    if (unit.kind === "queen" && input.down && !grounded) {
      unit.diving = true;
      top = Math.trunc((top * DIVE_STEER_NUM) / DIVE_STEER_DEN);
    }
    unit.vx = approach(unit.vx, dir * top, grounded ? GROUND_ACCEL : FLY_ACCEL);
    if (unit.diving) unit.vy = DIVE_SPEED;
    else if (input.pressed) {
      unit.vy = Math.max(
        Math.min(unit.vy, FLAP_CATCH) - FLAP_IMPULSE,
        -speedy(FLY_MAX_RISE, unit.speed),
      );
      unit.flapped = true;
    } else unit.vy = Math.min(unit.vy + FLY_GRAVITY, FLY_TERMINAL);
  }
  const contact = moveBody(unit, halfOf(unit.kind), heightOf(unit.kind), arena);
  if (contact.wall) unit.vx = 0;
  if (contact.ground >= 0 || contact.ceiling) unit.vy = 0;
  if (contact.ground >= 0) unit.jumping = false;
  else if (grounded && !unit.flapped && unit.kind === "worker")
    unit.coyote = COYOTE_STEPS;
  unit.ground = contact.ground;
}
