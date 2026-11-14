import test from "node:test";
import assert from "node:assert/strict";
import {
  JUMP,
  LEFT,
  RIGHT,
  TRIOS,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  laneOf,
  mirrored,
  stepWorld,
  toView,
  type World,
} from "../src/engine/index.js";
import { pointAgainst } from "../src/engine/step.js";
import * as T from "../src/engine/tuning.js";
import { validFuseVolleyField, type FuseVolleyStats } from "../src/platform.js";

const IDS = ["a", "b", "c", "d", "e", "f"] as const;
const trios = (seed = 77, scoring: "rally" | "classic" = "rally"): World =>
  createWorld(IDS, scoring, seed);
function hold(world: World, count: number, inputs: readonly number[]): void {
  for (let i = 0; i < count; i++) stepWorld(world, inputs);
}
/** Steps with nothing held until the next serve hovers, at most `limit` steps. */
function toServe(world: World, limit = 2000): number {
  for (let i = 0; i < limit; i++) {
    if (world.phase === "serve") return i;
    stepWorld(world, []);
  }
  return -1;
}
const lanes = (world: World) =>
  world.blobs.map((_, slot) => laneOf(world, slot));

test("six blobs make three a side in lanes: front, middle and back, the middle under the serve", () => {
  const world = trios();
  assert.equal(TRIOS.w, T.TRIO_COURT_W);
  assert.deepEqual(
    world.blobs.map((blob) => blob.side),
    [0, 1, 0, 1, 0, 1],
  );
  assert.deepEqual(lanes(world), [0, 0, 1, 1, 2, 2]);
  for (const [slot, blob] of world.blobs.entries()) {
    const lane = laneOf(world, slot);
    assert.ok(TRIOS.laneMin[blob.side]![lane]! <= blob.x);
    assert.ok(blob.x <= TRIOS.laneMax[blob.side]![lane]!);
  }
  // The serve hovers in each side's middle lane.
  for (const side of [0, 1] as const) {
    const x = TRIOS.serveX[side] / T.BU;
    assert.ok(TRIOS.laneMin[side]![1]! < x && x < TRIOS.laneMax[side]![1]!);
  }
  // Neighbouring lanes leave exactly a blob's width between their limits: teammates at a line just touch.
  assert.equal(TRIOS.laneMin[0]![0]! - TRIOS.laneMax[0]![1]!, 2 * T.BLOB_HALF);
  assert.equal(TRIOS.laneMin[1]![1]! - TRIOS.laneMax[1]![0]!, 2 * T.BLOB_HALF);
  // The singles and doubles courts have no lanes.
  assert.equal(laneOf(createWorld(["a", "b"], "rally", 1), 0), -1);
  assert.equal(laneOf(createWorld(["a", "b", "c", "d"], "rally", 1), 0), -1);
  assert.deepEqual(toView(world).court.lanes, [240, 480, 960, 1200]);
  assert.deepEqual(
    toView(world).blobs.map((blob) => blob.lane),
    [0, 0, 1, 1, 2, 2],
  );
});

test("a blob keeps to its lane however long it runs", () => {
  const world = trios();
  hold(world, 120, [LEFT, RIGHT, LEFT, RIGHT, RIGHT, LEFT]);
  const at = world.blobs.map((blob) => blob.x);
  assert.deepEqual(at, [
    TRIOS.laneMin[0]![0],
    TRIOS.laneMax[1]![0],
    TRIOS.laneMin[0]![1],
    TRIOS.laneMax[1]![1],
    TRIOS.laneMax[0]![2],
    TRIOS.laneMin[1]![2],
  ]);
  hold(world, 240, [RIGHT, LEFT, RIGHT, LEFT, LEFT, RIGHT]);
  assert.equal(
    world.blobs[0]!.x,
    TRIOS.laneMax[0]![0],
    "front runs up to the net",
  );
  assert.equal(world.blobs[4]!.x, 0, "back runs to the wall");
});

test("a side that wins the serve back rotates: back to middle, middle to front, front to back", () => {
  const world = trios(77, "classic");
  const server = world.server,
    other = server === 0 ? 1 : 0;
  // The server wins a rally: no rotation.
  pointAgainst(world, other, false);
  assert.deepEqual(world.rotation, [0, 0]);
  assert.equal(toServe(world), T.DEAD_STEPS + 1, "nobody had to move");
  // The other side takes the serve back: it rotates, and its blobs hop to their new lanes before the serve.
  world.ball.live = true;
  pointAgainst(world, server, false);
  assert.equal(world.server, other);
  assert.equal(world.rotation[other], 1);
  assert.equal(world.rotation[server], 0);
  const side = (slot: number) => slot % 2 === other;
  assert.deepEqual(
    lanes(world).filter((_, slot) => side(slot)),
    [2, 0, 1],
  );
  let hopped = false;
  for (let i = 0; i < T.DEAD_STEPS && world.phase === "dead"; i++) {
    stepWorld(world, [JUMP, JUMP, JUMP, JUMP, JUMP, JUMP]);
    hopped ||= world.blobs.some((blob, slot) => side(slot) && blob.air);
  }
  assert.ok(hopped, "the rotation hops");
  const waited = toServe(world);
  assert.ok(waited >= 0, "the serve comes once they are in their lanes");
  assert.equal(world.phase, "serve");
  for (const [slot, blob] of world.blobs.entries()) {
    const lane = laneOf(world, slot);
    assert.ok(TRIOS.laneMin[blob.side]![lane]! <= blob.x, `slot ${slot}`);
    assert.ok(blob.x <= TRIOS.laneMax[blob.side]![lane]!, `slot ${slot}`);
    assert.equal(blob.air, false);
  }
  // Three side-outs bring a side back to where it started.
  for (let i = 0; i < 4; i++) pointAgainst(world, world.server, false);
  assert.equal(world.rotation[other], 0);
});

test("rally scoring rotates on a side-out too, and a won match does not rotate", () => {
  const world = trios(9, "rally");
  const server = world.server,
    other = server === 0 ? 1 : 0;
  pointAgainst(world, other, false);
  assert.deepEqual(world.rotation, [0, 0]);
  pointAgainst(world, server, false);
  assert.equal(world.rotation[other], 1);
  world.score = [10, 10];
  world.score[other] = 11;
  world.winner = -1;
  pointAgainst(world, server, false);
  assert.equal(world.winner, other);
  assert.equal(
    world.rotation[other],
    1,
    "the winning point is a hold of serve",
  );
  const before = world.rotation[server];
  world.score = [12, 12];
  world.score[server] = 13;
  world.winner = -1;
  world.server = other;
  pointAgainst(world, other, false);
  assert.equal(world.winner, server);
  assert.equal(
    world.rotation[server],
    before,
    "a winning side-out does not rotate",
  );
});

test("a three-a-side world survives the codec with its rotation, and an impossible one is refused", () => {
  const world = trios();
  hold(world, 300, [RIGHT, LEFT, JUMP, JUMP, LEFT, RIGHT]);
  // A side-out: the side rotates, and its blobs are on their way to their new lanes.
  world.ball.live = true;
  world.phase = "rally";
  world.phaseSteps = 0;
  pointAgainst(world, world.server, false);
  hold(world, 20, []);
  assert.notDeepEqual(world.rotation, [0, 0]);
  const encoded = encodeWorld(world);
  assert.equal(encoded.length, 19 + 6 + 2);
  assert.deepEqual(decodeWorld(encoded), world);
  const bad = structuredClone(encoded) as unknown[];
  bad[bad.length - 1] = 3;
  assert.equal(decodeWorld(bad), undefined, "no fourth rotation");
  // A serve with a blob outside its lane never happens.
  const serving = trios();
  const outside = encodeWorld(serving);
  (outside[19] as unknown[])[1] = TRIOS.laneMin[0]![0]! - 1;
  assert.equal(decodeWorld(outside), undefined);
  // The narrower courts carry no rotation.
  assert.equal(encodeWorld(createWorld(["a", "b"], "rally", 3)).length, 21);
  assert.equal(
    encodeWorld(createWorld(["a", "b", "c", "d"], "rally", 3)).length,
    23,
  );
});

/** A match with bots at `levels` by slot ("idle" holds nothing). */
function match(levels: readonly (0 | 1 | 2 | "idle")[], seed: number): World {
  const world = trios(seed);
  for (let t = 0; t < 24_000 && world.phase !== "over"; t++) {
    const inputs = levels.map((level, slot) =>
      level === "idle" ? 0 : botInput(world, slot, level),
    );
    hold(world, 6, inputs);
  }
  return world;
}

test("three bots beat a side that stands still, from either side", () => {
  assert.equal(match([1, "idle", 1, "idle", 1, "idle"], 3).winner, 0);
  assert.equal(match(["idle", 1, "idle", 1, "idle", 1], 4).winner, 1);
});

test("bots play every lane and finish a match against each other", () => {
  const world = trios(11);
  const touches = [0, 0, 0];
  for (let t = 0; t < 24_000 && world.phase !== "over"; t++) {
    const inputs = world.blobs.map((_, slot) => botInput(world, slot, 1));
    for (let i = 0; i < 6; i++) {
      const before = world.blobs.map((blob) => blob.hits);
      stepWorld(world, inputs);
      for (const [slot, blob] of world.blobs.entries())
        if (blob.hits !== before[slot]) touches[laneOf(world, slot)]!++;
    }
  }
  assert.equal(world.phase, "over");
  assert.ok(
    touches.every((count) => count > 10),
    `touches by lane ${touches}`,
  );
});

test("the three-a-side court is fair: a mirrored world plays out mirrored", () => {
  const a = trios(5),
    b = createWorld(["b", "a", "d", "c", "f", "e"], "rally", 5);
  b.server = a.server === 0 ? 1 : 0;
  const W = TRIOS.w;
  b.ball.x = W * T.BU - a.ball.x;
  b.ball.prevX = b.ball.x;
  const twin = [1, 0, 3, 2, 5, 4];
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
  assert.deepEqual(a.rotation, [b.rotation[1], b.rotation[0]]);
  assert.ok(a.score[0] + a.score[1] > 0, "and points were played");
});

test("the platform takes a three-a-side field and refuses five", () => {
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
  const field = [0, 1, 2, 3, 4, 5].map((slot) =>
    slot % 2 === 0 ? stats(slot, true, 11) : stats(slot, false, 6),
  );
  assert.equal(validFuseVolleyField(field), true);
  assert.equal(validFuseVolleyField(field.slice(0, 5)), false);
  const split = field.map((player) =>
    player.slot === 4 ? stats(4, true, 10) : player,
  );
  assert.equal(validFuseVolleyField(split), false, "teammates share points");
});
