import {
  createWorld,
  stepWorld,
  type Train,
  type World,
} from "../../src/engine/index.js";
import { SUB, px } from "../../src/engine/math.js";
import { straightTrail } from "../../src/engine/trail.js";

/**
 * A world past its countdown with `count` trains `t0`, `t1`… in slots 0, 1…, and no loose carts unless a test adds
 * them, so nothing happens that the test did not set up. `seconds` is the round's length.
 */
export function playing(count = 1, seed = 7, seconds = 75): World {
  const world = createWorld(
    seed,
    Array.from({ length: count }, (_, slot) => ({ id: `t${slot}`, slot })),
    { seconds },
  );
  while (world.phase === "countdown") stepWorld(world, new Map());
  world.carts = [];
  world.fx = [];
  // Nothing new arrives on its own while a test runs.
  world.spawnAt = Number.MAX_SAFE_INTEGER;
  return world;
}

export const train = (world: World, id: string): Train =>
  world.trains.find((t) => t.id === id)!;

/**
 * Puts a train at `(x, y)` pixels heading `dir`, with `wagons` coupled straight behind it (cargo kinds 0, 1, 2…).
 */
export function place(
  world: World,
  id: string,
  x: number,
  y: number,
  dir: number,
  wagons = 0,
): Train {
  const t = train(world, id);
  t.x = px(x);
  t.y = px(y);
  t.dir = dir;
  t.trail = straightTrail(t.x, t.y, dir);
  t.odo = 0;
  t.cargo = Array.from({ length: wagons }, (_, i) => i % 4);
  t.guard = 0;
  t.bump = 0;
  return t;
}

/** A loose cart at `(x, y)` pixels. */
export function cart(world: World, x: number, y: number, kind = 0, cool = 0) {
  const made = {
    id: world.nextId++,
    kind,
    x: px(x),
    y: px(y),
    vx: 0,
    vy: 0,
    cool,
  };
  world.carts.push(made);
  return made;
}

export function steps(
  world: World,
  count: number,
  inputs:
    | ReadonlyMap<string, number>
    | (() => ReadonlyMap<string, number>) = new Map(),
): void {
  for (let i = 0; i < count; i++)
    stepWorld(world, typeof inputs === "function" ? inputs() : inputs);
}

export const held = (entries: Record<string, number>) =>
  new Map(Object.entries(entries));

/** Sub-units as pixels, for readable assertions. */
export const at = (value: number): number => value / SUB;

/** Headings: right, down, left, up. */
export const EAST = 0,
  SOUTH = 256,
  WEST = 512,
  NORTH = 768;
