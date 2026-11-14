import { BTN } from "./input.js";
import { SUB } from "./math.js";
import { mapOf, type MapId } from "./maps.js";
import { COUNTDOWN_STEPS, SPEED_FULL } from "./tuning.js";

/**
 * One match's world: plain integer data, so the netcode can clone, hash and checkpoint it. Positions are sub-units,
 * centre of the body, always inside the field. The arena itself is fixed data in `maps.ts`, found by `mapId`.
 */
export const PHASES = ["countdown", "play", "zap", "over"] as const;
export type Phase = (typeof PHASES)[number];
export type Slot = 0 | 1;

export interface Rider {
  id: string;
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
  /** Whose rider or bubble last sent it, or −1 for nobody (or both at once). */
  touch: -1 | Slot;
}

export interface World {
  mapId: MapId;
  /** Micro-steps simulated so far. */
  step: number;
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
  riders: [Rider, Rider];
  bubbles: [Bubble, Bubble];
  ball: Ball;
}

const rider = (id: string, slot: Slot): Rider => ({
  id,
  slot,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  facing: slot === 0 ? 1 : -1,
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
  const map = mapOf(world.mapId);
  for (const r of world.riders) {
    const spawn = map.spawns[r.slot];
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
  world.phase = "countdown";
  world.phaseSteps = COUNTDOWN_STEPS;
  world.speed = SPEED_FULL;
  world.budget = 0;
  world.linger = 0;
  world.freeze = 0;
}

/** A new match on `mapId` at 0–0, in its first countdown; `ids[0]` rides in slot 0, on the left. */
export function createWorld(
  mapId: MapId,
  ids: readonly [string, string],
): World {
  const world: World = {
    mapId,
    step: 0,
    phase: "countdown",
    phaseSteps: COUNTDOWN_STEPS,
    score: [0, 0],
    lastScorer: -1,
    suddenDeath: false,
    speed: SPEED_FULL,
    budget: 0,
    linger: 0,
    freeze: 0,
    riders: [rider(ids[0], 0), rider(ids[1], 1)],
    bubbles: [bubble(), bubble()],
    ball: { x: 0, y: 0, vx: 0, vy: 0, live: true, bounces: 0, touch: -1 },
  };
  resetPoint(world);
  return world;
}

/** A world of its own with the same state: what is done to the copy leaves the original alone. */
export function copyWorld(world: World): World {
  const [a, b] = world.riders,
    [p, q] = world.bubbles;
  return {
    ...world,
    score: [world.score[0], world.score[1]],
    riders: [{ ...a }, { ...b }],
    bubbles: [{ ...p }, { ...q }],
    ball: { ...world.ball },
  };
}
