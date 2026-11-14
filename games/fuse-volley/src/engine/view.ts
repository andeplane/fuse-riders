import { benched, courtOf, otherSide, teamOf } from "./world.js";
import type { Format } from "./court.js";
import { div } from "./math.js";
import * as T from "./tuning.js";
import type { Phase, Scoring, Side, World } from "./world.js";

/**
 * What the presentation sees of a match: screen pixels on the court (800 × 600, 1400 × 600 two a side and for three teams
 * of two, 1900 × 600 three a side) with y pointing down (fractions
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
  /** The team it plays for: its side on two sides, or three teams of two, 0–2. */
  team: number;
  /** Three teams of two, waiting off court for the next rally: drawn on the bench, not at `x`. */
  benched: boolean;
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
  /** The court's width and net line, px, and blobs a side on court. */
  court: { width: number; net: number; team: 1 | 2 | 3 };
  format: Format;
  /**
   * Three teams of two: each team's points by team, the teams on the left and right sides, and the side whose rallies
   * score under classic scoring (the receiving side). Empty, [0, 1] and −1 in the other formats.
   */
  points: number[];
  onCourt: [number, number];
  step: number;
  phase: Phase;
  /** Serve: steps until the ball drops by itself. Dead: steps of the settle left. 0 otherwise. */
  remaining: number;
  /** Points by side (three teams of two, of the team on that side now). */
  score: [number, number];
  scoring: Scoring;
  target: number;
  server: Side;
  lastFault: -1 | Side;
  winner: -1 | Side;
  lastTouch: -1 | Side;
  /** The side one rally from winning the match, or −1 (three teams of two, a side on court whose team is). */
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
  if (world.format === "2v2v2") {
    // The serving side scores only under rally scoring; a team at match point on the receiving side always can.
    // During the settle the side that lost walks off at the serve: read the teams that will play the next rally.
    const server = world.server,
      onCourt: [number, number] = [world.onCourt[0], world.onCourt[1]];
    if (world.phase === "dead" && world.lastFault !== -1)
      onCourt[world.lastFault] = 3 - onCourt[0] - onCourt[1];
    for (const side of [otherSide(server), server] as const) {
      if (world.scoring === "classic" && side === server) continue;
      if (world.points[onCourt[side]]! + 1 >= world.target) return side;
    }
    return -1;
  }
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
  const blob = (b: World["blobs"][number], slot: number): BlobView => {
    return {
      id: b.id,
      side: b.side,
      x: b.x,
      y: screenY(b.y / T.HU),
      air: b.air,
      frame: b.frame,
      touches: b.touches,
      hits: b.hits,
      team: teamOf(world, slot),
      benched: benched(world, slot),
    };
  };
  const ball = world.ball;
  return {
    court: {
      width: court.w,
      net: court.net,
      team: court.team,
    },
    format: world.format,
    points: [...world.points],
    onCourt: [world.onCourt[0], world.onCourt[1]],
    step: world.step,
    phase: world.phase,
    remaining:
      world.phase === "serve"
        ? T.SERVE_TIMEOUT - world.phaseSteps
        : world.phase === "dead"
          ? world.phaseSteps
          : 0,
    // Three teams of two, a side's score is the points of the team playing it now.
    score:
      world.format === "2v2v2"
        ? [world.points[world.onCourt[0]]!, world.points[world.onCourt[1]]!]
        : [world.score[0], world.score[1]],
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
