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
  World,
  type StreamEntries,
} from "fuse-netcode";
import {
  BETWEEN_TICKS,
  PLAY,
  createRoom,
  decode,
  encode,
  foldTick,
  freightGame,
  hash,
  isEntry,
  maxRounds,
  view,
  type Entry,
  type Room,
} from "../src/online/game.js";
import { seatName, validName } from "../src/online/names.js";
import {
  COUNTDOWN_STEPS,
  DEFAULT_SETTINGS,
  LEFT,
  OUTRO_STEPS,
  RIGHT,
  STEPS_PER_TICK,
  type Settings,
} from "../src/engine/index.js";
import { DIRS } from "../src/engine/math.js";
import { TURN } from "../src/engine/tuning.js";

type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1. */
function fold(room: Room, bodies: Bodies = {}): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  foldTick(room, "a", streams);
}
const run = (room: Room, ticks: number, bodies: () => Bodies = () => ({})) => {
  for (let i = 0; i < ticks; i++) fold(room, bodies());
};
const COUNTDOWN_TICKS = Math.ceil(COUNTDOWN_STEPS / STEPS_PER_TICK) + 1;
const OUTRO_TICKS = Math.ceil(OUTRO_STEPS / STEPS_PER_TICK) + 1;
void OUTRO_TICKS;

/** `a` and `b` seated, a bot in slot 2, and the match `m1` started. */
function started(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = createRoom("m0", settings);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "train", 1],
      [JOIN, "b", "Bo", 1, "train", 1],
      [BOT, "add", "bot:1", "Loco Lola", 2],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}
const train = (room: Room, id: string) =>
  room.world!.trains.find((t) => t.id === id)!;

/** Plays the current round out with these banked scores: the clock jumps to the whistle and the outro runs. */
function finish(room: Room, scores: Record<string, number>): void {
  if (room.world!.phase === "countdown") run(room, COUNTDOWN_TICKS);
  const world = room.world!;
  for (const t of world.trains) {
    t.score = scores[t.id] ?? 0;
    t.cargo = [];
  }
  world.step = COUNTDOWN_STEPS + world.length - 1;
  for (let i = 0; i < OUTRO_TICKS + 5 && room.stage === "running"; i++)
    fold(room);
}

test("entries: play entries name a match and round and carry steering bits; management uses the shared kinds", () => {
  assert.ok(isEntry([1, 5, PLAY, "m1", 1, LEFT]));
  assert.ok(isEntry([1, 5, PLAY, "m1", 1, LEFT | RIGHT]));
  assert.ok(isEntry([1, 5, PLAY, "m1", 1, 0]));
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1, 4]), "no other buttons");
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1, -1]));
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1, 1.5]));
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1]), "short");
  assert.ok(!isEntry([0, 5, PLAY, "m1", 1, 1]), "seq from 1");
  assert.ok(!isEntry([1, 5, PLAY, "", 1, 1]), "a match id");
  assert.ok(isEntry([1, 5, JOIN, "a", "Ada", 0, "train", 1]));
  assert.ok(!isEntry([1, 5, JOIN, "a", "Ada", 0, "fox", 1]), "only trains");
  assert.ok(!isEntry([1, 5, JOIN, "a", "Ada", 5, "train", 1]), "five seats");
  assert.ok(!isEntry([1, 5, JOIN, "constructor", "Ada", 0, "train", 1]));
  assert.ok(isEntry([1, 5, SETTINGS, { ...DEFAULT_SETTINGS, seconds: 60 }]));
  assert.ok(!isEntry([1, 5, SETTINGS, { ...DEFAULT_SETTINGS, seconds: 61 }]));
  assert.ok(!isEntry([1, 5, SETTINGS, { ...DEFAULT_SETTINGS, extra: 1 }]));
  assert.ok(isEntry([1, 5, ACTION, "start", "m1"]));
  assert.ok(!isEntry([1, 5, ACTION, "start", "has space"]));
  assert.ok(isEntry([1, 5, BOT, "add", "bot:1", "Loco Lola", 2]));
  assert.ok(isEntry([1, 5, SPECTATOR, "join", "w", "Wes", 1]));
  assert.equal(seatName("  Casey Jones  "), "Casey Jones");
  assert.equal(seatName("\u0007"), undefined);
  assert.equal(
    seatName("A very long driver name indeed"),
    "A very long driver",
  );
  assert.ok(!validName(" padded"));
});

test("start puts every driver in a world; after the countdown held steering turns the train", () => {
  const room = started();
  assert.equal(room.stage, "running");
  assert.equal(room.round, 1);
  assert.deepEqual(
    room.world!.trains.map((t) => t.id),
    ["a", "b", "bot:1"],
  );
  assert.equal(room.world!.length, DEFAULT_SETTINGS.seconds * 60);
  run(room, COUNTDOWN_TICKS);
  assert.equal(room.world!.phase, "play");
  const dir = train(room, "b").dir;
  fold(room, { b: [[PLAY, "m1", 1, RIGHT]] });
  run(room, 3);
  assert.equal(
    train(room, "b").dir,
    (dir + 4 * STEPS_PER_TICK * TURN) % DIRS,
    "held from one entry, through ticks with none",
  );
  assert.equal(room.held.b, RIGHT);
  fold(room, { b: [[PLAY, "m1", 1, 0]] });
  assert.equal(room.held.b, undefined, "released");
  // Entries for another match or round change nothing.
  fold(room, { b: [[PLAY, "old", 1, LEFT]] });
  fold(room, { b: [[PLAY, "m1", 2, LEFT]] });
  assert.equal(room.held.b, undefined);
  // The bot drives itself, on bits of its own that are never logged as held.
  let bits = 0;
  run(room, 40, () => {
    bits |= train(room, "bot:1").input;
    return {};
  });
  assert.notEqual(bits, 0);
  assert.equal(room.held["bot:1"], undefined);
});

test("a tap shorter than a tick still steers, on the tick's first step", () => {
  const tapped = started(),
    control = started();
  for (const room of [tapped, control]) run(room, COUNTDOWN_TICKS);
  fold(tapped, {
    b: [
      [PLAY, "m1", 1, LEFT],
      [PLAY, "m1", 1, 0],
    ],
  });
  fold(control);
  assert.equal(
    train(tapped, "b").dir,
    (train(control, "b").dir - TURN + DIRS) % DIRS,
    "one step of turn, the tick's first",
  );
  assert.equal(tapped.held.b, undefined, "nothing is held after it");
});

test("the top score wins the round, equal top scores share it, and the round wins decide the match", () => {
  const room = started({ ...DEFAULT_SETTINGS, wins: 2 });
  finish(room, { a: 5, b: 5, "bot:1": 3 });
  assert.equal(room.stage, "between");
  const [first] = room.results;
  assert.deepEqual(first!.winners, ["a", "b"], "a shared round");
  assert.deepEqual(
    first!.placings.map((p) => [p.id, p.place, p.score]),
    [
      ["a", 1, 5],
      ["b", 1, 5],
      ["bot:1", 3, 3],
    ],
  );
  assert.deepEqual(room.wins, { a: 1, b: 1 });
  assert.equal(view(room).resumeIn, BETWEEN_TICKS);
  run(room, BETWEEN_TICKS);
  assert.equal(room.stage, "running");
  assert.equal(room.round, 2);
  // Round two: b alone on top, and two round wins takes the match.
  finish(room, { a: 2, b: 7, "bot:1": 0 });
  assert.equal(room.stage, "over");
  assert.deepEqual(room.winners, ["b"]);
  assert.deepEqual(view(room).totals, { a: 7, b: 12, "bot:1": 3 });
  // Rematch starts round 1 of a new match; the lobby resets everything.
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.matchId, "m2");
  assert.deepEqual(room.wins, {});
  assert.deepEqual(room.winners, []);
  fold(room, { a: [[ACTION, "lobby", "m3"]] });
  assert.equal(room.stage, "lobby");
  assert.equal(room.world, null);
  assert.equal(room.round, 0);
});

test("a match that ends level on round wins goes to the most wagons delivered, and level on those too it is shared", () => {
  const settled = started({ ...DEFAULT_SETTINGS, wins: 1 });
  finish(settled, { a: 4, b: 4, "bot:1": 1 });
  assert.equal(settled.stage, "over");
  assert.deepEqual(
    settled.winners,
    ["a", "b"],
    "shared: level on wins and on wagons",
  );

  const twice = started({ ...DEFAULT_SETTINGS, wins: 2 });
  finish(twice, { a: 6, b: 1 });
  run(twice, BETWEEN_TICKS);
  finish(twice, { a: 1, b: 3 });
  run(twice, BETWEEN_TICKS);
  finish(twice, { a: 2, b: 2 });
  assert.equal(twice.stage, "over");
  assert.deepEqual(twice.wins, { a: 2, b: 2 });
  assert.deepEqual(
    twice.winners,
    ["a"],
    "level on wins, a delivered 9 to b's 6",
  );
});

test("a match of nothing but empty rounds ends at its round limit with no winner", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    wins: 1 as const,
    seconds: 60 as const,
  };
  const room = started(settings);
  for (let round = 0; round < maxRounds(settings); round++) {
    finish(room, {});
    if (room.stage === "between") run(room, BETWEEN_TICKS);
  }
  assert.equal(room.stage, "over");
  assert.deepEqual(room.winners, []);
  assert.equal(room.results.length, maxRounds(settings));
  assert.ok(room.results.every((r) => r.winners.length === 0));
});

test("settings are the host's between matches; the match keeps the ones it started with", () => {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, { a: [[JOIN, "a", "Ada", 0, "train", 1]] });
  fold(room, { a: [[SETTINGS, { ...DEFAULT_SETTINGS, seconds: 60 }]] });
  assert.equal(room.settings.seconds, 60);
  fold(room, { b: [[SETTINGS, { ...DEFAULT_SETTINGS, seconds: 90 }]] });
  assert.equal(room.settings.seconds, 60, "only the host sets the rules");
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.equal(room.world!.length, 60 * 60);
  fold(room, { a: [[SETTINGS, { ...DEFAULT_SETTINGS, seconds: 90 }]] });
  assert.equal(
    room.world!.length,
    60 * 60,
    "mid-match, the round keeps its length",
  );
  assert.equal(freightGame.matchSettings!(room).seconds, 60);
  assert.equal(freightGame.settings(room).seconds, 90);
});

test("an empty lobby does not start; a driver who leaves mid-round drives straight on, and a newcomer waits", () => {
  const empty = createRoom("m0", DEFAULT_SETTINGS);
  fold(empty, { a: [[ACTION, "start", "m1"]] });
  assert.equal(empty.stage, "lobby");
  const room = started();
  run(room, COUNTDOWN_TICKS);
  fold(room, { b: [[PLAY, "m1", 1, LEFT]] });
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.equal(room.held.b, undefined, "an absent seat holds nothing");
  const dir = train(room, "b").dir;
  run(room, 3);
  assert.equal(train(room, "b").dir, dir, "straight on");
  fold(room, { a: [[JOIN, "c", "Cy", 3, "train", 1]] });
  assert.ok(room.seats.has("c"));
  assert.ok(!room.world!.trains.some((t) => t.id === "c"), "not in this round");
  fold(room, { a: [[LEAVE, "b"]] });
  assert.equal(
    room.seats.get("b")!.connected,
    false,
    "a running round keeps the seat",
  );
});

test("the checkpoint carries a room whole in every stage, and a corrupt one is refused", () => {
  const check = (r: Room) => {
    const back = decode(structuredClone(encode(r)), r.tick);
    assert.ok(back, `stage ${r.stage}`);
    assert.equal(hash(back!), hash(r));
    assert.deepEqual(view(back!), view(r));
  };
  check(createRoom("m0", DEFAULT_SETTINGS));
  const room = started({ ...DEFAULT_SETTINGS, wins: 2 });
  run(room, 80, () => ({ b: [[PLAY, "m1", 1, room.tick % 3 ? RIGHT : 0]] }));
  check(room);
  finish(room, { a: 3, b: 1 });
  assert.equal(room.stage, "between");
  check(room);
  const good = encode(room);
  const broken = (change: (fields: unknown[]) => void) => {
    const copy = structuredClone(good);
    change(copy);
    return decode(copy, room.tick);
  };
  assert.ok(broken(() => {}));
  assert.equal(decode(good.slice(1), room.tick), undefined);
  assert.equal(decode(good, -1), undefined);
  type Result = { winners: string[]; placings: Record<string, unknown>[] };
  for (const [what, change] of [
    ["match id", (f: unknown[]) => (f[0] = "")],
    ["stage", (f: unknown[]) => (f[2] = "paused")],
    ["settings", (f: unknown[]) => (f[3] = { wins: 2 })],
    ["a lobby with a round", (f: unknown[]) => (f[2] = "lobby")],
    [
      "a seat's name",
      (f: unknown[]) => ((f[4] as Record<string, unknown>[])[0]!.name = ""),
    ],
    [
      "a seat's avatar",
      (f: unknown[]) =>
        ((f[4] as Record<string, unknown>[])[0]!.avatarId = "fox"),
    ],
    [
      "an unknown seat key",
      (f: unknown[]) => ((f[4] as Record<string, unknown>[])[0]!.x = 1),
    ],
    [
      "two seats in one slot",
      (f: unknown[]) => ((f[4] as Record<string, unknown>[])[1]!.slot = 0),
    ],
    ["a win count of zero", (f: unknown[]) => (f[6] = [["a", 0]])],
    [
      "wins no result gave",
      (f: unknown[]) =>
        (f[6] = [
          ["a", 1],
          ["b", 1],
        ]),
    ],
    [
      "a result without placings",
      (f: unknown[]) => (f[7] = [{ round: 1, winners: ["a"] }]),
    ],
    [
      "a round winner off the top score",
      (f: unknown[]) => ((f[7] as Result[])[0]!.winners = ["b"]),
    ],
    [
      "a place the scores do not give",
      (f: unknown[]) => ((f[7] as Result[])[0]!.placings[1]!.place = 1),
    ],
    [
      "a placing's unknown key",
      (f: unknown[]) => ((f[7] as Result[])[0]!.placings[0]!.state = "x"),
    ],
    ["match winners before the end", (f: unknown[]) => (f[8] = ["a"])],
    ["held bits for nobody", (f: unknown[]) => (f[10] = [["zed", 1]])],
    ["a broken world", (f: unknown[]) => (f[11] = [1, 2, 3])],
    ["between rounds without a world", (f: unknown[]) => (f[11] = null)],
    [
      "a break that never ends",
      (f: unknown[]) => (f[9] = room.tick + BETWEEN_TICKS + 1),
    ],
    ["a break already over", (f: unknown[]) => (f[9] = room.tick)],
    [
      "a round longer than its match's",
      (f: unknown[]) => (f[5] = { ...(f[5] as Settings), seconds: 90 }),
    ],
    [
      "a train id that is no member id",
      (f: unknown[]) =>
        (((f[11] as unknown[])[8] as unknown[][])[0]![0] = "__proto__"),
    ],
  ] as const)
    assert.equal(broken(change), undefined, what);

  // A finished match: its winners must be the leaders the results give.
  run(room, BETWEEN_TICKS);
  finish(room, { a: 3 });
  assert.equal(room.stage, "over");
  check(room);
  const over = encode(room);
  const wrong = structuredClone(over);
  wrong[8] = ["b"];
  assert.equal(decode(wrong, room.tick), undefined, "the wrong match winner");
});

test("the view shows seats, wins and the round; the game describes its seating", () => {
  const room = started();
  const shown = view(room);
  assert.equal(shown.tick, room.tick * STEPS_PER_TICK);
  assert.equal(shown.stage, "running");
  assert.deepEqual(
    shown.seats.map((s) => [s.id, s.slot, s.bot]),
    [
      ["a", 0, false],
      ["b", 1, false],
      ["bot:1", 2, true],
    ],
  );
  assert.ok(shown.world);
  assert.equal(freightGame.clock(room), room.tick * STEPS_PER_TICK);
  assert.equal(freightGame.steps(room), STEPS_PER_TICK);
  assert.deepEqual(freightGame.scope(room), { matchId: "m1", round: 1 });
  assert.equal(freightGame.stage(room), "running");
  assert.equal(freightGame.seat(room, "b")!.name, "Bo");
  assert.deepEqual(
    [...freightGame.members(room)].map((s) => s.id),
    ["a", "b", "bot:1"],
  );
  const seating = freightGame.seating;
  assert.equal(seating.botId(room, new Set(["bot:2"])), "bot:3");
  assert.equal(seating.botName(0), "Loco Lola");
  assert.equal(
    seating.sharedScreen({ ...DEFAULT_SETTINGS, display: true }),
    true,
  );
  assert.equal(
    seating.soloSettings({ ...DEFAULT_SETTINGS, display: true }).display,
    false,
  );
  assert.equal(seating.seatName(" Zed "), "Zed");
  assert.ok(seating.isAvatar("train"));
  assert.equal(seating.parseSettings({}), undefined);
  assert.equal(freightGame.createTicker(), foldTick);
});

/** Advances a replica to a tick: a long re-run is spread over several calls, each on its budget. */
function settle(world: ReturnType<typeof replica>, tick: number) {
  for (let i = 0; i < 50 && world.tick < tick; i++) world.advance(tick);
}

/** A replica of one room: `a` seats `a`, `b` and a bot and starts; only `b`'s stream is remote. */
function replica(self = "a") {
  const world = new World(
    freightGame,
    createRoom("m0", DEFAULT_SETTINGS),
    "a",
    self,
  );
  const a = world.stream("a", 1);
  world.stream("b", 1);
  a.append(1, [JOIN, "a", "Ada", 0, "train", 1]);
  a.append(1, [JOIN, "b", "Bo", 1, "train", 1]);
  a.append(1, [BOT, "add", "bot:1", "Loco Lola", 2]);
  a.append(2, [ACTION, "start", "m1"]);
  a.through = 900;
  return world;
}

test("every replica drives the same round, however late and batched the steering arrives", () => {
  const entries: Entry[] = [];
  for (let i = 0; i < 40; i++)
    entries.push([
      i + 1,
      70 + i * 9,
      PLAY,
      "m1",
      1,
      [LEFT, 0, RIGHT, LEFT | RIGHT][i % 4]!,
    ]);
  const whole = replica(),
    late = replica("b");
  // One replica hears the first entries in a burst up front (a packet carries at most six) and every later one just
  // before its tick; the other hears each change 15 ticks late, predicts, and rolls back.
  const burst = entries.slice(0, 6);
  whole.receive("b", burst, burst.length, burst.at(-1)![1], 0);
  for (const [index, entry] of entries.entries()) {
    if (index < burst.length) continue;
    settle(whole, entry[1] - 2);
    whole.receive("b", [entry], index + 1, entry[1], whole.tick);
  }
  whole.receive("b", [], entries.length, 900, whole.tick);
  settle(whole, 900);
  assert.equal(whole.rollbacks, 0, "the prompt replica never had to roll back");
  for (const [index, entry] of entries.entries()) {
    late.advance(entry[1] + 15);
    late.receive("b", [entry], index + 1, entry[1], late.tick);
  }
  late.receive("b", [], entries.length, 900, late.tick);
  settle(late, 900);
  assert.ok(late.rollbacks > 0, "the late replica rolled back");
  assert.equal(late.tick, 900);
  assert.equal(hash(whole.state), hash(late.state));
  assert.deepEqual(whole.view()[0], late.view()[0]);
});

test("when every driver leaves between rounds, the room is an empty lobby again, and it still checkpoints", () => {
  const room = started();
  finish(room, { a: 2 });
  assert.equal(room.stage, "between");
  fold(room, {
    a: [
      [LEAVE, "b"],
      [BOT, "remove", "bot:1"],
      [SPECTATOR, "join", "w", "Wes", 1],
    ],
  });
  fold(room, { a: [[LEAVE, "a"]] });
  run(room, BETWEEN_TICKS);
  assert.equal(room.stage, "lobby");
  assert.equal(room.round, 0);
  assert.deepEqual(room.wins, {});
  assert.equal(room.world, null);
  assert.ok(
    decode(structuredClone(encode(room)), room.tick),
    "a joiner can still take this room",
  );
});
