import { courtOf } from "./world.js";
import { div } from "./math.js";
import * as T from "./tuning.js";
import type { Phase, Scoring, Side, World } from "./world.js";

/**
 * What the presentation sees of a match: screen pixels on the court (800 × 600, or 1600 × 600 two a side) with y pointing down (fractions
 * allowed), speeds in pixels per step, timers in steps. Effects are the presentation's own, driven by the counters
 * changing between two views; a rollback that replays a step leaves a counter where it was, so nothing fires twice.
 */
export interface BlobView {
  id: string;
  side: Side;
  /** Centre x and feet y, screen px. */
  x: number;
  y: number;
  air: boolean;
  /** Squash frame 0–4: the head sits `HEAD_UP[frame]` px above the feet. */
  frame: number;
  /** This blob's side's touches in a row, 0–3. */
  touches: number;
  hits: number;
}
export interface BallView {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Gravity is on (false while a serve hovers). */
  live: boolean;
  /** Rotation in turns, 0–1. */
  spin: number;
}
export interface WorldView {
  /** The court's width and net line, px, and blobs a side. */
  court: { width: number; net: number; team: 1 | 2 };
  step: number;
  phase: Phase;
  /** Serve: steps until the ball drops by itself. Dead: steps of the settle left. 0 otherwise. */
  remaining: number;
  score: [number, number];
  scoring: Scoring;
  target: number;
  server: Side;
  lastFault: -1 | Side;
  winner: -1 | Side;
  lastTouch: -1 | Side;
  /** The side one rally from winning the match, or −1. */
  matchPoint: -1 | Side;
  hitCounter: number;
  pointCounter: number;
  netCounter: number;
  floorCounter: number;
  /** By slot: even slots on the left side, odd on the right. */
  blobs: BlobView[];
  ball: BallView;
}

const screenY = (pixelsUp: number): number => T.COURT_H - pixelsUp;

/** The side whose next rally won would win the match. */
function matchPointOf(world: World): -1 | Side {
  if (world.winner !== -1 || world.phase === "over") return -1;
  const server = world.server;
  for (const side of [server, server === 0 ? 1 : 0] as const) {
    // Under classic scoring only the server can score.
    if (world.scoring === "classic" && side !== server) continue;
    const mine = world.score[side] + 1,
      theirs = world.score[side === 0 ? 1 : 0];
    if (mine >= T.SCORE_CAP || (mine >= world.target && mine - theirs >= 2))
      return side;
  }
  return -1;
}

export function toView(world: World): WorldView {
  const court = courtOf(world);
  const blob = (b: World["blobs"][number]): BlobView => {
    return {
      id: b.id,
      side: b.side,
      x: b.x,
      y: screenY(b.y / T.HU),
      air: b.air,
      frame: b.frame,
      touches: b.touches,
      hits: b.hits,
    };
  };
  const ball = world.ball;
  return {
    court: { width: court.w, net: court.net, team: court.team },
    step: world.step,
    phase: world.phase,
    remaining:
      world.phase === "serve"
        ? T.SERVE_TIMEOUT - world.phaseSteps
        : world.phase === "dead"
          ? world.phaseSteps
          : 0,
    score: [world.score[0], world.score[1]],
    scoring: world.scoring,
    target: world.target,
    server: world.server,
    lastFault: world.lastFault,
    winner: world.winner,
    lastTouch: world.lastTouch,
    matchPoint: matchPointOf(world),
    hitCounter: world.hitCounter,
    pointCounter: world.pointCounter,
    netCounter: world.netCounter,
    floorCounter: world.floorCounter,
    blobs: world.blobs.map(blob),
    ball: {
      x: ball.x / T.BU,
      y: screenY(ball.y / T.BU),
      vx: ball.vx / T.BU,
      vy: -ball.vy / T.BU,
      live: ball.live,
      spin: ball.spin / T.COUNTER,
    },
  };
}

/** Seconds left of a hovering serve, rounded up, for a countdown. */
export const serveSeconds = (view: WorldView): number =>
  view.phase === "serve"
    ? div(view.remaining + T.STEPS_PER_SECOND - 1, T.STEPS_PER_SECOND)
    : 0;
