import { decided } from "./step.js";
import * as T from "./tuning.js";
import {
  PHASES,
  SCORINGS,
  targetOf,
  type Ball,
  type Blob,
  type Side,
  type World,
} from "./world.js";

/**
 * The world as checkpoint fields: flat tuples of integers (and the two blob ids) that MessagePack carries, and a
 * decoder that checks every one against the bounds and the consistency the simulation keeps. `decodeWorld` returns
 * a whole new world or nothing; it never changes what it was given and never returns a half-checked one.
 */
const VERSION = 1;
const BLOB_FIELDS = 12,
  BALL_FIELDS = 8,
  WORLD_FIELDS = 21;

const int = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  !Object.is(value, -0) &&
  value >= low &&
  value <= high;
const flag = (value: unknown): value is 0 | 1 => value === 0 || value === 1;
const sideOrNone = (value: unknown): value is -1 | Side =>
  value === -1 || value === 0 || value === 1;
const tuple = (value: unknown, length: number): value is unknown[] =>
  Array.isArray(value) && value.length === length;
const counter = (value: unknown): value is number =>
  int(value, 0, T.COUNTER - 1);
const uint32 = (value: unknown): value is number => int(value, 1, 0xffff_ffff);
/** A blob's id: the member or bot id the room seats, as an opaque short string. */
export const riderId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64;

const encodeBlob = (b: Blob): unknown[] => [
  b.id,
  b.x,
  b.y,
  b.vy,
  b.air ? 1 : 0,
  b.frame,
  b.dir,
  b.touches,
  b.hold,
  b.contact ? 1 : 0,
  b.prevContact ? 1 : 0,
  b.hits,
];
const encodeBall = (b: Ball): unknown[] => [
  b.x,
  b.y,
  b.vx,
  b.vy,
  b.prevX,
  b.prevY,
  b.live ? 1 : 0,
  b.spin,
];

export function encodeWorld(world: World): unknown[] {
  return [
    VERSION,
    world.seed,
    world.step,
    PHASES.indexOf(world.phase),
    world.phaseSteps,
    world.rng,
    SCORINGS.indexOf(world.scoring),
    world.server,
    world.lastFault,
    world.winner,
    world.lastTouch,
    world.touchStep,
    world.score[0],
    world.score[1],
    world.hitCounter,
    world.pointCounter,
    world.netCounter,
    world.floorCounter,
    encodeBall(world.ball),
    encodeBlob(world.blobs[0]),
    encodeBlob(world.blobs[1]),
  ];
}

function decodeBlob(raw: unknown, side: Side): Blob | undefined {
  if (!tuple(raw, BLOB_FIELDS)) return;
  const [
    id,
    x,
    y,
    vy,
    air,
    frame,
    dir,
    touches,
    hold,
    contact,
    prevContact,
    hits,
  ] = raw;
  if (
    !riderId(id) ||
    !int(x, T.BLOB_MIN[side], T.BLOB_MAX[side]) ||
    !int(y, T.BLOB_FLOOR, T.BLOB_CEILING) ||
    !int(vy, T.BLOB_MIN_VY, T.BLOB_MAX_VY) ||
    !flag(air) ||
    // On the sand a blob stands still.
    (air === 0 && (y !== T.BLOB_FLOOR || vy !== 0)) ||
    !int(frame, 0, T.SQUASH_FRAMES) ||
    !int(dir, -1, 1) ||
    !int(touches, 0, T.MAX_TOUCHES) ||
    !int(hold, 0, T.MAX_HOLD + 1) ||
    !flag(contact) ||
    !flag(prevContact) ||
    !int(hits, 0, T.MOST_HITS)
  )
    return;
  return {
    id,
    side,
    x,
    y,
    vy,
    air: air === 1,
    frame,
    dir: dir as -1 | 0 | 1,
    touches,
    hold,
    contact: contact === 1,
    prevContact: prevContact === 1,
    hits,
  };
}

const ballX = (value: unknown): value is number =>
  int(value, T.BALL_LEFT, T.BALL_RIGHT);
const ballY = (value: unknown): value is number =>
  int(value, T.BALL_FLOOR, T.BALL_CEILING);
const speed = (value: unknown): value is number =>
  int(value, -T.BALL_MAX_SPEED, T.BALL_MAX_SPEED);

function decodeBall(raw: unknown): Ball | undefined {
  if (!tuple(raw, BALL_FIELDS)) return;
  const [x, y, vx, vy, prevX, prevY, live, spin] = raw;
  if (
    !ballX(x) ||
    !ballY(y) ||
    !speed(vx) ||
    !speed(vy) ||
    !ballX(prevX) ||
    !ballY(prevY) ||
    !flag(live) ||
    !counter(spin)
  )
    return;
  return { x, y, vx, vy, prevX, prevY, live: live === 1, spin };
}

/** The checks that tie fields together: a world no sequence of steps could reach is refused. */
function consistent(world: World): boolean {
  const { phase, phaseSteps, ball, blobs, score, winner } = world;
  if (blobs[0].id === blobs[1].id) return false;
  if (world.touchStep > world.step) return false;
  if (world.target !== targetOf(world.scoring)) return false;
  // Timers: a serve counts up to its timeout, the settle counts down, nothing else has one.
  if (phase === "serve" && phaseSteps >= T.SERVE_TIMEOUT) return false;
  if (phase === "dead" && phaseSteps > T.DEAD_STEPS) return false;
  if ((phase === "rally" || phase === "over") && phaseSteps !== 0) return false;
  // A serve hovers, still, over the server's half; every other phase has gravity on.
  if (phase === "serve") {
    if (
      ball.live ||
      ball.vx !== 0 ||
      ball.vy !== 0 ||
      ball.x !== T.SERVE_X[world.server] ||
      ball.y !== T.SERVE_Y ||
      world.lastTouch !== -1 ||
      world.blobs.some(
        (blob) =>
          blob.touches !== 0 ||
          blob.hold !== 0 ||
          blob.contact ||
          blob.prevContact,
      )
    )
      return false;
  } else if (!ball.live) return false;
  // A settle and a finished match always follow a rally lost by someone.
  if ((phase === "dead" || phase === "over") && world.lastFault === -1)
    return false;
  // The score: nothing before the first rally, at most one winner, and the match over only once decided.
  if (world.lastFault === -1 && (score[0] !== 0 || score[1] !== 0))
    return false;
  if (decided(score, 0, world.target) && decided(score, 1, world.target))
    return false;
  if (winner === -1) {
    if (
      phase === "over" ||
      decided(score, 0, world.target) ||
      decided(score, 1, world.target)
    )
      return false;
  } else if (
    !decided(score, winner, world.target) ||
    (phase !== "dead" && phase !== "over") ||
    world.server !== winner
  )
    return false;
  return true;
}

export function decodeWorld(raw: unknown): World | undefined {
  if (!tuple(raw, WORLD_FIELDS)) return;
  const [
    version,
    seed,
    step,
    phaseIndex,
    phaseSteps,
    rng,
    scoringIndex,
    server,
    lastFault,
    winner,
    lastTouch,
    touchStep,
    score0,
    score1,
    hitCounter,
    pointCounter,
    netCounter,
    floorCounter,
    rawBall,
    rawLeft,
    rawRight,
  ] = raw;
  if (
    version !== VERSION ||
    !uint32(seed) ||
    !int(step, 0, T.MAX_STEP) ||
    !int(phaseIndex, 0, PHASES.length - 1) ||
    !int(phaseSteps, 0, T.MAX_STEP) ||
    !uint32(rng) ||
    !int(scoringIndex, 0, SCORINGS.length - 1) ||
    (server !== 0 && server !== 1) ||
    !sideOrNone(lastFault) ||
    !sideOrNone(winner) ||
    !sideOrNone(lastTouch) ||
    !int(touchStep, 0, T.MAX_STEP) ||
    !int(score0, 0, T.SCORE_CAP) ||
    !int(score1, 0, T.SCORE_CAP) ||
    !counter(hitCounter) ||
    !counter(pointCounter) ||
    !counter(netCounter) ||
    !counter(floorCounter)
  )
    return;
  const phase = PHASES[phaseIndex],
    scoring = SCORINGS[scoringIndex];
  const ball = decodeBall(rawBall),
    left = decodeBlob(rawLeft, 0),
    right = decodeBlob(rawRight, 1);
  if (!phase || !scoring || !ball || !left || !right) return;
  const world: World = {
    seed,
    step,
    phase,
    phaseSteps,
    rng,
    ball,
    blobs: [left, right],
    score: [score0, score1],
    scoring,
    target: targetOf(scoring),
    server,
    lastFault,
    winner,
    lastTouch,
    touchStep,
    hitCounter,
    pointCounter,
    netCounter,
    floorCounter,
  };
  return consistent(world) ? world : undefined;
}
