import { BTN } from "./input.js";
import { barrierUp } from "./gadgets.js";
import { mapOf, type MapId } from "./maps.js";
import { SUB } from "./math.js";
import { slowed, winnerOf } from "./step.js";
import { SPEED_FULL, STEPS_PER_SECOND, TARGET } from "./tuning.js";
import type { Phase, Slot, World } from "./world.js";

/**
 * What the presentation sees of a match: positions in pixels on the 640×360 field (fractions allowed), speeds in
 * pixels per micro-step, timers in micro-steps. The arena is not here: the renderer reads it from `view-kit.ts` by
 * `mapId`. Effects are the presentation's own, driven by the counters (`jumps`, `pops`, `seq`, `bounces`) changing
 * between two views; a rollback that replays a step leaves a counter where it was, so nothing is drawn twice.
 *
 * On an axis that wraps, a body jumps from one edge to the other between two views: interpolate the short way round.
 */
export interface RiderView {
  id: string;
  slot: Slot;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: -1 | 1;
  grounded: boolean;
  sliding: boolean;
  /** Disintegrated by the other side's goal, until the next point. */
  zapped: boolean;
  /** Holding the button down as of this step. */
  holding: boolean;
  /** Jumps, air-jumps and quick drops so far (wraps at 65536). */
  jumps: number;
  /** Opposing bubbles popped by touch. */
  pops: number;
  goals: number;
  ownGoals: number;
}
export interface BubbleView {
  /** The owner's slot: the bubble wears that side's colour. */
  slot: Slot;
  active: boolean;
  /** Held hard by its owner: draw the second ring. */
  hard: boolean;
  /** Where it is, or where it last was once popped. */
  x: number;
  y: number;
  /** Bubbles this rider has placed (wraps at 65536): a change is a new bubble. */
  seq: number;
}
export interface BallView {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** False from the moment it enters a goal until the next point: hide it. */
  live: boolean;
  /** Bounces, kicks, lifts and bumps so far (wraps at 65536). */
  bounces: number;
  /** Whose rider or bubble last sent it, or −1. */
  touch: -1 | Slot;
}
export interface WorldView {
  mapId: MapId;
  step: number;
  phase: Phase;
  /** Micro-steps left of the countdown or the zap; 0 in play and once the match is over. */
  remaining: number;
  /** The number the countdown shows, 3, 2 or 1; 0 outside it. */
  count: number;
  score: [number, number];
  /** Points that win the match. */
  target: number;
  /** Who scored the last point, or −1 before the first: in the zap, the beam runs from their goal to the other rider. */
  lastScorer: -1 | Slot;
  /** The slot that won, or −1 while the match is undecided. */
  winner: -1 | Slot;
  /** Both sides are one point from winning: the point being played (or just played) is sudden death. */
  suddenDeath: boolean;
  /** The ball is in a cloud: the arena is slowing down, or already slow. */
  slow: boolean;
  /** The arena's speed as a fraction of full speed: 1 normally, less in slow motion, 0 while a goal's freeze lasts. */
  speed: number;
  /** A goal has just been scored and nothing moves yet: draw the ball where it went in. */
  frozen: boolean;
  riders: [RiderView, RiderView];
  bubbles: [BubbleView, BubbleView];
  ball: BallView;
  /** The map's barriers, in the map's order (`MapDef.barriers` has where they are). */
  barriers: BarrierView[];
}
export interface BarrierView {
  /** It stands in the ball's way: a field not yet broken, a gate that is shut. */
  up: boolean;
  /** A field: strikes left until it breaks. A gate: 0. */
  left: number;
  /** A field: micro-steps since it was last struck that it still glows for. A gate: micro-steps it stays open. */
  timer: number;
}

const riderView = (world: World, slot: Slot): RiderView => {
  const r = world.riders[slot];
  return {
    id: r.id,
    slot,
    x: r.x / SUB,
    y: r.y / SUB,
    vx: r.vx / SUB,
    vy: r.vy / SUB,
    facing: r.facing,
    grounded: r.grounded,
    sliding: r.slide > 0,
    zapped: r.zapped,
    holding: (r.prev & BTN) !== 0 && world.phase !== "countdown",
    jumps: r.jumps,
    pops: r.pops,
    goals: r.goals,
    ownGoals: r.ownGoals,
  };
};
const bubbleView = (world: World, slot: Slot): BubbleView => {
  const b = world.bubbles[slot];
  return {
    slot,
    active: b.active,
    hard: b.hard,
    x: b.x / SUB,
    y: b.y / SUB,
    seq: b.seq,
  };
};

export function toView(world: World): WorldView {
  const { ball } = world,
    map = mapOf(world.mapId);
  return {
    mapId: world.mapId,
    step: world.step,
    phase: world.phase,
    remaining: world.phaseSteps,
    count:
      world.phase === "countdown"
        ? Math.ceil(world.phaseSteps / STEPS_PER_SECOND)
        : 0,
    score: [world.score[0], world.score[1]],
    target: TARGET,
    lastScorer: world.lastScorer,
    winner: winnerOf(world),
    suddenDeath: world.suddenDeath,
    slow: slowed(world),
    speed: world.speed / SPEED_FULL,
    frozen: world.freeze > 0,
    riders: [riderView(world, 0), riderView(world, 1)],
    bubbles: [bubbleView(world, 0), bubbleView(world, 1)],
    ball: {
      x: ball.x / SUB,
      y: ball.y / SUB,
      vx: ball.vx / SUB,
      vy: ball.vy / SUB,
      live: ball.live,
      bounces: ball.bounces,
      touch: ball.touch,
    },
    barriers: world.barriers.map((state, i) => {
      const barrier = map.barriers[i];
      return {
        up: barrier !== undefined && barrierUp(barrier, state),
        left: state.left,
        timer: state.timer,
      };
    }),
  };
}
