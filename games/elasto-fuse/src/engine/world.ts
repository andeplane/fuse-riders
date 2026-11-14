import { resetBike, stepBike, DIED, FLOWER, type Bike } from "./bike.js";
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
  taken: number;
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
}
export interface World {
  /** Index into `LEVELS`. */
  level: number;
  phase: Phase;
  /** Countdown: steps until the start. */
  go: number;
  /** Steps raced since the start. */
  step: number;
  /** The race step it closes on: the time limit, pulled in once somebody finishes. */
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
    taken: 0,
    prev: 0,
    run: 0,
    wait: 0,
    deaths: 0,
    finish: 0,
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
  rider.taken = 0;
  rider.run = 0;
  rider.wait = 0;
}

/**
 * One step. `inputs[slot]` is what each rider holds; `present[slot]` is false for a rider nobody is steering (gone or
 * away), whose bike coasts and whom the race does not wait for.
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
  world.riders.forEach((rider, slot) => {
    const bits = inputs[slot] ?? 0,
      pressed = bits & ~rider.prev;
    rider.prev = bits;
    if (rider.status === FINISHED) return;
    if (rider.status === DEAD) {
      if (--rider.wait <= 0 || pressed & RESTART) restart(rider, level);
      return;
    }
    if (pressed & RESTART) {
      rider.deaths++;
      restart(rider, level);
      return;
    }
    rider.run++;
    const outcome = stepBike(level, rider.bike, bits, pressed, rider.taken);
    rider.taken = outcome.taken;
    if (outcome.flags & FLOWER) {
      rider.status = FINISHED;
      rider.finish = world.step;
      world.close = Math.min(world.close, world.step + T.RACE_GRACE);
    } else if (outcome.flags & DIED) {
      rider.status = DEAD;
      rider.wait = T.RESPAWN;
      rider.deaths++;
    }
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
    for (let bits = rider.taken; bits; bits &= bits - 1) count++;
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
