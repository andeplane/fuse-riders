import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  SETTINGS,
  World,
  type StreamEntries,
} from "fuse-netcode";
import { FIRE, LEFT, UP, type TickEvent } from "../src/engine/index.js";
import {
  BETWEEN_TICKS,
  DEFAULT_SETTINGS as SETUP,
  OUTRO_TICKS,
  PLAY,
  PRESS,
  bombersGame as game,
  createRoom,
  foldTick,
  hash,
  isEntry,
  maxRounds,
  parseSettings,
  roundSeed,
  view,
  type Entry,
  type Room,
  type Settings,
} from "../src/online/game.js";
import { hashPlain } from "../src/online/hash.js";

type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1; returns the tick's events. */
function fold(room: Room, bodies: Bodies = {}): TickEvent[] {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  return foldTick(room, "a", streams);
}
const run = (room: Room, ticks: number) => {
  for (let i = 0; i < ticks; i++) fold(room);
};
/** Runs the countdown out: the next fold runs the round's first steps. */
const toFlight = (room: Room) => run(room, room.startAt - room.tick - 1);
const joins = [
  [JOIN, "a", "Ada", 0, "gunship", 1],
  [JOIN, "b", "Bo", 1, "gunship", 1],
  [BOT, "add", "bot:1", "Baron Boom", 2],
];
/** `a` and `b` seated, a bot in slot 2, and the match `m1` started. */
function started(settings: Settings = SETUP): Room {
  const room = createRoom("m0", settings);
  fold(room, { a: joins });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}
/** Leaves only `survivor` (a member id, or nobody) alive: the next step decides the round. */
function knockOut(room: Room, survivor: string): void {
  for (const c of room.world!.castles)
    if (room.ships[c.id] !== survivor) [c.alive, c.hp] = [false, 0];
}
const fired = (events: TickEvent[], castle: number) =>
  events.filter((e) => e.type === "fired" && e.castleId === castle);

test("entries: play carries direction bits, a press its ordinal and step; bad fields are refused", () => {
  assert.ok(isEntry([1, 5, PLAY, "m1", 1, UP | LEFT]));
  assert.ok(isEntry([1, 5, PRESS, "m1", 1, 7, 2]));
  assert.ok(isEntry([1, 5, SETTINGS, { ...SETUP, wins: 9 }]));
  for (const bad of [
    [1, 5, PLAY, "m1", 1, FIRE],
    [1, 5, PLAY, "m1", 1, 1.5],
    [1, 5, PLAY, "m1", -1, 0],
    [0, 5, PLAY, "m1", 1, 0],
    [1, 0, PLAY, "", 1, 0],
    [1, 5, PRESS, "m1", 1, 0, 0],
    [1, 5, PRESS, "m1", 1, 7, 3],
    [1, 5, PRESS, "m1", 1, 7, 0.5],
    [1, 5, PRESS, "m1", 1, 7],
    [1, 5, 2, "m1", 1, 7, 0],
    [1, 5, JOIN, "a", "Ada", 0, "chopper", 1],
    [1, 5, JOIN, "constructor", "Ada", 6, "gunship", 1],
    [1, 5, SETTINGS, { ...SETUP, wins: 10 }],
    [1, 5, SETTINGS, { ...SETUP, difficulty: "insane" }],
    [1, 5, SETTINGS, { ...SETUP, display: 1 }],
    [1, 5, SETTINGS, { wins: 3, difficulty: "easy" }],
  ])
    assert.ok(!isEntry(bad), JSON.stringify(bad));
  assert.equal(game.ordinal!([1, 5, PRESS, "m1", 1, 7, 2]), 7);
  assert.equal(game.ordinal!([1, 5, PLAY, "m1", 1, UP]), undefined);
  assert.equal(game.seating.seatName(" Ace  Pilot "), "Ace  Pilot");
});

test("start seats riders and bots, counts down, then held directions fly; stale or absent controls do nothing", () => {
  const room = started({ ...SETUP, difficulty: "hard" });
  assert.deepEqual([room.stage, room.ships], ["running", ["a", "b", "bot:1"]]);
  assert.deepEqual(room.world!.config, {
    seed: roundSeed("m1", 1),
    playerCount: 3,
    bots: [{ id: 2, difficulty: "hard" }],
  });
  // Held during the countdown: nothing moves until the first step, and the bits carry into it.
  fold(room, { b: [[PLAY, "m1", 1, UP]] });
  toFlight(room);
  assert.equal(room.world!.tick, 0);
  fold(room);
  assert.equal(room.world!.tick, 3);
  assert.ok(room.world!.castles[1]!.vy < 0, "b climbs on held UP");
  fold(room, {
    a: [
      [PLAY, "m1", 1, UP],
      [PLAY, "m1", 1, 0],
    ],
  });
  assert.ok(room.world!.castles[0]!.vy < 0, "a tap inside one tick climbs");
  assert.equal(room.held.a, undefined, "and holds nothing after");
  fold(room, { b: [[PLAY, "m0", 1, 0]] });
  fold(room, { b: [[PLAY, "m1", 2, 0]] });
  assert.equal(room.held.b, UP, "another match's or round's entry");
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.equal(room.held.b, undefined, "an absent seat holds nothing");
  const bot = room.world!.castles[2]!,
    at = `${bot.x},${bot.y}`;
  run(room, 60);
  assert.notEqual(`${bot.x},${bot.y}`, at, "the hard bot flies itself");
});

test("a press shorter than a log tick fires once, on the step it names, and only in its match and round", () => {
  const room = started();
  toFlight(room);
  run(room, 30); // loaded
  for (const offset of [0, 1, 2]) {
    const copy = structuredClone(room),
      at = copy.world!.tick;
    const shots = fired(fold(copy, { a: [[PRESS, "m1", 1, 1, offset]] }), 0);
    assert.deepEqual(
      shots.map((e) => e.tick),
      [at + offset],
    );
    let later = 0;
    for (let i = 0; i < 80; i++) later += fired(fold(copy), 0).length;
    assert.equal(later, 0, "no press, no shot: FIRE is never held");
  }
  const stale = [PRESS, "m0", 1, 1, 0],
    later = [PRESS, "m1", 2, 2, 0];
  assert.deepEqual(fired(fold(room, { a: [stale, later] }), 0), []);
  // A gesture repeated, or an older one after a newer, in the same tick folds once: FIRE only on its first step.
  for (const [first, second, last] of [
    [5, 5, 0],
    [6, 5, 0],
    [5, 6, FIRE],
  ] as const) {
    const copy = structuredClone(room);
    const presses = [first, second].map((n, i) => [PRESS, "m1", 1, n, 2 * i]);
    fold(copy, { a: presses });
    assert.equal(copy.world!.lastHeld[0]! & FIRE, last);
  }
});

test("a round is decided, plays its aftermath and scoreboard, and crowns decide the match", () => {
  const room = started({ ...SETUP, wins: 2 });
  for (let round = 1; round <= 2; round++) {
    toFlight(room);
    knockOut(room, "b");
    fold(room);
    assert.deepEqual([room.world!.result?.winner, room.stage], [1, "running"]);
    run(room, OUTRO_TICKS);
    if (round === 2) break;
    assert.deepEqual([room.stage, room.wins], ["between", { b: 1 }]);
    assert.equal(view(room).resumeAt, room.tick + BETWEEN_TICKS);
    run(room, BETWEEN_TICKS);
    assert.equal(room.round, 2);
  }
  assert.deepEqual([room.stage, room.winner], ["over", "b"]);
  assert.deepEqual(
    room.results.map((r) => `${r.round} ${r.winner} ${r.reason}`),
    ["1 b last-standing", "2 b last-standing"],
  );
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.deepEqual(
    [room.stage, room.matchId, room.round],
    ["running", "m2", 1],
  );
  assert.deepEqual(room.wins, {});
  fold(room, { a: [[ACTION, "lobby", "m3"]] });
  assert.deepEqual([room.stage, room.round, room.world], ["lobby", 0, null]);
});

test("a match of nothing but draws ends at its round limit with no winner", () => {
  const quick = { ...SETUP, wins: 1 },
    room = started(quick);
  while (room.stage !== "over" && room.round <= maxRounds(quick)) {
    toFlight(room);
    knockOut(room, "nobody");
    run(room, OUTRO_TICKS + 1 + BETWEEN_TICKS); // an "over" room only waits
  }
  assert.equal(room.winner, "");
  assert.equal(room.results.length, maxRounds(quick));
  assert.ok(room.results.every((r) => r.reason === "wipeout"));
});

test("past the round limit the leader never depends on the order the crowns were recorded in", () => {
  const leaders = [
    ["y", "x"],
    ["x", "y"],
  ].map((order) => {
    const room = started({ ...SETUP, wins: 1 });
    room.round = maxRounds(room.play);
    room.wins = Object.fromEntries(order.map((id) => [id, 2])); // tied, and neither won a round on record
    toFlight(room);
    knockOut(room, "nobody");
    run(room, OUTRO_TICKS + 1);
    return [room.stage, room.winner];
  });
  assert.deepEqual(leaders, [
    ["over", "x"],
    ["over", "x"],
  ]);
});

test("settings are exactly their three own keys, each of its type and range", () => {
  const ok = { wins: 9, difficulty: "hard", display: true };
  assert.deepEqual(parseSettings(ok), ok);
  const inherited = Object.assign(Object.create({ display: true }), {
    wins: 3,
    difficulty: "easy",
    show: true,
  });
  // prettier-ignore
  for (const bad of [{ ...ok, extra: 1 }, { wins: 3, difficulty: "easy" }, { ...ok, wins: 0 }, { ...ok, wins: 10 },
    { ...ok, wins: 2.5 }, { ...ok, wins: "3" }, { ...ok, difficulty: "x" }, { ...ok, display: 1 }, inherited,
    [3, "easy", true], null, "settings"])
    assert.equal(parseSettings(bad), undefined, JSON.stringify(bad));
});

test("riders join and leave mid-match: a newcomer flies from the next round, and too few gunships end the match", () => {
  const room = started();
  toFlight(room);
  fold(room, { a: [[JOIN, "c", "Cy", 3, "gunship", 1]] });
  fold(room, { a: [[LEAVE, "b"]] });
  assert.deepEqual(room.ships, ["a", "b", "bot:1"], "not in this round");
  assert.equal(room.seats.get("b")!.connected, false, "a round keeps b's seat");
  knockOut(room, "a");
  run(room, OUTRO_TICKS + 1 + BETWEEN_TICKS);
  assert.deepEqual(room.ships, ["a", "bot:1", "c"]);
  knockOut(room, "a");
  toFlight(room);
  run(room, OUTRO_TICKS + 1);
  fold(room, { a: [[BOT, "remove", "bot:1"]] });
  fold(room, { a: [[LEAVE, "c"]] });
  run(room, BETWEEN_TICKS);
  assert.deepEqual([room.stage, room.round, room.wins], ["lobby", 0, {}]);
  const alone = createRoom("m0", SETUP);
  fold(alone, { a: [joins[0]!] });
  fold(alone, { a: [[ACTION, "start", "m1"]] });
  assert.equal(alone.stage, "lobby", "one gunship does not take off");
  assert.equal(game.seating.botId(room, new Set(["bot:2"])), "bot:1");
  room.wins["bot:1"] = 1;
  assert.equal(game.seating.botId(room, new Set()), "bot:2", "crowns stay");
});

test("a structured clone of the room continues exactly as the room does", () => {
  const room = started();
  toFlight(room);
  run(room, 40);
  const copy = structuredClone(room);
  assert.equal(hash(copy), hash(room));
  for (let i = 0; i < 120; i++) {
    const bodies: Bodies = {
      a: [[PLAY, "m1", 1, i % 40 < 20 ? UP | LEFT : 0]],
      b: i % 50 === 0 ? [[PRESS, "m1", 1, i + 1, i % 3]] : [],
    };
    fold(room, bodies);
    fold(copy, bodies);
  }
  assert.equal(hash(copy), hash(room));
  assert.notEqual(hash(room), hash(started()));
});

test("the hash covers the whole room in a fixed order, and fields added later", () => {
  const h = hashPlain;
  assert.match(h({}), /^[0-9a-f]{16}$/);
  assert.equal(h({ a: 1, b: [2, "x"] }), h({ b: [2, "x"], a: 1 }));
  const map = (keys: string) => new Map([...keys].map((k) => [k, k]));
  assert.equal(h(map("ab")), h(map("ba")));
  assert.equal(h({ a: 1, gone: undefined }), h({ a: 1 }));
  assert.notEqual(h({ a: 1, events: [1] }), h({ a: 1 }), "events are data");
  assert.equal(h(-0), h(0));
  assert.notEqual(h(0.1 + 0.2), h(0.3), "exact bits");
  assert.notEqual(h(new Uint32Array([1, 2])), h(new Uint32Array([1, 3])));
  assert.notEqual(h([1, [2]]), h([[1], 2]));
  assert.notEqual(h("1"), h(1));
  assert.throws(() => h({ f: () => 0 }), TypeError);
  const room = started(),
    before = hash(room);
  room.world!.terrain.solid[100]! ^= 1;
  assert.notEqual(hash(room), before, "one terrain cell");
  room.world!.terrain.solid[100]! ^= 1;
  room.world!.bots[0]!.rng++;
  assert.notEqual(hash(room), before, "a bot's memory");
  room.world!.bots[0]!.rng--;
  // The round's own events are the one transient field; one of that name anywhere else is state.
  room.world!.events = [{ type: "sudden-death-started", tick: 1 }];
  assert.equal(hash(room), before, "the latest step's events");
  Object.assign(room.world!, { memory: [{ events: [1] }] });
  const nested = hash(room);
  assert.notEqual(nested, before, "a field the room did not have before");
  Object.assign(room.world!, { memory: [{ events: [2] }] });
  assert.notEqual(hash(room), nested, "a nested field named events");
});

/** A replica: `a` seats `a`, `b` and a bot and starts the match; `b`'s stream is remote. */
function replica(self = "a") {
  const world = new World(game, createRoom("m0", SETUP), "a", self);
  const a = world.stream("a", 1);
  world.stream("b", 1);
  for (const body of joins) a.append(1, body);
  a.append(2, [ACTION, "start", "m1"]);
  a.through = 900;
  return world;
}

test("every replica folds the same round, however late, duplicated or reordered the controls arrive", () => {
  const entries: Entry[] = [];
  for (let i = 0; i < 36; i++) {
    const at = [i + 1, 70 + i * 21] as const;
    entries.push(
      i % 3 === 2
        ? [...at, PRESS, "m1", 1, i, i % 3]
        : [...at, PLAY, "m1", 1, i % 2 ? UP | LEFT : 0],
    );
  }
  const send = (world: ReturnType<typeof replica>, batch: Entry[]) => {
    const [last, through] = batch.at(-1)!;
    const sent = world.receive("b", batch, last, through, world.tick);
    assert.equal(sent.status, "accepted");
  };
  const batches: Entry[][] = [];
  for (let i = 0; i < entries.length; i += 6)
    batches.push(entries.slice(i, i + 6));
  const [whole, late, shuffled] = [replica(), replica("b"), replica()];
  for (const batch of batches) {
    whole.advance(batch[0]![1] - 1);
    send(whole, batch);
  }
  // Each entry heard 15 ticks late, after the replica predicted past it: it rolls back.
  for (const entry of entries) {
    late.advance(entry[1] + 15);
    send(late, [entry]);
  }
  // Each pair of batches reversed and twice: the earlier as if dropped and resent once the replica predicted past it.
  for (let i = 0; i < batches.length; i += 2) {
    shuffled.advance(batches[i]![0]![1] + 10);
    const pair = [batches[i + 1], batches[i]].filter((b) => b !== undefined);
    for (const batch of [...pair, ...pair]) send(shuffled, batch);
  }
  for (const world of [whole, late, shuffled]) {
    world.receive("b", [], entries.length, 900, world.tick);
    world.advance(900);
    assert.equal(world.tick, 900);
  }
  assert.ok(late.rollbacks * shuffled.rollbacks > 0, "both rolled back");
  assert.equal(hash(late.state), hash(whole.state));
  assert.equal(hash(shuffled.state), hash(whole.state));
  assert.ok(whole.state.world!.castles[1]!.stats.volleys > 0, "b fired");
});
