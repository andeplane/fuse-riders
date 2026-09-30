import { starts } from "./arena.js";
import { hash, next } from "./rng.js";
import { straightTrail } from "./trail.js";
import { spawnCart } from "./cargo.js";
import * as T from "./tuning.js";

/**
 * One round's world: plain integer data, so the netcode can clone, hash and checkpoint it. Positions are floor
 * sub-units; a train's wagons are not stored, only the path its locomotive laid (`trail.ts`), so a wagon's place is
 * always where the locomotive was.
 */
export const PHASES = ["countdown", "play", "outro"] as const;
export type Phase = (typeof PHASES)[number];

/** What happened, for the screen's particles and sounds, keyed by what, who, when and where (never by `id`). */
export const FX = {
  collect: 0,
  cut: 1,
  deliver: 2,
  bump: 3,
  wall: 4,
  spawn: 5,
  scrap: 6,
} as const;
export const FX_KINDS = Object.keys(FX).length;

export interface Train {
  id: string;
  slot: number;
  /** The locomotive's centre. */
  x: number;
  y: number;
  /** Heading, 0 … DIRS − 1. */
  dir: number;
  /** Each coupled wagon's cargo kind, front first. */
  cargo: number[];
  /** The path behind the locomotive, `TRAIL` crumbs `CRUMB` apart, newest first, as x, y pairs. */
  trail: number[];
  /** Path length from the newest crumb to the locomotive, below `CRUMB`. */
  odo: number;
  /** Bits held this step. */
  input: number;
  /** Steps its wagons cannot be cut, after a cut. */
  guard: number;
  /** Steps until a bump or a wall knock makes a new effect. */
  bump: number;
  /** Wagons delivered this round: the score. */
  score: number;
  collected: number;
  deliveries: number;
  /** Rival wagons it cut loose, and its own wagons others cut loose. */
  stolen: number;
  lost: number;
}

/** A loose cart anyone can collect once `cool` has run out. */
export interface Cart {
  id: number;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  cool: number;
}

export interface Fx {
  id: number;
  at: number;
  kind: number;
  x: number;
  y: number;
  /** The train it belongs to (the thief for a cut), or −1. */
  slot: number;
  /** A count or a kind: wagons delivered or cut, a cart's cargo. */
  data: number;
  /** A second train (the victim of a cut) or a dock, else −1. */
  other: number;
}

export interface World {
  seed: number;
  /** Steps of play in the round. */
  length: number;
  /** Steps since the round was created. */
  step: number;
  phase: Phase;
  phaseAt: number;
  rng: number;
  nextId: number;
  /** When the next cart may be delivered to the floor. */
  spawnAt: number;
  trains: Train[];
  carts: Cart[];
  fx: Fx[];
}

export interface Entrant {
  id: string;
  slot: number;
}

export function createTrain(
  id: string,
  slot: number,
  x: number,
  y: number,
  dir: number,
): Train {
  return {
    id,
    slot,
    x,
    y,
    dir,
    cargo: [],
    trail: straightTrail(x, y, dir),
    odo: 0,
    input: 0,
    guard: 0,
    bump: 0,
    score: 0,
    collected: 0,
    deliveries: 0,
    stolen: 0,
    lost: 0,
  };
}

/** A new round: trains on their start places, each with a cart ahead of it, and a few more carts about the floor. */
export function createWorld(
  seed: number,
  entrants: readonly Entrant[],
  rules: { seconds: number },
): World {
  const sorted = [...entrants].sort((a, b) => a.slot - b.slot);
  const places = starts(seed >>> 0, sorted.length);
  const world: World = {
    seed: seed >>> 0,
    length: rules.seconds * T.STEPS_PER_SECOND,
    step: 0,
    phase: "countdown",
    phaseAt: 0,
    rng: (seed ^ 0x5bd1e995) >>> 0,
    nextId: 1,
    spawnAt: T.COUNTDOWN_STEPS + T.SPAWN_EVERY,
    trains: sorted.map((entrant, index) => {
      const place = places[index]!;
      return createTrain(entrant.id, entrant.slot, place.x, place.y, place.dir);
    }),
    carts: [],
    fx: [],
  };
  places.forEach((place, index) =>
    world.carts.push({
      id: world.nextId++,
      kind: hash(world.seed, index) % T.CARGO_KINDS,
      x: place.cartX,
      y: place.cartY,
      vx: 0,
      vy: 0,
      cool: 0,
    }),
  );
  for (let extra = 0; extra < sorted.length + 2; extra++)
    spawnCart(world, false);
  return world;
}

/** A value in 0 … n − 1 from the world's stream. */
export function random(world: World, n: number): number {
  const step = next(world.rng);
  world.rng = step.state;
  return step.value % n;
}

export function effect(
  world: World,
  kind: number,
  x: number,
  y: number,
  slot = -1,
  data = 0,
  other = -1,
): void {
  world.fx.push({
    id: world.nextId++,
    at: world.step,
    kind,
    x,
    y,
    slot,
    data,
    other,
  });
  if (world.fx.length > T.MAX_FX) world.fx.shift();
}

/** The round's play steps so far. */
export const played = (world: World): number =>
  world.phase === "countdown"
    ? 0
    : Math.min(world.length, world.step - T.COUNTDOWN_STEPS);
