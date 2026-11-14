/** Helpers every rule shares: who is where, who touches what, and death and respawn. */
import { arenaOf, standingOn, wrapDelta, wrapX } from "./maps.js";
import { halfOf, heightOf } from "./motion.js";
import { hashSeed } from "./rng.js";
import {
  BERRY_HEIGHT,
  GATE_OFFER,
  HATCH_LIFT,
  KICK_WAIT,
  MAX_FLAPS,
  MOUNT_WAIT,
  QUEEN_EGGS,
  REACH_HALF,
  RESPAWN_INVULN,
  RESPAWN_STEPS,
  S,
  SNAIL_HALF,
  WORKER_HALF,
  WORKER_HEIGHT,
} from "./tuning.js";
import type { Round, Unit, UnitKind } from "./types.js";

export const teamOf = (slot: number): number => slot % 2;

/** A unit at rest with its feet at (x, y), standing on platform `ground` (-1 in the air). */
export function newUnit(
  slot: number,
  kind: UnitKind,
  x: number,
  y: number,
  ground: number,
): Unit {
  return {
    slot,
    team: teamOf(slot),
    kind,
    speed: false,
    x,
    y,
    vx: 0,
    vy: 0,
    facing: teamOf(slot) === 0 ? 1 : -1,
    ground,
    coyote: 0,
    jumping: false,
    jumpStep: 0,
    flapped: false,
    diving: false,
    flaps: Array.from({ length: MAX_FLAPS }, () => 0),
    takeoff: 0,
    light: false,
    stun: 0,
    regular: false,
    attack: 0,
    dashing: false,
    attackBuffer: 0,
    downHeld: false,
    buffer: 0,
    carrying: false,
    gate: -1,
    gateProgress: 0,
    invuln: 0,
    dead: false,
    respawn: 0,
    riding: false,
    eaten: false,
    mountWait: 0,
    deposit: -1,
    depositStep: 0,
  };
}
export const isQueenSlot = (slot: number): boolean => slot < 2;
export const isMilitary = (unit: Unit): boolean => unit.kind !== "worker";
/** On the map and able to act or be touched. */
export const active = (unit: Unit): boolean => !unit.dead;
/** Locked into a gate: past the offer, while the transformation runs. */
export const gateLocked = (unit: Unit): boolean =>
  unit.gate >= 0 && unit.gateProgress >= GATE_OFFER;
/** Held in place by the map: in a gate's lock or in a hive hole. Nothing touches it and it does not move. */
export const held = (unit: Unit): boolean =>
  gateLocked(unit) || unit.deposit >= 0;
/** A Worker free to pick up, deposit, enter a gate or mount: not riding, not in the snail's mouth, not held. */
export const freeWorker = (unit: Unit): boolean =>
  !unit.dead &&
  unit.kind === "worker" &&
  !unit.riding &&
  !unit.eaten &&
  !held(unit);

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

/** Whether a unit's upright box overlaps the feet-anchored box at (x, y). */
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

/** Whether a Worker's reach, narrower than its body, overlaps the feet-anchored box at (x, y). */
export const reaches = (
  unit: Unit,
  x: number,
  y: number,
  half: number,
  height: number,
): boolean =>
  boxesTouch(unit.x, unit.y, REACH_HALF, WORKER_HEIGHT, x, y, half, height);

/** Whether a unit's upright box lies between the sides of the feet-anchored box at (x, y) and overlaps it. */
export const within = (
  unit: Unit,
  x: number,
  y: number,
  half: number,
  height: number,
): boolean =>
  Math.abs(wrapDelta(unit.x, x)) <= half - halfOf(unit.kind) &&
  unitTouches(unit, x, y, half, height);

/** The y of a unit's middle. */
export const centreY = (unit: Unit): number =>
  unit.y - Math.trunc(heightOf(unit.kind) / 2);

/** Lets go of whatever the unit holds on the map: its gate, its hive hole, the snail, the snail's mouth. */
export function release(state: Round, unit: Unit): void {
  if (unit.gate >= 0) {
    state.gates[unit.gate]!.user = -1;
    unit.gate = -1;
    unit.gateProgress = 0;
  }
  unit.deposit = -1;
  unit.depositStep = 0;
  if (unit.riding) {
    unit.riding = false;
    state.snail.rider = -1;
    state.snail.vx = 0;
    freeVictim(state);
  }
  if (unit.eaten) {
    unit.eaten = false;
    state.snail.victim = -1;
    state.snail.eat = 0;
  }
}

/** The Worker in the snail's mouth walks free, just in front of the head. */
export function freeVictim(state: Round): void {
  const victim = state.units[state.snail.victim];
  if (!victim) return;
  const arena = arenaOf(state.mapId);
  victim.eaten = false;
  victim.x = wrapX(
    state.snail.x + state.snail.facing * (SNAIL_HALF + WORKER_HALF + S),
  );
  victim.y = arena.snail.y;
  victim.vx = 0;
  victim.vy = 0;
  victim.ground = standingOn(arena, victim.x, victim.y);
  // It stands against the snail, so without a wait it would be caught or mount on the spot.
  victim.mountWait = MOUNT_WAIT;
  state.snail.victim = -1;
  state.snail.eat = 0;
  state.events.push({ type: "snailFree", victim: victim.slot });
}

/** A carried berry comes loose with its carrier's velocity. */
export function dropBerry(state: Round, unit: Unit): void {
  if (!unit.carrying) return;
  unit.carrying = false;
  state.loose.push({
    x: unit.x,
    y: Math.max(BERRY_HEIGHT, unit.y - 2 * S),
    vx: unit.vx,
    vy: unit.vy,
    resting: false,
    wait: KICK_WAIT,
    by: unit.slot,
  });
  state.events.push({ type: "berryDrop", slot: unit.slot });
}

/** Everything a unit's motion remembers between steps, back to rest. */
export function settle(unit: Unit): void {
  unit.vx = 0;
  unit.vy = 0;
  unit.jumping = false;
  unit.jumpStep = 0;
  unit.diving = false;
  unit.flapped = false;
  unit.flaps.fill(0);
  unit.takeoff = 0;
  unit.light = false;
  unit.stun = 0;
  unit.regular = false;
  unit.attack = 0;
  unit.dashing = false;
  unit.attackBuffer = 0;
  unit.buffer = 0;
  unit.coyote = 0;
}

/** `killer` is a slot; a Worker the snail finished eating names the rider. */
export function killUnit(state: Round, victim: Unit, killer: number): void {
  if (victim.dead) return;
  dropBerry(state, victim);
  release(state, victim);
  settle(victim);
  victim.dead = true;
  victim.respawn = RESPAWN_STEPS;
  victim.invuln = 0;
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

/**
 * Puts a unit back on the map, alive and briefly invulnerable: a Worker on its spawn point, a Queen in the air above
 * the next of her spare eggs (the first death hatches egg 0).
 */
export function respawnUnit(state: Round, unit: Unit): void {
  const arena = arenaOf(state.mapId);
  const egg =
    unit.kind === "queen" ? QUEEN_EGGS - 1 - state.eggs[unit.team]! : -1;
  const spot = arena.eggSpots[unit.team === 0 ? 0 : 1][egg];
  const spawn = spot ?? arena.spawns[unit.slot]!;
  unit.dead = false;
  unit.respawn = 0;
  unit.x = spawn.x;
  unit.y = spot ? spawn.y - HATCH_LIFT : spawn.y;
  unit.vx = 0;
  unit.vy = 0;
  unit.ground = spot ? -1 : standingOn(arena, spawn.x, spawn.y);
  unit.facing = unit.team === 0 ? 1 : -1;
  unit.invuln = RESPAWN_INVULN;
  unit.mountWait = 0;
  unit.downHeld = false;
  state.events.push({ type: "respawn", slot: unit.slot, egg: spot ? egg : -1 });
}
