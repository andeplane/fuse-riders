import { courtFor, type Court } from "./court.js";
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
  /** Touches this side has made in a row, 0–3 (a fourth is a fault): a side's count, so teammates always agree. */
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
  /**
   * Two blobs (one a side) or four (two a side), by slot: even slots play the left side, odd ones the right. The
   * count picks the court (`courtFor`).
   */
  blobs: Blob[];
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

/** The court this world plays on. */
export const courtOf = (world: World): Court => courtFor(world.blobs.length);

/** The blobs on `side`, in slot order. */
export const team = (world: World, side: Side): Blob[] =>
  world.blobs.filter((blob) => blob.side === side);

/** Touches `side` has made in a row (its blobs all hold the count). */
export const touchesOf = (world: World, side: Side): number =>
  world.blobs.find((blob) => blob.side === side)?.touches ?? 0;

/** Sets `side`'s touch count on each of its blobs. */
export function setTouches(world: World, side: Side, touches: number): void {
  for (const blob of world.blobs)
    if (blob.side === side) blob.touches = touches;
}

const blob = (id: string, slot: number, court: Court): Blob => ({
  id,
  side: slot % 2 === 0 ? 0 : 1,
  x: court.start[slot]!,
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
  ball.x = courtOf(world).serveX[world.server];
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

/** Blobs a match may have: one a side or two a side. */
export const isPlayerCount = (count: number): boolean =>
  count === 2 || count === 4;

/**
 * A new match at 0–0 with the first serve hovering. `ids` are the blobs by slot, two or four of them: `ids[0]` plays
 * the left side and `ids[1]` the right, and with four, `ids[2]` joins the left and `ids[3]` the right. `seed` must not
 * be 0.
 */
export function createWorld(
  ids: readonly string[],
  scoring: Scoring,
  seed: number,
): World {
  if (!isPlayerCount(ids.length)) throw new Error("A match has 2 or 4 blobs");
  const start = seed >>> 0 || 0x9e3779b9;
  const court = courtFor(ids.length);
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
    blobs: ids.map((id, slot) => blob(id, slot, court)),
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
