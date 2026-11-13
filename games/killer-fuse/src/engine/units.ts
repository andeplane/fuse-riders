/** Helpers every rule shares: who is where, who touches what, and death and respawn. */
import { arenaOf, wrapDelta } from "./maps.js";
import { halfOf, heightOf } from "./motion.js";
import {
  BERRY_HEIGHT,
  FREED_INVULN,
  KICK_WAIT,
  MOUNT_WAIT,
  RESPAWN_INVULN,
  RESPAWN_STEPS,
  S,
} from "./tuning.js";
import type { Round, Unit } from "./types.js";

export const teamOf = (slot: number): number => slot % 2;
export const isQueenSlot = (slot: number): boolean => slot < 2;
export const isMilitary = (unit: Unit): boolean => unit.kind !== "worker";
/** On the map and able to act or be touched. */
export const active = (unit: Unit): boolean => !unit.dead;
/** A Worker free to pick up, deposit, enter a gate or mount: not riding, not in the snail's mouth. */
export const freeWorker = (unit: Unit): boolean =>
  !unit.dead && unit.kind === "worker" && !unit.riding && !unit.eaten;

/**
 * Slots in the order a step serves them. It alternates which team goes first every step, so a contested pickup,
 * mount or gate is not decided by the slot number.
 */
const EVEN = [0, 1, 2, 3, 4, 5] as const,
  ODD = [1, 0, 3, 2, 5, 4] as const;
export const turnOrder = (step: number): readonly number[] =>
  step % 2 === 0 ? EVEN : ODD;

/** Whether two feet-anchored boxes overlap, across the wrap. */
export function boxesTouch(
  ax: number,
  ay: number,
  aHalf: number,
  aHeight: number,
  bx: number,
  by: number,
  bHalf: number,
  bHeight: number,
): boolean {
  return (
    Math.abs(wrapDelta(ax, bx)) < aHalf + bHalf &&
    ay > by - bHeight &&
    ay - aHeight < by
  );
}

/** Whether a unit's box overlaps the feet-anchored box at (x, y). */
export function unitTouches(
  unit: Unit,
  x: number,
  y: number,
  half: number,
  height: number,
): boolean {
  return boxesTouch(
    unit.x,
    unit.y,
    halfOf(unit.kind),
    heightOf(unit.kind),
    x,
    y,
    half,
    height,
  );
}

export const unitsTouch = (a: Unit, b: Unit): boolean =>
  unitTouches(a, b.x, b.y, halfOf(b.kind), heightOf(b.kind));

/** The y of a unit's middle: what "higher" compares. */
export const centreY = (unit: Unit): number =>
  unit.y - Math.trunc(heightOf(unit.kind) / 2);

/** Lets go of whatever the unit holds on the map: its gate, the snail, the snail's mouth. */
export function release(state: Round, unit: Unit): void {
  if (unit.gate >= 0) {
    state.gates[unit.gate]!.user = -1;
    unit.gate = -1;
    unit.gateProgress = 0;
  }
  if (unit.riding) {
    unit.riding = false;
    state.snail.rider = -1;
    freeVictim(state);
  }
  if (unit.eaten) {
    unit.eaten = false;
    state.snail.victim = -1;
    state.snail.eat = 0;
  }
}

/** The Worker in the snail's mouth walks free. */
export function freeVictim(state: Round): void {
  const victim = state.units[state.snail.victim];
  if (!victim) return;
  victim.eaten = false;
  victim.invuln = FREED_INVULN;
  // It stands against the snail, so without a wait it would mount on the spot.
  victim.mountWait = MOUNT_WAIT;
  state.snail.victim = -1;
  state.snail.eat = 0;
  state.events.push({ type: "snailFree", victim: victim.slot });
}

/** A carried berry falls where its carrier stands and becomes a loose, kickable object. */
export function dropBerry(state: Round, unit: Unit): void {
  if (!unit.carrying) return;
  unit.carrying = false;
  state.loose.push({
    x: unit.x,
    y: Math.max(BERRY_HEIGHT, unit.y - 2 * S),
    vx: Math.trunc(unit.vx / 2),
    vy: -S,
    resting: false,
    wait: KICK_WAIT,
    by: unit.slot,
  });
  state.events.push({ type: "berryDrop", slot: unit.slot });
}

/** `killer` is a slot; a Worker the snail finished eating names the rider. */
export function killUnit(state: Round, victim: Unit, killer: number): void {
  if (victim.dead) return;
  dropBerry(state, victim);
  release(state, victim);
  victim.dead = true;
  victim.respawn = RESPAWN_STEPS;
  victim.vx = 0;
  victim.vy = 0;
  victim.invuln = 0;
  victim.jumping = false;
  victim.diving = false;
  victim.flapped = false;
  victim.ground = -1;
  state.events.push({ type: "kill", victim: victim.slot, killer });
  if (victim.kind === "queen") {
    state.eggs[victim.team] = state.eggs[victim.team]! - 1;
    state.events.push({
      type: "queenKill",
      victim: victim.slot,
      killer,
      eggsLeft: state.eggs[victim.team]!,
    });
  } else {
    // A Warrior comes back as a plain Worker.
    victim.kind = "worker";
    victim.speed = false;
  }
}

/** Puts a unit back on its spawn point, alive and briefly invulnerable. */
export function respawnUnit(state: Round, unit: Unit): void {
  const spawn = arenaOf(state.mapId).spawns[unit.slot]!;
  unit.dead = false;
  unit.respawn = 0;
  unit.x = spawn.x;
  unit.y = spawn.y;
  unit.vx = 0;
  unit.vy = 0;
  unit.ground = -1;
  unit.coyote = 0;
  unit.facing = unit.team === 0 ? 1 : -1;
  unit.invuln = RESPAWN_INVULN;
  unit.mountWait = 0;
  state.events.push({ type: "respawn", slot: unit.slot });
}
