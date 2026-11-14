import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  PRESENCE,
  SETTINGS,
  type StreamEntries,
} from "fuse-netcode";
import { DUCK, JUMP, RULES } from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import {
  DEFAULT_SETTINGS,
  PLAY,
  createFuseSurgeGame,
  createRoom,
  decode,
  encode,
  foldTick,
  fuseSurgeGame,
  hash,
  idleBot,
  isEntry,
  parseSettings,
  riders,
  rulesOf,
  view,
  type Entry,
  type Room,
} from "../src/online/game.js";
import { matchResult, roundResult } from "../src/online/result.js";
import { BOT_NAMES, seatName, validMatchId } from "../src/online/names.js";
import { fuseSurgeRegistration } from "../src/platform.js";
import { fold, finish, run, seated, started } from "./fixtures/room.js";

const roundTrip = (room: Room): Room | undefined =>
  decode(JSON.parse(JSON.stringify(encode(room))) as unknown[], room.tick);

test("settings are exactly seven checked fields", () => {
  assert.deepEqual(parseSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.deepEqual(DEFAULT_SETTINGS, {
    display: false,
    hits: 3,
    seconds: 60,
    pace: 1,
    target: 3,
    recover: true,
    bot: 1,
  });
  assert.deepEqual(rulesOf(DEFAULT_SETTINGS), {
    hits: 3,
    seconds: 60,
    pace: 1,
    target: 3,
    recover: true,
  });
  const bad: unknown[] = [
    null,
    [],
    "settings",
    { ...DEFAULT_SETTINGS, extra: 1 },
    { display: false },
    { ...DEFAULT_SETTINGS, display: 1 },
    { ...DEFAULT_SETTINGS, recover: "yes" },
    { ...DEFAULT_SETTINGS, hits: 0 },
    { ...DEFAULT_SETTINGS, hits: 10 },
    { ...DEFAULT_SETTINGS, seconds: 5 },
    { ...DEFAULT_SETTINGS, seconds: 301 },
    { ...DEFAULT_SETTINGS, pace: 3 },
    { ...DEFAULT_SETTINGS, target: 0 },
    { ...DEFAULT_SETTINGS, bot: 5 },
  ];
  for (const raw of bad) assert.equal(parseSettings(raw), undefined);
  // Anything inside the bounds is a match, whether or not the lobby offers it.
  assert.ok(parseSettings({ ...DEFAULT_SETTINGS, hits: 7, seconds: 45 }));
});

test("the log takes management entries and held bits for a match, and nothing else", () => {
  assert.ok(isEntry([1, 1, PLAY, "m1", JUMP | DUCK]));
  assert.ok(isEntry([1, 1, PLAY, "m1", 0]));
  assert.ok(isEntry([1, 1, JOIN, "a", "Ada", 0, "robot", 1]));
  assert.ok(isEntry([1, 1, ACTION, "start", "m1"]));
  assert.ok(isEntry([1, 1, SETTINGS, DEFAULT_SETTINGS]));
  const bad: unknown[] = [
    [1, 1, PLAY, "m1", 4],
    [1, 1, PLAY, "m1", -1],
    [1, 1, PLAY, "m 1", 1],
    [1, 1, PLAY, "", 1],
    [0, 1, PLAY, "m1", 1],
    [1, 0, PLAY, "m1", 1],
    [1, 1, PLAY, "m1"],
    [1, 1, PLAY, "m1", 1, 1],
    [1, 1, ACTION, "start", "bad id"],
    [1, 1, JOIN, "__proto__", "Ada", 0, "robot", 1],
    [1, 1, SETTINGS, { ...DEFAULT_SETTINGS, hits: 99 }],
    "entry",
    null,
  ];
  for (const raw of bad) assert.equal(isEntry(raw), false, JSON.stringify(raw));
  assert.equal(seatName("  Ada  "), "Ada");
  assert.equal(seatName("a\u0007b"), undefined);
  assert.equal(seatName("   "), undefined);
  assert.equal(Array.from(seatName("x".repeat(40))!).length, 18);
  assert.ok(validMatchId("m1") && !validMatchId("m 1") && !validMatchId(5));
});

test("a match needs two riders; once started it counts in with the room's settings", () => {
  const alone = createRoom("m0", DEFAULT_SETTINGS);
  fold(alone, { a: [[JOIN, "a", "Ada", 0, "robot", 1]] });
  fold(alone, { a: [[ACTION, "start", "m1"]] });
  assert.equal(alone.stage, "lobby", "one rider is not a match");
  assert.equal(alone.world, null);
  const room = seated({ ...DEFAULT_SETTINGS, hits: 4, seconds: 30, pace: 2 });
  assert.deepEqual(
    riders(room).map((seat) => seat.id),
    ["a", "b"],
  );
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.matchId, "m1");
  assert.deepEqual(room.world!.rules, {
    hits: 4,
    seconds: 30,
    pace: 2,
    target: 3,
    recover: true,
  });
  assert.deepEqual(
    room.roster.map((entrant) => [entrant.id, entrant.name, entrant.slot]),
    [
      ["a", "Ada", 0],
      ["b", "Bo", 1],
    ],
  );
  assert.equal(room.world!.phase, "ready");
  // The lobby's settings can change for the next match; this one keeps what it started with.
  fold(room, { a: [[SETTINGS, { ...DEFAULT_SETTINGS, hits: 2 }]] });
  assert.equal(room.play.hits, 4);
  assert.equal(room.world!.rules.hits, 4);
  // Six steps a tick, whatever the room is doing.
  const before = room.simulationTick;
  run(room, 10);
  assert.equal(room.simulationTick, before + 10 * T.STEPS_PER_TICK);
  assert.equal(fuseSurgeGame.steps(room), T.STEPS_PER_TICK);
  assert.equal(fuseSurgeGame.clock(room), room.simulationTick);
  assert.deepEqual(fuseSurgeGame.scope(room), { matchId: "m1", round: 0 });
});

test("a seat's held bits steer its rider from the tick they are logged, for this match only", () => {
  const room = started();
  fold(room, { b: [[PLAY, "m1", JUMP]] });
  assert.deepEqual(room.held, { b: JUMP });
  assert.ok(room.world!.riders[1]!.y > 0, "b jumped");
  assert.equal(room.world!.riders[0]!.y, 0);
  // Held until changed.
  run(room, 3);
  assert.deepEqual(room.held, { b: JUMP });
  fold(room, { b: [[PLAY, "m1", 0]] });
  assert.deepEqual(room.held, {});
  // Bits for another match are ignored.
  run(room, 20);
  fold(room, { a: [[PLAY, "old", DUCK]] });
  assert.deepEqual(room.held, {});
  assert.equal(room.world!.riders[0]!.duck, false);
  // A press and release inside one tick still counts: the tick's first step sees it.
  fold(room, {
    a: [
      [PLAY, "m1", JUMP],
      [PLAY, "m1", 0],
    ],
  });
  assert.deepEqual(room.held, {});
  assert.ok(room.world!.riders[0]!.y > 0, "the tap was a hop");
  // A seat that goes away holds nothing until it is back.
  fold(room, { b: [[PLAY, "m1", DUCK]] });
  assert.deepEqual(room.held, { b: DUCK });
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.deepEqual(room.held, {});
});

test("a bot seat is asked once a tick, through the game's bot, and holds nothing in the room", () => {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [BOT, "add", "bot:1", "Volt", 1, "robot"],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.equal(room.stage, "running");
  const asked: number[] = [];
  const jumper = (_world: unknown, slot: number) => {
    asked.push(slot);
    return JUMP;
  };
  fold(room, {}, jumper);
  assert.deepEqual(asked, [1], "only the bot's slot");
  assert.ok(room.world!.riders[1]!.y > 0);
  assert.deepEqual(room.held, {});
  // An answer that is not held bits is no answer.
  run(room, 40);
  fold(room, {}, () => 99);
  assert.equal(room.world!.riders[1]!.y, 0);
  assert.equal(idleBot(room.world!, 0, 1), 0);
  // The game's own bot is the engine's.
  const game = createFuseSurgeGame();
  const streams = new Map<string, StreamEntries<Entry>>();
  game.createTicker()(room, "a", streams);
  assert.equal(game.rules, RULES);
  assert.equal(game.seating.botName(1), BOT_NAMES[1]);
  assert.equal(game.seating.botId(room, new Set(["bot:2"])), "bot:3");
  assert.equal(game.seating.solo.bots, 3);
  assert.deepEqual(
    game.seating.soloSettings({ ...DEFAULT_SETTINGS, display: true }),
    DEFAULT_SETTINGS,
  );
  assert.equal(
    game.seating.sharedScreen({ ...DEFAULT_SETTINGS, display: true }),
    true,
  );
  assert.equal(game.stage(room), "running");
  assert.equal(game.seat(room, "a")?.name, "Ada");
  assert.deepEqual(
    [...game.members(room)].map((seat) => seat.id),
    ["a", "bot:1"],
  );
  assert.equal(game.settings(room), room.settings);
  assert.equal(game.matchSettings?.(room), room.play);
});

test("a finished match names its winners and who saw it end, and reports as one rated round", () => {
  const room = started({ ...DEFAULT_SETTINGS, target: 2 });
  assert.equal(matchResult(room), undefined, "nothing to report mid-match");
  fold(room, { b: [[PLAY, "m1", DUCK]] });
  finish(room, 1);
  assert.equal(room.stage, "over");
  assert.deepEqual(room.decided!.winners, ["b"]);
  assert.deepEqual(room.decided!.finishers, ["a", "b"]);
  assert.equal(room.decided!.clock, room.simulationTick);
  assert.deepEqual(room.held, {}, "nothing is held once it is over");
  assert.deepEqual(view(room).winners, ["b"]);
  const result = matchResult(room)!;
  assert.equal(result.winnerId, "b");
  assert.equal(result.length, 1);
  assert.deepEqual(
    result.players.map((player) => [
      player.playerId,
      player.roundWins,
      player.matchScoreUnits,
      player.matchPlacement,
      player.points,
      player.earlyExits,
    ]),
    [
      ["a", 0, 0, 2, 0, 0],
      ["b", 1, 2, 1, 2, 0],
    ],
  );
  assert.equal(roundResult(room)!.round, 1);
  // The platform's own boundary takes it.
  const parsed = result.players.map((player) =>
    fuseSurgeRegistration.parseStats(
      { ...player, playerId: "a".repeat(24) },
      1,
    ),
  );
  assert.ok(parsed.every(Boolean));
  assert.ok(fuseSurgeRegistration.validField!(result.players));
  // It stays decided while the room looks at it, then a rematch plays the lobby's settings afresh.
  run(room, 20);
  assert.equal(room.stage, "over");
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.matchId, "m2");
  assert.equal(room.decided, null);
  assert.equal(room.world!.round, 1);
  fold(room, { a: [[ACTION, "lobby", "m3"]] });
  assert.equal(room.stage, "lobby");
  assert.equal(room.world, null);
  assert.deepEqual(room.roster, []);
});

test("a drawn match has several winners and no single winner id; a rider who left early is marked", () => {
  const room = seated({ ...DEFAULT_SETTINGS, target: 1, hits: 1 });
  fold(room, { a: [[JOIN, "c", "Cy", 2, "robot", 1]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  // c leaves, and nobody moves: the first surge takes all three together, a draw between everyone on the deck.
  fold(room, { a: [[PRESENCE, "c", false, 1]] });
  for (let i = 0; i < 4000 && room.stage === "running"; i++) run(room, 1);
  assert.equal(room.stage, "over");
  assert.equal(room.world!.lastReason, "wipe");
  assert.deepEqual(room.decided!.winners, ["a", "b", "c"]);
  const result = matchResult(room)!;
  assert.equal(result.winnerId, undefined);
  assert.deepEqual(
    result.players.map((player) => [
      player.playerId,
      player.matchPlacement,
      player.roundWins,
      player.earlyExits,
    ]),
    [
      ["a", 1, 1, 0],
      ["b", 1, 1, 0],
      ["c", 1, 1, 1],
    ],
  );
  assert.deepEqual(result.finishers, ["a", "b"]);
});

test("a room round-trips through its checkpoint in the lobby, mid-match and once decided", () => {
  const lobby = seated();
  assert.deepEqual(roundTrip(lobby), lobby);
  const room = started({ ...DEFAULT_SETTINGS, target: 1 });
  fold(room, { a: [[PLAY, "m1", JUMP]] });
  run(room, 200);
  const copy = roundTrip(room)!;
  assert.deepEqual(copy, room);
  assert.equal(hash(copy), hash(room));
  assert.match(hash(room), /^[0-9a-f]{16}$/);
  // The copy folds on exactly as the original.
  run(room, 100);
  run(copy, 100);
  assert.equal(hash(copy), hash(room));
  run(room, 1);
  assert.notEqual(hash(copy), hash(room), "a tick apart, a different hash");
  finish(room, 0);
  assert.deepEqual(roundTrip(room), room);
  const shown = view(room);
  assert.equal(shown.stage, "over");
  assert.equal(shown.tick, room.simulationTick);
  assert.equal(shown.logTick, room.tick);
  assert.deepEqual(
    shown.seats.map((seat) => [seat.id, seat.slot, seat.watcher]),
    [
      ["a", 0, false],
      ["b", 1, false],
    ],
  );
  assert.equal(view(lobby).world, null);
});

test("a checkpoint that disagrees with itself is refused whole", () => {
  const room = started({ ...DEFAULT_SETTINGS, target: 1 });
  fold(room, { a: [[PLAY, "m1", JUMP]] });
  run(room, 60);
  const change = (edit: (fields: unknown[]) => void, tick = room.tick) => {
    const fields = JSON.parse(JSON.stringify(encode(room))) as unknown[];
    edit(fields);
    return decode(fields, tick);
  };
  assert.ok(change(() => {}));
  assert.equal(
    change(() => {}, room.tick + 1),
    undefined,
    "the clock is six steps a tick",
  );
  assert.equal(
    change(() => {}, -1),
    undefined,
  );
  assert.equal(
    change((f) => f.pop()),
    undefined,
  );
  assert.equal(
    change((f) => (f[0] = "bad id")),
    undefined,
  );
  assert.equal(
    change((f) => (f[1] = "paused")),
    undefined,
  );
  assert.equal(
    change((f) => (f[1] = "lobby")),
    undefined,
    "a lobby has no world",
  );
  assert.equal(
    change((f) => (f[1] = "over")),
    undefined,
    "over needs a finished world",
  );
  assert.equal(
    change((f) => (f[2] = { display: false })),
    undefined,
  );
  assert.equal(
    change((f) => (f[4] = { ...DEFAULT_SETTINGS, target: 1, hits: 5 })),
    undefined,
    "the world plays by the match's settings",
  );
  assert.equal(
    change((f) => (f[8] = null)),
    undefined,
    "a match has a world",
  );
  assert.equal(
    change((f) => (f[8] = [1, 2, 3])),
    undefined,
  );
  assert.equal(
    change((f) => (f[7] = [1, ["a"], ["a"]])),
    undefined,
    "not decided yet",
  );
  // Seats.
  const seat = (edit: (seat: Record<string, unknown>) => void) =>
    change((f) => edit((f[3] as Record<string, unknown>[])[0]!));
  assert.equal(
    seat((s) => (s.id = "constructor")),
    undefined,
  );
  assert.equal(
    seat((s) => (s.name = "")),
    undefined,
  );
  assert.equal(
    seat((s) => (s.slot = 5)),
    undefined,
  );
  assert.equal(
    seat((s) => (s.slot = 1)),
    undefined,
    "two seats in one slot",
  );
  assert.equal(
    seat((s) => (s.avatarId = "nobody")),
    undefined,
  );
  assert.equal(
    seat((s) => (s.connected = "yes")),
    undefined,
  );
  assert.equal(
    seat((s) => (s.bot = 1)),
    undefined,
  );
  assert.equal(
    seat((s) => (s.extra = 1)),
    undefined,
  );
  assert.equal(
    seat((s) => (s.away = true)),
    undefined,
    "away and connected",
  );
  assert.equal(
    seat((s) => (s.watcher = false)),
    undefined,
  );
  assert.equal(
    seat((s) => delete s.generation),
    undefined,
  );
  assert.equal(
    seat((s) => ((s.bot = true), (s.generation = 1))),
    undefined,
  );
  assert.equal(
    change((f) => (f[3] = "seats")),
    undefined,
  );
  assert.equal(
    change((f) => (f[3] as unknown[]).push((f[3] as unknown[])[0])),
    undefined,
  );
  // Held bits: a rider of the match, once, never nothing.
  assert.equal(
    change((f) => (f[5] = [["zed", JUMP]])),
    undefined,
  );
  assert.equal(
    change((f) => (f[5] = [["a", 0]])),
    undefined,
  );
  assert.equal(
    change((f) => (f[5] = [["a", 9]])),
    undefined,
  );
  assert.equal(
    change(
      (f) =>
        (f[5] = [
          ["a", JUMP],
          ["a", DUCK],
        ]),
    ),
    undefined,
  );
  assert.equal(
    change((f) => (f[5] = [["a"]])),
    undefined,
  );
  assert.equal(
    change((f) => (f[5] = "held")),
    undefined,
  );
  // The roster is the world's riders, in order.
  assert.equal(
    change((f) => (f[6] as unknown[]).reverse()),
    undefined,
  );
  assert.equal(
    change((f) => (f[6] as unknown[]).pop()),
    undefined,
  );
  assert.equal(
    change((f) => ((f[6] as unknown[][])[1]![0] = "a")),
    undefined,
  );
  assert.equal(
    change((f) => ((f[6] as unknown[][])[1]![1] = "")),
    undefined,
  );
  assert.equal(
    change((f) => ((f[6] as unknown[][])[1]![2] = "bot")),
    undefined,
  );
  assert.equal(
    change((f) => ((f[6] as unknown[][])[1] = ["b"])),
    undefined,
  );
  assert.equal(
    change((f) => (f[6] = 7)),
    undefined,
  );
  // A lobby with leftovers.
  const lobby = seated();
  const stale = (edit: (fields: unknown[]) => void) => {
    const fields = JSON.parse(JSON.stringify(encode(lobby))) as unknown[];
    edit(fields);
    return decode(fields, lobby.tick);
  };
  assert.ok(stale(() => {}));
  assert.equal(
    stale((f) => (f[5] = [["a", JUMP]])),
    undefined,
  );
  assert.equal(
    stale(
      (f) =>
        (f[6] = [
          ["a", "Ada", false],
          ["b", "Bo", false],
        ]),
    ),
    undefined,
  );
  assert.equal(
    stale((f) => (f[1] = "running")),
    undefined,
  );
  // A decided match: the winners are the world's, in lane order, and the finishers its humans, sorted.
  finish(room, 1);
  const decided = (edit: (decided: unknown[]) => void) =>
    change((f) => edit(f[7] as unknown[]));
  assert.ok(decided(() => {}));
  assert.equal(
    decided((d) => (d[1] = ["a"])),
    undefined,
    "not who the world says won",
  );
  assert.equal(
    decided((d) => (d[1] = ["a", "b"])),
    undefined,
  );
  assert.equal(
    decided((d) => (d[1] = ["b", "a"])),
    undefined,
  );
  assert.equal(
    decided((d) => (d[1] = [])),
    undefined,
  );
  assert.equal(
    decided((d) => (d[1] = ["zed"])),
    undefined,
  );
  assert.equal(
    decided((d) => (d[1] = "b")),
    undefined,
  );
  assert.equal(
    decided((d) => (d[0] = 0)),
    undefined,
  );
  assert.equal(
    decided((d) => (d[0] = room.simulationTick + 1)),
    undefined,
  );
  assert.equal(
    decided((d) => (d[2] = ["b", "a"])),
    undefined,
    "sorted",
  );
  assert.equal(
    decided((d) => (d[2] = ["a", "a"])),
    undefined,
  );
  assert.equal(
    decided((d) => (d[2] = ["zed"])),
    undefined,
  );
  assert.equal(
    decided((d) => (d[2] = "a")),
    undefined,
  );
  assert.equal(
    decided((d) => d.pop()),
    undefined,
  );
  assert.equal(
    change((f) => (f[7] = null)),
    undefined,
    "an ended match is decided",
  );
  assert.equal(
    change((f) => (f[5] = [["a", JUMP]])),
    undefined,
    "nothing held once over",
  );
  assert.equal(
    change((f) => (f[7] = "decided")),
    undefined,
  );
});
