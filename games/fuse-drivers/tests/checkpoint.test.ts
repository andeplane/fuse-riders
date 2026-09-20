import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION,
  BOT,
  JOIN,
  SPECTATOR,
  packMessage,
  unpackMessage,
  type StreamEntries,
} from "fuse-netcode";
import { decodeRoom, encodeRoom, hashRoom } from "../src/game/checkpoint.js";
import {
  BRAKE,
  CONTROLS,
  DEFAULT_SETTINGS,
  ITEM,
  LEFT,
  NITRO,
  RIGHT,
  createRoom,
  foldTick,
  type FuseDriversEntry,
  type FuseDriversRoom,
} from "../src/game/rules.js";
import { defined } from "./fixtures/defined.js";

/** Entry bodies (everything after seq and tick) each member logs at the next tick. */
type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1. */
function fold(room: FuseDriversRoom, bodies: Bodies = {}): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<FuseDriversEntry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as FuseDriversEntry),
    });
  foldTick(room, "a", streams);
}
const runTo = (room: FuseDriversRoom, tick: number): void => {
  while (room.tick < tick) fold(room);
};

/** A lobby with one seat in it: no race, no grid, no controls and no bot memory. */
function lobby(): FuseDriversRoom {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, { a: [[JOIN, "a", "Ada", 0, "fox", 1]] });
  return room;
}

/**
 * Two drivers, a bot and a watcher, driving long enough that the lights have gone out: past the countdown the
 * trucks are moving, the bots have steered and the item boxes have been armed.
 */
function racing(ticks = 80): FuseDriversRoom {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "fox", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
      [BOT, "add", "bot:1", "CPU 3", 2],
      [SPECTATOR, "join", "w", "Wat", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  for (let step = 0; step < ticks; step++) {
    const at = room.tick + 1;
    fold(
      room,
      at % 5 === 0
        ? {
            a: [[CONTROLS, at % 10 === 0 ? LEFT | NITRO : RIGHT]],
            b: [[CONTROLS, at % 15 === 0 ? BRAKE : ITEM]],
          }
        : {},
    );
  }
  return room;
}

/** The same race once it has been decided, as the fold leaves it: the room is over when the race is finished. */
function over(): FuseDriversRoom {
  const room = racing();
  room.race = { ...defined(room.race, "race"), phase: "finished" };
  room.stage = "over";
  return room;
}

/** Encoded as a snapshot carries it: through MessagePack and back. */
const wire = (room: FuseDriversRoom): unknown[] =>
  unpackMessage(packMessage(encodeRoom(room))) as unknown[];
const roundTrip = (room: FuseDriversRoom) => decodeRoom(wire(room), room.tick);
const at = (fields: unknown[], ...path: number[]): unknown[] =>
  path.reduce<unknown[]>((value, index) => value[index] as unknown[], fields);

test("the four leading fields are the ones the snapshot puts before the streams", () => {
  const fields = encodeRoom(racing(3));
  assert.equal(
    fields.length,
    7,
    "scalars, seats, settings, grid, then the rest",
  );
  assert.deepEqual(
    at(fields, 0),
    ["m1", 1, "running"],
    "the scalars, less the tick",
  );
  assert.ok(Array.isArray(fields[1]), "the seats");
  assert.deepEqual(fields[2], DEFAULT_SETTINGS, "the settings");
  assert.deepEqual(fields[3], ["a", "b", "bot:1"], "the grid");
});

test("a room in every stage survives the checkpoint whole: the same hash, and it folds on identically", () => {
  for (const [stage, room] of Object.entries({
    lobby: lobby(),
    racing: racing(),
    over: over(),
  })) {
    const decoded = roundTrip(room);
    assert.ok(decoded, `${stage} decodes`);
    assert.equal(hashRoom(decoded), hashRoom(room), stage);
    assert.deepEqual(decoded, room, `${stage} is rebuilt field for field`);
    runTo(decoded, room.tick + 40);
    runTo(room, room.tick + 40);
    assert.equal(hashRoom(decoded), hashRoom(room), `${stage} forty ticks on`);
  }
  const started = racing();
  assert.equal(started.stage, "running");
  assert.ok(
    defined(started.race, "race").tick >
      defined(started.race, "race").countdownEndTick,
    "the lights went out",
  );
  assert.equal(defined(started.race, "race").trucks.length, 3);
  assert.ok(
    Object.keys(started.bots).length === 1,
    "the bot remembers its steering",
  );

  // The decoded room shares nothing with the fields it came from.
  const fields = wire(started),
    decoded = defined(decodeRoom(fields, started.tick), "decoded");
  decoded.grid[0] = "zed";
  defined(decoded.race, "race").trucks[0]!.x = 1;
  defined(decoded.seats.get("a"), "seat").name = "Changed";
  assert.deepEqual(decodeRoom(fields, started.tick), roundTrip(started));
});

/** Rewrites one encoded field of a running room; the result must be refused. */
function tampered(change: (fields: unknown[]) => void, tick?: number) {
  const room = racing(),
    fields = wire(room);
  change(fields);
  return decodeRoom(fields, tick ?? room.tick);
}

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
    ["a stage with no race of its own", (f) => (at(f, 0)[2] = "between")],
    [
      "settings naming an unknown track",
      (f) => (f[2] = { track: "moon", display: false }),
    ],
    ["seats that are not a list", (f) => (f[1] = {})],
    ["a seat named __proto__", (f) => (at(f, 1, 0)[0] = "__proto__")],
    ["a seat past capacity", (f) => (at(f, 1, 0)[2] = 5)],
    ["two seats in one slot", (f) => (at(f, 1, 1)[2] = 0)],
    ["a watcher holding a slot", (f) => (at(f, 1, 3)[2] = 3)],
    ["a bot carrying a stream generation", (f) => (at(f, 1, 2)[6] = 1)],
    ["a grid naming nobody in the room", (f) => (at(f, 3)[0] = "zed")],
    ["a grid naming one seat twice", (f) => (at(f, 3)[0] = "b")],
    [
      "a grid id that is a prototype name",
      (f) => (at(f, 3)[0] = "constructor"),
    ],
    ["controls with an unknown bit", (f) => (at(f, 4, 0)[1] = 64)],
    ["controls keyed by __proto__", (f) => (at(f, 4, 0)[0] = "__proto__")],
    [
      "the same seat's controls twice",
      (f) => (f[4] as unknown[]).push(at(f, 4, 0)),
    ],
    ["bot memory for a seat off the grid", (f) => (at(f, 5, 0)[0] = "w")],
    ["bot memory for a human", (f) => (at(f, 5, 0)[0] = "a")],
    [
      "a bot steering queue past any delay",
      (f) => (at(f, 5, 0)[1] = Array(65).fill(0)),
    ],
    ["a race in a room with no grid", (f) => (f[3] = [])],
    ["no race while the room is running", (f) => (f[6] = null)],
    ["a race that is not a list", (f) => (f[6] = "vroom")],
    ["a race on a track nobody has", (f) => (at(f, 6)[3] = "moon")],
    ["a race further ahead than the log", (f) => (at(f, 6)[0] = 100_000)],
    ["a finished race in a running room", (f) => (at(f, 6)[1] = "finished")],
    ["a countdown that is already over", (f) => (at(f, 6)[1] = "countdown")],
    [
      "fewer trucks than the grid",
      (f) => (at(f, 6)[7] = at(f, 6, 7).slice(0, 2)),
    ],
    ["more trucks than the grid", (f) => at(f, 6, 7).push(at(f, 6, 7)[0])],
    ["a truck claiming another slot", (f) => (at(f, 6, 7, 1)[0] = 0)],
    ["a truck at an infinite position", (f) => (at(f, 6, 7, 0)[1] = Infinity)],
    ["a truck at no position at all", (f) => (at(f, 6, 7, 0)[2] = NaN)],
    ["a truck at negative zero", (f) => (at(f, 6, 7, 0)[1] = -0)],
    ["a truck off the edge of the world", (f) => (at(f, 6, 7, 0)[1] = 1e9)],
    ["armor past the truck's own maximum", (f) => (at(f, 6, 7, 0)[6] = 99)],
    ["an item nobody stocks", (f) => (at(f, 6, 7, 0)[8] = "banana")],
    ["a steering direction of two", (f) => (at(f, 6, 7, 0)[9] = 2)],
    [
      "a timer armed past any effect",
      (f) => (at(f, 6, 7, 0, 15)[0] = 1_000_000),
    ],
    ["a lap counted with a fraction", (f) => (at(f, 6, 7, 0, 16)[1] = 1.5)],
    [
      "stats that are not numbers",
      (f) => (at(f, 6, 7, 0)[5] = ["fast", 1, 1, 1, 1, 1, 1]),
    ],
    ["placements that rank one slot twice", (f) => (at(f, 6)[8] = [0, 0, 1])],
    ["placements naming a slot off the grid", (f) => (at(f, 6)[8] = [0, 1, 9])],
    ["an item-held flag per nobody", (f) => (at(f, 6)[9] = [true, false])],
    [
      "a box cooldown grid of the wrong size",
      (f) => (at(f, 6)[10] = [0, 0, 0]),
    ],
    [
      "more mines than a race could ever hold",
      (f) =>
        (at(f, 6)[12] = Array.from({ length: 2000 }, () => [
          1,
          0,
          0,
          0,
          0,
          false,
        ])),
    ],
    [
      "a missile with an id the race never issued",
      (f) => (at(f, 6)[11] = [[999_999, 0, 10, 10, 0, 1, null, false]]),
    ],
    [
      "a missile owned by nobody on the grid",
      (f) => (at(f, 6)[11] = [[1, 9, 10, 10, 0, 1, null, false]]),
    ],
    [
      "two projectiles sharing one id",
      (f) => {
        at(f, 6)[11] = [[1, 0, 10, 10, 0, 1, null, false]];
        at(f, 6)[12] = [[1, 0, 10, 10, 1, false]];
        at(f, 6)[6] = 9;
      },
    ],
    [
      "a drone that remembers zaps for trucks that are not racing",
      (f) => (at(f, 6)[14] = [[1, 0, 1, 0, [0, 0, 0, 0, 0]]]),
    ],
    ["a tick that is not a tick", () => {}, -1],
  ];
  for (const [what, change, tick] of refused)
    assert.equal(tampered(change, tick), undefined, what);

  // The projectiles the refusals above bend out of shape: in shape, they are carried through.
  assert.ok(
    tampered((f) => {
      at(f, 6)[6] = 5;
      at(f, 6)[11] = [[1, 0, 100, 120, 0.5, 4, 2, false]];
      at(f, 6)[12] = [[2, 1, 110, 130, 6, true]];
      at(f, 6)[13] = [[3, 2, 120, 140, 8]];
      at(f, 6)[14] = [[4, 0, 9, 1, [0, 0, 7]]];
    }),
    "a race under fire decodes",
  );

  // A lobby carries no race, and nothing that only a race can fill.
  const empty = lobby(),
    fields = wire(empty);
  assert.ok(decodeRoom(fields, empty.tick), "the lobby decodes");
  at(fields, 3).push("a");
  assert.equal(
    decodeRoom(fields, empty.tick),
    undefined,
    "a grid with no race",
  );
  const withRace = wire(empty);
  withRace[6] = wire(racing())[6];
  assert.equal(
    decodeRoom(withRace, empty.tick),
    undefined,
    "a race in the lobby",
  );

  // Over and finished are one fact, stated twice: they may not disagree.
  const decided = over(),
    ended = wire(decided);
  assert.ok(decodeRoom(ended, decided.tick), "the finished race decodes");
  at(ended, 6)[1] = "racing";
  assert.equal(
    decodeRoom(ended, decided.tick),
    undefined,
    "a room over while its race runs on",
  );
});
