import { xorshift } from "./math.js";
import * as T from "./tuning.js";

/**
 * One match's world: plain integer data, so the netcode can clone, hash and checkpoint it. Units are the exe's (see
 * `tuning.ts`): the ball in 1/32 px, blob x in px, blob height in 1/256 px, y pointing up from the bottom edge.
 */
export const PHASES = ["serve", "rally", "dead", "over"] as const;
export type Phase = (typeof PHASES)[number];
export const SCORINGS = ["rally", "classic"] as const;
/** `rally`: every rally scores, first to 11. `classic`: only the serving side scores, first to 15. Both win by two. */
export type Scoring = (typeof SCORINGS)[number];
export type Side = 0 | 1;

export interface Blob {
  /** The member or bot id riding this blob. */
  id: string;
  side: Side;
  /** Centre, px. */
  x: number;
  /** Feet height, 1/256 px; `BLOB_FLOOR` on the sand. */
  y: number;
  vy: number;
  air: boolean;
  /** Squash animation frame, 0–4, and where it is heading (−1, 0 or 1). It moves the head, so it is a rule. */
  frame: number;
  dir: -1 | 0 | 1;
  /** Touches this side has made in a row, 0–3 (a fourth is a fault). */
  touches: number;
  /** Frames of unbroken contact with the ball: more than `MAX_HOLD` is carrying. */
  hold: number;
  /** In contact since the last frame's count, and as of the frame before. */
  contact: boolean;
  prevContact: boolean;
  /** Counted touches this match, for the result; stops at `MOST_HITS`. */
  hits: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where it was a step ago, for the net's tunnelling guard. */
  prevX: number;
  prevY: number;
  /** Gravity is on: false while a serve hovers. */
  live: boolean;
  /** Cosmetic rotation, 0–65535; it never feeds back into the rules. */
  spin: number;
}

export interface World {
  /** The match's seed, fixed: the bot draws its aim from it without moving `rng`. */
  seed: number;
  step: number;
  phase: Phase;
  /** Serve: steps since the ball appeared. Dead: steps left of the settle. Otherwise 0. */
  phaseSteps: number;
  /** The xorshift32 state: the first server and the net's nudge come from it. */
  rng: number;
  ball: Ball;
  blobs: [Blob, Blob];
  score: [number, number];
  scoring: Scoring;
  target: number;
  /** The side serving now (or next, during the settle). */
  server: Side;
  /** The side the last rally went against, or −1 before the first. */
  lastFault: -1 | Side;
  /** The side that has won, or −1 while undecided. */
  winner: -1 | Side;
  /** The side of the last counted touch (−1 at a serve) and the step it was counted on. */
  lastTouch: -1 | Side;
  touchStep: number;
  /** Counters for effects and sounds, each wrapping at `COUNTER`: a change between two views is an event. */
  hitCounter: number;
  pointCounter: number;
  netCounter: number;
  floorCounter: number;
}

export const otherSide = (side: Side): Side => (side === 0 ? 1 : 0);

/** A number below `n` from the world's generator. */
export function rng(world: World, n: number): number {
  world.rng = xorshift(world.rng);
  return world.rng % n;
}

const blob = (id: string, side: Side): Blob => ({
  id,
  side,
  x: T.BLOB_START[side],
  y: T.BLOB_FLOOR,
  vy: 0,
  air: false,
  frame: 0,
  dir: 0,
  touches: 0,
  hold: 0,
  contact: false,
  prevContact: false,
  hits: 0,
});

/** The ball hovers over the server's half until someone touches it; the blobs stay where they are. */
export function serve(world: World): void {
  const ball = world.ball;
  ball.x = T.SERVE_X[world.server];
  ball.y = T.SERVE_Y;
  ball.vx = 0;
  ball.vy = 0;
  ball.prevX = ball.x;
  ball.prevY = ball.y;
  ball.live = false;
  for (const each of world.blobs) {
    each.touches = 0;
    each.hold = 0;
    each.contact = false;
    each.prevContact = false;
  }
  world.lastTouch = -1;
  world.phase = "serve";
  world.phaseSteps = 0;
}

export const targetOf = (scoring: Scoring): number =>
  scoring === "rally" ? T.RALLY_TARGET : T.CLASSIC_TARGET;

/** A new match at 0–0 with the first serve hovering; `ids[0]` plays the left side. `seed` must not be 0. */
export function createWorld(
  ids: readonly [string, string],
  scoring: Scoring,
  seed: number,
): World {
  const start = seed >>> 0 || 0x9e3779b9;
  const world: World = {
    seed: start,
    step: 0,
    phase: "serve",
    phaseSteps: 0,
    rng: start,
    ball: {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      prevX: 0,
      prevY: 0,
      live: false,
      spin: 0,
    },
    blobs: [blob(ids[0], 0), blob(ids[1], 1)],
    score: [0, 0],
    scoring,
    target: targetOf(scoring),
    server: 0,
    lastFault: -1,
    winner: -1,
    lastTouch: -1,
    touchStep: 0,
    hitCounter: 0,
    pointCounter: 0,
    netCounter: 0,
    floorCounter: 0,
  };
  world.server = rng(world, 2) === 0 ? 0 : 1;
  serve(world);
  return world;
}
