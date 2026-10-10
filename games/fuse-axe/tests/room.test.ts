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
  DEFAULT_SETTINGS,
  PICK,
  PLAY,
  axeGame,
  createRoom,
  decode,
  encode,
  foldTick,
  hash,
  isEntry,
  view,
  type Entry,
  type Room,
} from "../src/online/game.js";
import { seatName, validName } from "../src/online/names.js";
import {
  DOWN,
  JUMP,
  LEFT,
  RIGHT,
  STEPS_PER_TICK,
} from "../src/engine/index.js";
import { WALK } from "../src/engine/tuning.js";

type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1, with `a` as the room's creator. */
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
/** `a` (Rhea) and `b` (Brakka) seated, a bot in slot 2, and run `m1` started. */
function started(): Room {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "rhea", 1],
      [JOIN, "b", "Bo", 1, "brakka", 1],
      [BOT, "add", "bot:1", "Ironhide", 2],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}
const hero = (room: Room, slot: number) =>
  room.world!.heroes.find((each) => each.seat === slot)!;
const play = (bits: number) => [PLAY, "m1", 1, bits];

test("entries: play entries name a run and stage and carry control bits, picks name a hero, management is shared", () => {
  assert.ok(isEntry([1, 5, PLAY, "m1", 1, RIGHT | JUMP]));
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1, 128]), "unknown bits");
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1, 1.5]));
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1]), "short");
  assert.ok(!isEntry([0, 5, PLAY, "m1", 1, 1]), "seq from 1");
  assert.ok(!isEntry([1, 0, PLAY, "m1", 1, 1]), "tick from 1");
  assert.ok(!isEntry([1, 5, PLAY, "", 1, 1]), "a run id");
  assert.ok(!isEntry([1, 5, PLAY, "m1", -1, 1]), "a stage");
  assert.ok(isEntry([1, 5, PICK, "gorm"]));
  assert.ok(!isEntry([1, 5, PICK, "wizard"]));
  assert.ok(!isEntry([1, 5, PICK, "gorm", 1]));
  assert.ok(!isEntry([1, 5, 2, "gorm"]), "an unknown kind");
  assert.ok(!isEntry("entry"));
  assert.ok(isEntry([1, 5, JOIN, "a", "Ada", 0, "rhea", 1]));
  assert.ok(!isEntry([1, 5, JOIN, "a", "Ada", 0, "chopper", 1]), "a hero");
  assert.ok(!isEntry([1, 5, JOIN, "a", "Ada", 5, "rhea", 1]), "five seats");
  assert.ok(!isEntry([1, 5, JOIN, "constructor", "Ada", 0, "rhea", 1]));
  assert.ok(isEntry([1, 5, SETTINGS, { display: true }]));
  assert.ok(!isEntry([1, 5, SETTINGS, { display: true, extra: 1 }]));
  assert.ok(isEntry([1, 5, ACTION, "start", "m1"]));
  assert.ok(!isEntry([1, 5, ACTION, "start", "has space"]));
  assert.ok(isEntry([1, 5, BOT, "add", "bot:1", "Ironhide", 2]));
  assert.ok(isEntry([1, 5, SPECTATOR, "join", "w", "Wes", 1]));
  assert.equal(seatName("  Axe Maiden  "), "Axe Maiden");
  assert.equal(seatName("\u0007"), undefined);
  assert.equal(seatName("A very long hero name indeed"), "A very long hero n");
  assert.ok(!validName(" padded"));
});

test("start seats every hero, a bot as its seat's; held controls walk until let go, and bots stand still", () => {
  const room = started();
  assert.equal(room.stage, "running");
  assert.equal(room.round, 1);
  assert.deepEqual(
    room.world!.heroes.map((each) => [each.seat, each.kind]),
    [
      [0, "rhea"],
      [1, "brakka"],
      [2, "gorm"],
    ],
  );
  // b holds RIGHT from one entry on, and keeps walking on ticks with no entry.
  const x = hero(room, 1).x;
  fold(room, { b: [play(RIGHT)] });
  run(room, 4);
  assert.equal(hero(room, 1).x, x + 5 * STEPS_PER_TICK * WALK.brakka.x);
  assert.equal(room.held.b, RIGHT);
  fold(room, { b: [play(0)] });
  assert.equal(room.held.b, undefined, "released");
  // Entries for another run or stage, or from a stream the seat does not follow, change nothing.
  const stood = hero(room, 1).x;
  fold(room, { b: [[PLAY, "old", 1, RIGHT]] });
  fold(room, { b: [[PLAY, "m1", 2, RIGHT]] });
  fold(room, { a: [[PLAY, "m1", 1, RIGHT]], "bot:1": [play(RIGHT)] });
  assert.equal(hero(room, 1).x, stood);
  assert.equal(room.held.b, undefined);
  assert.equal(hero(room, 2).x, started().world!.heroes[2]!.x, "the bot");
  assert.equal(room.held["bot:1"], undefined);
});

test("a tap shorter than a tick still presses, on the tick's first step", () => {
  const tapped = started(),
    control = started();
  fold(tapped, { b: [play(JUMP), play(0)] });
  fold(control);
  assert.equal(hero(tapped, 1).state, "jump");
  assert.equal(hero(control, 1).state, "idle");
  assert.equal(tapped.held.b, undefined, "nothing is held after it");
  // A direction tapped and let go walks the first step only; one held at the end walks all three; on the first
  // step every bit of the tick is held at once, so opposite taps cancel there.
  const walked = (bodies: unknown[][]) => {
    const room = started();
    fold(room, { b: bodies });
    return hero(room, 1).x - hero(started(), 1).x;
  };
  assert.equal(walked([play(RIGHT), play(0)]), WALK.brakka.x);
  assert.equal(walked([play(0), play(RIGHT)]), 3 * WALK.brakka.x);
  assert.equal(walked([play(LEFT), play(RIGHT)]), 2 * WALK.brakka.x);
});

test("a seated member picks its hero outside a run; the run plays the picks it started with", () => {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "brakka", 1],
      [BOT, "add", "bot:1", "Ironhide", 1],
      [SPECTATOR, "join", "w", "Wes", 1],
    ],
  });
  const heroes = () => view(room).seats.map((seat) => seat.hero);
  assert.deepEqual(heroes(), [null, "brakka", "rhea"]);
  fold(room, {
    a: [[PICK, "gorm"]],
    "bot:1": [[PICK, "gorm"]],
    w: [[PICK, "gorm"]],
  });
  assert.deepEqual(heroes(), [null, "gorm", "rhea"], "only a seated human");
  fold(room, {
    a: [
      [PICK, "rhea"],
      [ACTION, "start", "m1"],
    ],
  });
  assert.deepEqual(
    room.world!.heroes.map((each) => each.kind),
    ["gorm", "rhea"],
    "a pick in the start's tick waits for the next run",
  );
  fold(room, { a: [[PICK, "brakka"]] });
  assert.equal(room.seats.get("a")!.avatarId, "gorm");
});

test("an empty lobby does not start; a hero who leaves mid-run stands, and a new member waits for the next run", () => {
  const empty = createRoom("m0", DEFAULT_SETTINGS);
  fold(empty, { a: [[ACTION, "start", "m1"]] });
  assert.equal(empty.stage, "lobby");
  assert.equal(empty.matchId, "m0");
  const room = started();
  fold(room, { b: [play(RIGHT)] });
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.equal(room.held.b, undefined, "an absent seat holds nothing");
  fold(room, { a: [[JOIN, "c", "Cy", 3, "gorm", 1]] });
  assert.ok(room.seats.has("c"));
  assert.equal(room.world!.heroes.length, 3, "not in this run");
  fold(room, { a: [[LEAVE, "b"]] });
  assert.equal(room.seats.get("b")!.connected, false, "a run keeps the seat");
  // Back to the lobby: the run is gone and the absent seat with it.
  fold(room, { a: [[ACTION, "lobby", "m2"]] });
  assert.equal(room.stage, "lobby");
  assert.equal(room.world, null);
  assert.equal(room.round, 0);
});

test("a rematch after game over starts a new run, or an empty lobby when nobody is left", () => {
  // Game over arrives with the stage flow; until then a test puts the room there.
  const room = started();
  room.stage = "over";
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.matchId, "m2");
  assert.equal(room.world!.step, STEPS_PER_TICK);
  room.stage = "over";
  fold(room, {
    a: [
      [LEAVE, "b"],
      [BOT, "remove", "bot:1"],
      [LEAVE, "a"],
    ],
  });
  fold(room, { a: [[ACTION, "rematch", "m3"]] });
  assert.equal(room.stage, "lobby");
  assert.equal(room.world, null);
});

test("settings are the creator's; the view and the game describe the room and its seating", () => {
  const room = started();
  fold(room, { b: [[SETTINGS, { display: true }]] });
  assert.equal(room.settings.display, false, "only the creator sets them");
  fold(room, { a: [[SETTINGS, { display: true }]] });
  assert.equal(axeGame.settings(room).display, true);
  const shown = view(room);
  assert.equal(shown.tick, room.tick * STEPS_PER_TICK);
  assert.equal(shown.logTick, room.tick);
  assert.deepEqual(
    shown.seats.map((s) => [s.id, s.slot, s.bot, s.hero]),
    [
      ["a", 0, false, "rhea"],
      ["b", 1, false, "brakka"],
      ["bot:1", 2, true, "gorm"],
    ],
  );
  assert.equal(shown.world!.heroes.length, 3);
  assert.equal(axeGame.clock(room), room.tick * STEPS_PER_TICK);
  assert.equal(axeGame.steps(room), STEPS_PER_TICK);
  assert.deepEqual(axeGame.scope(room), { matchId: "m1", round: 1 });
  assert.equal(axeGame.stage(room), "running");
  assert.equal(axeGame.seat(room, "b")!.name, "Bo");
  assert.deepEqual(
    [...axeGame.members(room)].map((s) => s.id),
    ["a", "b", "bot:1"],
  );
  assert.equal(axeGame.createTicker(), foldTick);
  const seating = axeGame.seating;
  assert.equal(seating.capacity, 5);
  assert.equal(seating.minPlayers, 1);
  assert.equal(seating.botId(room, new Set(["bot:2"])), "bot:3");
  assert.equal(seating.botName(5), "Ironhide");
  assert.ok(seating.sharedScreen({ display: true }));
  assert.equal(seating.soloSettings({ display: true }).display, false);
  assert.ok(seating.isAvatar("gorm") && !seating.isAvatar("bot"));
  assert.equal(seating.defaultAvatar, "brakka");
  for (const raw of [null, [], {}, { display: 1 }, { display: true, x: 1 }])
    assert.equal(seating.parseSettings(raw), undefined, JSON.stringify(raw));
});

test("the checkpoint carries a room whole in every stage, and a corrupt one is refused without partial state", () => {
  const check = (room: Room) => {
    const back = decode(structuredClone(encode(room)), room.tick);
    assert.ok(back, `stage ${room.stage}`);
    assert.equal(hash(back!), hash(room));
    assert.deepEqual(view(back!), view(room));
  };
  const lobby = createRoom("m0", DEFAULT_SETTINGS);
  check(lobby);
  const room = started();
  fold(room, {
    a: [
      [SPECTATOR, "join", "w", "Wes", 1],
      [PRESENCE, "a", false, 1],
    ],
    b: [play(RIGHT)],
  });
  assert.ok(room.seats.get("a")!.away);
  check(room);
  const good = encode(room);
  const broken = (change: (fields: unknown[]) => void, tick = room.tick) => {
    const copy = structuredClone(good);
    change(copy);
    return decode(copy, tick);
  };
  const seat = (f: unknown[], index: number) =>
    (f[4] as Record<string, unknown>[])[index]!;
  assert.equal(decode(good.slice(1), room.tick), undefined);
  assert.equal(
    broken(() => {}, -1),
    undefined,
    "a tick",
  );
  assert.equal(
    broken(() => {}, 1),
    undefined,
    "a world older than its tick",
  );
  for (const [what, change] of [
    ["a run id", (f) => (f[0] = "")],
    ["a stage past the last", (f) => (f[1] = 2)],
    ["a stage name", (f) => (f[2] = "paused")],
    ["settings", (f) => (f[3] = {})],
    ["seats not a list", (f) => (f[4] = {})],
    ["eleven seats", (f) => (f[4] = Array(11).fill(seat(f, 0)))],
    ["a seat's name", (f) => (seat(f, 1).name = "")],
    ["a seat's hero", (f) => (seat(f, 1).avatarId = "wizard")],
    ["a bot's avatar", (f) => (seat(f, 3).avatarId = "gorm")],
    ["a watcher's avatar", (f) => (seat(f, 0).avatarId = "gorm")],
    ["an unknown seat key", (f) => (seat(f, 1).x = 1)],
    ["away and connected", (f) => (seat(f, 1).connected = true)],
    ["a repeated member", (f) => (seat(f, 2).id = "a")],
    ["two seats in one slot", (f) => (seat(f, 2).slot = 0)],
    [
      "six watchers",
      (f) =>
        (f[4] = [
          ...(f[4] as unknown[]),
          ...[1, 2, 3, 4, 5].map((n) => ({ ...seat(f, 0), id: `w${n}` })),
        ]),
    ],
    ["held bits not a list", (f) => (f[5] = {})],
    ["held bits of zero", (f) => (f[5] = [["b", 0]])],
    [
      "held bits twice",
      (f) =>
        (f[5] = [
          ["b", 1],
          ["b", 2],
        ]),
    ],
    ["held bits for nobody", (f) => (f[5] = [["zed", 1]])],
    ["held bits for a bot", (f) => (f[5] = [["bot:1", 1]])],
    ["a held key no member has", (f) => (f[5] = [["__proto__", 1]])],
    ["a broken world", (f) => (f[6] = [1, 2, 3])],
    ["a run without a world", (f) => (f[6] = null)],
    ["a lobby with a run", (f) => (f[2] = "lobby")],
    ["a run on stage 0", (f) => (f[1] = 0)],
    ["a world between ticks", (f) => ((f[6] as unknown[])[1] = 1)],
    ["a hero nobody sits at", (f) => (f[4] = (f[4] as unknown[]).slice(0, 3))],
    ["a hero its seat did not pick", (f) => (seat(f, 2).avatarId = "gorm")],
  ] as [string, (fields: unknown[]) => void][])
    assert.equal(broken(change), undefined, what);
  // A lobby holds nothing.
  const held = structuredClone(encode(lobby));
  held[5] = [["a", 1]];
  assert.equal(decode(held, 0), undefined);
});

test("a room restored from its checkpoint folds on to the same hash as the straight run", () => {
  const straight = started();
  const controls = (tick: number): Bodies => ({
    a: [play(tick % 7 < 3 ? RIGHT : tick % 5 === 0 ? JUMP : DOWN)],
    b: tick % 4 ? [] : [play(RIGHT | JUMP), play(tick % 8 ? RIGHT : 0)],
  });
  run(straight, 30, () => controls(straight.tick));
  const restored = decode(structuredClone(encode(straight)), straight.tick)!;
  assert.equal(hash(restored), hash(straight));
  for (let i = 0; i < 60; i++) {
    const bodies = controls(straight.tick);
    fold(straight, bodies);
    fold(restored, bodies);
  }
  assert.equal(hash(restored), hash(straight));
  assert.ok(straight.world!.camX > 0, "the party moved the camera");
});

/** A replica of one room: `a` seats itself (Rhea), `b` (Gorm) and a bot and starts; `b`'s stream is remote. */
function replica(self = "a") {
  const world = new World(
    axeGame,
    createRoom("m0", DEFAULT_SETTINGS),
    "a",
    self,
  );
  const a = world.stream("a", 1);
  world.stream("b", 1);
  a.append(1, [JOIN, "a", "Ada", 0, "rhea", 1]);
  a.append(1, [JOIN, "b", "Bo", 1, "gorm", 1]);
  a.append(1, [BOT, "add", "bot:1", "Ironhide", 2]);
  a.append(2, [ACTION, "start", "m1"]);
  a.through = 400;
  return world;
}

test("every replica folds the same run however b's controls arrive: late, batched, reordered or duplicated", () => {
  // b walks, taps jump inside single ticks and changes direction; two entries share a tick every few.
  const entries: Entry[] = [];
  for (let i = 0; i < 40; i++) {
    const tick = 10 + i * 8,
      bits: [number, ...number[]] =
        i % 3 === 0 ? [RIGHT | JUMP, RIGHT] : [i % 2 ? RIGHT : DOWN];
    for (const each of bits)
      entries.push([entries.length + 1, tick, PLAY, "m1", 1, each]);
  }
  const last = entries.length,
    batches: Entry[][] = [];
  for (let i = 0; i < last; i += 6) batches.push(entries.slice(i, i + 6));
  const whole = replica(),
    shuffled = replica(),
    late = replica("b");
  // One replica hears everything in order and up front.
  for (const batch of batches)
    whole.receive("b", batch, batch.at(-1)![0], batch.at(-1)![1], 0);
  whole.receive("b", [], last, 400, 0);
  whole.advance(400);
  // Another hears the batches in reverse, each twice.
  for (const batch of [...batches].reverse())
    for (let copy = 0; copy < 2; copy++)
      shuffled.receive("b", batch, last, batches[0]![0]![1] - 1, 0);
  shuffled.receive("b", [], last, 400, 0);
  shuffled.advance(400);
  // The third simulates ahead of each entry, predicts, and rolls back when it arrives.
  for (const entry of entries) {
    late.advance(entry[1] + 15);
    late.receive("b", [entry], entry[0], entry[1] - 1, late.tick);
  }
  late.receive("b", [], last, 400, late.tick);
  late.advance(400);
  assert.ok(late.rollbacks > 0, "the late replica rolled back");
  for (const other of [shuffled, late]) {
    assert.equal(other.tick, 400);
    assert.equal(hash(other.state), hash(whole.state));
    assert.deepEqual(other.view()[0], whole.view()[0]);
  }
  const b = whole.state.world!.heroes[1]!;
  assert.ok(b.x > whole.state.world!.heroes[0]!.x, "b walked on");
});
