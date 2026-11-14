import {
  resetBike,
  stepBike,
  validBike,
  DIED,
  FLOWER,
  type Bike,
} from "./bike.js";
import { RESTART } from "./input.js";
import { compile, type Compiled } from "./level.js";
import { LEVELS } from "./levels.js";
import * as T from "./tuning.js";

/**
 * One race on one level. Every rider has its own bike, its own apples and its own flower: riders share the track and
 * the clock but never touch, so a race is as many independent runs as it has riders, started together. A rider that
 * dies (or asks to restart) starts over at the start with its apples back while the race clock keeps running; the
 * first to the flower wins, and the race closes a while after that or when everyone present is home.
 */
export const RIDING = 0,
  DEAD = 1,
  FINISHED = 2;
export type Status = typeof RIDING | typeof DEAD | typeof FINISHED;
export const PHASES = ["countdown", "racing", "over"] as const;
export type Phase = (typeof PHASES)[number];

export interface Rider {
  id: string;
  status: Status;
  bike: Bike;
  /** The apples this run has eaten, one bit each in the level's apple order. */
  taken: bigint;
  /** The bits held on the previous step: what goes down on a step is what was not held before it. */
  prev: number;
  /** Steps the current run has lasted (the finishing run's length once finished). */
  run: number;
  /** Dead: steps until the rider is put back on the start. */
  wait: number;
  /** Runs ended by a crash or a restart. */
  deaths: number;
  /** The race step the rider reached the flower on; 0 until then. */
  finish: number;
  /**
   * Race steps this rider has run: its own clock. Riders never touch, so each runs on the clock of the device that
   * steers it; `stepWorld` moves them all together, an online room moves each as far as its device says it rode.
   */
  step: number;
}
export interface World {
  /** Index into `LEVELS`. */
  level: number;
  phase: Phase;
  /** Countdown: steps until the start. */
  go: number;
  /** Steps since the start on the race's own clock: what a rider's clock may not run far ahead of. */
  step: number;
  /** The step, on a rider's own clock, its race closes on: the time limit, pulled in once somebody finishes. */
  close: number;
  riders: Rider[];
}

export const isLevel = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= 0 &&
  (value as number) < LEVELS.length;
export const levelOf = (world: World): Compiled =>
  compile(LEVELS[world.level]!);

function freshRider(id: string, level: Compiled): Rider {
  return {
    id,
    status: RIDING,
    bike: resetBike(level),
    taken: 0n,
    prev: 0,
    run: 0,
    wait: 0,
    deaths: 0,
    finish: 0,
    step: 0,
  };
}

/** A race on `level` for `ids`, in slot order, `countdown` steps before its start. */
export function createWorld(
  ids: readonly string[],
  level: number,
  countdown: number = T.COUNTDOWN,
): World {
  if (ids.length < 1 || ids.length > T.CAPACITY)
    throw new Error("a race has one to five riders");
  if (!isLevel(level)) throw new Error("no such level");
  const prepared = compile(LEVELS[level]!);
  return {
    level,
    phase: countdown > 0 ? "countdown" : "racing",
    go: countdown,
    step: 0,
    close: T.RACE_LIMIT,
    riders: ids.map((id) => freshRider(id, prepared)),
  };
}

function restart(rider: Rider, level: Compiled): void {
  rider.status = RIDING;
  rider.bike = resetBike(level);
  rider.taken = 0n;
  rider.run = 0;
  rider.wait = 0;
}

/**
 * One step of one rider's own run with `bits` held. False when it runs no further: home, or its clock has reached
 * the race's close.
 */
export function stepRider(
  world: World,
  level: Compiled,
  slot: number,
  bits: number,
): boolean {
  const rider = world.riders[slot];
  if (!rider) return false;
  const pressed = bits & ~rider.prev;
  rider.prev = bits;
  if (rider.status === FINISHED || rider.step >= world.close) return false;
  rider.step++;
  if (rider.status === DEAD) {
    if (--rider.wait <= 0 || pressed & RESTART) restart(rider, level);
    return true;
  }
  if (pressed & RESTART) {
    rider.deaths++;
    restart(rider, level);
    return true;
  }
  rider.run++;
  const outcome = stepBike(level, rider.bike, bits, pressed, rider.taken);
  rider.taken = outcome.taken;
  if (outcome.flags & FLOWER) {
    rider.status = FINISHED;
    rider.finish = rider.step;
    world.close = Math.min(world.close, rider.step + T.RACE_GRACE);
  } else if (outcome.flags & DIED) {
    rider.status = DEAD;
    rider.wait = T.RESPAWN;
    rider.deaths++;
    // A bike flung out of the world waits at the start: where it flew to is no state a checkpoint may hold.
    if (!validBike(rider.bike)) rider.bike = resetBike(level);
  }
  return true;
}

/**
 * Runs the rider in `slot` on with `held` until its own clock reads `upTo`, or it runs no further. A rider's first
 * step starts from nothing held, whenever its device took the bits up: a bit held through the start is pressed on it.
 */
export function advanceRider(
  world: World,
  slot: number,
  upTo: number,
  held: number,
): void {
  const rider = world.riders[slot];
  if (!rider || world.phase === "over") return;
  const level = levelOf(world);
  while (rider.step < upTo && stepRider(world, level, slot, held));
}

/**
 * Closes a race whose riders run on their own clocks: once nobody `present` is still riding, or the race's own
 * clock is `CLOSE_LAG` past the close (a rider whose device stopped saying how far it rode is not waited for).
 */
export function settleRace(world: World, present: readonly boolean[]): void {
  if (world.phase !== "racing") return;
  const waiting = world.riders.some(
    (rider, slot) =>
      present[slot] === true &&
      rider.status !== FINISHED &&
      rider.step < world.close,
  );
  if (!waiting || world.step >= world.close + T.CLOSE_LAG) world.phase = "over";
}

/**
 * One step for everybody together. `inputs[slot]` is what each rider holds; `present[slot]` is false for a rider
 * nobody is steering (gone or away), whose bike coasts and whom the race does not wait for.
 */
export function stepWorld(
  world: World,
  inputs: readonly number[],
  present: readonly boolean[],
): void {
  if (world.phase === "over") return;
  if (world.phase === "countdown") {
    // Whatever is held through the countdown is held, not pressed, when the race starts.
    world.riders.forEach((rider, slot) => {
      rider.prev = inputs[slot] ?? 0;
    });
    if (--world.go <= 0) world.phase = "racing";
    return;
  }
  const level = levelOf(world);
  world.step++;
  world.riders.forEach((_, slot) => {
    stepRider(world, level, slot, inputs[slot] ?? 0);
  });
  const waiting = world.riders.some(
    (rider, slot) => rider.status !== FINISHED && present[slot] === true,
  );
  if (world.step >= world.close || !waiting) world.phase = "over";
}

/** Riders by slot in finishing order: home first by the step they got there (then slot), the rest by apples eaten. */
export function ranking(world: World): number[] {
  const apples = (rider: Rider) => {
    let count = 0;
    for (let bits = rider.taken; bits; bits &= bits - 1n) count++;
    return count;
  };
  return world.riders
    .map((_, slot) => slot)
    .sort((a, b) => {
      const ra = world.riders[a]!,
        rb = world.riders[b]!;
      if (ra.finish > 0 !== rb.finish > 0) return ra.finish > 0 ? -1 : 1;
      if (ra.finish !== rb.finish) return ra.finish - rb.finish;
      if (ra.finish === 0 && apples(ra) !== apples(rb))
        return apples(rb) - apples(ra);
      return a - b;
    });
}
