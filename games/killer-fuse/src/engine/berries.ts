/**
 * Berries: a finite supply in piles. A Worker picks one up by touching a pile or a loose berry, banks it by walking
 * into an empty hole of its own hive, and drops it where it dies. A loose berry falls, bounces and can be kicked by
 * any unit; one that reaches an empty hole fills it for the hive's team, whoever kicked it.
 */
import { arenaOf, type Arena } from "./maps.js";
import { moveBody } from "./motion.js";
import {
  BERRY_BOUNCE_DEN,
  BERRY_BOUNCE_NUM,
  BERRY_FRICTION_DEN,
  BERRY_FRICTION_NUM,
  BERRY_GRAVITY,
  BERRY_HALF,
  BERRY_HEIGHT,
  BERRY_REST_SPEED,
  BERRY_TERMINAL,
  HOLE_HALF,
  KICK_LIFT,
  KICK_SPEED,
  KICK_WAIT,
  PILE_HALF,
  PILE_HEIGHT,
  REGROW_CLOCK,
  REGROW_STEPS,
  WORKER_HALF,
  WORKER_HEIGHT,
} from "./tuning.js";
import type { LooseBerry, Round, Unit } from "./types.js";
import {
  active,
  boxesTouch,
  freeWorker,
  turnOrder,
  unitTouches,
} from "./units.js";

/** The first empty hole of `team`'s hive the feet-anchored box overlaps, or -1. */
function holeAt(
  state: Round,
  arena: Arena,
  team: number,
  x: number,
  y: number,
  half: number,
  height: number,
): number {
  const holes = arena.holes[team === 0 ? 0 : 1];
  for (let i = 0; i < holes.length; i += 1) {
    const hole = holes[i]!;
    if (
      !state.holes[team]![i] &&
      boxesTouch(
        x,
        y,
        half,
        height,
        hole.x,
        hole.y + HOLE_HALF,
        HOLE_HALF,
        2 * HOLE_HALF,
      )
    )
      return i;
  }
  return -1;
}

function pickUpAndBank(state: Round, arena: Arena, unit: Unit): void {
  if (!freeWorker(unit)) return;
  if (unit.carrying) {
    const hole = holeAt(
      state,
      arena,
      unit.team,
      unit.x,
      unit.y,
      // Workers are the only carriers, so the banking box is always a Worker's.
      WORKER_HALF,
      WORKER_HEIGHT,
    );
    if (hole >= 0 && unit.gate < 0) {
      state.holes[unit.team]![hole] = true;
      unit.carrying = false;
      state.events.push({
        type: "berryDeposit",
        slot: unit.slot,
        team: unit.team,
        hole,
      });
    }
    return;
  }
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
  berry.vy = Math.min(berry.vy + BERRY_GRAVITY, BERRY_TERMINAL);
  const before = { vx: berry.vx, vy: berry.vy };
  const contact = moveBody(berry, BERRY_HALF, BERRY_HEIGHT, arena);
  if (contact.wall)
    berry.vx = -Math.trunc((before.vx * BERRY_BOUNCE_NUM) / BERRY_BOUNCE_DEN);
  if (contact.ceiling) berry.vy = 0;
  if (contact.ground >= 0) {
    berry.vy = -Math.trunc((before.vy * BERRY_BOUNCE_NUM) / BERRY_BOUNCE_DEN);
    berry.vx = Math.trunc((berry.vx * BERRY_FRICTION_NUM) / BERRY_FRICTION_DEN);
    if (
      Math.abs(berry.vy) < 2 * BERRY_GRAVITY &&
      Math.abs(berry.vx) < BERRY_REST_SPEED
    ) {
      berry.vx = 0;
      berry.vy = 0;
      berry.resting = true;
    }
  }
}

/** A unit touching a loose berry: a free empty-handed Worker takes it, anyone else kicks it. True when taken. */
function touchLoose(state: Round, berry: LooseBerry, unit: Unit): boolean {
  if (freeWorker(unit) && !unit.carrying && unit.gate < 0) {
    unit.carrying = true;
    state.events.push({ type: "berryPickup", slot: unit.slot, pile: -1 });
    return true;
  }
  berry.vx = unit.facing * KICK_SPEED + Math.trunc(unit.vx / 2);
  berry.vy = -KICK_LIFT;
  berry.resting = false;
  berry.wait = KICK_WAIT;
  berry.by = unit.slot;
  state.events.push({ type: "berryKick", slot: unit.slot });
  return false;
}

export function stepBerries(state: Round): void {
  const arena = arenaOf(state.mapId);
  const order = turnOrder(state);
  for (const slot of order) pickUpAndBank(state, arena, state.units[slot]!);
  const kept: LooseBerry[] = [];
  for (const berry of state.loose) {
    moveLoose(berry, arena);
    let gone = false;
    for (const team of order.slice(0, 2)) {
      const hole = holeAt(
        state,
        arena,
        team,
        berry.x,
        berry.y,
        BERRY_HALF,
        BERRY_HEIGHT,
      );
      if (hole < 0) continue;
      state.holes[team]![hole] = true;
      state.events.push({ type: "berryKickIn", slot: berry.by, team, hole });
      gone = true;
      break;
    }
    if (!gone && berry.wait === 0)
      for (const slot of order) {
        const unit = state.units[slot]!;
        if (!active(unit) || unit.riding || unit.eaten) continue;
        if (!unitTouches(unit, berry.x, berry.y, BERRY_HALF, BERRY_HEIGHT))
          continue;
        gone = touchLoose(state, berry, unit);
        break;
      }
    if (!gone) kept.push(berry);
  }
  state.loose = kept;
  // The map has run dry when every pile is empty; ninety seconds later the piles are whole again. They are also made
  // whole on a slow clock whatever is left, so a few berries nobody dares fetch cannot starve a long game.
  if (state.piles.some((count) => count > 0)) state.dry = 0;
  else state.dry += 1;
  if (state.dry >= REGROW_STEPS || state.step % REGROW_CLOCK === 0) {
    state.piles = arena.piles.map((pile) => pile.count);
    state.dry = 0;
    state.events.push({ type: "berryRegrow" });
  }
}
