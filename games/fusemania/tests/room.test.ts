import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  PRESENCE,
  SETTINGS as SETTINGS_ENTRY,
  type StreamEntries,
} from "fuse-netcode";
import {
  BATTLE_MODE,
  FULL_RATING,
  GREAT,
  LEAD_IN_MS,
  MARVELOUS,
  MISS,
  PERFECT,
} from "../src/engine/index.js";
import {
  HOLD_TICKS,
  PICK,
  PLAY,
  READY,
  type Entry,
} from "../src/online/game.js";
import { matchResult } from "../src/online/result.js";
import { parseFusemaniaStats, validFusemaniaField } from "../src/platform.js";
import {
  SETTINGS,
  fold,
  game,
  library,
  run,
  runTo,
  seated,
  started,
} from "./fixtures/room.js";
import { beatMs } from "./fixtures/songs.js";

const counts = (room: ReturnType<typeof started>, slot: number) =>
  room.world!.players[slot]!.counts;

test("a match starts after a lead-in, on each seat's own chart", () => {
  const room = seated();
  fold(room, { b: [[PICK, 1]] });
  fold(room, {
    a: [
      [ACTION, "start", "m1"],
      [READY, 1],
    ],
    b: [[READY, 1]],
  });
  assert.equal(room.stage, "running");
  assert.equal(room.epoch, 1);
  assert.equal(room.world!.ms, -LEAD_IN_MS + 50);
  assert.deepEqual(
    room.roster.map((entrant) => [entrant.id, entrant.chart]),
    [
      ["a", 0],
      ["b", 1],
    ],
  );
  // The view names the chart a seat will play, for the lobby and the field.
  const view = game.view(room);
  assert.deepEqual(
    view.seats.map((seat) => seat.chart),
    [0, 1],
  );
  assert.equal(view.world!.players[1]!.chart, 1);
});

test("a press is judged at the song time it carries, whichever tick folds it", () => {
  const early = started(),
    late = started();
  const press = [PLAY, 1, 0, beatMs(4) + 10];
  // Folded on the tick the press happened in, and four ticks (200 ms) later: the same Marvelous.
  runTo(early, beatMs(4));
  fold(early, { a: [press] });
  runTo(late, beatMs(4) + 200);
  fold(late, { a: [press] });
  run(early, 5);
  for (const room of [early, late]) {
    assert.equal(counts(room, 0)[MARVELOUS], 1);
    assert.equal(room.world!.players[0]!.combo, 1);
  }
  // A press 30 ms off is a Perfect wherever it folds, and one for another column judges nothing.
  const off = started();
  runTo(off, beatMs(4) + 100);
  fold(off, {
    a: [[PLAY, 1, 0, beatMs(4) + 30]],
    b: [[PLAY, 1, 2, beatMs(4)]],
  });
  assert.equal(counts(off, 0)[PERFECT], 1);
  assert.equal(counts(off, 1)[MARVELOUS], 0);
});

test("a press too old to be true is judged at the oldest time the room still accepts", () => {
  const room = started();
  runTo(room, beatMs(6));
  // A device claims it pressed beat 4 a full second ago: the room hears it 300 ms ago at the earliest, a miss already.
  fold(room, { a: [[PLAY, 1, 0, beatMs(4)]] });
  assert.equal(counts(room, 0)[MARVELOUS], 0);
  assert.ok(counts(room, 0)[MISS]! > 0);
});

test("keys from another match, a watcher or a stranger change nothing", () => {
  const room = started();
  runTo(room, beatMs(4));
  const before = game.hash(room);
  const quiet = started();
  runTo(quiet, beatMs(4));
  assert.equal(game.hash(quiet), before);
  fold(room, {
    a: [[PLAY, 7, 0, beatMs(4)]],
    z: [[PLAY, 1, 0, beatMs(4)]],
  });
  fold(quiet);
  assert.equal(game.hash(room), game.hash(quiet));
});

test("the song ends for everyone together, the best rating wins, and a rematch is a new match", () => {
  const room = started();
  // Ada hits every step of Easy dead on; Bo plays nothing.
  const steps = library.steps("grid", 0)!;
  for (const note of steps.notes) {
    runTo(room, note.ms);
    fold(room, {
      a: [
        [PLAY, 1, note.column, note.ms],
        [PLAY, 1, note.column + 4, note.ms + 40],
      ],
    });
  }
  run(room, 400);
  assert.equal(room.stage, "over");
  assert.equal(room.decided!.winner, "a");
  const view = game.view(room);
  assert.equal(view.winner, "a");
  assert.equal(view.world!.players[0]!.rating, FULL_RATING);
  assert.equal(view.world!.players[0]!.place, 1);
  assert.equal(view.world!.players[1]!.rating, 0);
  assert.equal(view.world!.players[1]!.counts[MISS], steps.steps);

  const result = matchResult(library, room)!;
  assert.equal(result.players.length, 2);
  // The service knows members by their long ids; the test's are one letter.
  const reported = result.players.map((player) => ({
    ...player,
    playerId: player.playerId.repeat(24),
  }));
  for (const player of reported)
    assert.deepEqual(parseFusemaniaStats(player, 1), player);
  assert.ok(validFusemaniaField(reported));
  assert.equal(result.players[0]!.matchScoreUnits, FULL_RATING);

  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.epoch, 2);
  assert.equal(room.world!.players[0]!.score, 0);
  // The old match's keys are not this one's.
  runTo(room, beatMs(4));
  fold(room, { a: [[PLAY, 1, 0, beatMs(4)]] });
  assert.equal(counts(room, 0)[MARVELOUS], 0);
  fold(room, { a: [[ACTION, "lobby", "m3"]] });
  assert.equal(room.stage, "lobby");
  assert.equal(room.world, null);
});

test("the host's settings are checked: a song the library has, a known mode, a chart index", () => {
  const parse = game.seating.parseSettings;
  assert.deepEqual(parse(SETTINGS), SETTINGS);
  assert.deepEqual(parse({ ...SETTINGS, song: "other", mode: BATTLE_MODE }), {
    ...SETTINGS,
    song: "other",
    mode: BATTLE_MODE,
  });
  for (const bad of [
    null,
    { ...SETTINGS, song: "nope" },
    { ...SETTINGS, mode: 2 },
    { ...SETTINGS, chart: -1 },
    { ...SETTINGS, chart: 1.5 },
    { ...SETTINGS, chart: 99 },
    { ...SETTINGS, extra: 1 },
    { display: false, song: "grid", mode: 0, chart: 0 },
    { ...SETTINGS, songs: 2 },
    { ...SETTINGS, songs: 3, random: 1 },
  ])
    assert.equal(parse(bad), undefined, JSON.stringify(bad));
  // A song with fewer charts plays its hardest for a seat that picked a harder one.
  const room = seated();
  fold(room, { b: [[PICK, 1]] });
  fold(room, {
    a: [[SETTINGS_ENTRY, { ...SETTINGS, song: "other" }]],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.equal(room.world!.song, "other");
  assert.deepEqual(
    room.roster.map((entrant) => entrant.chart),
    [0, 0],
  );
});

test("entries are validated at the log's boundary", () => {
  assert.ok(game.isEntry([1, 1, PLAY, 1, 0, 2000]));
  assert.ok(game.isEntry([1, 1, PLAY, 1, 8, -3000]));
  assert.ok(game.isEntry([1, 1, PICK, 3]));
  for (const bad of [
    [1, 1, PLAY, 1, 9, 2000],
    [1, 1, PLAY, 1, 0, 2000.5],
    [1, 1, PLAY, 1, 0, 1e9],
    [1, 1, PLAY, -1, 0, 2000],
    [1, 1, PLAY, 1, 0],
    [1, 1, PLAY, 1, 0, 2000, 1],
    [0, 1, PLAY, 1, 0, 2000],
    [1, 1, PICK, 16],
    [1, 1, PICK, -1],
    [1, 1, PICK, 1, 1],
    [1, 1, 99, 1],
    "nope",
  ])
    assert.equal(game.isEntry(bad), false, JSON.stringify(bad));
});

test("a checkpoint restores the same room mid-song, and a doctored one is refused", () => {
  const room = started({ ...SETTINGS, mode: BATTLE_MODE });
  fold(room, { b: [[PICK, 1]] });
  runTo(room, beatMs(4));
  fold(room, { a: [[PLAY, 1, 0, beatMs(4) + 50]] });
  run(room, 30);
  assert.equal(counts(room, 0)[GREAT], 1);
  const fields = structuredClone(game.checkpoint.encode(room));
  const restored = game.checkpoint.decode(fields, room.tick)!;
  assert.ok(restored);
  assert.equal(game.hash(restored), game.hash(room));
  for (const each of [room, restored]) {
    fold(each, { b: [[PLAY, 1, 1, beatMs(5) + 1500]] });
    run(each, 40);
  }
  assert.equal(game.hash(restored), game.hash(room));
  assert.deepEqual(game.view(restored), game.view(room));

  const doctored = (change: (fields: unknown[]) => void) => {
    const copy = structuredClone(game.checkpoint.encode(room));
    change(copy);
    return game.checkpoint.decode(copy, room.tick);
  };
  assert.equal(
    doctored((copy) => (copy[1] = "lobby")),
    undefined,
    "a lobby has no world",
  );
  assert.equal(
    doctored((copy) => ((copy[2] as { song: string }).song = "nope")),
    undefined,
  );
  assert.equal(
    doctored((copy) => ((copy[4] as { song: string }).song = "other")),
    undefined,
    "the world's song is the match's",
  );
  assert.equal(
    doctored((copy) => copy.push("more")),
    undefined,
  );
  assert.equal(
    game.checkpoint.decode(fields, 0),
    undefined,
    "a match cannot have started before the room did",
  );
});

test("AI rivals fill seats, play on the host's chart and finish the song", () => {
  const room = seated({ ...SETTINGS, mode: BATTLE_MODE });
  fold(room, { a: [[BOT, "add", "bot:1", 2]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.equal(room.roster.length, 3);
  assert.equal(room.roster[2]!.bot, true);
  run(room, 2000);
  assert.equal(room.stage, "over");
  const bot = game.view(room).world!.players[2]!;
  assert.ok(bot.rating > 500_000, `the AI scored ${bot.rating}`);
  assert.equal(room.decided!.winner, "bot:1");
});

test("a started song stands still until every device has its audio", () => {
  const room = seated();
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.equal(room.stage, "running");
  assert.deepEqual(game.view(room).waiting, { ids: ["a", "b"], screen: false });
  // Nothing moves and nothing is judged while it waits, however long.
  run(room, 40);
  fold(room, { a: [[PLAY, 1, 0, beatMs(4)]] });
  assert.equal(room.world!.ms, -LEAD_IN_MS);
  assert.deepEqual(
    room.world!.players[0]!.down,
    room.world!.players[1]!.down,
    "a key pressed before the song began is nobody's",
  );
  // One device is done; a word about another match is not about this one.
  fold(room, { a: [[READY, 1]], b: [[READY, 2]] });
  assert.deepEqual(game.view(room).waiting, { ids: ["b"], screen: false });
  assert.equal(room.world!.ms, -LEAD_IN_MS);
  // The last one lets the song go, on that tick.
  fold(room, { b: [[READY, 1]] });
  assert.equal(game.view(room).waiting, null);
  assert.equal(room.world!.ms, -LEAD_IN_MS + 50);
  run(room, 10);
  assert.equal(room.world!.ms, -LEAD_IN_MS + 550);
});

test("a held song waits for nobody who is not there, and never longer than its limit", () => {
  // An AI rival has no device, and a rider who left is not waited for.
  const room = seated();
  fold(room, { a: [[BOT, "add", "bot:1", "Robo", 2]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.equal(room.roster.length, 3);
  assert.deepEqual(game.view(room).waiting?.ids, ["a", "b"]);
  fold(room, { a: [[READY, 1]] });
  assert.deepEqual(game.view(room).waiting?.ids, ["b"]);
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.equal(room.hold, null);
  assert.equal(room.world!.ms, -LEAD_IN_MS + 50);

  // A device that never answers holds the room for `HOLD_TICKS` and no more.
  const stuck = seated();
  fold(stuck, { a: [[ACTION, "start", "m1"]] });
  run(stuck, HOLD_TICKS - 1);
  assert.ok(stuck.hold);
  assert.equal(stuck.world!.ms, -LEAD_IN_MS);
  run(stuck, 1);
  assert.equal(stuck.hold, null);
  assert.equal(stuck.world!.ms, -LEAD_IN_MS + 50);

  // Back in the song select nothing is held, and the next song waits anew.
  fold(stuck, { a: [[ACTION, "lobby", "m2"]] });
  assert.equal(stuck.hold, null);
  fold(stuck, { a: [[ACTION, "start", "m3"]] });
  assert.deepEqual(game.view(stuck).waiting?.ids, ["a", "b"]);
});

test("a shared screen room waits for its TV, which holds no seat", () => {
  const ticker = game.createTicker();
  let seq = 0;
  const room = game.createRoom("m0", { ...SETTINGS, display: true });
  const step = (bodies: Record<string, unknown[][]> = {}) => {
    const streams = new Map<string, StreamEntries<Entry>>();
    for (const [id, list] of Object.entries(bodies))
      streams.set(id, {
        generation: 1,
        entries: list.map((body) => [++seq, room.tick + 1, ...body] as Entry),
      });
    ticker(room, "tv", streams);
  };
  step({
    tv: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
    ],
  });
  step({ tv: [[ACTION, "start", "m1"]] });
  assert.deepEqual(game.view(room).waiting, { ids: ["a", "b"], screen: true });
  // The phones are pads and done at once: the song still waits for the screen that plays it.
  step({ a: [[READY, 1]], b: [[READY, 1]] });
  assert.deepEqual(game.view(room).waiting, { ids: [], screen: true });
  assert.equal(room.world!.ms, -LEAD_IN_MS);
  const fields = structuredClone(game.checkpoint.encode(room));
  assert.equal(
    game.hash(game.checkpoint.decode(fields, room.tick)!),
    game.hash(room),
  );
  step({ tv: [[READY, 1]] });
  assert.equal(game.view(room).waiting, null);
  assert.equal(room.world!.ms, -LEAD_IN_MS + 50);
});

test("a held room restores from its checkpoint, and a doctored hold is refused", () => {
  const room = seated();
  fold(room, { a: [[ACTION, "start", "m1"]] });
  fold(room, { b: [[READY, 1]] });
  run(room, 5);
  const restored = game.checkpoint.decode(
    structuredClone(game.checkpoint.encode(room)),
    room.tick,
  )!;
  assert.ok(restored);
  assert.deepEqual(restored.hold, { ticks: 7, ready: ["b"], screen: false });
  for (const each of [room, restored]) fold(each, { a: [[READY, 1]] });
  assert.equal(game.hash(restored), game.hash(room));
  assert.equal(restored.hold, null);

  const held = seated();
  fold(held, { a: [[BOT, "add", "bot:1", "Robo", 2]] });
  fold(held, { a: [[ACTION, "start", "m1"]] });
  fold(held, { b: [[READY, 1]] });
  const bot = [...held.seats.values()].find((seat) => seat.bot)!.id;
  const doctored = (hold: unknown) => {
    const copy = structuredClone(game.checkpoint.encode(held));
    copy[11] = hold;
    return game.checkpoint.decode(copy, held.tick);
  };
  assert.ok(doctored([3, ["b"], false]));
  for (const bad of [
    [3, ["b"]],
    [-1, ["b"], false],
    [HOLD_TICKS + 1, ["b"], false],
    [3, ["b", "a"], false],
    [3, ["b", "b"], false],
    [3, [bot], false],
    [3, ["stranger"], false],
    [3, ["b"], true],
    [3, "b", false],
    "held",
  ])
    assert.equal(doctored(bad), undefined, JSON.stringify(bad));
  // Only a running song is held.
  const lobby = seated();
  const copy = structuredClone(game.checkpoint.encode(lobby));
  copy[11] = [0, [], false];
  assert.equal(game.checkpoint.decode(copy, lobby.tick), undefined);
  assert.equal(game.isEntry([1, 1, READY, 1]), true);
  assert.equal(game.isEntry([1, 1, READY, -1]), false);
  assert.equal(game.isEntry([1, 1, READY, 1, 2]), false);
});
