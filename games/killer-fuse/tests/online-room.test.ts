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
  type StreamEntries,
} from "fuse-netcode";
import {
  INPUT_DOWN,
  INPUT_HELD,
  INPUT_LEFT,
  INPUT_PRESSED,
  INPUT_RIGHT,
  LESSONS,
  MAP_IDS,
  RULES,
} from "../src/engine/index.js";
import {
  BETWEEN_TICKS,
  CAPACITY,
  COUNTDOWN_TICKS,
  FIRST_COUNTDOWN_TICKS,
  countdownTicks,
  DEFAULT_SETTINGS as SETUP,
  MAX_WATCHERS,
  ATTACK,
  OUTRO_TICKS,
  PLAY,
  PRESS,
  QUICK_COUNTDOWN_TICKS,
  SEAT,
  STEPS_PER_TICK,
  createRoom,
  foldTick,
  hash,
  isEntry,
  killerFuseGame as game,
  mapFor,
  parseSettings,
  pilots,
  roundOptions,
  roundSeed,
  seated,
  view,
  type Entry,
} from "../src/online/game.js";
import { hashPlain } from "../src/online/hash.js";
import { botName, seatName } from "../src/online/names.js";
import {
  copy,
  decide,
  finish,
  fold,
  join,
  lobby,
  run,
  started,
  toPlay,
} from "./fixtures/room.js";

test("settings: exactly bot level, map, wins, display and the three tutorial ones, each in range", () => {
  assert.deepEqual(parseSettings({ ...SETUP }), SETUP);
  assert.deepEqual(
    parseSettings({
      quick: true,
      lesson: "snail",
      passive: true,
      display: true,
      wins: 3,
      map: 2,
      botLevel: "hard",
    }),
    {
      botLevel: "hard",
      map: 2,
      wins: 3,
      display: true,
      passive: true,
      lesson: "snail",
      quick: true,
    },
  );
  for (const lesson of LESSONS)
    assert.equal(parseSettings({ ...SETUP, lesson })?.lesson, lesson);
  for (const bad of [
    null,
    "medium",
    { ...SETUP, wins: 0 },
    { ...SETUP, wins: 4 },
    { ...SETUP, wins: 1.5 },
    { ...SETUP, map: 4 },
    { ...SETUP, map: "1" },
    { ...SETUP, botLevel: "insane" },
    { ...SETUP, display: 1 },
    { ...SETUP, extra: 1 },
    { ...SETUP, passive: 0 },
    { ...SETUP, quick: "yes" },
    { ...SETUP, lesson: "flying" },
    { ...SETUP, lesson: null },
    { botLevel: "easy", map: 0, wins: 2, display: false },
    {
      botLevel: "easy",
      map: 0,
      wins: 2,
      "display,x": true,
      passive: false,
      lesson: "",
      quick: false,
    },
  ])
    assert.equal(parseSettings(bad), undefined, JSON.stringify(bad));
  // A room is never created with settings its own checkpoint would refuse.
  const odd = { ...SETUP, wins: 9, stray: true };
  assert.deepEqual(createRoom("m0", odd).settings, SETUP);
});

test("entries: play carries held bits, a press or an attack its ordinal and step, a seat its slot; bad fields are refused", () => {
  const all = INPUT_LEFT | INPUT_RIGHT | INPUT_DOWN | INPUT_HELD;
  assert.ok(isEntry([1, 5, PLAY, "m1", 1, all]));
  assert.ok(isEntry([1, 5, PRESS, "m1", 1, 7, 2]));
  assert.ok(isEntry([1, 5, ATTACK, "m1", 1, 8, 0]));
  assert.ok(isEntry([1, 5, SEAT, 5]));
  assert.ok(isEntry([1, 5, SETTINGS, { ...SETUP, wins: 3 }]));
  assert.ok(isEntry([1, 5, JOIN, "a", "Ada", 5, "bee", 1]));
  assert.ok(isEntry([1, 5, SPECTATOR, "join", "w", "Wim", 1]));
  assert.ok(isEntry([1, 5, ACTION, "start", "m1"]));
  for (const bad of [
    [1, 5, PLAY, "m1", 1, INPUT_PRESSED],
    [1, 5, PLAY, "m1", 1, 1.5],
    [1, 5, PLAY, "m1", -1, 0],
    [0, 5, PLAY, "m1", 1, 0],
    [1, 0, PLAY, "m1", 1, 0],
    [1, 5, PLAY, "", 1, 0],
    [1, 5, PLAY, "m1", 1, 0, 0],
    [1, 5, PRESS, "m1", 1, 0, 0],
    [1, 5, PRESS, "m1", 1, 7, 3],
    [1, 5, PRESS, "m1", 1, 7, 0.5],
    [1, 5, PRESS, "m1", 1, 7],
    [1, 5, SEAT, 6],
    [1, 5, SEAT, -1],
    [1, 5, SEAT, 1, 0],
    [1, 5, ATTACK, "m1", 1, 0, 0],
    [1, 5, ATTACK, "m1", 1, 7, 3],
    [1, 5, ATTACK, "m1", 1, 7],
    [1, 5, 4, "m1", 1, 7, 0],
    "entry",
    [1, 5, JOIN, "a", "Ada", 0, "wasp", 1],
    [1, 5, JOIN, "constructor", "Ada", 0, "bee", 1],
    [1, 5, JOIN, "a", "Ada", 6, "bee", 1],
    [1, 5, SPECTATOR, "join", "toString", "Wim", 1],
    [1, 5, ACTION, "start", "bad id"],
    [1, 5, BOT, "add", "bot:1", "Juno (bot)", 1],
    [1, 5, BOT, "remove", "bot:1"],
    [1, 5, SETTINGS, { ...SETUP, wins: 4 }],
    [1, 5, SETTINGS, { wins: 2, botLevel: "easy" }],
  ])
    assert.ok(!isEntry(bad), JSON.stringify(bad));
  assert.equal(game.ordinal!([1, 5, PRESS, "m1", 1, 7, 2]), 7);
  assert.equal(game.ordinal!([1, 5, ATTACK, "m1", 1, 8, 0]), 8);
  assert.equal(game.ordinal!([1, 5, PLAY, "m1", 1, 1]), undefined);
});

test("the game's seating: six seats, one person is enough, and names as they are seated", () => {
  const { seating } = game;
  assert.deepEqual(
    [seating.capacity, seating.minPlayers, seating.maxWatchers],
    [CAPACITY, 1, MAX_WATCHERS],
  );
  assert.equal(seating.seatName(" Queen   Bee "), "Queen   Bee");
  assert.equal(seating.seatName("x".repeat(30)), "x".repeat(18));
  assert.equal(seating.seatName("a\u0007b"), undefined);
  assert.equal(seating.seatName("   "), undefined);
  assert.equal(seatName("\ud83d Bo"), "Bo");
  assert.ok(seating.isAvatar("bee") && !seating.isAvatar("wasp"));
  assert.equal(seating.defaultAvatar, "bee");
  assert.equal(seating.botId(createRoom("m0", SETUP), new Set()), "bot:0");
  assert.equal(seating.botName(1), botName(1));
  assert.equal(botName(7), "Juno (bot)");
  assert.deepEqual(seating.solo, { name: "Player", bots: 0 });
  const shared = { ...SETUP, display: true };
  assert.ok(seating.sharedScreen!(shared));
  assert.deepEqual(seating.soloSettings!(shared), SETUP);
  assert.equal(game.rules, RULES);
  assert.equal(game.steps(createRoom("m0", SETUP)), STEPS_PER_TICK);
  assert.equal(game.maxSteps, STEPS_PER_TICK);
});

test("start: people keep their slots, bots play the rest, the game counts down and then steps three times a tick", () => {
  const room = started({ ...SETUP, botLevel: "hard", map: 2 });
  assert.deepEqual(
    [room.stage, room.round, room.matchId, room.startAt],
    ["running", 1, "m1", room.tick + FIRST_COUNTDOWN_TICKS],
  );
  const world = room.world!;
  assert.deepEqual(
    [world.seed, world.mapId, world.botLevel],
    [roundSeed("m1", 1), 2, "hard"],
  );
  assert.deepEqual(world.humans, [true, true, false, false, false, false]);
  assert.deepEqual(game.scope(room), { matchId: "m1", round: 1 });
  assert.equal(game.stage(room), "running");
  assert.deepEqual(game.matchSettings!(room), room.play);
  toPlay(room);
  assert.equal(world.step, 0);
  fold(room);
  assert.equal(world.step, STEPS_PER_TICK);
  assert.equal(game.clock(room), room.tick * STEPS_PER_TICK);
  // The settings of a set are fixed at its start: a change waits for the next one.
  fold(room, { a: [[SETTINGS, { ...SETUP, wins: 1 }]] });
  assert.deepEqual(
    [room.settings.wins, room.play.wins, game.settings(room).wins],
    [1, SETUP.wins, 1],
  );
});

test("a room of watchers does not start", () => {
  const room = createRoom("m0", SETUP);
  fold(room, { a: [[SPECTATOR, "join", "a", "Ada", 1]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.deepEqual(
    [room.stage, room.matchId, room.world],
    ["lobby", "m0", null],
  );
});

test("held bits steer from the latest entry on; a tap inside one tick counts; stale entries do nothing", () => {
  const room = started();
  toPlay(room);
  const idle = copy(room);
  fold(idle);
  // Held during the countdown would carry in; here `b` holds right from the first step.
  const held = copy(room);
  fold(held, { b: [[PLAY, "m1", 1, INPUT_RIGHT]] });
  assert.equal(held.held.b, INPUT_RIGHT);
  assert.notEqual(hash(held), hash(idle));
  assert.ok(held.world!.units[1]!.vx > idle.world!.units[1]!.vx);
  const before = held.world!.units[1]!.x;
  fold(held);
  assert.ok(held.world!.units[1]!.x > before, "still held a tick later");
  // A tap and release inside one tick moves on its first step and holds nothing after.
  const tap = copy(room);
  fold(tap, {
    a: [
      [PLAY, "m1", 1, INPUT_LEFT],
      [PLAY, "m1", 1, 0],
    ],
  });
  assert.equal(tap.held.a, undefined);
  assert.notEqual(hash(tap), hash(idle));
  // Another match's or game's entries, and a watcher's or a stranger's, are not this game's.
  const stale = copy(room);
  fold(stale, {
    a: [
      [PLAY, "m0", 1, INPUT_LEFT],
      [PLAY, "m1", 2, INPUT_LEFT],
      [PRESS, "m1", 2, 1, 0],
    ],
    z: [[PLAY, "m1", 1, INPUT_LEFT]],
  });
  assert.equal(hash(stale), hash(idle));
});

test("a press sets the edge once, on the step it names", () => {
  const room = started();
  toPlay(room);
  const folded = (bodies: unknown[][]) => {
    const next = copy(room);
    fold(next, { a: bodies });
    return next;
  };
  const idle = folded([]),
    first = folded([[PRESS, "m1", 1, 1, 0]]),
    last = folded([[PRESS, "m1", 1, 1, 2]]);
  // The Queen flaps: she rises on the step of the press, so an earlier press has her higher by the tick's end.
  const y = (r: typeof room) => r.world!.units[0]!.y;
  assert.ok(y(first) < y(last) && y(last) <= y(idle));
  assert.notEqual(hash(first), hash(last));
  assert.ok(first.world!.units[0]!.vy < idle.world!.units[0]!.vy);
  // A repeat of the ordinal in the tick is one gesture; a higher one is a second press.
  const twice = folded([
    [PRESS, "m1", 1, 1, 0],
    [PRESS, "m1", 1, 1, 2],
  ]);
  assert.equal(hash(twice), hash(first));
  const double = folded([
    [PRESS, "m1", 1, 1, 0],
    [PRESS, "m1", 1, 2, 2],
  ]);
  assert.notEqual(hash(double), hash(first));
  // A press holds the button on its own step only: nothing is held after.
  assert.equal(first.held.a, undefined);
});

test("drop in, drop out: a slot is the bot's whenever its person is not there to play", () => {
  const room = started();
  toPlay(room);
  fold(room, { b: [[PLAY, "m1", 1, INPUT_LEFT]] });
  assert.deepEqual(pilots(room).slice(0, 2), ["a", "b"]);
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.deepEqual(pilots(room).slice(0, 2), ["a", ""]);
  assert.deepEqual(seated(room).slice(0, 2), ["a", "b"]);
  assert.deepEqual(room.world!.humans.slice(0, 2), [true, false]);
  assert.equal(room.held.b, undefined, "an absent seat holds nothing");
  fold(room, { a: [[PRESENCE, "b", true, 1]] });
  assert.deepEqual(room.world!.humans.slice(0, 2), [true, true]);
  // A joiner mid-game takes over the bot in their slot on the tick they are seated.
  fold(room, { a: [join("c", "Cy", 4)] });
  assert.equal(room.world!.humans[4], true);
  assert.equal(view(room).crew[4], "c");
  // Leaving a running game marks the seat absent; the bot plays on.
  fold(room, { a: [[LEAVE, "c"]] });
  assert.equal(room.world!.humans[4], false);
  // A watcher never plays.
  fold(room, { a: [[SPECTATOR, "join", "w", "Wim", 1]] });
  assert.deepEqual(room.world!.humans, [
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
  assert.deepEqual(
    [...game.members(room)].map((seat) => seat.id),
    ["w", "a", "b", "c"],
  );
  assert.equal(game.seat(room, "w")?.watcher, true);
});

test("kills, deaths and berries are credited to the people who play the slots", () => {
  // A set whose bots fight: on this map and level a Queen who stands still is killed.
  const room = started({ ...SETUP, botLevel: "easy", map: 2 });
  toPlay(room);
  // Runs until the bots have fought and banked; people who do nothing only die.
  const crew = seated(room);
  const died: Record<string, number> = {};
  while (!room.world!.winner && room.tick < 4000)
    for (const event of fold(room))
      if (event.type === "kill" && crew[event.victim])
        died[crew[event.victim]!] = (died[crew[event.victim]!] ?? 0) + 1;
  const all = Object.values(room.stats);
  // A Queen's death comes with a `queenKill` beside its `kill`: it is still one death.
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(room.stats)
        .filter(([, stats]) => stats.deaths > 0)
        .map(([id, stats]) => [id, stats.deaths]),
    ),
    died,
  );
  assert.ok(
    all.length > 0 && Object.keys(room.stats).every((id) => "ab".includes(id)),
  );
  assert.ok(all.some((stats) => stats.deaths > 0));
  assert.ok(all.every((stats) => stats.kills === 0 && stats.berries === 0));
});

test("a set: games on rotating maps to the wins it takes, with a victory screen and a pause between", () => {
  const room = started();
  const maps = [1, 2, 3].map((round) => mapFor(room.play, "m1", round));
  assert.deepEqual([...maps].sort(), [...MAP_IDS]);
  assert.equal(mapFor({ ...SETUP, map: 3 }, "m1", 2), 3);
  toPlay(room);
  const events = fold(room);
  assert.deepEqual(events, room.events);
  assert.notEqual(events, room.events, "the events returned are a copy");
  decide(room, 1, "snail");
  const steps = room.world!.step;
  run(room, OUTRO_TICKS - 1);
  assert.deepEqual([room.stage, room.results.length], ["running", 0]);
  assert.equal(room.world!.step, steps, "a decided game steps no further");
  fold(room);
  assert.deepEqual(
    [room.stage, room.score, room.winner],
    ["between", [0, 1], -1],
  );
  assert.deepEqual(room.results[0], {
    round: 1,
    mapId: maps[0],
    team: 1,
    kind: "snail",
    steps,
    tick: room.tick,
    crew: ["a", "b", "", "", "", ""],
    present: ["a", "b"],
  });
  assert.deepEqual(room.roster, {
    a: { name: "Ada", slot: 0 },
    b: { name: "Bo", slot: 1 },
  });
  assert.deepEqual(
    [room.stats.a?.games, room.stats.a?.gameWins, room.stats.b?.gameWins],
    [1, 0, 1],
  );
  assert.equal(room.resumeAt, room.tick + BETWEEN_TICKS);
  run(room, BETWEEN_TICKS - 1);
  assert.equal(room.stage, "between");
  fold(room);
  assert.deepEqual([room.stage, room.round], ["running", 2]);
  assert.deepEqual(
    [room.world!.mapId, room.world!.seed, room.endAt, room.resumeAt],
    [maps[1], roundSeed("m1", 2), 0, 0],
  );
  finish(room, 0);
  assert.deepEqual([room.stage, room.score], ["between", [1, 1]]);
  run(room, BETWEEN_TICKS);
  finish(room, 0, "economy");
  assert.deepEqual(
    [room.stage, room.score, room.winner, room.round],
    ["over", [2, 1], 0, 3],
  );
  assert.deepEqual(
    room.results.map((r) => r.mapId),
    maps,
  );
  const tick = room.tick;
  run(room, BETWEEN_TICKS + 5);
  assert.deepEqual(
    [room.stage, room.round, room.tick],
    ["over", 3, tick + BETWEEN_TICKS + 5],
  );
  // A rematch is a new set with the same seats; the lobby clears it.
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.deepEqual(
    [
      room.stage,
      room.matchId,
      room.round,
      room.score,
      room.results,
      room.stats,
    ],
    ["running", "m2", 1, [0, 0], [], {}],
  );
  fold(room, { a: [[ACTION, "lobby", "m3"]] });
  assert.deepEqual(
    [room.stage, room.matchId, room.round, room.world, room.seats.size],
    ["lobby", "m3", 0, null, 2],
  );
});

test("a record freezes who sat and who was there; a one-win set is over after one game", () => {
  const room = started({ ...SETUP, wins: 1 });
  toPlay(room);
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  decide(room, 0);
  run(room, OUTRO_TICKS);
  assert.deepEqual([room.stage, room.winner], ["over", 0]);
  assert.deepEqual(
    [room.results[0]!.crew.slice(0, 2), room.results[0]!.present],
    [["a", "b"], ["a"]],
  );
});

test("seats: a free slot is taken, an occupied one is swapped once both ask, and never during a game", () => {
  const room = lobby();
  fold(room, { a: [[SEAT, 4]] });
  assert.deepEqual(seated(room), ["", "b", "", "", "a", ""]);
  // Asking for another's slot records the wish; the other's answer swaps.
  fold(room, { a: [[SEAT, 1]] });
  assert.deepEqual(room.asks, { a: 1 });
  assert.deepEqual(view(room).asks, { a: 1 });
  fold(room, { b: [[SEAT, 4]] });
  assert.deepEqual([seated(room), room.asks], [["", "a", "", "", "b", ""], {}]);
  // Asking for one's own slot withdraws a wish; a new wish replaces the old one.
  fold(room, { b: [[SEAT, 1]] });
  fold(room, { b: [[SEAT, 4]] });
  assert.deepEqual(room.asks, {});
  fold(room, { b: [[SEAT, 1]] });
  fold(room, { b: [[SEAT, 0]] });
  assert.deepEqual([seated(room)[0], room.asks], ["b", {}]);
  // A wish for a slot that empties, or of a member who leaves, is dropped.
  fold(room, { a: [[SEAT, 0]] });
  assert.deepEqual(room.asks, { a: 0 });
  fold(room, { b: [[SEAT, 5]] });
  assert.deepEqual(room.asks, {});
  fold(room, { b: [[SEAT, 1]] });
  fold(room, { a: [[LEAVE, "b"]] });
  assert.deepEqual([room.asks, room.seats.has("b")], [{}, false]);
  // Watchers, strangers and absent seats cannot ask; two asks in a tick apply in order.
  fold(room, { a: [[SPECTATOR, "join", "w", "Wim", 1], join("c", "Cy", 3)] });
  fold(room, { a: [[PRESENCE, "c", false, 1]] });
  fold(room, { w: [[SEAT, 2]], z: [[SEAT, 2]], c: [[SEAT, 2]] });
  assert.deepEqual(seated(room), ["", "a", "", "c", "", ""]);
  fold(room, {
    a: [
      [SEAT, 2],
      [SEAT, 0],
    ],
  });
  assert.equal(seated(room)[0], "a");
  // During a game seats are fixed, and a pending wish does not survive its start.
  fold(room, { a: [[PRESENCE, "c", true, 1]] });
  fold(room, { a: [[SEAT, 3]] });
  assert.deepEqual(room.asks, { a: 3 });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.deepEqual(room.asks, {});
  fold(room, { a: [[SEAT, 5]] });
  assert.equal(seated(room)[0], "a");
  // Between games they move again, and the next game's bots follow.
  finish(room, 0);
  fold(room, { a: [[SEAT, 5]] });
  run(room, BETWEEN_TICKS);
  assert.deepEqual(room.world!.humans, [
    false,
    false,
    false,
    true,
    false,
    true,
  ]);
});

test("a seat follows the stream generation it was seated with, current or retired", () => {
  const room = started();
  toPlay(room);
  const idle = copy(room);
  fold(idle);
  const entries = (tick: number): Entry[] => [
    [900, tick, PLAY, "m1", 1, INPUT_LEFT],
  ];
  const withStream = (stream: StreamEntries<Entry>) => {
    const next = copy(room);
    foldTick(next, "a", new Map([["b", stream]]));
    return hash(next);
  };
  const tick = room.tick + 1;
  // The seat is generation 1: a newer stream's entries are not its, the retired generation's are.
  assert.equal(
    withStream({ generation: 2, entries: entries(tick) }),
    hash(idle),
  );
  assert.notEqual(
    withStream({
      generation: 2,
      entries: [],
      retired: [{ generation: 1, entries: entries(tick) }],
    }),
    hash(idle),
  );
  assert.equal(
    withStream({
      generation: 2,
      entries: [],
      retired: [{ generation: 3, entries: entries(tick) }],
    }),
    hash(idle),
  );
});

test("the hash covers the room and the round, and leaves out only the tick's events", () => {
  const room = started();
  toPlay(room);
  fold(room);
  const base = hash(room);
  assert.match(base, /^[0-9a-f]{16}$/);
  const other = copy(room);
  other.events = [{ type: "berryRegrow" }];
  other.world!.events = [{ type: "berryRegrow" }];
  assert.equal(hash(other), base);
  for (const change of [
    (r: typeof room) => r.world!.units[3]!.x++,
    (r: typeof room) => r.world!.rng++,
    (r: typeof room) => r.score[0]!++,
    (r: typeof room) => (r.asks.b = 0),
    (r: typeof room) => (r.seats.get("b")!.name = "Bob"),
    (r: typeof room) =>
      (r.stats.a = { games: 0, gameWins: 0, kills: 1, deaths: 0, berries: 0 }),
  ]) {
    const changed = copy(room);
    change(changed);
    assert.notEqual(hash(changed), base);
  }
  assert.equal(hash(createRoom("m0", SETUP)), hash(createRoom("m0", SETUP)));
  const h = hashPlain;
  assert.throws(() => h(() => 1));
  assert.throws(() => h(new Map([[1, 1]])));
  assert.equal(h({ a: 1, b: undefined }), h({ a: 1 }));
  assert.equal(h({ a: 1, b: 2 }), h({ b: 2, a: 1 }));
  assert.equal(h(-0), h(0));
  assert.equal(h(NaN), h(0 / 0));
  assert.notEqual(h(new Uint32Array([1, 2])), h([1, 2]));
  assert.equal(h(new Uint8Array([1, 2])), h([1, 2]));
  assert.notEqual(h([null, true, "x"]), h([null, false, "x"]));
});

test("the view is a copy in game time, seats in order, with every step's events of the tick", () => {
  const room = started();
  fold(room, { a: [[SPECTATOR, "join", "w", "Wim", 1]] });
  const lobbyView = view(createRoom("m0", SETUP));
  assert.deepEqual([lobbyView.world, lobbyView.crew.join("")], [null, ""]);
  toPlay(room);
  fold(room);
  room.events = [{ type: "respawn", slot: 2 }];
  const shown = view(room);
  assert.deepEqual(
    [shown.tick, shown.logTick, shown.stage, shown.round],
    [room.tick * STEPS_PER_TICK, room.tick, "running", 1],
  );
  assert.deepEqual(
    shown.seats.map((seat) => seat.id),
    ["w", "a", "b"],
  );
  assert.deepEqual(shown.crew, ["a", "b", "", "", "", ""]);
  assert.deepEqual(shown.world!.events, [{ type: "respawn", slot: 2 }]);
  assert.equal(shown.world!.units.length, CAPACITY);
  assert.equal(shown.world!.units[2]!.bot, true);
  // Nothing in a kept frame changes under the next fold.
  const kept = structuredClone(shown);
  decide(room, 1);
  const decided = view(room);
  run(room, 3);
  room.seats.get("a")!.name = "Changed";
  assert.deepEqual(shown, kept);
  assert.deepEqual(decided.world!.winner, { team: 1, kind: "military" });
  assert.notEqual(decided.world!.winner, room.world!.winner);
});

test("the first game of a set counts down 8 s, every later one 3 s", () => {
  assert.deepEqual(
    [countdownTicks(1), countdownTicks(2), countdownTicks(3)],
    [FIRST_COUNTDOWN_TICKS, COUNTDOWN_TICKS, COUNTDOWN_TICKS],
  );
  assert.equal(FIRST_COUNTDOWN_TICKS, 160);
  assert.equal(COUNTDOWN_TICKS, 60);
});

test("a tutorial room: one second of countdown, the lesson's setup, bots that stand still, and a checkpoint that keeps all three", () => {
  assert.deepEqual(
    [countdownTicks(1, true), countdownTicks(2, true)],
    [QUICK_COUNTDOWN_TICKS, QUICK_COUNTDOWN_TICKS],
  );
  assert.equal(QUICK_COUNTDOWN_TICKS, 20);
  const settings = {
    ...SETUP,
    map: 1 as const,
    passive: true,
    lesson: "snail" as const,
    quick: true,
  };
  const room = started(settings);
  assert.equal(room.startAt, room.tick + QUICK_COUNTDOWN_TICKS);
  const usual = started({ ...SETUP, map: 1 });
  assert.ok(room.world!.passive && !usual.world!.passive);
  assert.ok(room.world!.snail.x < usual.world!.snail.x, "nearer Cyan's goal");
  assert.deepEqual(roundOptions(settings, "m1", 1), {
    seed: roundSeed("m1", 1),
    mapId: 1,
    botLevel: "medium",
    passive: true,
    lesson: "snail",
  });
  assert.equal("lesson" in roundOptions(SETUP, "m1", 1), false);
  // Nobody holds a control for ten seconds of play: every bot is where it started.
  toPlay(room);
  const before = room.world!.units.map((unit) => [unit.x, unit.y]);
  run(room, 200);
  assert.deepEqual(
    room.world!.units.map((unit) => [unit.x, unit.y]),
    before,
  );
  const back = game.checkpoint.decode(game.checkpoint.encode(room), room.tick);
  assert.ok(back);
  assert.equal(hash(back), hash(room));
  // A checkpoint whose world is not the passive one its settings ask for is refused.
  const lively = copy(room);
  lively.world!.passive = false;
  assert.equal(
    game.checkpoint.decode(game.checkpoint.encode(lively), room.tick),
    undefined,
  );
});
