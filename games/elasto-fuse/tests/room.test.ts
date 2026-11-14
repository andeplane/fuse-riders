import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, JOIN, PRESENCE, SETTINGS } from "fuse-netcode";
import { matchResult, roundResult } from "../src/online/result.js";
import {
  DEFAULT_SETTINGS,
  INTERMISSION,
  PLAY,
  createRoom,
  decode,
  elastoFuseGame,
  encode,
  hash,
  isEntry,
  levelsOf,
  order,
  parseSettings,
  view,
  type Room,
} from "../src/online/game.js";
import {
  GAS,
  COUNTDOWN,
  CLOSE_LAG,
  RACE_GRACE,
  RACE_LIMIT,
  RIDER_AHEAD,
  LEVEL_COUNT,
  RESTART,
  STEPS_PER_TICK,
  TURN,
  VOLT_LEFT,
} from "../src/engine/index.js";
import { PLACE_POINTS } from "../src/basics.js";
import { parseElastoFuseStats, validElastoFuseField } from "../src/platform.js";
import { fold, play, rideHome, run, seated, started } from "./fixtures/room.js";

const single = { ...DEFAULT_SETTINGS, count: 1 as const };

test("series lengths, wraparound and seeded random order agree across checkpoints", () => {
  for (const count of [3, 5, 10] as const) {
    const settings = { ...DEFAULT_SETTINGS, level: LEVEL_COUNT - 2, count };
    const consecutive = levelsOf(settings, "m1");
    assert.equal(consecutive.length, count);
    assert.deepEqual(consecutive.slice(0, 3), [
      LEVEL_COUNT - 2,
      LEVEL_COUNT - 1,
      0,
    ]);
    const random = { ...settings, order: "random" as const };
    const sequence = levelsOf(random, "m1");
    assert.equal(new Set(sequence).size, count, "no repeat within a match");
    assert.ok(sequence.every((level) => level >= 0 && level < LEVEL_COUNT));
    assert.deepEqual(levelsOf(random, "m1"), sequence);
    assert.notDeepEqual(
      levelsOf(random, "m2"),
      sequence,
      "rematch gets a new sequence",
    );
    const room = started(random);
    const restored = decode(encode(room), room.tick)!;
    assert.ok(restored);
    assert.equal(restored.world!.level, sequence[0]);
    // Nobody rides: the race waits out its limit and the lag after it.
    const ticks =
      (COUNTDOWN + RACE_LIMIT + CLOSE_LAG + INTERMISSION) / STEPS_PER_TICK;
    run(room, ticks);
    run(restored, ticks);
    assert.equal(room.world!.level, sequence[1]);
    assert.equal(
      hash(restored),
      hash(room),
      "recovered room advances through the same sequence",
    );
  }
});
/** Folds empty ticks until the room leaves `stage`. */
const leave = (room: Room, stage: string) => {
  for (let i = 0; i < 2_000 && room.stage === stage; i++) fold(room);
  assert.notEqual(room.stage, stage);
};

test("settings validate the starting level, order and bounded match length", () => {
  assert.deepEqual(parseSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.level, 0);
  assert.deepEqual(
    parseSettings({ ...DEFAULT_SETTINGS, display: true, level: 3 }),
    {
      ...DEFAULT_SETTINGS,
      display: true,
      level: 3,
    },
  );
  for (const bad of [
    null,
    {},
    { display: false },
    { display: false, level: LEVEL_COUNT },
    { display: false, level: -2 },
    { display: false, level: 1.5 },
    { display: 1, level: 0 },
    { display: false, level: 0, extra: 1 },
  ])
    assert.equal(parseSettings(bad), undefined, JSON.stringify(bad));
  assert.deepEqual(levelsOf(DEFAULT_SETTINGS, "m1"), [0, 1, 2]);
  assert.deepEqual(levelsOf(single, "m1"), [0]);
  for (const bad of [
    { count: 2 },
    { count: 11 },
    { order: "unknown" },
    { level: LEVEL_COUNT },
  ])
    assert.equal(parseSettings({ ...DEFAULT_SETTINGS, ...bad }), undefined);
});

test("entries: play names a match and a race, six held bits and a step of the rider's clock; management uses the shared kinds", () => {
  assert.ok(isEntry([1, 1, PLAY, "m1", GAS | TURN, 0, 0]));
  assert.ok(isEntry([1, 1, PLAY, "m1", 63, RACE_LIMIT, 9]));
  assert.ok(!isEntry([1, 1, PLAY, "m1", 64, 0, 0]));
  assert.ok(!isEntry([1, 1, PLAY, "m1", GAS, RACE_LIMIT + 1, 0]));
  assert.ok(!isEntry([1, 1, PLAY, "m1", GAS, 1.5, 0]));
  assert.ok(!isEntry([1, 1, PLAY, "m1", GAS, 0, 10]));
  assert.ok(!isEntry([1, 1, PLAY, "m1", GAS, 0]));
  assert.ok(!isEntry([1, 1, PLAY, "m1", GAS]));
  assert.ok(!isEntry([1, 1, PLAY, "", GAS, 0, 0]));
  assert.ok(!isEntry([0, 1, PLAY, "m1", GAS, 0, 0]));
  assert.ok(isEntry([1, 1, JOIN, "a", "Ada", 0, "robot", 1]));
  assert.ok(isEntry([1, 1, SETTINGS, { ...DEFAULT_SETTINGS, level: 2 }]));
  assert.ok(!isEntry([1, 1, SETTINGS, { display: false, level: LEVEL_COUNT }]));
  assert.ok(!isEntry([1, 1, JOIN, "__proto__", "Ada", 0, "robot", 1]));
});

test("a rider runs as far as its device says, on what it held, whatever the room's clock reads", () => {
  const room = started(single);
  const [a, b] = room.world!.riders;
  fold(room, { a: [play(room, GAS, 0)] });
  assert.equal(a!.step, 0);
  fold(room, { a: [play(room, GAS, 12)] });
  assert.equal(room.world!.phase, "countdown", "the room is still counting");
  assert.equal(a!.step, 12, "and the rider is where its own clock says");
  assert.equal(a!.run, 12);
  assert.equal(b!.step, 0, "a rider that said nothing has not moved");
  // Word from another race, and a step already ridden, move nobody.
  fold(room, { a: [[PLAY, room.matchId, GAS, 40, room.round + 1]] });
  fold(room, { a: [play(room, GAS, 5)] });
  assert.equal(a!.step, 12);
  // A clock far ahead of the race's is held to its reach.
  fold(room, { a: [play(room, GAS, RACE_LIMIT)] });
  assert.equal(a!.step, room.world!.step + RIDER_AHEAD);

  // A press on a later step moves the bike later than the same press on an earlier one.
  const early = started(single),
    late = started(single);
  fold(early, { a: [play(early, GAS, 2), play(early, GAS, 16)] });
  fold(late, { a: [play(late, GAS, 9), play(late, GAS, 16)] });
  assert.equal(late.held["a"], GAS);
  assert.equal(late.world!.riders[0]!.step, early.world!.riders[0]!.step);
  assert.notDeepEqual(
    late.world!.riders[0]!.bike,
    early.world!.riders[0]!.bike,
  );
});

test("the race waits for a rider who is there, but not forever for one who stopped saying how far it rode", () => {
  const room = started(single);
  rideHome(room, "a");
  assert.equal(room.stage, "running", "b is still out");
  const close = room.world!.close;
  assert.equal(close, room.world!.riders[0]!.finish + RACE_GRACE);
  while (room.stage === "running") fold(room);
  const waited = room.world!.step - close - CLOSE_LAG;
  assert.ok(waited >= 0 && waited < STEPS_PER_TICK);
  assert.equal(room.decided!.winner, "a");
});

test("one rider is enough; a single level is one race, decided when it closes", () => {
  const room = createRoom("m0", single);
  fold(room, { a: [[JOIN, "a", "Ada", 0, "robot", 1]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.world!.riders.length, 1);
  assert.equal(room.world!.phase, "countdown");
  assert.equal(matchResult(room), undefined);
  rideHome(room, "a");
  assert.equal(room.stage, "over");
  assert.equal(room.decided!.winner, "a");
  assert.deepEqual(room.standings, [
    {
      points: PLACE_POINTS[0],
      wins: 1,
      finishes: 1,
      deaths: 0,
      clock: room.world!.riders[0]!.finish,
    },
  ]);
  const result = matchResult(room)!;
  assert.equal(result.winnerId, "a");
  assert.deepEqual(result.finishers, ["a"]);
  const stats = parseElastoFuseStats(
    { ...result.players[0], playerId: "0123456789abcdef01234567" },
    1,
  );
  assert.equal(stats?.points, PLACE_POINTS[0]);
  assert.ok(validElastoFuseField(result.players));
  assert.equal(roundResult(room)!.round, 1);
  assert.deepEqual(room.held, {}, "nothing is held into the next match");
});

test("held bits ride from one entry on; another match's entry and an away seat hold nothing", () => {
  const room = started(single);
  fold(room, {
    a: [play(room, GAS)],
    b: [[PLAY, "other", GAS, 0, 0]],
  });
  assert.deepEqual(room.held, { a: GAS });
  run(room, 3);
  assert.deepEqual(room.held, { a: GAS });
  fold(room, { a: [[PRESENCE, "a", false, 1]] });
  assert.deepEqual(room.held, {}, "an away seat holds nothing");
});

test("a restart tapped for one step restarts; a volt held across ticks volts once", () => {
  const room = started(single);
  fold(room, { a: [play(room, GAS, 0), play(room, GAS, 140)] });
  assert.equal(room.world!.riders[0]!.run, 140);
  fold(room, {
    a: [
      play(room, GAS | RESTART, 140),
      play(room, GAS, 141),
      play(room, GAS, 144),
    ],
  });
  assert.equal(room.world!.riders[0]!.run, STEPS_PER_TICK - 1);
  assert.equal(room.world!.riders[0]!.deaths, 1);
  fold(room, { b: [play(room, VOLT_LEFT, 2), play(room, VOLT_LEFT, 8)] });
  const volted = room.world!.riders[1]!.bike.lastVolt;
  fold(room, { b: [play(room, VOLT_LEFT, 28)] });
  assert.equal(room.world!.riders[1]!.step, 28);
  assert.equal(room.world!.riders[1]!.bike.lastVolt, volted);
});

test("a tour races every level in turn with place points, resting between races", () => {
  const room = started();
  assert.equal(view(room).rounds, DEFAULT_SETTINGS.count);
  rideHome(room, "a");
  // a is home; b never moved, so the race runs out its grace.
  leave(room, "running");
  assert.equal(room.stage, "between");
  assert.equal(room.pause, INTERMISSION);
  assert.equal(room.round, 0);
  assert.deepEqual(
    room.standings.map((standing) => standing.points),
    [PLACE_POINTS[0], 0],
  );
  assert.equal(room.standings[1]!.clock, room.world!.close);
  const shown = view(room);
  assert.equal(shown.stage, "between");
  assert.deepEqual(shown.order, [0, 1]);
  run(room, INTERMISSION / STEPS_PER_TICK);
  assert.equal(room.stage, "running");
  assert.equal(room.round, 1);
  assert.equal(room.world!.level, 1);
  assert.equal(room.world!.phase, "countdown");
  assert.equal(elastoFuseGame.scope(room).round, 1);
  // b wins the second race; the tie on points and wins goes to the lower clock.
  rideHome(room, "b");
  leave(room, "running");
  assert.deepEqual(
    room.standings.map((standing) => [standing.points, standing.wins]),
    [
      [10, 1],
      [10, 1],
    ],
  );
  assert.deepEqual(order(room.standings), [
    room.standings[0]!.clock <= room.standings[1]!.clock ? 0 : 1,
    room.standings[0]!.clock <= room.standings[1]!.clock ? 1 : 0,
  ]);
});

test("a checkpoint restores every stage and plays on identically", () => {
  const stages = new Set<string>();
  const check = (room: Room) => {
    stages.add(room.stage);
    const copy = decode(
      JSON.parse(JSON.stringify(encode(room))) as unknown[],
      room.tick,
    );
    assert.ok(copy, `decodes in ${room.stage}`);
    assert.equal(hash(copy), hash(room));
    return copy;
  };
  const room = seated();
  check(room);
  fold(room, { a: [[ACTION, "start", "m1"]] });
  check(room);
  rideHome(room, "a");
  const copy = check(room);
  for (let i = 0; room.stage === "running"; i++) {
    const body = play(room, i % 2 ? GAS : 0, i * STEPS_PER_TICK);
    fold(room, { b: [body] });
    fold(copy, { b: [body] });
  }
  assert.equal(hash(copy), hash(room));
  check(room);
  const one = started(single);
  fold(one, { a: [[PRESENCE, "b", false, 1]] });
  rideHome(one, "a");
  assert.equal(one.stage, "over");
  check(one);
  assert.deepEqual([...stages].sort(), ["between", "lobby", "over", "running"]);
});

test("a corrupt checkpoint is refused whole", () => {
  const room = started(single);
  rideHome(room, "a");
  const fields = encode(room);
  const broken = (change: (fields: unknown[]) => void, tick = room.tick) => {
    const list = JSON.parse(JSON.stringify(fields)) as unknown[];
    change(list);
    return decode(list, tick);
  };
  assert.ok(broken(() => {}));
  assert.equal(
    broken(() => {}, room.tick + 1),
    undefined,
    "the wrong tick",
  );
  assert.equal(
    broken((f) => (f[1] = "lobby")),
    undefined,
    "a lobby with a world",
  );
  assert.equal(
    broken((f) => (f[1] = "between")),
    undefined,
  );
  assert.equal(
    broken((f) => (f[7] = 1)),
    undefined,
    "a round past the levels",
  );
  assert.equal(
    broken((f) => (f[11] = null)),
    undefined,
    "no world",
  );
  assert.equal(
    broken((f) => (f[6] as unknown[]).pop()),
    undefined,
    "a rider short",
  );
  assert.equal(
    broken((f) => ((f[8] as number[][])[0]![0] = 11)),
    undefined,
    "more points than its finishes give",
  );
  assert.equal(
    broken((f) => (f[4] = { display: false, level: 1 })),
    undefined,
  );
  assert.equal(
    broken((f) => f.pop()),
    undefined,
  );
});

test("the game names itself, its rules and five seats, and solo is one rider with no bots", () => {
  assert.equal(elastoFuseGame.id, "elasto-fuse");
  assert.match(elastoFuseGame.rules, /^elasto-fuse-\d+$/);
  assert.equal(elastoFuseGame.seating.capacity, 5);
  assert.equal(elastoFuseGame.seating.minPlayers, 1);
  assert.deepEqual(elastoFuseGame.seating.solo, { name: "You", bots: 0 });
  assert.equal(elastoFuseGame.maxSteps, STEPS_PER_TICK);
});

test("controls let go between two races are not held into the next", () => {
  const room = started();
  rideHome(room, "a");
  fold(room, { b: [play(room, GAS)] });
  while (room.stage === "running") fold(room);
  assert.equal(room.stage, "between");
  assert.equal(room.held["b"], GAS);
  fold(room, { b: [play(room, 0)] });
  while (room.stage === "between") fold(room);
  assert.equal(room.stage, "running");
  assert.equal(room.round, 1);
  assert.equal(room.held["b"], undefined);
});
