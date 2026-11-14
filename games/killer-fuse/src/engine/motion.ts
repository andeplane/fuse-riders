/**
 * One unit's own motion for one step: controls to velocity, then a move against the solid platforms with the
 * horizontal wrap. It touches nothing but the unit, so the bots' navigation can fly trial moves through the very
 * same function the round uses (nav.ts). The order within a step is fixed: the attack press, facing,
 * jump or take-off, flaps and gravity, the dash or horizontal steering, then the move.
 */
import { WIDTH, wrapDelta, wrapX, type Arena, type Rect } from "./maps.js";
import { COLLIDERS, colliderOf, uprightOf, type Collider } from "./shapes.js";
import {
  ATTACK_BUFFER,
  BOUNCE,
  CEILING_BOUNCE_MAX,
  COYOTE_STEPS,
  DASH_DROP,
  DIVE_ACCEL_X,
  DIVE_NUDGE,
  DIVE_NUDGE_SPEED,
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
  JUMP_CUT_FORCE,
  JUMP_CUT_STEPS,
  JUMP_EASE,
  JUMP_HOLD_FORCE,
  JUMP_HOLD_STEPS,
  JUMP_RELIEF,
  JUMP_SPEED,
  PRESS_BUFFER,
  QUEEN_DASH,
  QUEEN_LETHAL,
  QUEEN_PERIOD,
  REST_SPEED,
  RUN_SPEED,
  S,
  SPEED_RISE,
  STUN_DRAG,
  STUN_SPEED,
  TAKEOFF_STEPS,
  TAKEOFF_THRUST,
  WARRIOR_DASH,
  WARRIOR_LETHAL,
  WARRIOR_PERIOD,
  WING_WALK_ACCEL,
  WING_WALK_DRAG,
  WING_WALK_SPEED,
  WORKER_ACCEL,
  WORKER_AIR_DRAG,
  WORKER_GRAVITY,
  WORKER_GRAVITY_LEDGE,
  WORKER_GROUND_DRAG,
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
  attack: false,
};

/** Half the width and the height of a kind's upright movement box. */
export const halfOf = (kind: UnitKind): number => uprightOf(kind).half;
export const heightOf = (kind: UnitKind): number => uprightOf(kind).height;

/** `value` moved toward `target` by at most `by`. */
export function approach(value: number, target: number, by: number): number {
  if (value < target) return Math.min(target, value + by);
  return Math.max(target, value - by);
}

export const dirOf = (input: Input): -1 | 0 | 1 =>
  input.right === input.left ? 0 : input.right ? 1 : -1;

/** A box by its centre x and bottom y against one solid shifted by `shift` for the wrap. Touching is not overlap. */
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

/** What a move ran into: a wall (the solid's index, or -1), the ceiling or a platform top (`ground`, its index). */
export interface Contact {
  wall: number;
  ceiling: boolean;
  ground: number;
}

/** Whether a body at (x, feet y) facing `facing` is below the top of the screen and clear of every platform. */
export function fits(
  arena: Arena,
  x: number,
  y: number,
  box: Collider,
  facing: number,
): boolean {
  const cx = x + box.shift * facing,
    bottom = y - box.lift;
  if (bottom - box.height < 0) return false;
  for (const solid of arena.solids)
    for (const shift of SHIFTS)
      if (hits(cx, bottom, box.half, box.height, solid, shift)) return false;
  return true;
}

/**
 * Moves a body by its velocity, horizontally and then vertically, stopping it at the first solid on each axis. Every
 * speed is below the thinnest platform, so nothing tunnels.
 */
export function moveBody(
  body: Body,
  box: Collider,
  facing: number,
  arena: Arena,
): Contact {
  const contact: Contact = { wall: -1, ceiling: false, ground: -1 };
  const off = box.shift * facing;
  const feet = body.y - box.lift;
  let x = body.x + off + body.vx;
  for (let i = 0; i < arena.solids.length; i += 1) {
    const solid = arena.solids[i]!;
    for (const shift of SHIFTS)
      if (hits(x, feet, box.half, box.height, solid, shift)) {
        x =
          body.vx > 0
            ? solid.x + shift - box.half
            : solid.x + shift + solid.w + box.half;
        contact.wall = i;
      }
  }
  let y = feet + body.vy;
  for (let i = 0; i < arena.solids.length; i += 1) {
    const solid = arena.solids[i]!;
    for (const shift of SHIFTS)
      if (hits(x, y, box.half, box.height, solid, shift)) {
        if (body.vy > 0) {
          y = solid.y;
          contact.ground = i;
        } else {
          y = solid.y + solid.h + box.height;
          contact.ceiling = true;
        }
      }
  }
  if (y - box.height < 0) {
    y = box.height;
    contact.ceiling = true;
  }
  body.x = wrapX(x - off);
  body.y = y + box.lift;
  return contact;
}

/** `value` scaled by a ratio, truncated toward zero. */
export const share = (value: number, [num, den]: Ratio): number =>
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

/** A stunned unit's horizontal speed: capped and slowly dragged down. It cannot steer. */
function drift(vx: number): number {
  const capped = Math.max(-STUN_SPEED, Math.min(STUN_SPEED, vx));
  return capped - share(capped, STUN_DRAG);
}

/** Ends every flap and the take-off push. */
export function fold(unit: Unit): void {
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

/** How far a unit whose box just grew back is moved to stand clear: up, then down, in art pixels. */
const REFIT_UP = 10,
  REFIT_DOWN = 6;

/** Puts a unit whose box just grew back in the clear: on its platform, or at the nearest free height. */
function refit(unit: Unit, arena: Arena): void {
  const box = colliderOf(unit, false);
  const free = (y: number): boolean => fits(arena, unit.x, y, box, unit.facing);
  if (free(unit.y)) return;
  const floor = arena.solids[unit.ground];
  if (floor && free(floor.y)) {
    unit.y = floor.y;
    return;
  }
  for (let up = 1; up <= REFIT_UP; up += 1)
    if (free(unit.y - up * S)) {
      unit.y -= up * S;
      return;
    }
  for (let down = 1; down <= REFIT_DOWN; down += 1)
    if (free(unit.y + down * S)) {
      unit.y += down * S;
      return;
    }
}

/**
 * Ends the dash of an attack. A Queen's attack goes straight to its cooldown; a Warrior's sword stays lethal until
 * its window is over.
 */
export function endDash(unit: Unit, arena: Arena): void {
  if (!unit.dashing) return;
  unit.dashing = false;
  if (unit.kind === "queen" && unit.attack <= QUEEN_LETHAL)
    unit.attack = QUEEN_LETHAL + 1;
  refit(unit, arena);
}

/** Ends an attack's lethal part at once, dash and all: what a glance does. A dive ends with it. */
export function sheathe(unit: Unit, arena: Arena): void {
  endDash(unit, arena);
  unit.diving = false;
  const window = unit.kind === "queen" ? QUEEN_LETHAL : WARRIOR_LETHAL;
  if (unit.attack >= 1 && unit.attack <= window) unit.attack = window + 1;
}

/** Counts a running attack one step on: the dash ends with the lethal window, the cooldown with the period. */
function tickAttack(unit: Unit, arena: Arena): void {
  if (unit.attack === 0) return;
  const queen = unit.kind === "queen";
  unit.attack += 1;
  if (unit.attack > (queen ? QUEEN_LETHAL : WARRIOR_LETHAL))
    endDash(unit, arena);
  if (unit.attack > (queen ? QUEEN_PERIOD : WARRIOR_PERIOD)) unit.attack = 0;
}

/** The art pixels a Queen may shift, forward first, to make room for her flat dash box. */
const DASH_ROOM = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, -1, -2, -3, -4] as const;

/** Starts an attack if the dash has room. The dash goes the held way unless that opposes the unit's motion. */
function launch(unit: Unit, dir: -1 | 0 | 1, arena: Arena): boolean {
  const face = dir !== 0 && dir * unit.vx >= 0 ? dir : unit.facing;
  if (unit.kind === "queen") {
    // Out of a dive she drops a little first, if there is room below.
    const drops = unit.diving ? [DASH_DROP, 0] : [0];
    let found = false;
    for (const drop of drops)
      for (const k of DASH_ROOM) {
        const x = wrapX(unit.x + face * k * S);
        if (found || !fits(arena, x, unit.y + drop, COLLIDERS.queenDash, face))
          continue;
        unit.x = x;
        unit.y += drop;
        found = true;
      }
    if (!found) return false;
  }
  unit.facing = face;
  unit.attack = 1;
  unit.dashing = true;
  unit.diving = false;
  unit.stun = 0;
  unit.regular = false;
  return true;
}

/** The attack press: an attack starts when none is running or cooling down and no glance stun is on. */
function strike(unit: Unit, input: Input, arena: Arena): void {
  const can = unit.attack === 0 && !(unit.stun > 0 && unit.regular);
  const wants = input.attack || unit.attackBuffer > 0;
  if (wants && can && launch(unit, dirOf(input), arena)) unit.attackBuffer = 0;
  else
    unit.attackBuffer = input.attack
      ? ATTACK_BUFFER
      : Math.max(0, unit.attackBuffer - 1);
}

/** A Warrior's or Queen's vertical controls for one step: take-off, flaps, dive and gravity. */
function fly(unit: Unit, input: Input, grounded: boolean): void {
  const mayDive =
    unit.kind === "queen" &&
    !grounded &&
    input.down &&
    !unit.dashing &&
    !(unit.stun > 0 && unit.regular);
  if (mayDive) {
    if (!unit.diving && !unit.downHeld) {
      fold(unit);
      unit.diving = true;
    }
  } else unit.diving = false;
  const press = buffered(unit, input, unit.stun === 0 && !unit.diving);
  if (unit.diving) {
    // No onset: she falls at the dive speed from its first step.
    unit.vy = DIVE_SPEED;
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
  const rise =
    unit.speed && unit.kind === "warrior"
      ? share(FLY_MAX_RISE, SPEED_RISE)
      : FLY_MAX_RISE;
  const gravity = unit.light ? FLY_GRAVITY_LIGHT : FLY_GRAVITY;
  unit.vy = Math.max(-rise, Math.min(FLY_TERMINAL, unit.vy + gravity - thrust));
}

/** A Worker's jump for one step: the launch, the push while the button stays held, and gravity. */
function jump(unit: Unit, input: Input, grounded: boolean): void {
  if (buffered(unit, input, unit.stun === 0 && (grounded || unit.coyote > 0))) {
    unit.vy = -JUMP_SPEED;
    unit.jumping = true;
    unit.jumpStep = 1;
    unit.light = false;
    unit.flapped = true;
    unit.coyote = 0;
  }
  if (unit.coyote > 0) unit.coyote -= 1;
  let force = 0;
  if (unit.jumping) {
    const k = unit.jumpStep - 1;
    if (input.held || k === 0) {
      force =
        k < JUMP_HOLD_STEPS
          ? JUMP_HOLD_FORCE
          : (JUMP_RELIEF[k - JUMP_HOLD_STEPS] ?? 0);
      unit.jumpStep += 1;
    } else {
      // Let go: a short hop early on, a quick fade later in the hold, nothing once the push was easing anyway.
      unit.jumping = false;
      unit.jumpStep = 0;
      if (k <= JUMP_CUT_STEPS) force = -JUMP_CUT_FORCE;
      else if (k < JUMP_HOLD_STEPS) {
        force = JUMP_EASE[0];
        unit.jumpStep = -1;
      }
    }
  } else if (unit.jumpStep < 0) {
    force = JUMP_EASE[1];
    unit.jumpStep = 0;
  }
  const gravity = unit.light ? WORKER_GRAVITY_LEDGE : WORKER_GRAVITY;
  unit.vy = Math.max(
    -JUMP_SPEED,
    Math.min(WORKER_TERMINAL, unit.vy + gravity - force),
  );
}

/**
 * A dash met a wall. It ends when the body is within the wall's height. A body that sticks out below slips under
 * (a Warrior only when its lower quarter is below the wall's middle), and a Queen that sticks out above is lifted
 * onto the ledge; both then keep dashing. Returns whether the dash goes on.
 */
function dashWall(
  unit: Unit,
  box: Collider,
  wall: Rect,
  x: number,
  arena: Arena,
): boolean {
  const bottom = unit.y - box.lift,
    top = bottom - box.height;
  const wallBottom = wall.y + wall.h;
  if (top >= wall.y && bottom <= wallBottom) return false;
  let y: number;
  if (bottom > wallBottom) {
    const low = bottom - Math.trunc(box.height / 4);
    if (unit.kind !== "queen" && low < wall.y + Math.trunc(wall.h / 2))
      return false;
    y = wallBottom + box.height + box.lift;
  } else {
    if (unit.kind !== "queen") return false;
    y = wall.y + box.lift;
  }
  if (!fits(arena, x, y, box, unit.facing)) return false;
  unit.x = x;
  unit.y = y;
  unit.vy = 0;
  return true;
}

/**
 * A dive that clips the corner of the platform it would land on slides past it instead, when the Queen is barely
 * moving sideways. True when it did.
 */
function nudged(
  unit: Unit,
  from: Body,
  box: Collider,
  platform: Rect,
  arena: Arena,
): boolean {
  if (Math.abs(from.vx) >= DIVE_NUDGE_SPEED) return false;
  const half = Math.trunc(platform.w / 2);
  const off = wrapDelta(unit.x, platform.x + half);
  const overlap = half + box.half - Math.abs(off);
  if (overlap <= 0 || overlap > DIVE_NUDGE) return false;
  const x = wrapX(unit.x + (off >= 0 ? overlap : -overlap));
  const y = from.y + from.vy;
  if (!fits(arena, x, y, box, unit.facing)) return false;
  unit.x = x;
  unit.y = y;
  unit.vy = from.vy;
  return true;
}

/** One step of a Worker's, Warrior's or Queen's own motion under `input`. */
export function moveUnit(unit: Unit, input: Input, arena: Arena): void {
  unit.flapped = false;
  tickAttack(unit, arena);
  const worker = unit.kind === "worker";
  if (!worker) strike(unit, input, arena);
  const stunned = unit.stun > 0;
  const dir = stunned ? 0 : dirOf(input);
  // Facing is locked through a dash and a stun.
  if (dir !== 0 && !unit.dashing) unit.facing = dir;
  const grounded = unit.ground >= 0;
  if (worker) {
    unit.diving = false;
    unit.vx = stunned
      ? drift(unit.vx)
      : steer(
          unit.vx,
          dir,
          WORKER_ACCEL,
          speedy(RUN_SPEED, unit.speed),
          grounded ? WORKER_GROUND_DRAG : WORKER_AIR_DRAG,
        );
    jump(unit, input, grounded);
  } else {
    fly(unit, input, grounded);
    if (unit.dashing)
      unit.vx =
        unit.facing *
        (unit.kind === "queen"
          ? QUEEN_DASH
          : (WARRIOR_DASH[unit.attack - 1] ?? 0));
    else if (stunned) unit.vx = drift(unit.vx);
    else
      unit.vx = steer(
        unit.vx,
        dir,
        unit.diving ? DIVE_ACCEL_X : grounded ? WING_WALK_ACCEL : FLY_ACCEL,
        speedy(grounded ? WING_WALK_SPEED : FLY_SPEED, unit.speed),
        grounded ? WING_WALK_DRAG : FLY_DRAG,
      );
  }
  if (unit.stun > 0) {
    unit.stun -= 1;
    if (unit.stun === 0) unit.regular = false;
  }
  unit.downHeld = input.down;

  // A standing Queen is taller than a flying one; under a low ceiling she keeps the box she flew in with.
  const tall =
    unit.kind === "queen" &&
    grounded &&
    !unit.dashing &&
    fits(arena, unit.x, unit.y, COLLIDERS.queen, unit.facing);
  const box = colliderOf(unit, tall);
  const from: Body = { x: unit.x, y: unit.y, vx: unit.vx, vy: unit.vy };
  const contact = moveBody(unit, box, unit.facing, arena);
  if (contact.wall >= 0) {
    const wall = arena.solids[contact.wall]!;
    if (
      unit.dashing &&
      dashWall(unit, box, wall, wrapX(from.x + from.vx), arena)
    ) {
      contact.ground = -1;
      contact.ceiling = false;
    } else {
      endDash(unit, arena);
      // A Warrior in the air bounces off a wall; everyone else just stops.
      unit.vx =
        unit.kind === "warrior" && !grounded ? -share(from.vx, BOUNCE) : 0;
    }
  }
  // A dash ends on a floor or ceiling only when it flew more into it than along it.
  if (
    (contact.ground >= 0 || contact.ceiling) &&
    Math.abs(from.vy) >= Math.abs(from.vx)
  )
    endDash(unit, arena);
  if (contact.ceiling) {
    unit.vy =
      unit.kind === "queen"
        ? 0
        : Math.min(CEILING_BOUNCE_MAX, share(-from.vy, BOUNCE));
    unit.jumping = false;
    unit.jumpStep = 0;
  }
  if (
    contact.ground >= 0 &&
    unit.diving &&
    nudged(unit, from, box, arena.solids[contact.ground]!, arena)
  )
    contact.ground = -1;
  if (contact.ground >= 0) {
    unit.vy = 0;
    unit.jumping = false;
    unit.jumpStep = 0;
    unit.light = false;
    unit.diving = false;
    fold(unit);
  } else if (grounded && !unit.flapped && worker) {
    // Walked off a ledge: a moment in which it can still jump, and a softer fall.
    unit.coyote = COYOTE_STEPS;
    unit.light = true;
  }
  unit.ground = contact.ground;
}
