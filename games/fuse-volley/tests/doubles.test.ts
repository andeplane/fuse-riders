import test from "node:test";
import assert from "node:assert/strict";
import {
  DOUBLES,
  JUMP,
  LEFT,
  RIGHT,
  SINGLES,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  mirrored,
  stepWorld,
  toView,
  type World,
} from "../src/engine/index.js";
import { countTouches } from "../src/engine/step.js";
import * as T from "../src/engine/tuning.js";
import {
  parseFuseVolleyStats,
  validFuseVolleyField,
  type FuseVolleyStats,
} from "../src/platform.js";

const IDS = ["a", "b", "c", "d"] as const;
const doubles = (seed = 77): World => createWorld(IDS, "rally", seed);
/** Steps `count` times with `inputs` held by slot. */
function hold(world: World, count: number, inputs: readonly number[]): void {
  for (let i = 0; i < count; i++) stepWorld(world, inputs);
}

test("the singles court is the exe's numbers, measured from the net", () => {
  assert.equal(SINGLES.w, T.COURT_W);
  assert.equal(SINGLES.ballRight, T.BALL_RIGHT);
  assert.deepEqual(SINGLES.serveX, T.SERVE_X);
  assert.deepEqual(SINGLES.blobMin, T.BLOB_MIN);
  assert.deepEqual(SINGLES.blobMax, T.BLOB_MAX);
  assert.equal(SINGLES.netTopX, T.NET_TOP_X);
  assert.equal(SINGLES.polePutLeft, T.POLE_PUT_LEFT);
  assert.equal(SINGLES.polePutRight, T.POLE_PUT_RIGHT);
  assert.equal(SINGLES.guardLine, T.GUARD_LINE);
  assert.equal(SINGLES.guardMirror, T.COURT_W * T.BU - T.GUARD_LINE + 1);
  assert.equal(SINGLES.clearLeft, T.CLEAR_LEFT);
  assert.equal(SINGLES.clearRight, T.CLEAR_RIGHT);
  // The wide court keeps every net distance.
  assert.equal(DOUBLES.w, T.TEAM_COURT_W);
  assert.equal(
    DOUBLES.polePutRight - DOUBLES.netTopX,
    SINGLES.polePutRight - SINGLES.netTopX,
  );
  assert.equal(DOUBLES.blobMax[0], DOUBLES.net - 40);
});

test("four blobs make a doubles match: slots alternate sides on the wide court", () => {
  const world = doubles();
  assert.deepEqual(
    world.blobs.map((blob) => blob.side),
    [0, 1, 0, 1],
  );
  assert.deepEqual(
    world.blobs.map((blob) => blob.x),
    DOUBLES.start,
  );
  assert.equal(world.ball.x, DOUBLES.serveX[world.server]);
  assert.deepEqual(toView(world).court, {
    width: T.TEAM_COURT_W,
    net: T.TEAM_COURT_W / 2,
    team: 2,
  });
  assert.throws(() => createWorld(["a", "b", "c"], "rally", 1));
});

test("teammates are solid: a runner shoves a standing teammate at half speed, two pushing stand still", () => {
  const world = doubles();
  const [front, , back] = [world.blobs[0]!, world.blobs[1]!, world.blobs[2]!];
  // The back blob runs at the front one until they meet, then keeps pushing.
  hold(world, 400, [0, 0, RIGHT, 0]);
  assert.equal(front.x - back.x, 2 * T.BLOB_HALF, "touching, not overlapping");
  assert.equal(front.x, DOUBLES.blobMax[0], "pushed all the way to the net");
  // Pushing back against each other, neither moves.
  hold(world, 60, [0, 0, 0, 0]);
  const at = [back.x, front.x];
  hold(world, 60, [LEFT, 0, RIGHT, 0]);
  assert.deepEqual([back.x, front.x], at);
});

test("a teammate is jumped over, never shoved", () => {
  const world = doubles();
  const front = world.blobs[0]!,
    back = world.blobs[2]!;
  // A running jump from a step away clears the head and lands beyond; from a standstill against it, the rise shoves.
  front.x = DOUBLES.net - 200;
  back.x = front.x - 2 * T.BLOB_HALF - 40;
  let passed = false;
  for (let i = 0; i < 150; i++) {
    stepWorld(world, [0, 0, RIGHT | JUMP, 0]);
    if (back.x > front.x) passed = true;
  }
  assert.ok(passed, "the back blob is past its teammate");
  assert.equal(front.x, DOUBLES.net - 200, "and never shoved it");
});

test("three touches a side, shared by teammates: a fourth by either is a fault", () => {
  const world = doubles();
  world.phase = "rally";
  world.ball.live = true;
  world.ball.x = (DOUBLES.net - 300) * T.BU;
  world.ball.prevX = world.ball.x;
  world.ball.y = 400 * T.BU;
  world.ball.prevY = world.ball.y;
  const [a, , c] = [world.blobs[0]!, world.blobs[1]!, world.blobs[2]!];
  for (const [i, blob] of [a, c, a].entries()) {
    blob.contact = true;
    countTouches(world);
    countTouches(world);
    assert.equal(a.touches, i + 1);
    assert.equal(c.touches, i + 1);
  }
  const points = world.pointCounter;
  c.contact = true;
  countTouches(world);
  assert.notEqual(world.pointCounter, points, "the fourth touch is a fault");
  assert.equal(world.lastFault, 0);
});

test("a doubles world survives the codec, and teammates that disagree on touches are refused", () => {
  const world = doubles();
  hold(world, 600, [RIGHT, LEFT, JUMP, JUMP]);
  const encoded = encodeWorld(world);
  assert.deepEqual(decodeWorld(encoded), world);
  const wrong = structuredClone(encoded) as unknown[];
  (wrong[19 + 2] as unknown[])[8] = 1;
  assert.equal(decodeWorld(wrong), undefined);
  assert.equal(decodeWorld(encoded.slice(0, -1)), undefined, "three blobs");
  // A doubles blob outside the singles court's right half still decodes only on the wide court.
  const singles = encodeWorld(createWorld(["a", "b"], "rally", 3));
  (singles[20] as unknown[])[1] = 900;
  assert.equal(decodeWorld(singles), undefined);
});

/** A match with bots at `levels` by slot ("idle" holds nothing), bots answering once per tick. */
function match(levels: readonly (0 | 1 | 2 | "idle")[], seed: number): World {
  const world = doubles(seed);
  for (let t = 0; t < 24_000 && world.phase !== "over"; t++) {
    const inputs = levels.map((level, slot) =>
      level === "idle" ? 0 : botInput(world, slot, level),
    );
    hold(world, 6, inputs);
  }
  return world;
}

test("a pair of bots beats a side that stands still, from either side", () => {
  assert.equal(match([1, "idle", 1, "idle"], 3).winner, 0);
  assert.equal(match(["idle", 1, "idle", 1], 4).winner, 1);
});

test("the doubles court is fair: a mirrored world plays out mirrored", () => {
  const a = doubles(5),
    b = createWorld(["b", "a", "d", "c"], "rally", 5);
  b.server = a.server === 0 ? 1 : 0;
  const W = DOUBLES.w;
  b.ball.x = W * T.BU - a.ball.x;
  b.ball.prevX = b.ball.x;
  const twin = [1, 0, 3, 2];
  for (const [slot, other] of twin.entries())
    b.blobs[slot]!.x = W - a.blobs[other]!.x;
  for (let t = 0; t < 2500; t++) {
    const ia = a.blobs.map((_, slot) => botInput(a, slot, 2));
    const ib = b.blobs.map((_, slot) => botInput(b, slot, 2));
    assert.deepEqual(
      ib,
      twin.map((other) => mirrored(ia[other]!)),
      `tick ${t}`,
    );
    hold(a, 6, ia);
    hold(b, 6, ib);
    for (const [slot, other] of twin.entries())
      assert.equal(a.blobs[other]!.x, W - b.blobs[slot]!.x);
  }
  assert.deepEqual(a.score, [b.score[1], b.score[0]]);
  assert.ok(a.score[0] + a.score[1] > 0, "and points were played");
});

const stats = (
  slot: number,
  won: boolean,
  points: number,
): FuseVolleyStats => ({
  playerId: `${"a".repeat(23)}${slot}`,
  name: `P${slot}`,
  slot,
  roundsPlayed: 1,
  roundWins: won ? 1 : 0,
  matchScoreUnits: points,
  matchPlacement: won ? 1 : 2,
  earlyExits: 0,
  points,
  hits: 10,
});

test("the platform takes a doubles field: two sides of two, teammates sharing points and result", () => {
  const field = [
    stats(0, true, 11),
    stats(1, false, 7),
    stats(2, true, 11),
    stats(3, false, 7),
  ];
  for (const player of field)
    assert.deepEqual(parseFuseVolleyStats(player, 1), player);
  assert.ok(validFuseVolleyField(field));
  assert.ok(!validFuseVolleyField(field.slice(0, 3)), "three players");
  assert.ok(
    !validFuseVolleyField([
      field[0]!,
      field[1]!,
      stats(2, false, 7),
      field[3]!,
    ]),
    "a winner's teammate who lost",
  );
  assert.ok(
    !validFuseVolleyField([
      field[0]!,
      field[1]!,
      field[2]!,
      stats(3, false, 5),
    ]),
    "teammates on different scores",
  );
  assert.ok(
    !validFuseVolleyField([
      field[0]!,
      field[1]!,
      field[2]!,
      stats(1, false, 7),
    ]),
    "a slot twice",
  );
});
