import { createWorld, stepWorld, type World } from "../../src/engine/index.js";
import * as T from "../../src/engine/tuning.js";

export const A = "blob-a",
  B = "blob-b";

/** A rally-scored match with `A` on the left and `B` on the right, its first serve hovering. */
export const fresh = (
  scoring: "rally" | "classic" = "rally",
  seed = 1234,
): World => createWorld([A, B], scoring, seed);

/** Steps `count` times holding `left` and `right`. */
export function steps(world: World, count: number, left = 0, right = 0): void {
  for (let i = 0; i < count; i++) stepWorld(world, [left, right]);
}

/** Steps until `done` holds, at most `limit` times; returns how many steps it took, or −1 if it never did. */
export function until(
  world: World,
  done: (world: World) => boolean,
  limit = 5000,
  left = 0,
  right = 0,
): number {
  for (let i = 0; i < limit; i++) {
    if (done(world)) return i;
    stepWorld(world, [left, right]);
  }
  return done(world) ? limit : -1;
}

/** The ball placed in flight at (x, y) px with speed (vx, vy) in ball units, gravity on, play running. */
export function rally(
  world: World,
  x: number,
  y: number,
  vx = 0,
  vy = 0,
): World {
  const ball = world.ball;
  ball.x = x * T.BU;
  ball.y = y * T.BU;
  ball.vx = vx;
  ball.vy = vy;
  ball.prevX = ball.x;
  ball.prevY = ball.y;
  ball.live = true;
  world.phase = "rally";
  world.phaseSteps = 0;
  return world;
}

/** A small seeded generator for scripted pilots. */
export function scripted(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
