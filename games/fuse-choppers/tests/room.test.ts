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
  chopperGame,
  createRoom,
  decode,
  encode,
  foldTick,
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
  OUTRO_STEPS,
  STEPS_PER_TICK,
  UP,
  type Settings,
} from "../src/engine/index.js";
import { LIFT } from "../src/engine/tuning.js";

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
const QUICK: Settings = { ...DEFAULT_SETTINGS, wins: 1 };

/** `a` and `b` seated, a bot in slot 2, and the match `m1` started. */
function started(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = createRoom("m0", settings);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "chopper", 1],
      [JOIN, "b", "Bo", 1, "chopper", 1],
      [BOT, "add", "bot:1", "Rotor Rex", 2],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}
const chopper = (room: Room, id: string) =>
  room.world!.choppers.find((c) => c.id === id)!;
/** Ends the current round by crashing everyone but `survivor` into the crush zone. */
function crashAllBut(room: Room, survivor: string): void {
  for (const c of room.world!.choppers)
    if (c.id !== survivor) c.x = room.world!.crushX - 1000;
    else c.grace = 10_000;
}

test("entries: play entries name a match and round and carry control bits; management uses the shared kinds", () => {
  assert.ok(isEntry([1, 5, PLAY, "m1", 1, UP]));
  assert.ok(isEntry([1, 5, PLAY, "m1", 1, 0]));
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1, 64]), "unknown bits");
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1, 2 ** 40]), "past 32 bits");
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1, 2 ** 32 + 1]));
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1, 1.5]));
  assert.ok(!isEntry([1, 5, PLAY, "m1", 1]), "short");
  assert.ok(!isEntry([0, 5, PLAY, "m1", 1, 1]), "seq from 1");
  assert.ok(!isEntry([1, 5, PLAY, "", 1, 1]), "a match id");
  assert.ok(isEntry([1, 5, JOIN, "a", "Ada", 0, "chopper", 1]));
  assert.ok(!isEntry([1, 5, JOIN, "a", "Ada", 0, "fox", 1]), "only choppers");
  assert.ok(!isEntry([1, 5, JOIN, "a", "Ada", 5, "chopper", 1]), "five seats");
  assert.ok(!isEntry([1, 5, JOIN, "constructor", "Ada", 0, "chopper", 1]));
  assert.ok(isEntry([1, 5, SETTINGS, { ...DEFAULT_SETTINGS, lift: "thrust" }]));
  assert.ok(
    !isEntry([1, 5, SETTINGS, { ...DEFAULT_SETTINGS, lift: "jetpack" }]),
  );
  assert.ok(!isEntry([1, 5, SETTINGS, { ...DEFAULT_SETTINGS, extra: 1 }]));
  assert.ok(isEntry([1, 5, ACTION, "start", "m1"]));
  assert.ok(!isEntry([1, 5, ACTION, "start", "has space"]));
  assert.ok(isEntry([1, 5, BOT, "add", "bot:1", "Rotor Rex", 2]));
  assert.ok(isEntry([1, 5, SPECTATOR, "join", "w", "Wes", 1]));
  assert.equal(seatName("  Ace Pilot  "), "Ace Pilot");
  assert.equal(seatName("\u0007"), undefined);
  assert.equal(seatName("A very long pilot name indeed"), "A very long pilot");
  assert.ok(!validName(" padded"));
});

test("start seats every pilot in a world; the countdown runs, then held controls fly", () => {
  const room = started();
  assert.equal(room.stage, "running");
  assert.equal(room.round, 1);
  assert.deepEqual(
    room.world!.choppers.map((c) => c.id),
    ["a", "b", "bot:1"],
  );
  const ticks = Math.ceil(COUNTDOWN_STEPS / STEPS_PER_TICK);
  run(room, ticks);
  assert.equal(room.world!.phase, "play");
  // b holds UP from one entry on; it keeps climbing on ticks with no entry.
  const y = chopper(room, "b").y;
  fold(room, { b: [[PLAY, "m1", 1, UP]] });
  run(room, 4);
  assert.ok(chopper(room, "b").y < y, "b climbs on held lift");
  assert.equal(room.held.b, UP);
  fold(room, { b: [[PLAY, "m1", 1, 0]] });
  assert.equal(room.held.b, undefined, "released");
  // Entries for another match or round change nothing.
  fold(room, { b: [[PLAY, "old", 1, UP]] });
  assert.equal(room.held.b, undefined);
  fold(room, { b: [[PLAY, "m1", 2, UP]] });
  assert.equal(room.held.b, undefined);
  // The bot flies itself, on bits of its own.
  let bot = 0;
  run(room, 20, () => {
    bot |= chopper(room, "bot:1").input;
    return {};
  });
  assert.notEqual(bot, 0);
  assert.equal(room.held["bot:1"], undefined, "a bot's bits are not logged");
});

test("a tap shorter than a tick still lifts, on the tick's first step", () => {
  const tapped = started(),
    control = started();
  for (const room of [tapped, control]) {
    run(room, Math.ceil(COUNTDOWN_STEPS / STEPS_PER_TICK) + 1);
    chopper(room, "b").engaged = true;
  }
  fold(tapped, {
    b: [
      [PLAY, "m1", 1, UP],
      [PLAY, "m1", 1, 0],
    ],
  });
  fold(control);
  const b = chopper(tapped, "b"),
    untouched = chopper(control, "b");
  assert.equal(b.vy, untouched.vy - LIFT, "one step of lift, the tick's first");
  assert.equal(tapped.held.b, undefined, "nothing is held after it");
});

test("a round ends, the scoreboard shows, the next round starts, and the crowns decide the match", () => {
  const room = started({ ...DEFAULT_SETTINGS, wins: 2 });
  run(room, Math.ceil(COUNTDOWN_STEPS / STEPS_PER_TICK) + 1);
  crashAllBut(room, "b");
  fold(room);
  assert.equal(room.world!.winner, "b");
  assert.equal(room.stage, "running", "the outro plays in the round");
  run(room, Math.ceil(OUTRO_STEPS / STEPS_PER_TICK));
  assert.equal(room.stage, "between");
  assert.equal(room.wins.b, 1);
  assert.equal(room.results[0]!.winner, "b");
  assert.equal(room.results[0]!.placings[0]!.id, "b");
  assert.equal(room.results[0]!.placings.length, 3);
  assert.equal(view(room).resumeIn, BETWEEN_TICKS);
  run(room, BETWEEN_TICKS);
  assert.equal(room.stage, "running");
  assert.equal(room.round, 2);
  assert.notEqual(room.world!.seed, 0);
  run(room, Math.ceil(COUNTDOWN_STEPS / STEPS_PER_TICK) + 1);
  crashAllBut(room, "b");
  run(room, Math.ceil(OUTRO_STEPS / STEPS_PER_TICK) + 1);
  assert.equal(room.stage, "over");
  assert.equal(room.winner, "b");
  // Rematch starts round 1 of a new match; the lobby resets everything.
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.matchId, "m2");
  assert.deepEqual(room.wins, {});
  fold(room, { a: [[ACTION, "lobby", "m3"]] });
  assert.equal(room.stage, "lobby");
  assert.equal(room.world, null);
  assert.equal(room.round, 0);
});

test("a match of nothing but draws ends at its round limit with no winner", () => {
  const room = started(QUICK);
  for (let round = 0; round < maxRounds(QUICK); round++) {
    run(room, Math.ceil(COUNTDOWN_STEPS / STEPS_PER_TICK) + 1);
    crashAllBut(room, "nobody");
    run(room, Math.ceil(OUTRO_STEPS / STEPS_PER_TICK) + 1);
    if (room.stage === "between") run(room, BETWEEN_TICKS);
  }
  assert.equal(room.stage, "over");
  assert.equal(room.winner, "");
  assert.equal(room.results.length, maxRounds(QUICK));
});

test("settings are the host's between matches; the match keeps the ones it started with", () => {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, { a: [[JOIN, "a", "Ada", 0, "chopper", 1]] });
  fold(room, { a: [[SETTINGS, { ...DEFAULT_SETTINGS, lift: "thrust" }]] });
  assert.equal(room.settings.lift, "thrust");
  fold(room, { b: [[SETTINGS, { ...DEFAULT_SETTINGS, lift: "classic" }]] });
  assert.equal(room.settings.lift, "thrust", "only the host sets the rules");
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.equal(room.world!.lift, "thrust");
  fold(room, { a: [[SETTINGS, { ...DEFAULT_SETTINGS, combat: "off" }]] });
  assert.equal(
    room.world!.combat,
    "all",
    "mid-match, the round keeps its rules",
  );
  assert.equal(chopperGame.matchSettings!(room).combat, "all");
  assert.equal(chopperGame.settings(room).combat, "off");
});

test("an empty lobby does not start; a pilot who leaves mid-round falls, and a new pilot waits for the next round", () => {
  const empty = createRoom("m0", DEFAULT_SETTINGS);
  fold(empty, { a: [[ACTION, "start", "m1"]] });
  assert.equal(empty.stage, "lobby");
  const room = started();
  run(room, Math.ceil(COUNTDOWN_STEPS / STEPS_PER_TICK) + 1);
  fold(room, { b: [[PLAY, "m1", 1, UP]] });
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.equal(room.held.b, undefined, "an absent seat holds nothing");
  fold(room, { a: [[JOIN, "c", "Cy", 3, "chopper", 1]] });
  assert.ok(room.seats.has("c"));
  assert.ok(
    !room.world!.choppers.some((c) => c.id === "c"),
    "not in this round",
  );
  fold(room, { a: [[LEAVE, "b"]] });
  assert.equal(
    room.seats.get("b")!.connected,
    false,
    "a running round keeps the seat",
  );
});

test("the checkpoint carries a room whole in every stage, and a corrupt one is refused", () => {
  const room = started();
  const check = (r: Room) => {
    const fields = structuredClone(encode(r));
    const back = decode(fields, r.tick);
    assert.ok(back, `stage ${r.stage}`);
    assert.equal(hash(back!), hash(r));
    assert.deepEqual(view(back!), view(r));
  };
  check(createRoom("m0", DEFAULT_SETTINGS));
  run(room, 80, () => ({ b: [[PLAY, "m1", 1, room.tick % 2 ? UP : 0]] }));
  check(room);
  crashAllBut(room, "a");
  run(room, Math.ceil(OUTRO_STEPS / STEPS_PER_TICK) + 1);
  assert.equal(room.stage, "between");
  check(room);
  const good = encode(room);
  const broken = (change: (fields: unknown[]) => void) => {
    const copy = structuredClone(good);
    change(copy);
    return decode(copy, room.tick);
  };
  assert.equal(decode(good.slice(1), room.tick), undefined);
  assert.equal(decode(good, -1), undefined);
  for (const [what, change] of [
    ["match id", (f: unknown[]) => (f[0] = "")],
    ["stage", (f: unknown[]) => (f[2] = "paused")],
    ["settings", (f: unknown[]) => (f[3] = { lift: "classic" })],
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
    ["a crown count of zero", (f: unknown[]) => (f[6] = [["a", 0]])],
    [
      "a result without placings",
      (f: unknown[]) => (f[7] = [{ round: 1, winner: "a" }]),
    ],
    [
      "a placing's state",
      (f: unknown[]) => {
        (
          f[7] as { placings: Record<string, unknown>[] }[]
        )[0]!.placings[0]!.state = "napping";
      },
    ],
    ["a winner before the end", (f: unknown[]) => (f[8] = "a")],
    ["held bits for nobody", (f: unknown[]) => (f[10] = [["zed", 1]])],
    ["a broken world", (f: unknown[]) => (f[11] = [1, 2, 3])],
    ["between rounds without a world", (f: unknown[]) => (f[11] = null)],
  ] as const)
    assert.equal(broken(change), undefined, what);
});

test("the view shows seats, crowns and the round; the game describes its seating", () => {
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
  assert.equal(chopperGame.clock(room), room.tick * STEPS_PER_TICK);
  assert.equal(chopperGame.steps(room), STEPS_PER_TICK);
  assert.deepEqual(chopperGame.scope(room), { matchId: "m1", round: 1 });
  assert.equal(chopperGame.stage(room), "running");
  assert.equal(chopperGame.seat(room, "b")!.name, "Bo");
  assert.deepEqual(
    [...chopperGame.members(room)].map((s) => s.id),
    ["a", "b", "bot:1"],
  );
  const seating = chopperGame.seating;
  assert.equal(seating.botId(room, new Set(["bot:2"])), "bot:3");
  assert.equal(seating.botName(0), "Rotor Rex");
  assert.equal(
    seating.sharedScreen({ ...DEFAULT_SETTINGS, display: true }),
    true,
  );
  assert.equal(
    seating.soloSettings({ ...DEFAULT_SETTINGS, display: true }).display,
    false,
  );
  assert.equal(seating.seatName(" Zed "), "Zed");
  assert.ok(seating.isAvatar("chopper"));
  assert.equal(seating.parseSettings({}), undefined);
  assert.equal(chopperGame.createTicker(), foldTick);
});

/** A replica of one room: `a` seats `a`, `b` and a bot and starts; only `b`'s stream is remote. */
function replica(self = "a") {
  const world = new World(
    chopperGame,
    createRoom("m0", DEFAULT_SETTINGS),
    "a",
    self,
  );
  const a = world.stream("a", 1);
  world.stream("b", 1);
  a.append(1, [JOIN, "a", "Ada", 0, "chopper", 1]);
  a.append(1, [JOIN, "b", "Bo", 1, "chopper", 1]);
  a.append(1, [BOT, "add", "bot:1", "Rotor Rex", 2]);
  a.append(2, [ACTION, "start", "m1"]);
  a.through = 600;
  return world;
}

test("every replica folds the same flight, however late and batched the controls arrive", () => {
  const entries: Entry[] = [];
  for (let i = 0; i < 30; i++)
    entries.push([i + 1, 60 + i * 7, PLAY, "m1", 1, i % 2 ? UP : 0]);
  const whole = replica(),
    late = replica("b");
  // One replica hears everything up front; the other hears each change 15 ticks late, predicts, and rolls back.
  // A packet carries at most six entries, so the whole log arrives as a burst of them.
  for (let i = 0; i < entries.length; i += 6) {
    const batch = entries.slice(i, i + 6);
    whole.receive("b", batch, i + batch.length, batch.at(-1)![1], 0);
  }
  whole.receive("b", [], entries.length, 600, 0);
  whole.advance(600);
  for (const [index, entry] of entries.entries()) {
    late.advance(entry[1] + 15);
    late.receive("b", [entry], index + 1, entry[1], late.tick);
  }
  late.receive("b", [], entries.length, 600, late.tick);
  late.advance(600);
  assert.ok(late.rollbacks > 0, "the late replica rolled back");
  assert.equal(late.tick, 600);
  assert.equal(hash(whole.state), hash(late.state));
  assert.deepEqual(whole.view()[0], late.view()[0]);
});

test("when every rider leaves between rounds, the room is an empty lobby again, and it still checkpoints", () => {
  const room = started();
  run(room, Math.ceil(COUNTDOWN_STEPS / STEPS_PER_TICK) + 1);
  crashAllBut(room, "a");
  run(room, Math.ceil(OUTRO_STEPS / STEPS_PER_TICK) + 1);
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

test("the checkpoint refuses a room whose parts disagree", () => {
  const room = started();
  run(room, Math.ceil(COUNTDOWN_STEPS / STEPS_PER_TICK) + 1);
  crashAllBut(room, "a");
  run(room, Math.ceil(OUTRO_STEPS / STEPS_PER_TICK) + 1);
  assert.equal(room.stage, "between");
  const good = encode(room);
  const broken = (change: (fields: unknown[]) => void) => {
    const copy = structuredClone(good);
    change(copy);
    return decode(copy, room.tick);
  };
  assert.ok(broken(() => {}));
  assert.equal(
    broken((f) => (f[9] = room.tick + BETWEEN_TICKS + 1)),
    undefined,
    "a break that never ends",
  );
  assert.equal(
    broken((f) => (f[9] = room.tick)),
    undefined,
    "a break already over",
  );
  assert.equal(
    broken((f) => (f[5] = { ...(f[5] as Settings), lift: "thrust" })),
    undefined,
    "a round flown under other rules than its match",
  );
  assert.equal(
    broken(
      (f) => (((f[11] as unknown[])[14] as unknown[][])[0]![0] = "__proto__"),
    ),
    undefined,
    "a chopper id that is no member id",
  );
});
