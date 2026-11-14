import test from "node:test";
import assert from "node:assert/strict";
import {
  BTN,
  COUNTDOWN_STEPS,
  DOWN,
  LEFT,
  MAPS,
  MAP_IDS,
  RIGHT,
  UP,
  GOAL_STEPS,
  decodeWorld,
  encodeWorld,
  riderId,
  stepWorld,
  type World,
} from "../src/engine/index.js";
import { SUB } from "../src/engine/math.js";
import {
  ballAt,
  fresh,
  held,
  place,
  playing,
  scripted,
  steps,
} from "./fixtures/world.js";

/** Positions in the encoded world. */
const MAP = 1,
  STEP = 2,
  PHASE = 3,
  PHASE_STEPS = 4,
  SCORE_A = 5,
  SCORE_B = 6,
  LAST_SCORER = 7,
  SUDDEN_DEATH = 8,
  RIDER_A = 9,
  RIDER_B = 10,
  BUBBLE_A = 11,
  BUBBLE_B = 12,
  BALL = 13;

function goal(world: World, team: 0 | 1): void {
  const rect = MAPS.gridlock.goals.find((each) => each.team === team)!;
  ballAt(world, rect.x + 6, rect.y + 40);
  stepWorld(world, new Map());
}

/** Worlds in every phase, with bubbles, a slide and a hard bubble among them. */
function samples(): Record<string, World> {
  const play = playing();
  place(play, 0, 215, 200);
  stepWorld(play, held(BTN, DOWN | BTN));
  steps(play, 12, held(BTN, DOWN | BTN));

  const zap = playing();
  place(zap, 1, 400, 100);
  stepWorld(zap, held(0, BTN));
  goal(zap, 0);
  steps(zap, 40, held(RIGHT));

  const second = playing();
  goal(second, 1);
  steps(second, GOAL_STEPS + 100);

  const over = playing();
  for (let i = 0; i < 2; i++) {
    goal(over, 0);
    steps(over, GOAL_STEPS + COUNTDOWN_STEPS);
    goal(over, 1);
    steps(over, GOAL_STEPS + COUNTDOWN_STEPS);
  }
  goal(over, 1);
  steps(over, GOAL_STEPS);

  return {
    countdown: fresh("halo"),
    play,
    zap,
    "second countdown": second,
    over,
    downlink: playing("downlink"),
  };
}

/** A copy of an encoded world with one change made to it. */
function altered(world: World, change: (fields: unknown[]) => void): unknown {
  const fields = structuredClone(encodeWorld(world));
  change(fields);
  return fields;
}
const part = (fields: unknown[], index: number): unknown[] => {
  const tuple = fields[index];
  assert.ok(Array.isArray(tuple));
  return tuple;
};

test("a world in any phase encodes to plain integers and ids, and decodes to an equal world", () => {
  const worlds = samples();
  assert.deepEqual(
    Object.values(worlds).map((world) => world.phase),
    ["countdown", "play", "zap", "countdown", "over", "play"],
  );
  assert.ok(worlds.play!.bubbles[0].hard && worlds.play!.riders[1].slide > 0);
  assert.ok(worlds.over!.suddenDeath);
  for (const [name, world] of Object.entries(worlds)) {
    const fields = encodeWorld(world);
    const flat = fields.flat(2);
    assert.ok(
      flat.every(
        (field) => Number.isSafeInteger(field) || typeof field === "string",
      ),
      name,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(fields)), fields, name);
    const decoded = decodeWorld(JSON.parse(JSON.stringify(fields)));
    assert.deepEqual(decoded, world, name);
    assert.notEqual(decoded, world);
    assert.deepEqual(encodeWorld(decoded!), fields, name);
  }
});

test("a decoded world plays on exactly as the original does", () => {
  for (const mapId of MAP_IDS) {
    const world = fresh(mapId),
      next = scripted(5);
    const keys = [0, LEFT, RIGHT, BTN, RIGHT | BTN, LEFT | BTN, DOWN | BTN, UP];
    const inputs = () =>
      held(keys[next() % keys.length]!, keys[next() % keys.length]!);
    let now = inputs();
    for (let i = 0; i < 1500; i++) {
      if (i % 6 === 0) now = inputs();
      stepWorld(world, now);
    }
    const copy = decodeWorld(encodeWorld(world));
    assert.ok(copy, "every world the engine reaches passes its own checks");
    for (let i = 0; i < 1500; i++) {
      if (i % 6 === 0) now = inputs();
      stepWorld(world, now);
      stepWorld(copy, now);
      if (i % 100 === 0)
        assert.ok(decodeWorld(encodeWorld(world)), `${mapId} step ${i}`);
    }
    assert.deepEqual(copy, world);
  }
});

test("decoding refuses anything that is not a whole encoded world", () => {
  const fields = encodeWorld(playing());
  for (const raw of [
    undefined,
    null,
    7,
    "world",
    {},
    [],
    fields.slice(0, -1),
    [...fields, 0],
    Object.fromEntries(fields.entries()),
  ])
    assert.equal(decodeWorld(raw), undefined);
  assert.equal(
    decodeWorld(altered(playing(), (f) => (f[0] = 99))),
    undefined,
    "an unknown version",
  );
});

test("decoding refuses each top-level field out of range", () => {
  const world = playing();
  const cases: [string, number, unknown][] = [
    ["map", MAP, MAP_IDS.length],
    ["map", MAP, -1],
    ["map", MAP, "gridlock"],
    ["step", STEP, -1],
    ["step", STEP, 0x8000_0000],
    ["step", STEP, 1.5],
    ["phase", PHASE, 4],
    ["phase", PHASE, "play"],
    ["phase steps", PHASE_STEPS, 1],
    ["phase steps", PHASE_STEPS, -1],
    ["score", SCORE_A, 4],
    ["score", SCORE_A, -1],
    ["score", SCORE_B, 0.5],
    ["last scorer", LAST_SCORER, 2],
    ["last scorer", LAST_SCORER, -2],
    ["sudden death", SUDDEN_DEATH, 2],
    ["sudden death", SUDDEN_DEATH, true],
    ["rider", RIDER_A, null],
    ["rider", RIDER_B, []],
    ["bubble", BUBBLE_A, [1, 0, 0, 0]],
    ["bubble", BUBBLE_B, "bubble"],
    ["ball", BALL, [0, 0, 0, 0, 1, 0]],
  ];
  for (const [name, index, value] of cases)
    assert.equal(
      decodeWorld(altered(world, (f) => (f[index] = value))),
      undefined,
      `${name} = ${JSON.stringify(value)}`,
    );
});

test("decoding refuses each rider field out of range", () => {
  const world = playing();
  const cases: [string, number, unknown][] = [
    ["id", 0, ""],
    ["id", 0, 7],
    ["id", 0, "x".repeat(65)],
    ["x", 1, -1],
    ["x", 1, 640 * SUB],
    ["x", 1, 0.5],
    ["y", 2, 8 * SUB],
    ["y", 2, 352 * SUB],
    ["y", 2, null],
    ["vx", 3, 14507],
    ["vx", 3, -14507],
    ["vy", 4, -8705],
    ["vy", 4, 17409],
    ["vy", 4, -0],
    ["facing", 5, 0],
    ["facing", 5, 2],
    ["grounded", 6, 2],
    ["grounded", 6, false],
    ["held bits", 7, 32],
    ["held bits", 7, LEFT | RIGHT],
    ["slide", 8, 79],
    ["slide", 8, -1],
    ["zapped", 9, 1],
    ["jumps", 10, 65536],
    ["pops", 11, -1],
    ["goals", 12, 1],
    ["own goals", 13, 1],
    ["own goals", 13, 4],
  ];
  for (const index of [RIDER_A, RIDER_B])
    for (const [name, field, value] of cases)
      assert.equal(
        decodeWorld(altered(world, (f) => (part(f, index)[field] = value))),
        undefined,
        `rider ${name} = ${JSON.stringify(value)}`,
      );
  assert.equal(
    decodeWorld(
      altered(world, (f) => (part(f, RIDER_B)[0] = part(f, RIDER_A)[0])),
    ),
    undefined,
    "two riders with one id",
  );
  assert.equal(
    decodeWorld(altered(world, (f) => part(f, RIDER_A).push(0))),
    undefined,
    "an extra field",
  );
});

test("a rider may be anywhere along an axis that wraps, but not in the edge of one that does not", () => {
  const sideways = playing("gridlock"),
    upright = playing("downlink");
  assert.ok(decodeWorld(altered(sideways, (f) => (part(f, RIDER_A)[1] = 0))));
  assert.equal(
    decodeWorld(altered(upright, (f) => (part(f, RIDER_A)[1] = 0))),
    undefined,
  );
  assert.ok(decodeWorld(altered(upright, (f) => (part(f, RIDER_A)[2] = 0))));
  assert.equal(
    decodeWorld(altered(sideways, (f) => (part(f, RIDER_A)[2] = 0))),
    undefined,
  );
});

test("decoding refuses each bubble and ball field out of range", () => {
  const world = playing();
  place(world, 0, 215, 200);
  stepWorld(world, held(BTN));
  assert.ok(world.bubbles[0].hard);
  const bubble: [string, number, unknown][] = [
    ["active", 0, 2],
    ["active", 0, 0],
    ["x", 1, -1],
    ["x", 1, 640 * SUB],
    ["y", 2, 360 * SUB],
    ["y", 2, 1.25],
    ["hard", 3, 2],
    ["seq", 4, 65536],
    ["seq", 4, -1],
  ];
  for (const [name, field, value] of bubble)
    assert.equal(
      decodeWorld(altered(world, (f) => (part(f, BUBBLE_A)[field] = value))),
      undefined,
      `bubble ${name} = ${JSON.stringify(value)}`,
    );
  assert.equal(
    decodeWorld(altered(world, (f) => (part(f, BUBBLE_B)[3] = 1))),
    undefined,
    "a hard bubble that is not active",
  );
  const ball: [string, number, unknown][] = [
    ["x", 0, 640 * SUB],
    ["x", 0, -1],
    ["y", 1, 7 * SUB],
    ["y", 1, "0"],
    ["vx", 2, 15958],
    ["vx", 2, -15958],
    ["vy", 3, 15958],
    ["vy", 3, 0.1],
    ["live", 4, 0],
    ["live", 4, 2],
    ["bounces", 5, 65536],
    ["touch", 6, 2],
    ["touch", 6, -2],
  ];
  for (const [name, field, value] of ball)
    assert.equal(
      decodeWorld(altered(world, (f) => (part(f, BALL)[field] = value))),
      undefined,
      `ball ${name} = ${JSON.stringify(value)}`,
    );
});

test("decoding refuses fields that disagree with each other", () => {
  const { play, zap, over, countdown } = samples();
  const refused = (world: World, change: (f: unknown[]) => void, why: string) =>
    assert.equal(decodeWorld(altered(world, change)), undefined, why);

  refused(play!, (f) => (f[PHASE] = 0), "a countdown with no time on it");
  refused(play!, (f) => (f[PHASE] = 2), "a zap with no time on it");
  refused(play!, (f) => (f[PHASE] = 3), "over with nobody on three");
  refused(countdown!, (f) => (f[PHASE_STEPS] = 361), "too long a countdown");
  refused(countdown!, (f) => (f[PHASE] = 1), "play with a countdown running");
  refused(zap!, (f) => (f[PHASE_STEPS] = 361), "too long a zap");
  refused(play!, (f) => (f[SCORE_A] = 1), "a point nobody scored");
  refused(play!, (f) => (f[LAST_SCORER] = 0), "a scorer with no points");
  refused(play!, (f) => (f[SUDDEN_DEATH] = 1), "sudden death at 0–0");
  refused(over!, (f) => (f[SUDDEN_DEATH] = 0), "2–3 without sudden death");
  refused(over!, (f) => (f[SCORE_A] = 3), "both sides on three");
  refused(over!, (f) => (f[PHASE] = 1), "play after the winning point");
  refused(
    zap!,
    (f) => {
      f[SCORE_A] = 0;
      part(f, RIDER_A)[12] = 0;
    },
    "a zap after no point",
  );
  refused(zap!, (f) => (f[LAST_SCORER] = 1), "the wrong side credited");
  refused(zap!, (f) => (part(f, RIDER_B)[9] = 0), "nobody zapped in a zap");
  refused(zap!, (f) => (part(f, RIDER_A)[9] = 1), "the scorer zapped too");
  refused(zap!, (f) => (part(f, RIDER_B)[3] = 5), "a zapped rider moving");
  refused(zap!, (f) => (part(f, BALL)[4] = 1), "a live ball after the goal");
  refused(zap!, (f) => (part(f, BALL)[2] = 5), "a dead ball moving");
  refused(
    zap!,
    (f) => {
      part(f, RIDER_A)[12] = 0;
      part(f, RIDER_A)[13] = 1;
    },
    "a point credited as the scorer's own goal",
  );
  refused(
    play!,
    (f) => (part(f, RIDER_A)[7] = 0),
    "a hard bubble nobody is holding",
  );
  refused(
    countdown!,
    (f) => (part(f, BUBBLE_A)[0] = 1),
    "a bubble during the countdown",
  );
});

test("a refused world leaves what it was given untouched", () => {
  const fields = altered(playing(), (f) => (f[SCORE_A] = 9)),
    before = structuredClone(fields);
  assert.equal(decodeWorld(fields), undefined);
  assert.deepEqual(fields, before);
});

test("a rider id is a short non-empty string", () => {
  assert.ok(riderId("solo"));
  assert.ok(riderId("bot:1"));
  assert.ok(!riderId(""));
  assert.ok(!riderId("x".repeat(65)));
  assert.ok(!riderId(1));
});
