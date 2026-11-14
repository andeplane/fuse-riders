import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, PRESENCE, SPECTATOR, type Frame } from "fuse-netcode";
import { MAPS } from "../src/engine/index.js";
import {
  COUNTDOWN_TICKS,
  DEFAULT_SETTINGS,
  FIRST_COUNTDOWN_TICKS,
  countdownTicks,
  SEAT,
  createRoom,
  view,
  type Room,
  type View,
} from "../src/online/index.js";
import {
  present,
  roleOf,
  seatTitle,
  settingsSummary,
  type SeatModel,
  type Viewer,
} from "../src/app/presenter.js";
import {
  decide,
  finish,
  fold,
  join,
  lobby,
  run,
  started,
  toPlay,
} from "./fixtures/room.js";

const viewer = (patch: Partial<Viewer> = {}): Viewer => ({
  me: "a",
  solo: false,
  display: false,
  ...patch,
});
const frame = (room: Room, managerId = "a"): Frame<View> => ({
  ...view(room),
  managerId,
});
const flat = (model: ReturnType<typeof present>): SeatModel[] =>
  model.lobby.teams
    .flatMap((team) => team.seats)
    .sort((a, b) => a.slot - b.slot);

test("seats in words", () => {
  assert.deepEqual([0, 1, 2, 5].map(roleOf), [
    "QUEEN",
    "QUEEN",
    "WORKER",
    "WORKER",
  ]);
  assert.equal(seatTitle(0), "Cyan Queen");
  assert.equal(seatTitle(1), "Pink Queen");
  assert.equal(seatTitle(4), "Cyan Worker");
  assert.equal(seatTitle(5), "Pink Worker");
  assert.equal(
    settingsSummary(DEFAULT_SETTINGS),
    "Medium bots · Maps rotate · First to 2",
  );
  assert.equal(
    settingsSummary({ ...DEFAULT_SETTINGS, botLevel: "hard", map: 2, wins: 3 }),
    `Hard bots · ${MAPS[2].name} · First to 3`,
  );
});

test("the lobby: two teams of three seats, bots in the empty ones, start and settings for the host", () => {
  const room = lobby();
  const host = present(frame(room), viewer());
  assert.equal(host.screen, "lobby");
  assert.equal(
    host.arena.countdown,
    undefined,
    "no countdown card in the lobby",
  );
  assert.equal(host.layout, "arena");
  assert.deepEqual(
    host.lobby.teams.map((team) => [
      team.name,
      team.key,
      team.seats.map((seat) => seat.slot),
    ]),
    [
      ["CYAN", "cyan", [0, 2, 4]],
      ["PINK", "pink", [1, 3, 5]],
    ],
  );
  const seats = flat(host);
  assert.deepEqual(
    seats.map((seat) => [seat.kind, seat.role, seat.action, seat.label]),
    [
      ["you", "QUEEN", "none", ""],
      ["player", "QUEEN", "ask", "ASK TO SWAP"],
      ["bot", "WORKER", "take", "SIT HERE"],
      ["bot", "WORKER", "take", "SIT HERE"],
      ["bot", "WORKER", "take", "SIT HERE"],
      ["bot", "WORKER", "take", "SIT HERE"],
    ],
  );
  assert.equal(seats[0]!.name, "Ada");
  assert.equal(seats[2]!.name, "Bolt (bot)");
  assert.equal(host.seated, true);
  assert.equal(host.host, true);
  assert.equal(host.askName, false);
  assert.equal(host.playing, false);
  assert.equal(host.result, undefined);
  assert.deepEqual(
    [host.lobby.showStart, host.lobby.canStart, host.lobby.note],
    [true, true, "Bots play every empty seat"],
  );
  assert.equal(host.lobby.settings.editable, true);
  assert.deepEqual([host.humans, host.bots], [2, 4]);

  const guest = present(frame(room), viewer({ me: "b" }));
  assert.equal(guest.host, false);
  assert.equal(guest.lobby.showStart, false);
  assert.equal(guest.lobby.note, "Waiting for the host to start");
  assert.equal(guest.lobby.settings.editable, false);
  assert.equal(
    guest.lobby.settings.summary,
    "Medium bots · Maps rotate · First to 2",
  );
  assert.equal(flat(guest)[1]!.kind, "you");

  const stranger = present(frame(room), viewer({ me: "z" }));
  assert.deepEqual(
    [stranger.seated, stranger.watching, stranger.askName, stranger.canJoin],
    [false, false, true, true],
  );
  assert.ok(
    flat(stranger).every((seat) => seat.action === "none" && !seat.label),
    "someone without a seat has none to move from",
  );
  assert.equal(
    present(frame(room), viewer({ me: "" })).askName,
    false,
    "not before the room admitted this device",
  );

  const tv = present(frame(room), viewer({ me: "tv", display: true }));
  assert.deepEqual([tv.seated, tv.askName, tv.host], [false, false, false]);
  assert.equal(tv.lobby.note, "Waiting for the host to start");
  assert.equal(tv.arena.localSlot, -1);
});

test("an empty room cannot start, and a full one offers no seat", () => {
  const empty = createRoom("m0", DEFAULT_SETTINGS);
  fold(empty);
  const host = present(frame(empty), viewer());
  assert.deepEqual(
    [host.lobby.showStart, host.lobby.canStart, host.lobby.note],
    [true, false, "Take a seat to start"],
  );
  assert.equal(
    present(frame(empty), viewer({ me: "b" })).lobby.note,
    "Waiting for players",
  );
  const full = lobby();
  fold(full, {
    a: [
      join("c", "Cy", 2),
      join("d", "Di", 3),
      join("e", "Ed", 4),
      join("f", "Flo", 5),
    ],
  });
  const model = present(frame(full), viewer({ me: "z" }));
  assert.equal(model.canJoin, false);
  assert.deepEqual([model.humans, model.bots], [6, 0]);
});

test("a swap: one asks, the other sees the wish and answers, and the asker can take it back", () => {
  const room = lobby();
  fold(room, { b: [[SEAT, 0]] });
  const ada = flat(present(frame(room), viewer()));
  assert.equal(ada[0]!.note, "Bo asks to swap");
  assert.deepEqual(
    [ada[1]!.action, ada[1]!.label, ada[1]!.note],
    ["accept", "SWAP", "Bo asks for your seat"],
  );
  const bo = flat(present(frame(room), viewer({ me: "b" })));
  assert.deepEqual(
    [bo[0]!.action, bo[0]!.label, bo[0]!.note],
    ["withdraw", "CANCEL", "You asked to swap"],
  );
  fold(room, { a: [[SEAT, 1]] });
  const after = flat(present(frame(room), viewer()));
  assert.deepEqual(
    [after[0]!.name, after[1]!.name, after[1]!.kind, after[0]!.action],
    ["Bo", "Ada", "you", "ask"],
  );
});

test("someone away keeps the seat's name, and watchers are listed", () => {
  const room = lobby();
  fold(room, {
    a: [
      [PRESENCE, "b", false, 1],
      [SPECTATOR, "join", "w", "Wim", 1],
    ],
  });
  const model = present(frame(room), viewer());
  assert.deepEqual(
    [flat(model)[1]!.kind, flat(model)[1]!.name, flat(model)[1]!.action],
    ["away", "Bo", "ask"],
  );
  assert.deepEqual(model.lobby.watchers, ["Wim"]);
  const wim = present(frame(room), viewer({ me: "w" }));
  assert.deepEqual(
    [wim.seated, wim.watching, wim.askName, wim.arena.localSlot],
    [false, true, false, -1],
  );
  const away = present(frame(room), viewer({ me: "b" }));
  assert.ok(
    flat(away).every((seat) => seat.action === "none"),
    "a disconnected player's taps would be refused",
  );
});

test("a game: the countdown, then the controls, then the pause banner and the result", () => {
  const room = started({ ...DEFAULT_SETTINGS, map: 1, wins: 2 });
  let model = present(frame(room), viewer());
  assert.equal(model.screen, "arena");
  assert.deepEqual(model.arena.names, ["Ada", "Bo", "", "", "", ""]);
  assert.equal(model.arena.localSlot, 0);
  assert.equal(model.arena.line, "CYAN 0 · 0 PINK · FIRST TO 2");
  assert.equal(
    model.arena.banner,
    undefined,
    "the card counts down, not a banner",
  );
  const countdown = model.arena.countdown!;
  assert.deepEqual([countdown.round, countdown.map], [1, MAPS[1].name]);
  assert.equal(
    countdown.elapsed + countdown.left,
    FIRST_COUNTDOWN_TICKS + 1,
    "8 s from the start command to the first step",
  );
  assert.ok(countdown.left > 140, "the countdown has just begun");
  const quick = present(
    frame(started({ ...DEFAULT_SETTINGS, map: 1, wins: 2, quick: true })),
    viewer(),
  ).arena.countdown!;
  assert.equal(
    quick.elapsed + quick.left,
    countdownTicks(1, true) + 1,
    "a tutorial room counts down one second",
  );
  assert.ok(countdownTicks(1, true) < FIRST_COUNTDOWN_TICKS);
  assert.equal(model.playing, false, "nothing to steer during the countdown");
  assert.equal(present(frame(room), viewer({ me: "b" })).arena.localSlot, 1);
  assert.ok(
    flat(model).every((seat) => seat.action === "none"),
    "seats are fixed once the set started",
  );

  toPlay(room);
  model = present(frame(room), viewer());
  assert.equal(model.playing, true, "held keys are logged for the first step");
  assert.equal(
    model.arena.countdown?.left,
    1,
    "the last tick of the countdown",
  );
  fold(room);
  model = present(frame(room), viewer());
  assert.equal(model.arena.banner, undefined);
  assert.equal(
    model.arena.countdown,
    undefined,
    "the card goes when play starts",
  );
  assert.equal(model.playing, true);
  assert.equal(present(frame(room), viewer({ me: "z" })).playing, false);
  assert.equal(
    present(frame(room), viewer({ me: "a", display: true })).playing,
    false,
  );

  decide(room, 1, "snail");
  fold(room);
  assert.equal(
    present(frame(room), viewer()).playing,
    false,
    "the game is decided: the victory screen plays",
  );
  run(room, 60);
  assert.equal(room.stage, "between");
  model = present(frame(room), viewer());
  assert.deepEqual(model.arena.banner, {
    title: "PINK TAKES GAME 1",
    detail: "SNAIL VICTORY · Next game in 5",
    team: 1,
  });
  assert.equal(model.arena.line, "CYAN 0 · 1 PINK · FIRST TO 2");
  assert.equal(
    model.arena.countdown,
    undefined,
    "the pause shows the result banner",
  );
  assert.equal(model.result, undefined);

  run(room, room.resumeAt - room.tick);
  assert.equal(room.stage, "running");
  assert.equal(room.round, 2);
  const next = present(frame(room), viewer()).arena.countdown!;
  assert.ok(next.elapsed <= 1, "the next game counts down from its start");
  assert.equal(next.elapsed + next.left, COUNTDOWN_TICKS + 1, "for 3 s");
  finish(room, 1, "economy");
  assert.equal(room.stage, "over");
  model = present(frame(room), viewer());
  assert.equal(model.screen, "arena");
  assert.equal(model.arena.banner, undefined);
  assert.equal(model.arena.countdown, undefined, "no card over the result");
  const result = model.result!;
  assert.equal(result.title, "YOUR TEAM LOST");
  assert.equal(result.team, 1);
  assert.equal(result.games.length, 2);
  assert.match(
    result.games[0]!,
    /^Game 1, .+: PINK rode the snail home in \d+ s$/,
  );
  assert.match(result.games[1]!, /PINK filled the hive with berries/);
  assert.deepEqual(result.players, [
    "Ada (Cyan Queen): 0 kills, 0 deaths, 0 berries",
    "Bo (Pink Queen): 0 kills, 0 deaths, 0 berries",
  ]);
  assert.deepEqual([result.host, result.waiting], [true, ""]);
  const bo = present(frame(room), viewer({ me: "b" })).result!;
  assert.equal(bo.title, "YOUR TEAM WINS!");
  assert.deepEqual(
    [bo.host, bo.waiting],
    [false, "Waiting for the host to start a rematch"],
  );
  assert.equal(
    present(frame(room), viewer({ me: "tv", display: true })).result!.title,
    "PINK WINS THE SET",
  );
  room.stats.a = { ...room.stats.a!, kills: 1, deaths: 1, berries: 1 };
  assert.equal(
    present(frame(room), viewer()).result!.players[0],
    "Ada (Cyan Queen): 1 kill, 1 death, 1 berry",
  );
  delete room.stats.b;
  assert.match(
    present(frame(room), viewer()).result!.players[1]!,
    /^Bo .*0 kills/,
  );

  fold(room, { a: [[ACTION, "lobby"]] });
  assert.equal(present(frame(room), viewer()).screen, "lobby");
});

test("a military win reads as one in the result", () => {
  const room = started({ ...DEFAULT_SETTINGS, wins: 1 });
  finish(room, 0);
  const result = present(frame(room), viewer()).result!;
  assert.equal(result.title, "YOUR TEAM WINS!");
  assert.match(
    result.games[0]!,
    /CYAN killed the enemy Queen three times in \d+ s$/,
  );
});

test("a shared-screen room: the TV shows the arena, a seated phone is a controller", () => {
  const room = started({ ...DEFAULT_SETTINGS, display: true });
  assert.equal(present(frame(room), viewer()).layout, "controller");
  assert.equal(
    present(frame(room), viewer({ me: "tv", display: true })).layout,
    "arena",
  );
  assert.equal(
    present(frame(room), viewer({ me: "z" })).layout,
    "arena",
    "a phone without a seat watches",
  );
});
