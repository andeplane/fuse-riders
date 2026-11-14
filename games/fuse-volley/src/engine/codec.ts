import { courtFor, type Court, type Format } from "./court.js";
import { decided, kingsDecided } from "./step.js";
import * as T from "./tuning.js";
import {
  PHASES,
  SCORINGS,
  benched,
  otherSide,
  targetOf,
  type Ball,
  type Blob,
  type Side,
  type World,
} from "./world.js";

/**
 * The world as checkpoint fields: flat tuples of integers (and the blob ids) that MessagePack carries, and a
 * decoder that checks every one against the bounds and the consistency the simulation keeps. `decodeWorld` returns
 * a whole new world or nothing; it never changes what it was given and never returns a half-checked one.
 */
const VERSION = 1;
const BLOB_FIELDS = 12,
  BALL_FIELDS = 8,
  /** The world's own fields and the ball; one more for each blob after them. */
  HEAD_FIELDS = 19;

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
    ...world.blobs.map(encodeBlob),
    // Six blobs say which format they play after the blobs: 0 for three a side, 1 for three teams of two, which also
    // carry each team's points and the teams on court. Two and four blobs have one format each and carry nothing more.
    ...(world.format === "3v3"
      ? [0]
      : world.format === "2v2v2"
        ? [1, ...world.points, world.onCourt[0], world.onCourt[1]]
        : []),
  ];
}

function decodeBlob(raw: unknown, side: Side, court: Court): Blob | undefined {
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
    !int(x, court.blobMin[side], court.blobMax[side]) ||
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

const ballX = (value: unknown, court: Court): value is number =>
  int(value, court.ballLeft, court.ballRight);
const ballY = (value: unknown): value is number =>
  int(value, T.BALL_FLOOR, T.BALL_CEILING);
const speed = (value: unknown): value is number =>
  int(value, -T.BALL_MAX_SPEED, T.BALL_MAX_SPEED);

function decodeBall(raw: unknown, court: Court): Ball | undefined {
  if (!tuple(raw, BALL_FIELDS)) return;
  const [x, y, vx, vy, prevX, prevY, live, spin] = raw;
  if (
    !ballX(x, court) ||
    !ballY(y) ||
    !speed(vx) ||
    !speed(vy) ||
    !ballX(prevX, court) ||
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
  if (new Set(blobs.map((blob) => blob.id)).size !== blobs.length) return false;
  // A side's count is the side's: teammates on court hold the same one.
  const onCourt = blobs.filter((_, slot) => !benched(world, slot));
  if (
    onCourt.some((blob) =>
      onCourt.some(
        (mate) => mate.side === blob.side && mate.touches !== blob.touches,
      ),
    )
  )
    return false;
  if (world.touchStep > world.step) return false;
  if (world.target !== targetOf(world.scoring, world.format)) return false;
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
      ball.x !== courtFor(world.format).serveX[world.server] ||
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
  if (world.format === "2v2v2") return kingsConsistent(world);
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

/** Three teams of two: the teams on court, the points, and the winner, checked as `consistent` checks two sides. */
function kingsConsistent(world: World): boolean {
  const { points, onCourt, winner, phase } = world;
  if (world.score[0] !== 0 || world.score[1] !== 0) return false;
  if (world.lastFault === -1 && points.some((each) => each !== 0)) return false;
  const won = [0, 1, 2].filter((team) =>
    kingsDecided(points, team, world.target),
  );
  if (won.length > 1) return false;
  if (winner === -1) return phase !== "over" && won.length === 0;
  // The winner is on court and has just won the rally; the side that lost it would serve next.
  return (
    won[0] === onCourt[winner] &&
    (phase === "dead" || phase === "over") &&
    world.server === otherSide(winner)
  );
}

/** A waiting blob is parked: on the sand at the left wall, still, with no touches. */
const parked = (blob: Blob): boolean =>
  blob.x === 0 &&
  !blob.air &&
  blob.frame === 0 &&
  blob.dir === 0 &&
  blob.touches === 0 &&
  blob.hold === 0 &&
  !blob.contact &&
  !blob.prevContact;

export function decodeWorld(raw: unknown): World | undefined {
  if (
    !Array.isArray(raw) ||
    (raw.length !== HEAD_FIELDS + 2 &&
      raw.length !== HEAD_FIELDS + 4 &&
      raw.length !== HEAD_FIELDS + 6 + 1 &&
      raw.length !== HEAD_FIELDS + 6 + 6)
  )
    return;
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
    ...rest
  ] = raw as unknown[];
  const six = rest.length > 4,
    rawBlobs = six ? rest.slice(0, 6) : rest,
    tail = six ? rest.slice(6) : [];
  const format: Format | undefined = !six
    ? rawBlobs.length === 4
      ? "2v2"
      : "1v1"
    : tail.length === 1 && tail[0] === 0
      ? "3v3"
      : tail.length === 6 && tail[0] === 1
        ? "2v2v2"
        : undefined;
  const kings = format === "2v2v2";
  const points = kings ? tail.slice(1, 4) : [],
    onCourt = kings ? tail.slice(4, 6) : [0, 1];
  const [left, right] = onCourt;
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
    !counter(floorCounter) ||
    !format ||
    !points.every((each) => int(each, 0, T.SCORE_CAP)) ||
    !int(left, 0, 2) ||
    !int(right, 0, 2) ||
    left === right
  )
    return;
  const phase = PHASES[phaseIndex],
    scoring = SCORINGS[scoringIndex];
  const court = courtFor(format);
  // Three teams of two, a blob plays the side its team is on; a waiting one sits on the left, parked.
  const sideOf = (slot: number): Side | -1 => {
    if (!kings) return slot % 2 === 0 ? 0 : 1;
    const at = onCourt.indexOf(slot % 3);
    return at === 0 ? 0 : at === 1 ? 1 : -1;
  };
  const ball = decodeBall(rawBall, court),
    blobs = rawBlobs.map((each, slot) => {
      const side = sideOf(slot),
        blob = decodeBlob(each, side === -1 ? 0 : side, court);
      return side === -1 && blob && !parked(blob) ? undefined : blob;
    });
  if (!phase || !scoring || !ball || blobs.some((blob) => !blob)) return;
  const world: World = {
    seed,
    step,
    phase,
    phaseSteps,
    rng,
    ball,
    blobs: blobs as Blob[],
    format,
    score: [score0, score1],
    points: points as number[],
    onCourt: [left as number, right as number],
    scoring,
    target: targetOf(scoring, format),
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
