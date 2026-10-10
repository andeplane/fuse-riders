import {
  CAPACITY,
  ENEMY_HP,
  FLOOR_BOTTOM,
  FLOOR_TOP,
  HERO_KINDS,
  px,
  type EnemyKind,
  type HeroKind,
} from "./tuning.js";
import { clamp } from "./math.js";

/**
 * One run's world: plain integer data, so the netcode can clone, hash and checkpoint it. Space is `x` along the
 * road, `y` depth on the floor band (larger is nearer the viewer) and `z` height above the floor, all in sub-units;
 * the camera's left edge is `camX`. Heroes are kept in id order, which is seat order; enemies follow in id order,
 * the order they spawned in.
 */
export const HERO_STATES = [
  "idle",
  "walk",
  "jump",
  "land",
  "attack1",
  "attack2",
  "attack3",
] as const;
export type HeroState = (typeof HERO_STATES)[number];

export interface Hero {
  id: number;
  seat: number;
  kind: HeroKind;
  x: number;
  y: number;
  z: number;
  /** Velocity along the road and in depth: the walk this step, or the momentum a jump keeps. */
  vx: number;
  vy: number;
  vz: number;
  facing: 1 | -1;
  state: HeroState;
  /** Steps since `state` began. */
  timer: number;
  /** The bits held on the previous step, which the next step derives presses from. */
  held: number;
  /** Steps an Attack or a Jump press stays usable for (0: none waiting). */
  attackBuf: number;
  jumpBuf: number;
  /** Hit-stop: the hero holds still on every step up to and including this one. */
  stopUntil: number;
  /** The enemies this swing has hit, by id, so none is hit twice by one swing. Replaced, never mutated. */
  struck: number[];
  /** Tallies for the HUD: hit points taken from enemies, and enemies knocked down. */
  damage: number;
  knockdowns: number;
}

export const ENEMY_STATES = [
  "idle",
  "hurt",
  "knockdown",
  "down",
  "getup",
  "dead",
] as const;
export type EnemyState = (typeof ENEMY_STATES)[number];

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  z: number;
  /** A nudge's or a knockdown's speed along the road, and a knockdown's rise and fall. */
  vx: number;
  vz: number;
  facing: 1 | -1;
  hp: number;
  state: EnemyState;
  /** Steps since `state` began. */
  timer: number;
  /** Hit-stop: the enemy holds still on every step up to and including this one. */
  stopUntil: number;
}

export const FX_KINDS = ["hit", "heavy", "ko"] as const;
export type FxKind = (typeof FX_KINDS)[number];

/** A hit spark where a blade landed, born on step `born` and dropped `FX_LIFE` steps later. */
export interface Fx {
  kind: FxKind;
  x: number;
  y: number;
  z: number;
  born: number;
}

export interface World {
  seed: number;
  /** Steps since the run began. */
  step: number;
  /** The mulberry32 state (`rng.ts`): every random draw advances it, so rollback replays the same draws. */
  rng: number;
  /** The next entity id. */
  nextId: number;
  camX: number;
  heroes: Hero[];
  enemies: Enemy[];
  /** Effects, oldest first, at most `FX_MAX`. */
  fx: Fx[];
}

export interface HeroEntry {
  seat: number;
  kind: HeroKind;
}

/** Where each seat's hero starts, in pixels: spread across the left of the screen and the depth of the floor. */
export const SPAWNS: readonly (readonly [number, number])[] = [
  [64, 138],
  [48, 116],
  [48, 160],
  [32, 127],
  [32, 149],
];

export function createWorld(options: {
  seed: number;
  heroes: readonly HeroEntry[];
}): World {
  const entries = [...options.heroes].sort((a, b) => a.seat - b.seat);
  entries.forEach((entry, index) => {
    if (
      !Number.isInteger(entry.seat) ||
      entry.seat < 0 ||
      entry.seat >= CAPACITY ||
      entries[index - 1]?.seat === entry.seat
    )
      throw new RangeError(`fuse-axe: bad or repeated seat ${entry.seat}`);
    if (!HERO_KINDS.includes(entry.kind))
      throw new RangeError(`fuse-axe: unknown hero kind ${entry.kind}`);
  });
  const heroes = entries.map((entry, index): Hero => {
    const [x, y] = SPAWNS[entry.seat]!;
    return {
      id: index + 1,
      seat: entry.seat,
      kind: entry.kind,
      x: px(x),
      y: px(y),
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      facing: 1,
      state: "idle",
      timer: 0,
      held: 0,
      attackBuf: 0,
      jumpBuf: 0,
      stopUntil: 0,
      struck: [],
      damage: 0,
      knockdowns: 0,
    };
  });
  return {
    seed: options.seed >>> 0,
    step: 0,
    rng: (options.seed ^ 0x5bd1e995) >>> 0,
    nextId: heroes.length + 1,
    camX: 0,
    heroes,
    enemies: [],
    fx: [],
  };
}

/** Turns an enemy toward the hero nearest it along the road plus in depth (the first in id order on a tie). */
export function faceNearest(world: World, enemy: Enemy): void {
  let nearest: Hero | undefined,
    best = Infinity;
  for (const hero of world.heroes) {
    const distance = Math.abs(hero.x - enemy.x) + Math.abs(hero.y - enemy.y);
    if (distance < best) [nearest, best] = [hero, distance];
  }
  // One straight above or below it in depth keeps its facing.
  if (nearest && nearest.x !== enemy.x)
    enemy.facing = nearest.x > enemy.x ? 1 : -1;
}

/**
 * A new world with one more enemy standing at (`x`, `y`) in sub-units, its depth held to the floor band, facing the
 * nearest hero. It takes the world's next id, so enemies stay in id order; the world passed in is left untouched.
 */
export function spawnEnemy(
  world: World,
  kind: EnemyKind,
  x: number,
  y: number,
): World {
  const enemy: Enemy = {
    id: world.nextId,
    kind,
    x,
    y: clamp(y, FLOOR_TOP, FLOOR_BOTTOM),
    z: 0,
    vx: 0,
    vz: 0,
    facing: -1,
    hp: ENEMY_HP[kind],
    state: "idle",
    timer: 0,
    stopUntil: 0,
  };
  faceNearest(world, enemy);
  return {
    ...world,
    nextId: world.nextId + 1,
    enemies: [...world.enemies, enemy],
  };
}
