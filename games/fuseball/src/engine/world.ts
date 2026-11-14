import { BTN } from "./input.js";
import { SUB } from "./math.js";
import { freshBarriers, type BarrierState } from "./gadgets.js";
import {
  RANDOM,
  arenaOf,
  isSeed,
  mapOf,
  type MapDef,
  type MapId,
} from "./maps.js";
import { COUNTDOWN_STEPS, SPEED_FULL } from "./tuning.js";

/**
 * One match's world: plain integer data, so the netcode can clone, hash and checkpoint it. Positions are sub-units,
 * centre of the body, always inside the field. The arena itself is fixed data in `maps.ts`, found by `mapId`, or,
 * for the random one, the level `generate.ts` rolls from `seed`.
 */
export const PHASES = ["countdown", "play", "zap", "over"] as const;
export type Phase = (typeof PHASES)[number];
/** A side of the arena and its colour: 0 starts on the left, 1 on the right. A duel has one rider a side. */
export type Slot = 0 | 1;

/** Two or more of something: a match always has a rider on each side. */
export type Several<T> = [T, T, ...T[]];
export function several<T>(list: T[]): Several<T> {
  const [first, second, ...rest] = list;
  if (first === undefined || second === undefined)
    throw new Error("A match needs a rider on each side");
  return [first, second, ...rest];
}

export interface Rider {
  id: string;
  /** This rider's place in `World.riders`, and their bubble's in `World.bubbles`. */
  index: number;
  /** The side this rider plays for: `index % 2`, so the sides take turns down the list. */
  slot: Slot;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: -1 | 1;
  /** Standing on a solid as of the last step. */
  grounded: boolean;
  /** The bits held on the step before: a press is a bit held now and not then. */
  prev: number;
  /** Steps left of a power slide, or 0. */
  slide: number;
  /** Disintegrated by the other side's goal: no control and no collisions until the point resets. */
  zapped: boolean;
  /** Counters for the presentation and the result: they never feed back into the rules. */
  jumps: number;
  /** Opposing bubbles this rider popped by touch. */
  pops: number;
  /** Points this rider's side scored that were not the other rider's own goals. */
  goals: number;
  /** Points this rider gave away by sending the ball into the other colour's goal. */
  ownGoals: number;
}

/** A rider's one bubble: a fixed round bumper where they last air-jumped. */
export interface Bubble {
  active: boolean;
  x: number;
  y: number;
  /** The owner has kept the button held since placing it: nothing pops it. */
  hard: boolean;
  /** Bubbles this rider has placed; it changes with every new one. */
  seq: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** False once it is in a goal, until the next point. */
  live: boolean;
  /** Bounces, kicks and bumps so far, for the presentation. */
  bounces: number;
  /** The place in `World.riders` of whoever last sent it, themselves or by their bubble; −1 for nobody (or several at once). */
  touch: number;
}

export interface World {
  mapId: MapId;
  /** The seed of a rolled level: any unsigned 32-bit integer when `mapId` is the random one, otherwise 0. */
  seed: number;
  /** Micro-steps simulated so far. */
  step: number;
  /**
   * Micro-steps this point has been in motion: it starts at 0 with the point and stands still through the countdown
   * and a goal's freeze, when nothing moves. The arena's movers are where this says they are.
   */
  clock: number;
  phase: Phase;
  /** Steps left of the countdown or the zap; 0 in play and when the match is over. */
  phaseSteps: number;
  score: [number, number];
  lastScorer: -1 | Slot;
  /** Both sides are one point from winning (or were, when the last point was scored). */
  suddenDeath: boolean;
  /**
   * The arena's pace, set once per log tick by `paceTick`: its speed in 1/256ths of full speed (0 while a goal's
   * freeze lasts), and what is left over, in 1/256ths of a micro-step, of the steps the ticks so far were owed.
   */
  speed: number;
  budget: number;
  /** Log ticks the speed still holds where it is after the ball has left a cloud. */
  linger: number;
  /** Micro-steps left of the freeze that follows a goal; nothing moves while it lasts. */
  freeze: number;
  /** Two, four or six riders: a duel, 2v2 or 3v3. Even places ride for side 0, odd for side 1. */
  riders: Several<Rider>;
  /** Each rider's one bubble, in the riders' order. */
  bubbles: Several<Bubble>;
  ball: Ball;
  /** The state of the map's barriers (force fields and gates), in the map's order; every point starts them afresh. */
  barriers: BarrierState[];
}

const rider = (id: string, index: number): Rider => ({
  id,
  index,
  slot: index % 2 === 0 ? 0 : 1,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  facing: index % 2 === 0 ? 1 : -1,
  grounded: true,
  prev: BTN,
  slide: 0,
  zapped: false,
  jumps: 0,
  pops: 0,
  goals: 0,
  ownGoals: 0,
});
const bubble = (): Bubble => ({
  active: false,
  x: 0,
  y: 0,
  hard: false,
  seq: 0,
});

/** Riders back on their marks, the ball on its anchor, bubbles gone, and the countdown running. */
export function resetPoint(world: World): void {
  const map = arenaOf(world);
  for (const r of world.riders) {
    const spawn = map.spawns[r.index] ?? map.spawns[r.slot];
    r.x = spawn.x * SUB;
    r.y = spawn.y * SUB;
    r.vx = 0;
    r.vy = 0;
    r.facing = r.slot === 0 ? 1 : -1;
    r.grounded = true;
    // A button still held when the countdown ends is not a fresh press.
    r.prev = BTN;
    r.slide = 0;
    r.zapped = false;
  }
  for (const b of world.bubbles) {
    b.active = false;
    b.hard = false;
  }
  const ball = world.ball;
  ball.x = map.ballAnchor.x * SUB;
  ball.y = map.ballAnchor.y * SUB;
  ball.vx = 0;
  ball.vy = 0;
  ball.live = true;
  ball.touch = -1;
  world.barriers = freshBarriers(map);
  world.clock = 0;
  world.phase = "countdown";
  world.phaseSteps = COUNTDOWN_STEPS;
  world.speed = SPEED_FULL;
  world.budget = 0;
  world.linger = 0;
  world.freeze = 0;
}

/** How many riders a match on `map` may have: two at least, an even number, and no more than it has marks for. */
export const fits = (map: MapDef, riders: number): boolean =>
  riders >= 2 && riders % 2 === 0 && riders <= map.spawns.length;

/**
 * A new match on `mapId` at 0–0, in its first countdown; `ids` are the riders in order, the sides taking turns, so
 * `ids[0]` rides on the left and `ids[1]` on the right. `seed` picks the level when the map is the random one, and
 * is not kept otherwise. It throws when the arena has no marks for that many riders.
 */
export function createWorld(
  mapId: MapId,
  ids: readonly string[],
  seed = 0,
): World {
  if (!fits(mapOf(mapId, seed), ids.length))
    throw new Error(`${mapId} does not seat ${ids.length} riders`);
  const world: World = {
    mapId,
    seed: mapId === RANDOM && isSeed(seed) ? seed : 0,
    step: 0,
    clock: 0,
    phase: "countdown",
    phaseSteps: COUNTDOWN_STEPS,
    score: [0, 0],
    lastScorer: -1,
    suddenDeath: false,
    speed: SPEED_FULL,
    budget: 0,
    linger: 0,
    freeze: 0,
    riders: several(ids.map(rider)),
    bubbles: several(ids.map(bubble)),
    ball: { x: 0, y: 0, vx: 0, vy: 0, live: true, bounces: 0, touch: -1 },
    barriers: [],
  };
  resetPoint(world);
  return world;
}

/** A world of its own with the same state: what is done to the copy leaves the original alone. */
export function copyWorld(world: World): World {
  return {
    ...world,
    score: [world.score[0], world.score[1]],
    riders: several(world.riders.map((each) => ({ ...each }))),
    bubbles: several(world.bubbles.map((each) => ({ ...each }))),
    ball: { ...world.ball },
    barriers: world.barriers.map((barrier) => ({ ...barrier })),
  };
}
