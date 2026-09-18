import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  SETTINGS,
  SPECTATOR,
  packMessage,
  unpackMessage,
} from "fuse-netcode";
import {
  HOLD,
  ROLL,
  TARGET,
  createRoom,
  diceGame,
  isDiceEntry,
  parseSettings,
  type DiceRoom,
} from "../src/game/index.js";
import { FAST, addBot, fold, rig, runTo, started } from "./fixtures/dice.js";

const { encode, decode } = diceGame.checkpoint;
/** Encoded as a snapshot carries it: through MessagePack and back. */
const wire = (room: DiceRoom): unknown[] =>
  unpackMessage(packMessage(encode(room))) as unknown[];
const roundTrip = (room: DiceRoom) => decode(wire(room), room.tick);

/** Rooms in every stage, with a watcher, a bot, a departed player and decided rounds. */
function rooms() {
  const lobby = createRoom("m0", FAST);
  fold(lobby, { a: [[JOIN, "a", "Ada", 0, "fox", 1]] });
  const running = started(FAST, [
    addBot("bot:1", 2),
    [SPECTATOR, "join", "w", "Wat", 1],
  ]);
  rig(running, 5);
  fold(running, { a: [[ROLL, 1]] });
  const between = started();
  between.scores.a = TARGET;
  fold(between, { a: [[HOLD, 1]] });
  const over = structuredClone(between);
  runTo(over, over.resumeAt);
  over.scores.b = TARGET;
  fold(over, { b: [[HOLD, over.turnNo]] });
  runTo(over, over.resumeAt);
  fold(over, { a: [[LEAVE, "b"]] });
  over.scores.a = TARGET;
  fold(over, { a: [[HOLD, over.turnNo]] });
  return { lobby, running, between, over };
}

test("every stage of a room survives the checkpoint whole: the same hash, and it folds on identically", () => {
  for (const [stage, room] of Object.entries(rooms())) {
    const decoded = roundTrip(room);
    assert.ok(decoded, `${stage} decodes`);
    assert.equal(diceGame.hash(decoded), diceGame.hash(room), stage);
    assert.deepEqual(diceGame.view(decoded), diceGame.view(room), stage);
    runTo(decoded, room.tick + 100);
    runTo(room, room.tick + 100);
    assert.equal(diceGame.hash(decoded), diceGame.hash(room), `${stage} later`);
  }
  assert.equal(rooms().over.stage, "over");
  assert.equal(rooms().between.stage, "between");
  // The decoded room shares nothing with the fields it came from.
  const room = rooms().running,
    fields = wire(room),
    decoded = decode(fields, room.tick)!;
  decoded.scores.a = 49;
  decoded.seats.get("a")!.name = "Changed";
  assert.deepEqual(decode(fields, room.tick), roundTrip(room));
});

/** Rewrites one encoded field of a running room; the result must be refused. */
function tampered(change: (fields: unknown[]) => void, tick?: number) {
  const room = rooms().running,
    fields = wire(room);
  change(fields);
  return decode(fields, tick ?? room.tick);
}
const at = (fields: unknown[], ...path: number[]): unknown[] =>
  path.reduce<unknown[]>((value, index) => value[index] as unknown[], fields);

test("a corrupt or hostile checkpoint is refused whole", () => {
  assert.ok(
    tampered(() => {}),
    "the untouched fields decode",
  );
  const refused: [string, (fields: unknown[]) => void, number?][] = [
    ["too few fields", (f) => f.pop()],
    ["a header that is not a list", (f) => (f[0] = "x")],
    ["a match id with spaces", (f) => (at(f, 0)[0] = "a b")],
    ["round 0", (f) => (at(f, 0)[1] = 0)],
    ["an unknown stage", (f) => (at(f, 0)[2] = "paused")],
    ["a negative generator", (f) => (at(f, 0)[3] = -1)],
    ["a fractional turn number", (f) => (at(f, 0)[4] = 1.5)],
    ["a match timer out of bounds", (f) => (at(f, 0)[6] = 1)],
    ["seats that are not a list", (f) => (f[1] = {})],
    ["a seat with a bad id", (f) => (at(f, 1, 0)[0] = "no spaces")],
    ["a seat named __proto__", (f) => (at(f, 1, 0)[0] = "__proto__")],
    ["a seat with an empty name", (f) => (at(f, 1, 0)[1] = "")],
    ["a seat past capacity", (f) => (at(f, 1, 0)[2] = 5)],
    ["an unknown avatar", (f) => (at(f, 1, 0)[3] = "unicorn")],
    ["a human without a generation", (f) => (at(f, 1, 0)[6] = null)],
    ["a bot with a generation", (f) => (at(f, 1, 2)[6] = 1)],
    ["a watcher with a slot", (f) => (at(f, 1, 3)[2] = 3)],
    ["two seats in one slot", (f) => (at(f, 1, 1)[2] = 0)],
    [
      "one seat twice",
      (f) => (f[1] as unknown[]).push([...(at(f, 1, 0) as unknown[])]),
    ],
    [
      "settings out of bounds",
      (f) => (f[2] = { turnTicks: 1, display: false }),
    ],
    ["turn fields missing", (f) => at(f, 3).pop()],
    ["the turn of an unknown seat", (f) => (at(f, 3)[0] = "zed")],
    ["the turn of a watcher", (f) => (at(f, 3)[0] = "w")],
    ["a negative turn total", (f) => (at(f, 3)[1] = -5)],
    ["a deadline past any timer", (f) => (at(f, 3)[2] = 1_000_000)],
    ["a bot waiting too long", (f) => (at(f, 3)[3] = 1_000_000)],
    ["a die showing 7", (f) => (at(f, 3)[4] = 7)],
    ["a roll with nobody rolling", (f) => (at(f, 3)[5] = "")],
    ["a round winner nobody knows", (f) => (at(f, 3)[6] = "zed")],
    ["a winner while running", (f) => (at(f, 3)[7] = "a")],
    ["a break past its length", (f) => (at(f, 3)[8] = 1_000_000)],
    ["scores for a stranger", (f) => (at(f, 4)[0] = { zed: 3 })],
    [
      "scores with a __proto__ key",
      (f) => (at(f, 4)[0] = JSON.parse('{"__proto__": 3}') as unknown),
    ],
    ["scores past any game", (f) => (at(f, 4)[0] = { a: 1_000_000 })],
    ["a round win nobody played for", (f) => (at(f, 4)[1] = { a: 1 })],
    ["roster entries twice", (f) => at(f, 4, 3).push(at(f, 4, 3)[0])],
    ["a roster entry without a name", (f) => (at(f, 4, 3, 0)[1] = 7)],
    ["history that is not a list", (f) => (at(f, 4)[4] = {})],
    [
      "a decided round in the future",
      (f) => (at(f, 4)[4] = [[5, "a", { a: 50 }, 3, ["a"], ["a"]]]),
    ],
    ["a tick that is not a tick", () => {}, -1],
  ];
  for (const [what, change, tick] of refused)
    assert.equal(tampered(change, tick), undefined, what);

  // Stage and winners must agree.
  const over = rooms().over,
    fields = wire(over);
  at(fields, 3)[7] = "";
  assert.equal(decode(fields, over.tick), undefined, "over without a winner");
  const between = rooms().between,
    history = wire(between);
  at(history, 4)[4] = [];
  assert.equal(
    decode(history, between.tick),
    undefined,
    "a round win with no decided round",
  );
  const doubled = wire(between);
  at(doubled, 4)[4] = [
    [1, "a", { a: 50, b: 0 }, 3, ["a", "b"], ["a", "b"]],
    [1, "a", { a: 50, b: 0 }, 3, ["a", "b"], ["a", "b"]],
  ];
  at(doubled, 4)[1] = { a: 2 };
  assert.equal(decode(doubled, between.tick), undefined, "one round twice");
  const future = wire(between);
  at(future, 4, 4, 0)[3] = between.tick + 1;
  assert.equal(
    decode(future, between.tick),
    undefined,
    "a round decided after the room's tick",
  );
  const stats: [string, (row: unknown[]) => void][] = [
    ["more busts than rolls", (row) => (row[3] = 99)],
    ["a stranger's stats", (row) => (row[0] = "z")],
    ["a negative roll count", (row) => (row[1] = -1)],
    ["a best turn past the bank", (row) => (row[4] = 20_000)],
    ["a short row", (row) => row.pop()],
  ];
  for (const [name, change] of stats) {
    const fields = wire(between);
    change(at(fields, 4, 5, 0));
    assert.equal(decode(fields, between.tick), undefined, name);
  }
  const twice = wire(between);
  at(twice, 4)[5] = [at(twice, 4, 5, 0), at(twice, 4, 5, 0)];
  assert.equal(decode(twice, between.tick), undefined, "one player twice");
  const record = (present: unknown, finishers: unknown) => {
    const fields = wire(between);
    const decided = at(fields, 4, 4, 0);
    decided[4] = present;
    decided[5] = finishers;
    return decode(fields, between.tick);
  };
  assert.ok(record(["a", "b"], ["a"]), "a well-formed record decodes");
  assert.equal(record(["b", "a"], []), undefined, "present out of order");
  assert.equal(record(["a", "a"], []), undefined, "present twice");
  assert.equal(record(["a", "zed"], []), undefined, "a stranger present");
  assert.equal(record(["a"], ["b"]), undefined, "a finisher not present");
});

test("the entry parser accepts ROLL and HOLD naming a turn, and the shared management entries, and nothing else", () => {
  const accepted: unknown[] = [
    [1, 1, ROLL, 1],
    [4_294_967_295, 4_294_967_295, HOLD, 4_294_967_295],
    [1, 1, JOIN, "a", "Ada", 0, "fox", 1],
    [1, 1, JOIN, "a", "constructor", 4, "robot", 0],
    [1, 1, LEAVE, "a"],
    [1, 1, PRESENCE, "a", false, 2],
    [1, 1, SETTINGS, { turnTicks: 40, display: true }],
    [1, 1, ACTION, "start", "m1"],
    [1, 1, BOT, "add", "bot:1", "Bot 1", 1],
    [1, 1, BOT, "remove", "bot:1"],
    [1, 1, SPECTATOR, "join", "w", "Wat", 1],
    [1, 1, SPECTATOR, "leave", "w"],
  ];
  for (const entry of accepted)
    assert.equal(isDiceEntry(entry), true, JSON.stringify(entry));
  const refused: unknown[] = [
    undefined,
    null,
    "roll",
    {},
    [],
    [1, 1, ROLL],
    [1, 1, ROLL, 1, 1],
    [0, 1, ROLL, 1],
    [1, 0, ROLL, 1],
    [1, 1, ROLL, 0],
    [1, 1, 2, 1],
    [1, 1, "0", 1],
    [1.5, 1, ROLL, 1],
    [1, -1, HOLD, 1],
    [1, 1, HOLD, 4_294_967_296],
    [1, 1, HOLD, "1"],
    [-0, 1, HOLD, 1],
    [1, 1, JOIN, "a", "Ada", 5, "fox", 1],
    [1, 1, JOIN, "a", "", 0, "fox", 1],
    [1, 1, JOIN, "a", " Ada", 0, "fox", 1],
    [1, 1, JOIN, "a", "x".repeat(19), 0, "fox", 1],
    [1, 1, JOIN, "a", "Ada", 0, "unicorn", 1],
    [1, 1, JOIN, "__proto__", "Ada", 0, "fox", 1],
    [1, 1, LEAVE, "constructor"],
    [1, 1, PRESENCE, "toString", true, 1],
    [1, 1, BOT, "add", "__proto__", "Bot", 1],
    [1, 1, SPECTATOR, "join", "hasOwnProperty", "Wat", 1],
    [1, 1, SETTINGS, { turnTicks: 39, display: false }],
    [1, 1, SETTINGS, { turnTicks: 40 }],
    [1, 1, SETTINGS, { turnTicks: 40, display: false, extra: 1 }],
    [1, 1, ACTION, "explode", "m1"],
  ];
  for (const entry of refused)
    assert.equal(isDiceEntry(entry), false, JSON.stringify(entry));
  assert.equal(
    parseSettings({ turnTicks: 1200, display: false })?.turnTicks,
    1200,
  );
  assert.equal(parseSettings({ turnTicks: 1201, display: false }), undefined);
  assert.equal(parseSettings([40, false]), undefined);
  assert.equal(parseSettings(null), undefined);
  assert.equal(parseSettings({ turnTicks: 40, display: "yes" }), undefined);
});
