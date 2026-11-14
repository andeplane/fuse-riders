/**
 * Berries: a finite supply in piles that never grows back. A Worker picks one up by touching a pile or a loose
 * berry, and banks it by touching an open hole of its own hive, from the ground, the air or the snail's back: it
 * sits in the hole for DEPOSIT_STEPS, untouchable, then the berry counts and it pops out. A Worker that dies or is
 * caught by the snail drops its berry with the speed it had. A loose berry falls and bounces; a unit that cannot
 * pick it up kicks a resting one straight up and knocks a flying one away, and one that comes to an open hole fills
 * it for that hive's team, whoever sent it.
 */
import { arenaOf, wrapDelta, wrapX, type Arena } from "./maps.js";
import { halfOf, heightOf, moveBody, share } from "./motion.js";
import type { Collider } from "./shapes.js";
import {
  BERRY_AIR_DRAG,
  BERRY_BOUNCE,
  BERRY_GRAVITY,
  BERRY_GROUND_DRAG,
  BERRY_HALF,
  BERRY_HEIGHT,
  BERRY_MAX,
  BERRY_REST_SPEED,
  DEPOSIT_EXIT,
  DEPOSIT_POP_X,
  DEPOSIT_POP_Y,
  DEPOSIT_STEPS,
  GATE_INVULN,
  HOLE_HALF,
  HOLE_SNAP,
  KICK_LIFT,
  KICK_WAIT,
  PILE_HALF,
  PILE_HEIGHT,
  SNAIL_HALF,
  SNAIL_HEIGHT,
  WORKER_HEIGHT,
} from "./tuning.js";
import type { LooseBerry, Round, Unit } from "./types.js";
import {
  active,
  boxesTouch,
  freeWorker,
  held,
  reaches,
  release,
  settle,
  turnOrder,
  unitTouches,
} from "./units.js";

const BERRY_BOX: Collider = {
  half: BERRY_HALF,
  height: BERRY_HEIGHT,
  lift: 0,
  shift: 0,
};

/** Whether hole `index` of `team`'s hive can take a berry: not filled, and no Worker sitting in it. */
export const holeOpen = (state: Round, team: number, index: number): boolean =>
  !state.holes[team]![index] &&
  !state.units.some((unit) => unit.team === team && unit.deposit === index);

const limit = (value: number): number =>
  Math.max(-BERRY_MAX, Math.min(BERRY_MAX, value));

/** A carrying Worker that touches an open hole of its own hive climbs in. */
function enterHole(state: Round, arena: Arena, unit: Unit): void {
  const holes = arena.holes[unit.team === 0 ? 0 : 1];
  for (let i = 0; i < holes.length; i += 1) {
    const hole = holes[i]!;
    if (
      !holeOpen(state, unit.team, i) ||
      !reaches(unit, hole.x, hole.y + HOLE_HALF, HOLE_HALF, 2 * HOLE_HALF)
    )
      continue;
    // From the snail's back it gets off first.
    release(state, unit);
    settle(unit);
    unit.deposit = i;
    unit.depositStep = 0;
    unit.x = hole.x;
    unit.y = hole.y + Math.trunc(WORKER_HEIGHT / 2);
    unit.ground = -1;
    state.events.push({
      type: "depositStart",
      slot: unit.slot,
      team: unit.team,
      hole: i,
    });
    return;
  }
}

/** A Worker sitting in a hole: the berry counts after DEPOSIT_STEPS, and it pops out DEPOSIT_EXIT steps later. */
function sitInHole(state: Round, unit: Unit): void {
  unit.depositStep += 1;
  if (unit.depositStep === DEPOSIT_STEPS) {
    state.holes[unit.team]![unit.deposit] = true;
    unit.carrying = false;
    state.events.push({
      type: "berryDeposit",
      slot: unit.slot,
      team: unit.team,
      hole: unit.deposit,
    });
  }
  if (unit.depositStep < DEPOSIT_STEPS + DEPOSIT_EXIT) return;
  unit.deposit = -1;
  unit.depositStep = 0;
  // Out the way it came.
  unit.facing = unit.facing === 1 ? -1 : 1;
  unit.vx = unit.facing * DEPOSIT_POP_X;
  unit.vy = -DEPOSIT_POP_Y;
  unit.invuln = GATE_INVULN;
}

function workerTurn(state: Round, arena: Arena, unit: Unit): void {
  if (unit.dead || unit.kind !== "worker") return;
  if (unit.deposit >= 0) return sitInHole(state, unit);
  if (unit.eaten || unit.gate >= 0) return;
  if (unit.carrying) return enterHole(state, arena, unit);
  if (unit.riding) return;
  for (let i = 0; i < arena.piles.length; i += 1) {
    const pile = arena.piles[i]!;
    if (
      state.piles[i]! > 0 &&
      unitTouches(unit, pile.x, pile.y, PILE_HALF, PILE_HEIGHT)
    ) {
      state.piles[i] = state.piles[i]! - 1;
      unit.carrying = true;
      state.events.push({ type: "berryPickup", slot: unit.slot, pile: i });
      return;
    }
  }
}

function moveLoose(berry: LooseBerry, arena: Arena): void {
  if (berry.wait > 0) berry.wait -= 1;
  if (berry.resting) return;
  berry.vy = limit(berry.vy + BERRY_GRAVITY);
  berry.vx = limit(berry.vx - share(berry.vx, BERRY_AIR_DRAG));
  const before = { vx: berry.vx, vy: berry.vy };
  const contact = moveBody(berry, BERRY_BOX, 1, arena);
  if (contact.wall >= 0) berry.vx = -share(before.vx, BERRY_BOUNCE);
  if (contact.ceiling) berry.vy = -share(before.vy, BERRY_BOUNCE);
  if (contact.ground >= 0) {
    berry.vy = -share(before.vy, BERRY_BOUNCE);
    berry.vx -= share(berry.vx, BERRY_GROUND_DRAG);
    if (
      Math.abs(berry.vy) < 4 * BERRY_GRAVITY &&
      Math.abs(berry.vx) < BERRY_REST_SPEED
    ) {
      berry.vx = 0;
      berry.vy = 0;
      berry.resting = true;
    }
  }
}

/**
 * A flying berry meets a body whose middle is (cx, cy), half sizes (hx, hy), moving at (vx, vy): the berry, which
 * weighs nothing, is thrown back along the axis it came in on with `bounce` times the closing speed.
 */
function knock(
  berry: LooseBerry,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  vx: number,
  vy: number,
  bounce: number,
): void {
  const dx = wrapDelta(berry.x, cx),
    dy = berry.y - Math.trunc(BERRY_HEIGHT / 2) - cy;
  if (Math.abs(dx) * hy > Math.abs(dy) * hx) {
    const closing = berry.vx - vx;
    if (closing * dx < 0) berry.vx = limit(vx - bounce * closing);
  } else {
    const closing = berry.vy - vy;
    if (closing * dy < 0) berry.vy = limit(vy - bounce * closing);
  }
}

/** A unit touching a loose berry. True when the berry was taken. */
function touchLoose(state: Round, berry: LooseBerry, unit: Unit): boolean {
  if (freeWorker(unit) && !unit.carrying && unit.gate < 0) {
    unit.carrying = true;
    state.events.push({ type: "berryPickup", slot: unit.slot, pile: -1 });
    return true;
  }
  if (!berry.resting) {
    const half = halfOf(unit.kind),
      tall = Math.trunc(heightOf(unit.kind) / 2);
    knock(berry, unit.x, unit.y - tall, half, tall, unit.vx, unit.vy, 1);
    return false;
  }
  if (unit.ground < 0) return false;
  berry.vy = -KICK_LIFT;
  berry.resting = false;
  berry.wait = KICK_WAIT;
  berry.by = unit.slot;
  state.events.push({ type: "berryKick", slot: unit.slot });
  return false;
}

/** The open hole a loose berry at (x, y) is in, as [team, hole], or null. */
function holeAt(
  state: Round,
  arena: Arena,
  teams: readonly number[],
  x: number,
  y: number,
): [team: number, hole: number] | null {
  const cy = y - Math.trunc(BERRY_HEIGHT / 2);
  for (const team of teams) {
    const holes = arena.holes[team === 0 ? 0 : 1];
    for (let i = 0; i < holes.length; i += 1) {
      const hole = holes[i]!;
      if (
        Math.abs(wrapDelta(x, hole.x)) <= HOLE_SNAP &&
        Math.abs(cy - hole.y) <= HOLE_SNAP &&
        holeOpen(state, team, i)
      )
        return [team, i];
    }
  }
  return null;
}

export function stepBerries(state: Round): void {
  const arena = arenaOf(state.mapId);
  const order = turnOrder(state);
  for (const slot of order) workerTurn(state, arena, state.units[slot]!);
  const teams = order.slice(0, 2);
  const track = arena.snail.y;
  const kept: LooseBerry[] = [];
  for (const berry of state.loose) {
    const from = { x: berry.x, y: berry.y };
    moveLoose(berry, arena);
    // Halfway along the step as well, so a fast berry cannot skip a hole.
    const mid = {
      x: wrapX(from.x + Math.trunc(wrapDelta(berry.x, from.x) / 2)),
      y: from.y + Math.trunc((berry.y - from.y) / 2),
    };
    const scored =
      holeAt(state, arena, teams, mid.x, mid.y) ??
      holeAt(state, arena, teams, berry.x, berry.y);
    if (scored) {
      const [team, hole] = scored;
      state.holes[team]![hole] = true;
      state.events.push({ type: "berryKickIn", slot: berry.by, team, hole });
      continue;
    }
    let gone = false;
    if (berry.wait === 0)
      for (const slot of order) {
        const unit = state.units[slot]!;
        if (!active(unit) || unit.riding || unit.eaten || held(unit)) continue;
        if (!unitTouches(unit, berry.x, berry.y, BERRY_HALF, BERRY_HEIGHT))
          continue;
        gone = touchLoose(state, berry, unit);
        break;
      }
    if (
      !gone &&
      !berry.resting &&
      boxesTouch(
        berry.x,
        berry.y,
        BERRY_HALF,
        BERRY_HEIGHT,
        state.snail.x,
        track,
        SNAIL_HALF,
        SNAIL_HEIGHT,
      )
    )
      knock(
        berry,
        state.snail.x,
        track - Math.trunc(SNAIL_HEIGHT / 2),
        SNAIL_HALF,
        Math.trunc(SNAIL_HEIGHT / 2),
        state.snail.vx,
        0,
        2,
      );
    if (!gone) kept.push(berry);
  }
  state.loose = kept;
}
