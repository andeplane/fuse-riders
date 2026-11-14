import test from "node:test";
import assert from "node:assert/strict";
import {
  JUMP,
  LEFT,
  RIGHT,
  TRIPLES,
  DOUBLES,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  mirrored,
  stepWorld,
  toView,
  type Scoring,
  type World,
} from "../src/engine/index.js";
import { pointAgainst } from "../src/engine/step.js";
import * as T from "../src/engine/tuning.js";
import { validFuseVolleyField, type FuseVolleyStats } from "../src/platform.js";

const IDS = ["a", "b", "c", "d", "e", "f"] as const;
const triples = (seed = 77, scoring: Scoring = "rally"): World =>
  createWorld(IDS, scoring, seed, "3v3");
const kings = (seed = 77, scoring: Scoring = "rally"): World =>
  createWorld(IDS, scoring, seed, "2v2v2");
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
/** Ends the current rally against `loser` the way the ball landing would, then waits for the next serve. */
function lose(world: World, loser: 0 | 1): void {
  world.ball.live = true;
  world.phase = "rally";
  world.phaseSteps = 0;
  pointAgainst(world, loser, false);
  if (world.winner === -1) assert.ok(toServe(world) >= 0);
}

// ---- three a side ----

test("six blobs default to three a side on one big court: front, middle and back, no lanes", () => {
  const world = triples();
  assert.equal(world.format, "3v3");
  assert.equal(createWorld(IDS, "rally", 77).format, "3v3");
  assert.equal(TRIPLES.w, T.TRIPLE_COURT_W);
  assert.deepEqual(
    world.blobs.map((blob) => blob.side),
    [0, 1, 0, 1, 0, 1],
  );
  const net = TRIPLES.net;
  assert.deepEqual(
    world.blobs.map((blob) => Math.abs(blob.x - net)),
    [
      T.TRIPLE_FRONT,
      T.TRIPLE_FRONT,
      T.TRIPLE_MID,
      T.TRIPLE_MID,
      T.TRIPLE_BACK,
      T.TRIPLE_BACK,
    ],
  );
  // Every blob may run its whole half: from the wall to the net.
  hold(world, 600, [LEFT, RIGHT, LEFT, RIGHT, LEFT, RIGHT]);
  assert.ok(
    world.blobs.every(
      (blob) =>
        blob.x === 0 ||
        blob.x === TRIPLES.w ||
        Math.abs(blob.x - (blob.side === 0 ? 0 : TRIPLES.w)) <= 4 * T.BLOB_HALF,
    ),
  );
  hold(world, 900, [RIGHT, LEFT, RIGHT, LEFT, RIGHT, LEFT]);
  const front = world.blobs
    .filter((blob) => blob.side === 0)
    .map((blob) => blob.x);
  assert.equal(Math.max(...front), TRIPLES.blobMax[0], "one reaches the net");
});

test("three teammates are solid to each other: pushed together they stand a blob apart", () => {
  const world = triples();
  hold(world, 900, [RIGHT, 0, RIGHT, 0, RIGHT, 0]);
  const left = world.blobs
    .filter((blob) => blob.side === 0)
    .map((blob) => blob.x)
    .sort((a, b) => a - b);
  assert.ok(left[2]! - left[1]! >= 2 * T.BLOB_HALF - 1, `${left}`);
  assert.ok(left[1]! - left[0]! >= 2 * T.BLOB_HALF - 1, `${left}`);
  assert.equal(left[2], TRIPLES.blobMax[0]);
});

test("a three-a-side world survives the codec, and a world with a made-up format is refused", () => {
  const world = triples();
  hold(world, 300, [RIGHT, LEFT, JUMP, JUMP, LEFT, RIGHT]);
  const encoded = encodeWorld(world);
  assert.equal(encoded.length, 19 + 6 + 1);
  assert.deepEqual(decodeWorld(encoded), world);
  const bad = structuredClone(encoded) as unknown[];
  bad[bad.length - 1] = 2;
  assert.equal(decodeWorld(bad), undefined, "no third six-blob format");
  // The narrower courts carry nothing after their blobs, as before.
  assert.equal(encodeWorld(createWorld(["a", "b"], "rally", 3)).length, 21);
  assert.equal(
    encodeWorld(createWorld(["a", "b", "c", "d"], "rally", 3)).length,
    23,
  );
});

/** A match with bots at `levels` by slot ("idle" holds nothing). */
function match(
  levels: readonly (0 | 1 | 2 | "idle")[],
  seed: number,
  make: (seed: number) => World = triples,
): World {
  const world = make(seed);
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

test("three-a-side bots finish a match with every blob playing its share", () => {
  const world = match([1, 1, 1, 1, 1, 1], 11);
  assert.equal(world.phase, "over");
  for (const blob of world.blobs)
    assert.ok(
      blob.hits > 10,
      `touches by slot ${world.blobs.map((b) => b.hits)}`,
    );
});

test("the three-a-side court is fair: a mirrored world plays out mirrored", () => {
  const a = triples(5),
    b = createWorld(["b", "a", "d", "c", "f", "e"], "rally", 5, "3v3");
  b.server = a.server === 0 ? 1 : 0;
  const W = TRIPLES.w;
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
  assert.ok(a.score[0] + a.score[1] > 0, "and points were played");
});

// ---- three teams of two ----

test("three teams of two: teams 0 and 1 start on the doubles court, team 2 waits parked", () => {
  const world = kings();
  assert.equal(world.format, "2v2v2");
  assert.deepEqual(world.onCourt, [0, 1]);
  assert.deepEqual(world.points, [0, 0, 0]);
  assert.equal(world.target, T.KINGS_RALLY_TARGET);
  assert.equal(kings(1, "classic").target, T.KINGS_CLASSIC_TARGET);
  const view = toView(world);
  assert.equal(view.court.width, DOUBLES.w);
  assert.deepEqual(
    view.blobs.map((blob) => [blob.team, blob.side, blob.benched]),
    [
      [0, 0, false],
      [1, 1, false],
      [2, 0, true],
      [0, 0, false],
      [1, 1, false],
      [2, 0, true],
    ],
  );
  // On court, a team's first blob starts in front and its second behind, as two a side.
  assert.deepEqual(
    [
      world.blobs[0]!.x,
      world.blobs[3]!.x,
      world.blobs[1]!.x,
      world.blobs[4]!.x,
    ],
    [DOUBLES.start[0], DOUBLES.start[2], DOUBLES.start[1], DOUBLES.start[3]],
  );
  // The waiting team holds still whatever it presses, and its bots press nothing.
  hold(world, 120, [0, 0, RIGHT | JUMP, 0, 0, LEFT | JUMP]);
  assert.equal(world.blobs[2]!.x, 0);
  assert.equal(world.blobs[2]!.air, false);
  assert.equal(botInput(world, 2, 2), 0);
});

test("king of the court, rally scoring: winners score and stay, losers swap with the waiting team, who serve", () => {
  const world = kings(77, "rally");
  lose(world, 1);
  assert.deepEqual(world.points, [1, 0, 0]);
  // The waiting team came on where the losers were, and serves.
  assert.deepEqual(world.onCourt, [0, 2]);
  assert.equal(world.server, 1);
  assert.equal(world.phase, "serve");
  assert.equal(world.ball.x, DOUBLES.serveX[1]);
  assert.deepEqual(
    toView(world).blobs.map((blob) => blob.benched),
    [false, true, false, false, true, false],
  );
  assert.equal(world.blobs[2]!.side, 1);
  assert.equal(world.blobs[2]!.x, DOUBLES.start[1]);
  assert.equal(world.blobs[5]!.x, DOUBLES.start[3]);
  // The challengers win: they score, the old kings walk off.
  lose(world, 0);
  assert.deepEqual(world.points, [1, 0, 1]);
  assert.deepEqual(world.onCourt, [1, 2]);
  assert.equal(world.server, 0);
  // First to the target wins outright, with no lead of two.
  world.points = [10, 9, 10];
  lose(world, 0);
  assert.equal(world.winner, 1);
  hold(world, T.DEAD_STEPS + 10, []);
  assert.equal(world.phase, "over");
  assert.deepEqual(world.onCourt, [1, 2], "a finished match swaps nobody");
});

test("king of the court, classic: only the receiving (king) side scores; a serving side that wins takes the crown", () => {
  const world = kings(77, "classic");
  const server = world.server,
    king = server === 0 ? 1 : 0;
  // The serving side wins: no point, but it stays on and the old kings go off.
  lose(world, king);
  assert.deepEqual(world.points, [0, 0, 0]);
  assert.equal(world.onCourt[server], server === 0 ? 0 : 1);
  assert.equal(world.server, king, "the team coming on serves");
  // Now the receivers (the new kings) win: a point.
  const kingTeam = world.onCourt[server];
  lose(world, king);
  assert.equal(world.points[kingTeam], 1);
});

test("a king-of-the-court world survives the codec mid-rally, mid-settle and benched; a forged one is refused", () => {
  const world = kings(5);
  hold(world, 200, [RIGHT, LEFT, 0, JUMP, JUMP, 0]);
  assert.deepEqual(decodeWorld(encodeWorld(world)), world);
  lose(world, 0);
  const encoded = encodeWorld(world);
  assert.equal(encoded.length, 19 + 6 + 6);
  assert.deepEqual(decodeWorld(encoded), world);
  const forge = (edit: (raw: unknown[]) => void) => {
    const raw = structuredClone(encoded) as unknown[];
    edit(raw);
    return decodeWorld(raw);
  };
  const tail = encoded.length - 6;
  assert.equal(
    forge((raw) => (raw[tail + 5] = raw[tail + 4])),
    undefined,
    "one team on both sides",
  );
  assert.equal(
    forge((raw) => (raw[tail + 4] = 3)),
    undefined,
    "a fourth team",
  );
  // A waiting blob is parked at the left wall.
  const bench = world.onCourt.includes(0)
    ? world.onCourt.includes(1)
      ? 2
      : 1
    : 0;
  assert.equal(
    forge((raw) => ((raw[19 + bench] as unknown[])[1] = 300)),
    undefined,
  );
  // Points past the target with nobody having won never happen.
  assert.equal(
    forge((raw) => (raw[tail + 1] = T.KINGS_RALLY_TARGET)),
    undefined,
  );
  // Six blobs on two sides carry no points: a three-a-side world with king fields is refused.
  assert.equal(
    forge((raw) => (raw[tail] = 0)),
    undefined,
  );
});

test("king-of-the-court bots play a whole match and every team gets on court", () => {
  const world = match([1, 1, 1, 1, 1, 1], 21, kings);
  assert.equal(world.phase, "over");
  assert.equal(Math.max(...world.points), T.KINGS_RALLY_TARGET);
  for (const blob of world.blobs)
    assert.ok(blob.hits > 5, `${world.blobs.map((b) => b.hits)}`);
  const view = toView(world);
  assert.equal(view.matchPoint, -1);
  assert.deepEqual(view.score, [
    world.points[world.onCourt[0]],
    world.points[world.onCourt[1]],
  ]);
});

test("the platform takes a three-team field placed by points, and refuses a bad one", () => {
  const stats = (
    slot: number,
    placement: number,
    points: number,
  ): FuseVolleyStats => ({
    playerId: `${"a".repeat(23)}${slot}`,
    name: `P${slot}`,
    slot,
    roundsPlayed: 1,
    roundWins: placement === 1 ? 1 : 0,
    matchScoreUnits: points,
    matchPlacement: placement,
    earlyExits: 0,
    points,
    hits: 10,
  });
  const by = (team: number, placement: number, points: number) =>
    [team, team + 3].map((slot) => stats(slot, placement, points));
  const field = [...by(0, 3, 4), ...by(1, 1, 11), ...by(2, 2, 9)].sort(
    (a, b) => a.slot - b.slot,
  );
  assert.equal(validFuseVolleyField(field), true);
  const tied = [...by(0, 2, 4), ...by(1, 1, 7), ...by(2, 2, 4)].sort(
    (a, b) => a.slot - b.slot,
  );
  assert.equal(validFuseVolleyField(tied), true, "level teams share second");
  const wrong = [...by(0, 2, 4), ...by(1, 1, 11), ...by(2, 3, 9)];
  assert.equal(validFuseVolleyField(wrong), false, "placed against the points");
  const short = [...by(0, 3, 4), ...by(1, 1, 10), ...by(2, 2, 9)];
  assert.equal(validFuseVolleyField(short), false, "nobody reached a target");
  // Three a side still validates as two sides.
  const sides = [0, 1, 2, 3, 4, 5].map((slot) =>
    slot % 2 === 0 ? stats(slot, 1, 11) : stats(slot, 2, 6),
  );
  assert.equal(validFuseVolleyField(sides), true);
  assert.equal(validFuseVolleyField(sides.slice(0, 5)), false);
});
