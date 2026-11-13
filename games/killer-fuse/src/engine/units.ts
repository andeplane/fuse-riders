/** Helpers every rule shares: who is where, who touches what, and death and respawn. */
import { arenaOf, wrapDelta } from "./maps.js";
import { halfOf, heightOf } from "./motion.js";
import { hashSeed } from "./rng.js";
import {
  BERRY_HEIGHT,
  FREED_INVULN,
  KICK_WAIT,
  MOUNT_WAIT,
  RESPAWN_INVULN,
  RESPAWN_STEPS,
  S,
  WARRIOR_HEIGHT,
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
 * The team a step serves first: a coin flipped from the round's seed and the step number. It decides a contested
 * pickup, mount or gate, and a victory both teams reach on the same step. A plain alternation would not do: mirrored
 * bots reach the snail on the same step every game, and the step's parity would always favour the same side.
 */
export const firstTeam = (state: Round): number =>
  hashSeed(state.seed, state.step) & 1;

/** Slots in the order a step serves them: the first team's unit of each pair before the other's. */
const EVEN = [0, 1, 2, 3, 4, 5] as const,
  ODD = [1, 0, 3, 2, 5, 4] as const;
export const turnOrder = (state: Round): readonly number[] =>
  firstTeam(state) === 0 ? EVEN : ODD;

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

/** The y of a unit's middle. */
export const centreY = (unit: Unit): number =>
  unit.y - Math.trunc(heightOf(unit.kind) / 2);

/**
 * The y a duel compares: half a Warrior's height above the feet, for a Queen too. Her tall body is a bigger target and
 * gives her no head start, so a Queen and a Warrior standing on the same ledge are level.
 */
export const duelY = (unit: Unit): number =>
  unit.y - Math.trunc(WARRIOR_HEIGHT / 2);

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
