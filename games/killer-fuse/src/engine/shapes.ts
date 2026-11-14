/**
 * The boxes of every unit, per state, as data: the movement box that meets platforms and other bodies, the hit boxes
 * a weapon must touch to kill, and the weapon itself while an attack is lethal. They are given in units around each
 * character's origin with y up; here they are compiled once into subpixel offsets from a
 * unit's (x, feet y), drawn for a unit facing right.
 */
import {
  QUEEN_HALF,
  QUEEN_HEIGHT,
  QUEEN_LETHAL,
  WARRIOR_HALF,
  WARRIOR_HEIGHT,
  WARRIOR_LETHAL,
  WORKER_HALF,
  WORKER_HEIGHT,
  u,
} from "./tuning.js";
import type { Unit, UnitKind } from "./types.js";

/** A box by its centre, as an offset from the unit's (x, feet y) when it faces right, and its half sizes. */
export interface Box {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

/**
 * A movement box: `half` wide each side of the unit's x plus `shift` (toward its facing), its bottom `lift` above the
 * feet and `height` tall.
 */
export interface Collider {
  half: number;
  height: number;
  lift: number;
  shift: number;
}

/** `[centre x, centre y, width, height]` in units around the origin, y up. */
type Raw = readonly [number, number, number, number];

/** How far each origin is above the feet: the bottom of the upright movement box. */
const WORKER_ORIGIN = 0.5435,
  WARRIOR_ORIGIN = 0.542,
  QUEEN_GROUND_ORIGIN = 1.454,
  QUEEN_AIR_ORIGIN = 0.999;

const boxes = (origin: number, raw: readonly Raw[]): readonly Box[] =>
  raw.map(([x, y, w, h]) => ({
    x: u(x),
    y: -u(origin + y),
    hw: u(w / 2),
    hh: u(h / 2),
  }));

export const COLLIDERS = {
  worker: { half: WORKER_HALF, height: WORKER_HEIGHT, lift: 0, shift: 0 },
  warrior: { half: WARRIOR_HALF, height: WARRIOR_HEIGHT, lift: 0, shift: 0 },
  /** A dashing Warrior tucks its legs: 0.521 by 1.138, its top where it was. */
  warriorDash: {
    half: WARRIOR_HALF,
    height: u(1.138),
    lift: u(0.294),
    shift: 0,
  },
  queen: { half: QUEEN_HALF, height: QUEEN_HEIGHT, lift: 0, shift: 0 },
  /** In the air a Queen is 0.447 by 1.502. */
  queenFly: { half: QUEEN_HALF, height: u(1.502), lift: 0, shift: 0 },
  /** A dashing Queen lies flat: 1.692 by 0.378, trailing behind her. */
  queenDash: {
    half: u(0.846),
    height: u(0.378),
    lift: u(0.673),
    shift: -u(0.277),
  },
} as const satisfies Record<string, Collider>;

export const HIT_BOXES = {
  workerStand: boxes(WORKER_ORIGIN, [
    [0, -0.09, 0.56, 0.91],
    [-0.06, 0.09, 0.82, 0.28],
    [0, 0.5, 0.55, 0.28],
  ]),
  workerMove: boxes(WORKER_ORIGIN, [[0, 0.05, 0.6, 1.2]]),
  workerRide: boxes(WORKER_ORIGIN, [
    [-0.06, -0.42, 0.68, 1.08],
    [0, 0.21, 0.55, 0.19],
    [0, 0.42, 0.55, 0.23],
  ]),
  warriorStand: boxes(WARRIOR_ORIGIN, [
    [0.01, -0.01, 0.98, 1.06],
    [0.03, 0.75, 0.57, 0.31],
  ]),
  warriorRise: boxes(WARRIOR_ORIGIN, [[0.07, 0.16, 0.68, 1.52]]),
  warriorFall: boxes(WARRIOR_ORIGIN, [
    [0.05, 0, 0.62, 1.19],
    [0.05, 0.77, 0.62, 0.36],
  ]),
  warriorAttack: boxes(WARRIOR_ORIGIN, [
    [0.18, 0.57, 0.89, 0.71],
    [0, -0.02, 0.53, 0.47],
  ]),
  queenStand: boxes(QUEEN_GROUND_ORIGIN, [
    [0.05, -0.43, 0.54, 1.14],
    [0.05, 0.32, 0.55, 0.36],
  ]),
  queenFly: boxes(QUEEN_AIR_ORIGIN, [
    [0.04, -0.42, 0.38, 1.18],
    [0.05, 0.34, 0.6, 0.37],
  ]),
  queenDash: boxes(QUEEN_AIR_ORIGIN, [[-0.35, -0.14, 1.55, 0.39]]),
  queenDive: boxes(QUEEN_AIR_ORIGIN, [
    [0, 0.03, 0.45, 0.96],
    [0, -0.64, 0.45, 0.36],
  ]),
} as const satisfies Record<string, readonly Box[]>;

export const WEAPONS = {
  /** The sword: a round guard (radius 0.5, here its 0.9 square) and the blade, reaching 1.28 u ahead. */
  warrior: boxes(WARRIOR_ORIGIN, [
    [0.44, 0.34, 0.9, 0.9],
    [0.82, 0.28, 0.92, 0.28],
  ]),
  /** A dashing Queen's blade reaches 1.41 u ahead. */
  queenDash: boxes(QUEEN_AIR_ORIGIN, [
    [0.99, -0.11, 0.84, 0.05],
    [0.51, -0.14, 0.17, 0.39],
  ]),
  /** A diving Queen's blade points down, its tip 1.96 u below her origin. */
  queenDive: boxes(QUEEN_AIR_ORIGIN, [
    [-0.02, -1.45, 0.05, 1.02],
    [-0.02, -1.07, 0.41, 0.13],
    [-0.02, -0.91, 0.5, 0.19],
  ]),
} as const satisfies Record<string, readonly Box[]>;

const NONE: readonly Box[] = [];

/** The upright movement box of a kind: what a unit stands in. */
export const uprightOf = (kind: UnitKind): Collider => COLLIDERS[kind];

/**
 * The movement box of a unit right now. `tall` says whether a standing Queen has the headroom for her full height;
 * without it she keeps the box she flies in.
 */
export function colliderOf(unit: Unit, tall = true): Collider {
  if (unit.kind === "worker") return COLLIDERS.worker;
  if (unit.kind === "warrior")
    return unit.dashing ? COLLIDERS.warriorDash : COLLIDERS.warrior;
  if (unit.dashing) return COLLIDERS.queenDash;
  return unit.ground >= 0 && tall ? COLLIDERS.queen : COLLIDERS.queenFly;
}

/** Whether the unit's weapon can kill on this step. Only a sword in its lethal window or a diving Queen's can. */
export function lethal(unit: Unit): boolean {
  if (unit.kind === "warrior")
    return unit.attack >= 1 && unit.attack <= WARRIOR_LETHAL;
  if (unit.kind !== "queen") return false;
  return (
    unit.diving ||
    (unit.dashing && unit.attack >= 1 && unit.attack <= QUEEN_LETHAL)
  );
}

/** The boxes a weapon must touch to hit this unit, for the state it is in. */
export function hitBoxesOf(unit: Unit): readonly Box[] {
  if (unit.kind === "worker") {
    if (unit.riding) return HIT_BOXES.workerRide;
    return unit.ground >= 0 && unit.vx === 0
      ? HIT_BOXES.workerStand
      : HIT_BOXES.workerMove;
  }
  if (unit.kind === "warrior") {
    if (lethal(unit)) return HIT_BOXES.warriorAttack;
    if (unit.ground >= 0) return HIT_BOXES.warriorStand;
    return unit.vy < 0 ? HIT_BOXES.warriorRise : HIT_BOXES.warriorFall;
  }
  if (unit.dashing) return HIT_BOXES.queenDash;
  if (unit.diving) return HIT_BOXES.queenDive;
  return unit.ground >= 0 ? HIT_BOXES.queenStand : HIT_BOXES.queenFly;
}

/** The unit's weapon while it is lethal; nothing otherwise. */
export function weaponOf(unit: Unit): readonly Box[] {
  if (!lethal(unit)) return NONE;
  if (unit.kind === "warrior") return WEAPONS.warrior;
  return unit.diving ? WEAPONS.queenDive : WEAPONS.queenDash;
}
