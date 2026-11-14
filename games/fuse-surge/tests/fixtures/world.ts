import {
  DEFAULT_RULES,
  STEPS_PER_TICK,
  createWorld,
  stepWorld,
  type Kind,
  type Rules,
  type Surge,
  type World,
} from "../../src/engine/index.js";
import * as T from "../../src/engine/tuning.js";

export const A = "rider-a",
  B = "rider-b";

/** A match for `A` and `B` (and more ids when given), in its first countdown. */
export const fresh = (
  rules: Partial<Rules> = {},
  seed = 1234,
  ids: readonly string[] = [A, B],
): World => createWorld(ids, { ...DEFAULT_RULES, ...rules }, seed);

/** Steps `count` times with every slot's held bits; a slot left out holds nothing. */
export function steps(
  world: World,
  count: number,
  ...bits: readonly number[]
): void {
  for (let i = 0; i < count; i++) stepWorld(world, bits);
}

/** Steps until `done` holds, at most `limit` times; returns how many steps it took, or −1 if it never did. */
export function until(
  world: World,
  done: (world: World) => boolean,
  limit = 20000,
  ...bits: readonly number[]
): number {
  for (let i = 0; i < limit; i++) {
    if (done(world)) return i;
    stepWorld(world, bits);
  }
  return done(world) ? limit : -1;
}

/** A match with its countdown over and no surge due for a long while: a quiet deck to place things on. */
export function playing(
  rules: Partial<Rules> = {},
  ids: readonly string[] = [A, B],
): World {
  const world = fresh(rules, 1234, ids);
  steps(world, T.READY_STEPS);
  // Past the checkpoint's bound on purpose: these tests place their own surges and never encode this world.
  world.nextSpawn = 1_000_000;
  return world;
}

/** Puts a surge on the deck `ahead` px in front of the start line. */
export function surge(
  world: World,
  kind: Kind,
  ahead = 60,
  more: Partial<Surge> = {},
): Surge {
  const added: Surge = {
    id: world.nextId++,
    kind,
    flip: false,
    x: T.START_X + ahead * T.U,
    done: 0,
    hit: 0,
    ...more,
  };
  world.surges.push(added);
  return added;
}

/** Plays whole log ticks with `answer` asked once a tick, as the room's fold asks a bot, until `done` or `ticks`. */
export function ticks(
  world: World,
  count: number,
  answer: (world: World, slot: number) => number,
  done: (world: World) => boolean = () => false,
): number {
  for (let tick = 0; tick < count; tick++) {
    if (done(world)) return tick;
    const bits = world.riders.map((_, slot) => answer(world, slot));
    for (let i = 0; i < STEPS_PER_TICK; i++) stepWorld(world, bits);
  }
  return count;
}

/** A seeded generator for tests' own scripts. */
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
