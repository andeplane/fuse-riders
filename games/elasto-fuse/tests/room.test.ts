import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, JOIN, PRESENCE, SETTINGS } from "fuse-netcode";
import { matchResult, roundResult } from "../src/online/result.js";
import {
  DEFAULT_SETTINGS,
  INTERMISSION,
  PLAY,
  TOUR,
  createRoom,
  decode,
  elastoFuseGame,
  encode,
  firstStepBits,
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
  LEVEL_COUNT,
  RESTART,
  STEPS_PER_TICK,
  TURN,
  VOLT_LEFT,
} from "../src/engine/index.js";
import { PLACE_POINTS } from "../src/basics.js";
import { parseElastoFuseStats, validElastoFuseField } from "../src/platform.js";
import { fold, rideHome, run, seated, started } from "./fixtures/room.js";

const single = { display: false, level: 0 };
/** Folds empty ticks until the room leaves `stage`. */
const leave = (room: Room, stage: string) => {
  for (let i = 0; i < 2_000 && room.stage === stage; i++) fold(room);
  assert.notEqual(room.stage, stage);
};

test("settings are exactly a display flag and a level, or the tour", () => {
  assert.deepEqual(parseSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.level, TOUR);
  assert.deepEqual(parseSettings({ display: true, level: 3 }), {
    display: true,
    level: 3,
  });
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
  assert.equal(levelsOf(DEFAULT_SETTINGS).length, LEVEL_COUNT);
  assert.deepEqual(levelsOf(single), [0]);
});

test("entries: play names a match and carries six held bits; management uses the shared kinds", () => {
  assert.ok(isEntry([1, 1, PLAY, "m1", GAS | TURN]));
  assert.ok(isEntry([1, 1, PLAY, "m1", 63]));
  assert.ok(!isEntry([1, 1, PLAY, "m1", 64]));
  assert.ok(!isEntry([1, 1, PLAY, "", GAS]));
  assert.ok(!isEntry([0, 1, PLAY, "m1", GAS]));
  assert.ok(isEntry([1, 1, JOIN, "a", "Ada", 0, "robot", 1]));
  assert.ok(isEntry([1, 1, SETTINGS, { display: false, level: 2 }]));
  assert.ok(!isEntry([1, 1, SETTINGS, { display: false, level: 99 }]));
  assert.ok(!isEntry([1, 1, JOIN, "__proto__", "Ada", 0, "robot", 1]));
});

test("the first step of a tick sees a tap, and sees a bit let go and pressed again as up", () => {
  assert.equal(firstStepBits(0, [], 0), 0);
  assert.equal(firstStepBits(GAS, [], GAS), GAS);
  assert.equal(firstStepBits(0, [TURN, 0], 0), TURN, "a tap inside the tick");
  assert.equal(firstStepBits(GAS, [GAS | TURN, GAS], GAS), GAS | TURN);
  assert.equal(
    firstStepBits(GAS | TURN, [GAS, GAS | TURN], GAS | TURN),
    GAS,
    "released and pressed again: up for the first step, so it goes down on the second",
  );
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
  fold(room, { a: [[PLAY, "m1", GAS]], b: [[PLAY, "other", GAS]] });
  assert.deepEqual(room.held, { a: GAS });
  run(room, 3);
  assert.deepEqual(room.held, { a: GAS });
  fold(room, { a: [[PRESENCE, "a", false]] });
  assert.deepEqual(room.held, {}, "an away seat holds nothing");
});

test("a restart tapped inside one tick restarts; a volt held across ticks volts once", () => {
  const room = started(single);
  while (room.world!.phase === "countdown") fold(room);
  fold(room, { a: [[PLAY, "m1", GAS]] });
  run(room, 40);
  assert.ok(room.world!.riders[0]!.run > 100);
  fold(room, {
    a: [
      [PLAY, "m1", GAS | RESTART],
      [PLAY, "m1", GAS],
    ],
  });
  assert.equal(room.world!.riders[0]!.run, STEPS_PER_TICK - 1);
  assert.equal(room.world!.riders[0]!.deaths, 1);
  fold(room, { b: [[PLAY, "m1", VOLT_LEFT]] });
  const volted = room.world!.riders[1]!.bike.lastVolt;
  run(room, 5);
  assert.equal(room.world!.riders[1]!.bike.lastVolt, volted);
});

test("a tour races every level in turn with place points, resting between races", () => {
  const room = started();
  assert.equal(view(room).rounds, LEVEL_COUNT);
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
    fold(room, { b: [[PLAY, "m1", i % 2 ? GAS : 0]] });
    fold(copy, { b: [[PLAY, "m1", i % 2 ? GAS : 0]] });
  }
  assert.equal(hash(copy), hash(room));
  check(room);
  const one = started(single);
  rideHome(one, "a");
  rideHome(one, "b");
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
