import {
  createWorld,
  stepWorld,
  type MapId,
  type Slot,
  type World,
} from "../../src/engine/index.js";
import { SUB } from "../../src/engine/math.js";

export const A = "rider-a",
  B = "rider-b";

/** A match on `mapId` with riders `A` (slot 0, left) and `B` (slot 1, right), still in its first countdown. */
export const fresh = (mapId: MapId = "gridlock"): World =>
  createWorld(mapId, [A, B]);

/** The same match past its countdown, nothing held. */
export function playing(mapId: MapId = "gridlock"): World {
  const world = fresh(mapId);
  while (world.phase === "countdown") stepWorld(world, new Map());
  return world;
}

export const held = (a: number, b: number = 0): ReadonlyMap<string, number> =>
  new Map([
    [A, a],
    [B, b],
  ]);

export function steps(
  world: World,
  count: number,
  inputs: ReadonlyMap<string, number> = new Map(),
): void {
  for (let i = 0; i < count; i++) stepWorld(world, inputs);
}

/** Steps until `done` holds, at most `limit` times; returns how many steps it took, or −1 if it never did. */
export function until(
  world: World,
  done: () => boolean,
  inputs: ReadonlyMap<string, number> = new Map(),
  limit = 2000,
): number {
  for (let i = 1; i <= limit; i++) {
    stepWorld(world, inputs);
    if (done()) return i;
  }
  return -1;
}

/** Puts a rider at `(x, y)` pixels, still and in the air. */
export function place(world: World, slot: Slot, x: number, y: number): void {
  const rider = world.riders[slot];
  rider.x = x * SUB;
  rider.y = y * SUB;
  rider.vx = 0;
  rider.vy = 0;
  rider.grounded = false;
  rider.slide = 0;
}

/** Puts the ball at `(x, y)` pixels with a speed in pixels per step. */
export function ballAt(
  world: World,
  x: number,
  y: number,
  vx = 0,
  vy = 0,
): void {
  world.ball.x = x * SUB;
  world.ball.y = y * SUB;
  world.ball.vx = vx * SUB;
  world.ball.vy = vy * SUB;
}

/** A coordinate in pixels, for readable assertions. */
export const at = (value: number): number => value / SUB;

/** A small integer generator for input scripts: a test's own, never the engine's. */
export function scripted(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 8;
  };
}
