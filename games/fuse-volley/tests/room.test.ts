import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  PRESENCE,
  SPECTATOR,
  type StreamEntries,
} from "fuse-netcode";
import {
  DEFAULT_SETTINGS,
  PLAY,
  createRoom,
  decode,
  encode,
  firstStepBits,
  foldTick,
  fuseVolleyGame,
  hash,
  isEntry,
  parseSettings,
  view,
  type BotInput,
  type Entry,
  type Room,
  type Settings,
} from "../src/online/game.js";
import {
  JUMP,
  LEFT,
  RIGHT,
  STEPS_PER_TICK,
  seedOf,
  type Side,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";

import {
  fold,
  run,
  seated,
  started,
  finish,
  type Bodies,
} from "./fixtures/room.js";

test("settings are exactly a display flag, a scoring rule and a bot level", () => {
  assert.deepEqual(parseSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.scoring, "rally");
  assert.deepEqual(
    parseSettings({ display: true, scoring: "classic", bot: 2 }),
    { display: true, scoring: "classic", bot: 2 },
  );
  for (const bad of [
    null,
    [],
    { display: true, scoring: "classic" },
    { display: true, scoring: "classic", bot: 3 },
    { display: true, scoring: "golden", bot: 1 },
    { display: "yes", scoring: "rally", bot: 1 },
    { display: true, scoring: "rally", bot: 1, extra: 1 },
  ])
    assert.equal(parseSettings(bad), undefined, JSON.stringify(bad));
});

test("entries: play names a match and carries three held bits; management uses the shared kinds", () => {
  assert.ok(isEntry([1, 1, PLAY, "m1", LEFT | JUMP]));
  assert.ok(isEntry([1, 1, PLAY, "m1", LEFT | RIGHT]));
  assert.ok(!isEntry([1, 1, PLAY, "m1", 8]));
  assert.ok(!isEntry([1, 1, PLAY, "m 1", 0]));
  assert.ok(!isEntry([0, 1, PLAY, "m1", 0]));
  assert.ok(!isEntry([1, 1, PLAY, "m1"]));
  assert.ok(isEntry([1, 1, JOIN, "a", "Ada", 0, "robot", 1]));
  assert.ok(!isEntry([1, 1, JOIN, "__proto__", "Ada", 0, "robot", 1]));
});

test("a match needs both seats; it starts with the lobby's scoring, seeded by its id", () => {
  const lobby = createRoom("m0", DEFAULT_SETTINGS);
  fold(lobby, { a: [[JOIN, "a", "Ada", 0, "robot", 1]] });
  fold(lobby, { a: [[ACTION, "start", "m1"]] });
  assert.equal(lobby.stage, "lobby");
  const room = started({ display: false, scoring: "classic", bot: 0 });
  assert.equal(room.stage, "running");
  assert.equal(room.world!.scoring, "classic");
  assert.equal(room.world!.seed, seedOf("m1"));
  assert.deepEqual(
    room.world!.blobs.map((blob) => blob.id),
    ["a", "b"],
  );
  assert.equal(room.simulationTick, room.tick * STEPS_PER_TICK);
});

test("held bits ride from one entry on; another match's entry and an away seat hold nothing", () => {
  const room = started();
  const left = room.world!.blobs[0];
  fold(room, { a: [[PLAY, "m1", RIGHT]] });
  const x = left.x;
  run(room, 3);
  assert.equal(left.x, x + 3 * STEPS_PER_TICK * T.RUN_SPEED);
  assert.equal(room.held.a, RIGHT);
  fold(room, { a: [[PLAY, "m0", 0]] });
  assert.equal(room.held.a, RIGHT, "an old match's entry changes nothing");
  fold(room, { a: [[PLAY, "m1", 0]] });
  assert.equal(room.held.a, undefined);
  fold(room, { b: [[PLAY, "m1", LEFT]] });
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.equal(room.held.b, undefined, "an away seat holds nothing");
});

test("a jump pressed and released inside one tick still jumps", () => {
  assert.equal(firstStepBits(0, JUMP), JUMP);
  assert.equal(firstStepBits(LEFT, RIGHT | JUMP), LEFT | JUMP);
  const room = started();
  fold(room, {
    a: [
      [PLAY, "m1", JUMP],
      [PLAY, "m1", 0],
    ],
  });
  assert.ok(room.world!.blobs[0].air, "the tap jumped");
  assert.equal(room.held.a, undefined);
});

test("a bot seat answers through the injected bot, with the lobby's level, once a tick", () => {
  const room = createRoom("m0", { display: false, scoring: "rally", bot: 2 });
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [BOT, "add", "bot:1", "Jelly", 1, "robot"],
    ],
  });
  assert.equal(room.seats.size, 2);
  fold(room, { a: [[ACTION, "start", "m1"]] });
  const asked: [Side, number][] = [];
  const bot: BotInput = (_world, side, level) => {
    asked.push([side, level]);
    return RIGHT;
  };
  const x = room.world!.blobs[1].x;
  run(room, 2, bot);
  assert.deepEqual(asked, [
    [1, 2],
    [1, 2],
  ]);
  assert.equal(room.world!.blobs[1].x, Math.min(x + 36, T.BLOB_MAX[1]));
  assert.equal(room.held["bot:1"], undefined, "a bot logs nothing");
});

test("a finished match freezes its decision; a checkpoint restores every stage and plays on identically", () => {
  const lobby = seated();
  const running = started();
  fold(running, { a: [[PLAY, "m1", RIGHT | JUMP]], b: [[PLAY, "m1", LEFT]] });
  run(running, 40);
  fold(running, { a: [[SPECTATOR, "join", "w", "Wes", 1]] });
  const over = started();
  finish(over, 1);
  assert.equal(over.decided?.winner, "a");
  assert.deepEqual(over.decided?.finishers, ["a", "b"]);
  assert.ok(over.decided!.clock <= over.simulationTick);
  for (const room of [lobby, running, over]) {
    const fields = structuredClone(encode(room));
    const restored = decode(fields, room.tick)!;
    assert.ok(restored, room.stage);
    assert.equal(hash(restored), hash(room));
    assert.deepEqual(view(restored), view(room));
    for (const each of [room, restored]) {
      fold(each, { a: [[PLAY, each.matchId, RIGHT]] });
      run(each, 30);
    }
    assert.equal(hash(restored), hash(room), `${room.stage} plays on the same`);
  }
});

test("a corrupt checkpoint is refused whole, and refusing it changes nothing", () => {
  const room = started();
  fold(room, { a: [[PLAY, "m1", RIGHT]] });
  run(room, 5);
  const over = started();
  finish(over, 0);
  const lobby = seated();
  const WORLD = 8;
  type Corrupt = (fields: unknown[]) => void;
  const at =
    (index: number, value: unknown): Corrupt =>
    (fields) => {
      fields[index] = value;
    };
  const cases: [string, Room, Corrupt][] = [
    ["a missing field", room, (fields) => fields.pop()],
    ["an unknown stage", room, at(1, "between")],
    ["a stage the world contradicts", room, at(1, "over")],
    ["a lobby with a world", room, at(1, "lobby")],
    ["unknown settings", room, at(2, { display: false, scoring: "x", bot: 1 })],
    [
      "a scoring the world is not playing",
      room,
      at(4, { display: false, scoring: "classic", bot: 1 }),
    ],
    ["held bits for a stranger", room, at(5, [["z", RIGHT]])],
    ["held bits past the mask", room, at(5, [["a", 8]])],
    ["held zero", room, at(5, [["a", 0]])],
    ["a roster of one", room, at(6, [["a", "Ada", false]])],
    ["a decision before the end", room, at(7, [1, "a", ["a", "b"]])],
    ["a world that is not one", room, at(WORLD, [1, 2, 3])],
    ["no world in a match", room, at(WORLD, null)],
    ["a clock off the log", room, at(9, room.tick * STEPS_PER_TICK + 1)],
    ["an ended match with no decision", over, at(7, null)],
    ["the wrong winner", over, at(7, [over.decided!.clock, "a", ["a", "b"]])],
    ["something held after the end", over, at(5, [["a", RIGHT]])],
    ["a lobby marked running", lobby, at(1, "running")],
  ];
  for (const [name, source, corrupt] of cases) {
    const fields = structuredClone(encode(source));
    assert.ok(decode(fields, source.tick), `${name}: sound before the damage`);
    corrupt(fields);
    const damaged = structuredClone(fields);
    assert.equal(decode(fields, source.tick), undefined, name);
    assert.deepEqual(fields, damaged, `${name}: the fields are left as given`);
  }
  assert.equal(decode(encode(room), -1), undefined);
});

test("the game names itself, its rules and a two-seat duel with one bot for solo", () => {
  assert.equal(fuseVolleyGame.id, "fuse-volley");
  assert.equal(fuseVolleyGame.rules, "fuse-volley-2");
  assert.equal(fuseVolleyGame.seating?.capacity, 2);
  assert.equal(fuseVolleyGame.maxSteps, STEPS_PER_TICK);
});
