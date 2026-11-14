import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, SETTINGS as SETTINGS_ENTRY } from "fuse-netcode";
import { FULL_RATING } from "../src/engine/index.js";
import {
  PLAY,
  SESSION_SCORES,
  seedOf,
  standings,
  type Room,
  type Settings,
} from "../src/online/game.js";
import {
  SETTINGS,
  fold,
  game,
  library,
  run,
  runTo,
  seated,
} from "./fixtures/room.js";

/** Three songs, the host picking each. */
const THREE: Settings = { ...SETTINGS, songs: 3 };
const DRAWN: Settings = { ...THREE, random: true };
const act = (room: Room, action: string, id: string) =>
  fold(room, { a: [[ACTION, action, id]] });
/** Runs the song out with nobody playing. */
const finish = (room: Room) => {
  while (room.stage === "running") fold(room);
};
/** Ada hits every step of the song dead on; Bo plays nothing. */
function ace(room: Room): void {
  const chart = room.roster.find((entrant) => entrant.id === "a")!.chart;
  for (const note of library.steps(room.play.song, chart)!.notes) {
    runTo(room, note.ms);
    fold(room, {
      a: [
        [PLAY, room.epoch, note.column, note.ms],
        [PLAY, room.epoch, note.column + 4, note.ms + 40],
      ],
    });
  }
  finish(room);
}
/** The room's session, read afresh: an assertion on `room.session` narrows it for the lines after. */
const sessionOf = (room: Room) => room.session!;
const points = (room: Room) =>
  Object.fromEntries(
    sessionOf(room).scores.map((score) => [score.id, score.points]),
  );

test("a session adds its songs up: the host picks each one, and the last ends it", () => {
  const room = seated(THREE);
  assert.equal(room.session, null);
  act(room, "start", "m1");
  assert.deepEqual(room.session, {
    length: 3,
    done: 0,
    songs: ["grid"],
    scores: [],
  });
  ace(room);
  assert.equal(room.stage, "over");
  assert.deepEqual(sessionOf(room).scores, [
    { id: "a", name: "Ada", points: FULL_RATING, wins: 1 },
    { id: "b", name: "Bo", points: 0, wins: 0 },
  ]);
  assert.equal(sessionOf(room).done, 1);

  // Back to the song select between two songs: the session waits there.
  act(room, "lobby", "m2");
  assert.equal(room.stage, "lobby");
  assert.equal(sessionOf(room).done, 1);
  assert.deepEqual(sessionOf(room).songs, ["grid"]);
  fold(room, { a: [[SETTINGS_ENTRY, { ...THREE, song: "other" }]] });
  act(room, "start", "m3");
  assert.deepEqual(sessionOf(room).songs, ["grid", "other"]);
  ace(room);
  assert.deepEqual(points(room), { a: 2 * FULL_RATING, b: 0 });
  assert.equal(sessionOf(room).scores[0]!.wins, 2);

  // The third song straight from the result.
  act(room, "rematch", "m4");
  assert.deepEqual(sessionOf(room).songs, ["grid", "other", "other"]);
  finish(room);
  const view = game.view(room).session!;
  assert.deepEqual([view.length, view.done], [3, 3]);
  assert.deepEqual(
    view.standings.map((score) => [score.name, score.points, score.wins]),
    [
      ["Ada", 2 * FULL_RATING, 3],
      ["Bo", 0, 0],
    ],
  );

  // After the last song, another go is a new session, and the song select ends the old one.
  const again = structuredClone(room);
  act(again, "rematch", "m5");
  assert.deepEqual(again.session, {
    length: 3,
    done: 0,
    songs: ["other"],
    scores: [],
  });
  act(room, "lobby", "m5");
  assert.equal(room.session, null);
  assert.equal(game.view(room).session, null);
});

test("a random session draws every song from the match's id, the same on every device, without repeats", () => {
  const ids = ["m1", "m2", "m3"];
  const play = () => {
    const room = seated(DRAWN);
    act(room, "start", ids[0]!);
    finish(room);
    act(room, "rematch", ids[1]!);
    finish(room);
    act(room, "rematch", ids[2]!);
    return room;
  };
  const room = play();
  const [first, second, third] = sessionOf(room).songs;
  assert.equal(first, library.songs[seedOf("m1") % 2]!.id);
  // Two songs in the library: the second is the one not played yet, the third any but the one just played.
  assert.notEqual(second, first);
  assert.notEqual(third, second);
  assert.equal(room.world!.song, third);
  assert.equal(room.play.song, third);
  // The lobby's song follows the draw, so the song select shows what was played.
  assert.equal(room.settings.song, third);
  assert.equal(game.hash(play()), game.hash(room));
  // Another id can draw another song.
  const drawn = new Set(
    ["x1", "x2", "x3", "x4", "x5", "x6"].map((id) => {
      const other = seated(DRAWN);
      act(other, "start", id);
      return other.world!.song;
    }),
  );
  assert.deepEqual([...drawn].sort(), ["grid", "other"]);
});

test("a song that is given up is not one of the session's", () => {
  const room = seated(THREE);
  act(room, "start", "m1");
  run(room, 40);
  act(room, "lobby", "m2");
  assert.deepEqual(room.session, {
    length: 3,
    done: 0,
    songs: [],
    scores: [],
  });
  act(room, "start", "m3");
  assert.deepEqual(sessionOf(room).songs, ["grid"]);
  finish(room);
  assert.equal(sessionOf(room).done, 1);
  // Given up after one finished song: that one stays.
  act(room, "rematch", "m4");
  run(room, 40);
  act(room, "lobby", "m5");
  assert.deepEqual(
    [sessionOf(room).done, sessionOf(room).songs],
    [1, ["grid"]],
  );
});

test("another length starts a new session, and one song a session plays none", () => {
  const room = seated(THREE);
  act(room, "start", "m1");
  finish(room);
  act(room, "lobby", "m2");
  fold(room, { a: [[SETTINGS_ENTRY, { ...THREE, songs: 5 }]] });
  act(room, "start", "m3");
  assert.deepEqual(
    [sessionOf(room).length, sessionOf(room).done, sessionOf(room).scores],
    [5, 0, []],
  );
  finish(room);
  act(room, "lobby", "m4");
  fold(room, { a: [[SETTINGS_ENTRY, SETTINGS]] });
  // The session waits in the lobby until a song starts without one.
  assert.equal(sessionOf(room).done, 1);
  act(room, "start", "m5");
  assert.equal(room.session, null);
  finish(room);
  assert.equal(room.session, null);
  // Whether the host picks or the room draws can change in the middle.
  const mixed = seated(THREE);
  act(mixed, "start", "m1");
  finish(mixed);
  act(mixed, "lobby", "m2");
  fold(mixed, { a: [[SETTINGS_ENTRY, DRAWN]] });
  act(mixed, "start", "m3");
  assert.deepEqual(sessionOf(mixed).songs, ["grid", "other"]);
  assert.equal(sessionOf(mixed).done, 1);
});

test("a rider who joins in the middle gets a total, one who left keeps theirs, and a full list drops the least", () => {
  const room = seated(THREE);
  act(room, "start", "m1");
  ace(room);
  act(room, "lobby", "m2");
  fold(room, { a: [[BOT, "add", "bot:1", "Robo", 2]] });
  act(room, "start", "m3");
  finish(room);
  const totals = points(room);
  assert.equal(totals.a, FULL_RATING);
  assert.ok(totals["bot:1"]! > 500_000);
  assert.deepEqual(
    game.view(room).session!.standings.map((score) => score.id),
    ["a", "bot:1", "b"],
  );
  act(room, "lobby", "m4");
  fold(room, { a: [[BOT, "remove", "bot:1"]] });
  act(room, "start", "m5");
  finish(room);
  assert.equal(points(room)["bot:1"], totals["bot:1"]);

  // Sixteen riders who came and went, then a song with two new ones: the two with the least make room.
  const full = seated(THREE);
  act(full, "start", "m1");
  sessionOf(full).done = 1;
  sessionOf(full).songs = ["grid", "grid"];
  sessionOf(full).scores = Array.from(
    { length: SESSION_SCORES },
    (_, index) => ({
      id: `gone${index}`,
      name: `Gone ${index}`,
      points: 1000 + index,
      wins: 0,
    }),
  );
  finish(full);
  const ids = sessionOf(full).scores.map((score) => score.id);
  assert.equal(ids.length, SESSION_SCORES);
  assert.deepEqual(ids.slice(-2), ["a", "b"]);
  assert.ok(!ids.includes("gone0") && !ids.includes("gone1"));
  assert.ok(ids.includes("gone2"));
});

test("standings go by points, then by songs won, then by who joined first", () => {
  const score = (id: string, total: number, wins: number) => ({
    id,
    name: id,
    points: total,
    wins,
  });
  assert.deepEqual(
    standings([
      score("a", 10, 0),
      score("b", 30, 1),
      score("c", 30, 2),
      score("d", 10, 0),
    ]).map((each) => each.id),
    ["c", "b", "a", "d"],
  );
});

test("a checkpoint carries the session, and a doctored one is refused", () => {
  const room = seated(THREE);
  act(room, "start", "m1");
  ace(room);
  act(room, "rematch", "m2");
  run(room, 60);
  const stages: Room[] = [structuredClone(room)];
  ace(room);
  stages.push(structuredClone(room));
  act(room, "lobby", "m3");
  stages.push(structuredClone(room));
  for (const each of stages) {
    const fields = structuredClone(game.checkpoint.encode(each));
    const restored = game.checkpoint.decode(fields, each.tick)!;
    assert.ok(restored, each.stage);
    assert.equal(game.hash(restored), game.hash(each));
    assert.deepEqual(game.view(restored), game.view(each));
  }
  const [running, over, lobby] = stages as [Room, Room, Room];
  type Raw = [number, number, string[], [string, string, number, number][]];
  const doctored = (
    from: Room,
    change: (session: Raw, all: unknown[]) => void,
  ) => {
    const copy = structuredClone(game.checkpoint.encode(from));
    change(copy[10] as Raw, copy);
    return game.checkpoint.decode(copy, from.tick);
  };
  const refused: [string, Room, (session: Raw, all: unknown[]) => void][] = [
    ["a length no session has", running, (s) => (s[0] = 4)],
    ["a single song is no session", running, (s) => (s[0] = 1)],
    ["more done than the session has", running, (s) => (s[1] = 4)],
    ["a song the library lacks", running, (s) => (s[2][0] = "nope")],
    ["the song being played is the last", running, (s) => (s[2][1] = "other")],
    ["a running song is not done yet", running, (s) => s[2].pop()],
    ["a total past what the songs give", running, (s) => (s[3][0]![2] = 9e6)],
    ["more wins than songs", running, (s) => (s[3][1]![3] = 1)],
    ["a rider twice", running, (s) => s[3].push([...s[3][0]!])],
    ["a name that is none", running, (s) => (s[3][0]![1] = "")],
    ["a match of a session has one", running, (_s, all) => (all[10] = null)],
    ["a decided song is counted", over, (s) => (s[1] = 1)],
    ["a decided song is in the totals", over, (s) => s[3].pop()],
    ["less than the song gave", over, (s) => (s[3][0]![2] = 5)],
    ["a lobby is between two songs", lobby, (s) => s[2].push("grid")],
    ["a finished session leaves the lobby", lobby, (s) => (s[1] = 3)],
    ["not a session", lobby, (_s, all) => (all[10] = [3, 0])],
  ];
  for (const [why, from, change] of refused)
    assert.equal(doctored(from, change), undefined, why);
  // A single song with a session around it is refused as well.
  const single = seated();
  act(single, "start", "m1");
  assert.equal(
    doctored(single, (_s, all) => (all[10] = [3, 0, ["grid"], []])),
    undefined,
  );
  assert.ok(doctored(lobby, () => undefined));
});

test("the session's settings are checked: 1, 3, 5 or 10 songs, and who chooses them", () => {
  const parse = game.seating.parseSettings;
  for (const songs of [1, 3, 5, 10])
    assert.deepEqual(parse({ ...DRAWN, songs }), { ...DRAWN, songs });
  for (const bad of [
    { ...SETTINGS, songs: 0 },
    { ...SETTINGS, songs: 4 },
    { ...SETTINGS, songs: "3" },
    { ...SETTINGS, random: "yes" },
    { display: false, song: "grid", mode: 0, chart: 0, songs: 3 },
  ])
    assert.equal(parse(bad), undefined, JSON.stringify(bad));
});

test("a start with nobody seated leaves a session that has not begun, and a checkpoint keeps it", () => {
  const room = game.createRoom("m0", THREE);
  act(room, "start", "m1");
  assert.equal(room.stage, "lobby");
  assert.deepEqual(room.session, {
    length: 3,
    done: 0,
    songs: [],
    scores: [],
  });
  const restored = game.checkpoint.decode(
    structuredClone(game.checkpoint.encode(room)),
    room.tick,
  )!;
  assert.equal(game.hash(restored), game.hash(room));
});

test("settings changed while a song plays wait for the next one, and a checkpoint keeps both", () => {
  const room = seated(THREE);
  act(room, "start", "m1");
  fold(room, {
    a: [[SETTINGS_ENTRY, { ...SETTINGS, songs: 5, random: true }]],
  });
  run(room, 20);
  const stages = [structuredClone(room)];
  finish(room);
  stages.push(structuredClone(room));
  for (const each of stages) {
    assert.deepEqual([each.play.songs, each.settings.songs], [3, 5]);
    assert.equal(sessionOf(each).length, 3);
    const restored = game.checkpoint.decode(
      structuredClone(game.checkpoint.encode(each)),
      each.tick,
    )!;
    assert.ok(restored, each.stage);
    assert.equal(game.hash(restored), game.hash(each));
  }
  // The next song is the first of five, drawn by the room.
  act(room, "rematch", "m2");
  assert.deepEqual(
    [sessionOf(room).length, sessionOf(room).done, sessionOf(room).scores],
    [5, 0, []],
  );
});

test("a new AI rival never takes the id of one the session remembers", () => {
  const room = seated(THREE);
  fold(room, { a: [[BOT, "add", "bot:1", "Robo", 2]] });
  act(room, "start", "m1");
  finish(room);
  act(room, "lobby", "m2");
  fold(room, { a: [[BOT, "remove", "bot:1"]] });
  assert.ok(!room.seats.has("bot:1"));
  // Its total stays in the session, so the next rival is another one.
  assert.equal(game.seating.botId!(room, new Set()), "bot:2");
  act(room, "start", "m3");
  finish(room);
  act(room, "rematch", "m4");
  finish(room);
  act(room, "lobby", "m5");
  assert.equal(game.seating.botId!(room, new Set()), "bot:1");
});
