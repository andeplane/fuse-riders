import { div } from "./math.js";
import * as T from "./tuning.js";

/**
 * A match of Fuse Surge: riders side by side on a deck, each in its own lane, and surges sweeping the deck toward
 * the edge. A low surge is jumped, a high one ducked; a hit throws a rider one foothold back, and the last foothold
 * is the pit. A match is rounds: the last rider standing takes one, riders still up when the clock runs out share
 * it, and the first to `target` wins takes the match.
 */
export const PHASES = ["ready", "play", "break", "over"] as const;
export type Phase = (typeof PHASES)[number];
/** How a round ended: one rider left, the clock ran out, or the last riders fell together. */
export const REASONS = ["none", "last", "time", "wipe"] as const;
export type Reason = (typeof REASONS)[number];
export type Pace = 0 | 1 | 2;
export const PACES: readonly Pace[] = [0, 1, 2];
export const isPace = (value: unknown): value is Pace =>
  value === 0 || value === 1 || value === 2;
export const LOW = 0,
  HIGH = 1;
export type Kind = typeof LOW | typeof HIGH;

/** What a match plays by, fixed when it starts. */
export interface Rules {
  /** Hits that put a rider in the pit. */
  hits: number;
  /** A round's clock, seconds. */
  seconds: number;
  pace: Pace;
  /** Round wins that take the match. */
  target: number;
  /** Five clean dodges in a row win a foothold back. */
  recover: boolean;
}
const whole = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= low &&
  value <= high;
export const isHits = (value: unknown): value is number =>
  whole(value, T.MIN_HITS, T.MAX_HITS);
export const isSeconds = (value: unknown): value is number =>
  whole(value, T.MIN_SECONDS, T.MAX_SECONDS);
export const isTarget = (value: unknown): value is number =>
  whole(value, T.MIN_TARGET, T.MAX_TARGET);
export const DEFAULT_RULES: Rules = {
  hits: T.DEFAULT_HITS,
  seconds: T.DEFAULT_SECONDS,
  pace: 1,
  target: T.DEFAULT_TARGET,
  recover: true,
};

export interface Rider {
  id: string;
  x: number;
  /** Height of the feet above the deck; below zero once it is falling into the pit. */
  y: number;
  vy: number;
  duck: boolean;
  /** Jump was held on the last step: a press is the change. */
  jumpHeld: boolean;
  /** Steps a jump press still waits for the deck. */
  buffer: number;
  /** Hits taken this round: the foothold it stands on. */
  hits: number;
  /** Knocked into the pit this round. */
  out: boolean;
  /** Steps of being thrown back left; nothing strikes a reeling rider. */
  reel: number;
  /** Steps after reeling in which nothing strikes. */
  grace: number;
  /** Clean dodges in a row, up to `STREAK_FOR_STEP`. */
  streak: number;
  /** The match so far: rounds won, surges dodged and hits taken. */
  wins: number;
  dodges: number;
  taken: number;
}

export interface Surge {
  id: number;
  kind: Kind;
  /** It changes height when it crosses the gate. */
  flip: boolean;
  x: number;
  /** Bit per rider slot: it is settled for that rider, and it struck that rider. */
  done: number;
  hit: number;
}

export interface World {
  seed: number;
  step: number;
  phase: Phase;
  /** Steps of the countdown or the break left; 0 while a round plays. */
  phaseSteps: number;
  /** The round being played, from 1. */
  round: number;
  /** Steps this round has played. */
  clock: number;
  rules: Rules;
  rng: number;
  /** Steps until the next surge. */
  nextSpawn: number;
  nextId: number;
  /** The height of the last surge spawned and how many of it came in a row. */
  runKind: Kind;
  run: number;
  riders: Rider[];
  surges: Surge[];
  /** The last round's winners, a bit per slot, and how it ended. */
  lastWinners: number;
  lastReason: Reason;
  /** The match's winners once it is over, a bit per slot. */
  winners: number;
  /** Hits this match: the presentation's cue. */
  hitCounter: number;
}

export const isPlayerCount = (count: number): boolean =>
  Number.isInteger(count) && count >= T.MIN_RIDERS && count <= T.CAPACITY;

/** The foothold a rider with `hits` stands on: evenly spaced from the start line back to the last one. */
export function footholdX(hits: number, maxHits: number): number {
  if (hits <= 0 || maxHits <= 1) return T.START_X;
  if (hits >= maxHits) return T.OUT_X;
  return T.START_X - div(hits * (T.START_X - T.LAST_X), maxHits - 1);
}

/** The surges' speed, units per step, `clock` steps into a round. */
export const speedAt = (clock: number, pace: Pace): number => {
  const speed = T.SPEED_BASE[pace] + div(clock * T.SPEED_RAMP[pace], 1000);
  return speed > T.SPEED_MAX ? T.SPEED_MAX : speed;
};
/** Steps between surges `clock` steps into a round, before the jitter. */
export const gapAt = (clock: number, pace: Pace): number => {
  const gap = T.GAP_BASE[pace] - div(clock * T.GAP_SHRINK[pace], 1000);
  return gap < T.GAP_MIN[pace] ? T.GAP_MIN[pace] : gap;
};
/** A round's clock in steps. */
export const limitOf = (rules: Rules): number =>
  rules.seconds * T.STEPS_PER_SECOND;

const freshRider = (id: string): Rider => ({
  id,
  x: T.START_X,
  y: 0,
  vy: 0,
  duck: false,
  jumpHeld: false,
  buffer: 0,
  hits: 0,
  out: false,
  reel: 0,
  grace: 0,
  streak: 0,
  wins: 0,
  dodges: 0,
  taken: 0,
});

/** Puts everyone back on the start line for round `round`; what is held stays held, and the match's counts stay. */
export function startRound(world: World, round: number): void {
  world.round = round;
  world.phase = "ready";
  world.phaseSteps = T.READY_STEPS;
  world.clock = 0;
  world.nextSpawn = T.FIRST_SPAWN;
  world.run = 0;
  world.runKind = LOW;
  world.surges = [];
  for (const rider of world.riders) {
    rider.x = T.START_X;
    rider.y = 0;
    rider.vy = 0;
    rider.duck = false;
    rider.buffer = 0;
    rider.hits = 0;
    rider.out = false;
    rider.reel = 0;
    rider.grace = 0;
    rider.streak = 0;
  }
}

/** A match for `ids` in slot order (two to five of them), in its first countdown. */
export function createWorld(
  ids: readonly string[],
  rules: Rules,
  seed: number,
): World {
  if (!isPlayerCount(ids.length))
    throw new Error("Fuse Surge plays with two to five riders");
  const world: World = {
    seed: seed >>> 0 || 1,
    step: 0,
    phase: "ready",
    phaseSteps: T.READY_STEPS,
    round: 1,
    clock: 0,
    rules: { ...rules },
    rng: seed >>> 0 || 1,
    nextSpawn: T.FIRST_SPAWN,
    nextId: 1,
    runKind: LOW,
    run: 0,
    riders: ids.map(freshRider),
    surges: [],
    lastWinners: 0,
    lastReason: "none",
    winners: 0,
    hitCounter: 0,
  };
  return world;
}

/** A copy that shares nothing with `world`: the forward run and the bots step copies. */
export function cloneWorld(world: World): World {
  return {
    ...world,
    rules: { ...world.rules },
    riders: world.riders.map((rider) => ({ ...rider })),
    surges: world.surges.map((surge) => ({ ...surge })),
  };
}

/** The slots a bit mask names, in order. */
export function slotsOf(mask: number, count: number): number[] {
  const slots: number[] = [];
  for (let slot = 0; slot < count; slot++)
    if (mask & (1 << slot)) slots.push(slot);
  return slots;
}
