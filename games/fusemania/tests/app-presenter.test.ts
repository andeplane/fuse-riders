import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, SETTINGS as SETTINGS_ENTRY } from "fuse-netcode";
import { BATTLE_MODE, FULL_RATING, MINED } from "../src/engine/index.js";
import { cuesBetween } from "../src/app/audio.js";
import {
  bestText,
  grade,
  ordinal,
  percent,
  present,
  scoreText,
  type Viewer,
} from "../src/app/presenter.js";
import { PICK, PLAY } from "../src/online/game.js";
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

const viewer = (me: string, extra: Partial<Viewer> = {}): Viewer => ({
  me,
  host: me === "a",
  solo: false,
  display: false,
  ...extra,
});

test("a rating reads as a grade, a percentage and a score", () => {
  assert.equal(grade(FULL_RATING), "AAAA");
  assert.equal(grade(970_000), "AAA");
  assert.equal(grade(930_000), "AA");
  assert.equal(grade(929_999), "A");
  assert.equal(grade(750_000), "B");
  assert.equal(grade(600_000), "C");
  assert.equal(grade(0), "D");
  assert.equal(percent(942_199), "94.2%");
  assert.equal(percent(FULL_RATING), "100.0%");
  assert.equal(scoreText(1_000_000), "1,000,000");
  assert.equal(scoreText(942), "942");
  assert.equal(bestText(942_199), "AA 94.2%");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal), [
    "1ST",
    "2ND",
    "3RD",
    "4TH",
    "11TH",
    "12TH",
    "13TH",
    "21ST",
  ]);
});

test("the lobby lists each seat with the chart it will play, and only the host starts and seats AI", () => {
  const room = seated();
  fold(room, { b: [[PICK, 1]], a: [[BOT, "add", "bot:1", 2]] });
  const host = present(library, game.view(room), viewer("a"));
  assert.equal(host.screen, "lobby");
  assert.deepEqual(
    host.lobby.members.map((member) => [
      member.name,
      member.chart,
      member.you,
      member.bot,
    ]),
    [
      ["Ada", "EASY 3", true, false],
      ["Bo", "HARD 9", false, false],
      [host.lobby.members[2]!.name, "EASY 3", false, true],
    ],
  );
  assert.equal(host.lobby.showStart, true);
  assert.equal(host.lobby.canAddBot, true);
  assert.deepEqual(host.lobby.removable, ["bot:1"]);
  assert.equal(host.chart, 0);
  const guest = present(library, game.view(room), viewer("b"));
  assert.equal(guest.lobby.showStart, false);
  assert.equal(guest.lobby.canAddBot, false);
  assert.deepEqual(guest.lobby.removable, []);
  assert.equal(guest.lobby.note, "Waiting for the host to start");
  assert.equal(guest.chart, 1);
  // A device without a seat is asked for a name; the shared screen never is.
  const stranger = present(library, game.view(room), viewer("z"));
  assert.equal(stranger.askName, true);
  assert.equal(
    present(library, game.view(room), viewer("tv", { display: true })).askName,
    false,
  );
});

test("a battle alone asks for a rival", () => {
  const room = game.createRoom("m0", { ...SETTINGS, mode: BATTLE_MODE });
  fold(room, { a: [[10, "a", "Ada", 0, "robot", 1]] });
  const model = present(library, game.view(room), viewer("a"));
  assert.match(model.lobby.note, /rival/);
});

test("during a song a player gets the field, a phone on a shared screen the pads, and a newcomer a note", () => {
  const room = started();
  const playing = present(library, game.view(room), viewer("b"));
  assert.equal(playing.screen, "play");
  assert.equal(playing.playing, true);
  assert.equal(playing.localSlot, 1);
  assert.equal(playing.status, "GET READY");
  assert.deepEqual(playing.names, ["Ada", "Bo"]);
  assert.deepEqual(playing.chartNames, ["EASY 3", "EASY 3"]);
  assert.equal(playing.title, "GRID");
  const watcher = present(library, game.view(room), viewer("z"));
  assert.equal(watcher.playing, false);
  assert.equal(watcher.note, "Pick a name to play in the next song");
  runTo(room, beatMs(4));
  fold(room, { b: [[PLAY, 1, 0, beatMs(4)]] });
  run(room, 4);
  assert.match(
    present(library, game.view(room), viewer("b")).status,
    /^[\d,]+ · 1ST$/,
  );

  const shared = started({ ...SETTINGS, display: true });
  assert.equal(
    present(library, game.view(shared), viewer("b")).screen,
    "controller",
  );
  assert.equal(
    present(library, game.view(shared), viewer("tv", { display: true })).screen,
    "play",
  );
});

test("the result ranks the players, says who won and what this device's best was", () => {
  const room = started();
  for (const note of library.steps("grid", 0)!.notes) {
    runTo(room, note.ms);
    fold(room, {
      a: [
        [PLAY, 1, note.column, note.ms + 30],
        [PLAY, 1, note.column + 4, note.ms + 70],
      ],
    });
  }
  run(room, 400);
  const view = game.view(room);
  assert.equal(view.stage, "over");
  const winner = present(library, view, viewer("a"), 500_000);
  assert.equal(winner.result!.title, "YOU WIN!");
  assert.deepEqual(
    winner.result!.rows.map((row) => [row.place, row.name, row.you]),
    [
      [1, "Ada", true],
      [2, "Bo", false],
    ],
  );
  assert.equal(winner.result!.rows[0]!.detail, "EASY 3 · 90.0%");
  assert.equal(winner.result!.rows[0]!.combo, "MAX COMBO 64");
  assert.deepEqual(winner.result!.counts[1], ["PERFECT", "64"]);
  assert.deepEqual(winner.result!.lines, ["NEW BEST! (WAS 50.0%)"]);
  assert.equal(winner.result!.host, true);
  const loser = present(library, view, viewer("b"), 990_000);
  assert.equal(loser.result!.title, "ADA WINS");
  assert.deepEqual(loser.result!.lines, ["BEST AAA 99.0%"]);
  assert.equal(
    loser.result!.waiting,
    "Waiting for the host to pick the next song",
  );
  assert.deepEqual(present(library, view, viewer("b")).result!.lines, [
    "FIRST SCORE ON THIS CHART",
  ]);
  assert.equal(present(library, view, viewer("b")).status, "2ND PLACE");
  // Back in the lobby there is no result.
  fold(room, { a: [[ACTION, "lobby", "m2"]] });
  assert.equal(present(library, game.view(room), viewer("a")).result, null);
});

test("sounds follow what a player's picture shows: an item taken, thrown, landing, blocked, a mine", () => {
  const room = started();
  run(room, 2);
  const base = game.view(room).world!.players[0]!;
  assert.deepEqual(cuesBetween(undefined, base), []);
  assert.deepEqual(cuesBetween(base, base), []);
  assert.deepEqual(cuesBetween(base, { ...base, item: 3 }), ["pickup"]);
  assert.deepEqual(cuesBetween({ ...base, item: 3 }, base), ["throw"]);
  assert.deepEqual(
    cuesBetween(base, { ...base, effects: [[2, 1000, 9000, 1]] }),
    ["struck"],
  );
  assert.deepEqual(
    cuesBetween(base, { ...base, effects: [[11, 1000, 9000, 0]] }),
    ["boost"],
  );
  assert.deepEqual(cuesBetween(base, { ...base, blocked: 1 }), ["blocked"]);
  const counts = [...base.counts];
  counts[MINED] = 1;
  assert.deepEqual(cuesBetween(base, { ...base, counts }), ["mine"]);
  // Another player's picture is not this one's history.
  assert.deepEqual(
    cuesBetween(game.view(room).world!.players[1]!, { ...base, item: 3 }),
    [],
  );
});

// ---- sessions ----

const THREE = { ...SETTINGS, songs: 3 };
const finishSong = (room: ReturnType<typeof seated>) => {
  while (room.stage === "running") fold(room);
};
const buttons = (model: ReturnType<typeof present>) => [
  model.result!.primary.text,
  model.result!.primary.action,
  model.result!.secondary?.text ?? "",
];

test("a single song offers another go or the song select, with no session anywhere", () => {
  const room = started();
  assert.equal(present(library, game.view(room), viewer("a")).title, "GRID");
  finishSong(room);
  const model = present(library, game.view(room), viewer("a"));
  assert.deepEqual(buttons(model), ["PLAY AGAIN", "rematch", "SONG SELECT"]);
  assert.equal(model.result!.session, null);
  assert.equal(model.result!.final, false);
  assert.deepEqual(model.totals, []);
  const lobby = present(library, game.view(seated()), viewer("a")).lobby;
  assert.equal(lobby.startText, "START");
  assert.equal(lobby.session, null);
});

test("a session counts its songs on the start button, the title and the result, and shows the totals", () => {
  const room = seated(THREE);
  assert.equal(
    present(library, game.view(room), viewer("a")).lobby.startText,
    "START SONG 1 OF 3",
  );
  fold(room, { a: [[ACTION, "start", "m1"]] });
  let model = present(library, game.view(room), viewer("a"));
  assert.equal(model.title, "SONG 1 OF 3 · GRID");
  assert.deepEqual(model.totals, [0, 0]);
  // Ada hits one step, then the song runs out.
  runTo(room, beatMs(4));
  fold(room, { a: [[PLAY, 1, 0, beatMs(4)]] });
  finishSong(room);
  const view = game.view(room);
  const rating = view.world!.players[0]!.rating;
  assert.ok(rating > 0);
  model = present(library, view, viewer("a"));
  assert.equal(model.title, "SONG 1 OF 3 · GRID");
  assert.equal(model.result!.title, "YOU WIN!");
  // The box adds the song's score to the total before it, so the song is not counted twice once it is decided.
  assert.deepEqual(model.totals, [0, 0]);
  assert.deepEqual(model.result!.session, {
    title: "SESSION · AFTER SONG 1 OF 3",
    rows: [
      {
        place: 1,
        name: "Ada",
        you: true,
        slot: 0,
        points: scoreText(rating),
        wins: "1 WIN",
      },
      { place: 2, name: "Bo", you: false, slot: 1, points: "0", wins: "" },
    ],
  });
  // The host picks the next song in the song select; a guest waits for that.
  assert.deepEqual(buttons(model), ["PICK NEXT SONG", "lobby", ""]);
  const guest = present(library, view, viewer("b"));
  assert.equal(
    guest.result!.waiting,
    "Waiting for the host to pick the next song",
  );
  assert.equal(guest.result!.session!.rows[1]!.you, true);

  // In the lobby between two songs: the standings so far and the next song's number.
  fold(room, { a: [[ACTION, "lobby", "m2"]] });
  const between = present(library, game.view(room), viewer("a")).lobby;
  assert.equal(between.startText, "START SONG 2 OF 3");
  assert.equal(between.session!.title, "SESSION · 1 OF 3 PLAYED");
  assert.deepEqual(
    between.session!.rows.map((row) => row.name),
    ["Ada", "Bo"],
  );
  // Another length is another session: the old standings are not the next song's.
  fold(room, { a: [[SETTINGS_ENTRY, { ...THREE, songs: 5 }]] });
  const changed = present(library, game.view(room), viewer("a")).lobby;
  assert.equal(changed.startText, "START SONG 1 OF 5");
  assert.equal(changed.session, null);
  assert.equal(
    changed.note,
    "Another number of songs starts a new session: pick 3 again to go on with this one.",
  );
  assert.equal(
    present(library, game.view(room), viewer("b")).lobby.note,
    "Waiting for the host to start",
  );
  fold(room, { a: [[SETTINGS_ENTRY, THREE]] });

  fold(room, { a: [[ACTION, "start", "m3"]] });
  model = present(library, game.view(room), viewer("a"));
  assert.equal(model.title, "SONG 2 OF 3 · GRID");
  assert.deepEqual(model.totals, [rating, 0]);
  finishSong(room);
  assert.deepEqual(present(library, game.view(room), viewer("a")).totals, [
    rating,
    0,
  ]);

  // The last song ends the session: its winner leads the card, and the next thing is a new session.
  fold(room, { a: [[ACTION, "rematch", "m4"]] });
  finishSong(room);
  const last = game.view(room);
  model = present(library, last, viewer("a"));
  assert.equal(model.result!.title, "YOU WIN THE SESSION!");
  assert.equal(model.result!.final, true);
  assert.equal(model.result!.session!.title, "FINAL STANDINGS");
  assert.equal(model.result!.session!.rows[0]!.wins, "3 WINS");
  assert.deepEqual(buttons(model), ["NEW SESSION", "lobby", ""]);
  const loser = present(library, last, viewer("b"));
  assert.equal(loser.result!.title, "ADA WINS THE SESSION");
  assert.equal(
    loser.result!.waiting,
    "Waiting for the host to start a new session",
  );
});

test("a random session's next song is one button away, and a rider who left keeps a row", () => {
  const room = seated({ ...THREE, random: true });
  fold(room, { a: [[BOT, "add", "bot:1", "Robo", 2]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  finishSong(room);
  let view = game.view(room);
  let model = present(library, view, viewer("a"));
  assert.deepEqual(buttons(model), ["NEXT SONG", "rematch", "SONG SELECT"]);
  assert.equal(
    present(library, view, viewer("b")).result!.waiting,
    "Waiting for the host to start the next song",
  );
  fold(room, { a: [[ACTION, "lobby", "m2"]] });
  fold(room, { a: [[BOT, "remove", "bot:1"]] });
  const rows = present(library, game.view(room), viewer("a")).lobby.session!
    .rows;
  // The AI won the song and left: its row stays, without a seat's colour.
  assert.deepEqual(
    rows.map((row) => [row.place, row.slot, row.wins]),
    [
      [1, -1, "1 WIN"],
      [2, 0, ""],
      [3, 1, ""],
    ],
  );
  fold(room, { a: [[ACTION, "start", "m3"]] });
  finishSong(room);
  fold(room, { a: [[ACTION, "rematch", "m4"]] });
  finishSong(room);
  view = game.view(room);
  model = present(library, view, viewer("a"));
  assert.deepEqual(buttons(model), ["NEW SESSION", "rematch", "SONG SELECT"]);
});
