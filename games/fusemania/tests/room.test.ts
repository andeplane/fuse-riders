import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, SETTINGS as SETTINGS_ENTRY } from "fuse-netcode";
import {
  BATTLE_MODE,
  FULL_RATING,
  GREAT,
  LEAD_IN_MS,
  MARVELOUS,
  MISS,
  PERFECT,
} from "../src/engine/index.js";
import { PICK, PLAY } from "../src/online/game.js";
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
  fold(room, { a: [[ACTION, "start", "m1"]] });
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
    { display: false, song: "grid", mode: 0 },
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
