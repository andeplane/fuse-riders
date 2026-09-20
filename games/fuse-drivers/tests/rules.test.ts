import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTION, BOT, JOIN, LEAVE, PRESENCE, SETTINGS } from "fuse-netcode";
import {
  CAPACITY,
  DEFAULT_SETTINGS,
  createRoom,
  fuseDriversGame,
  fuseDriversView,
  isFuseDriversEntry,
  parseSettings,
  players,
  seatName,
  trackNames,
} from "../src/game/index.js";
import { addBot, drive, fold, runTo, started } from "./fixtures/fuseDrivers.js";
import { defined } from "./fixtures/defined.js";

test("a name is trimmed and bounded, and an empty one is refused", () => {
  assert.equal(seatName("  Ada  "), "Ada");
  assert.equal(seatName("x".repeat(40)), "x".repeat(18));
  assert.equal(seatName("   "), undefined);
  assert.equal(seatName(""), undefined);
});

test("settings name a committed track and nothing else", () => {
  const track = defined(trackNames()[0]);
  assert.deepEqual(parseSettings({ track, display: false }), {
    track,
    display: false,
  });
  assert.equal(parseSettings({ track: "nowhere", display: false }), undefined);
  assert.equal(parseSettings({ track }), undefined, "display is required");
  assert.equal(
    parseSettings({ track, display: false, extra: 1 }),
    undefined,
    "an unknown key",
  );
  assert.equal(parseSettings(null), undefined);
});

test("starting the race grids the seated drivers in slot order", () => {
  const room = started();
  assert.equal(room.stage, "running");
  assert.deepEqual(room.grid, ["a", "b"]);
  const race = defined(room.race, "race");
  assert.equal(race.trucks.length, 2);
  assert.equal(
    race.trackName,
    room.settings.track,
    "the race runs the chosen map",
  );
});

test("the same match id grids the same race on every peer", () => {
  const one = started(),
    two = started();
  assert.equal(
    JSON.stringify(defined(one.race, "race")),
    JSON.stringify(defined(two.race, "race")),
  );
});

test("a driver's controls hold until they log a change", () => {
  const room = started();
  fold(room, { a: [drive({ right: true })] });
  const held = room.controls.a;
  runTo(room, room.tick + 10);
  assert.equal(room.controls.a, held, "silence is not a release");
  fold(room, { a: [drive({})] });
  assert.equal(room.controls.a, 0);
});

test("a race that finishes ends the match, and only then may it be replayed", () => {
  const room = started();
  const race = defined(room.race, "race");
  // Put every truck over the line: the fold ends the match on the race's own finished phase.
  room.race = {
    ...race,
    phase: "finished",
    trucks: race.trucks.map((truck) => ({ ...truck, finishedTick: race.tick })),
  };
  fold(room);
  assert.equal(room.stage, "over");
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.matchId, "m2");
  assert.equal(
    defined(room.race, "race").tick,
    1,
    "a fresh race, not the old one",
  );
});

test("a bot takes a grid slot and drives without logging anything", () => {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [[JOIN, "a", "Ada", 0, "fox", 1], addBot("bot:1", 1)],
  });
  fold(room, { a: [[PRESENCE, "a", true, 1]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  assert.deepEqual(room.grid, ["a", "bot:1"]);
  assert.ok(room.bots["bot:1"], "the bot has memory in the room");
  const before = JSON.stringify(defined(room.race, "race").trucks[1]);
  runTo(room, room.tick + 60);
  assert.notEqual(
    JSON.stringify(defined(room.race, "race").trucks[1]),
    before,
    "the bot drove",
  );
});

test("the view carries the grid, the drivers and the race", () => {
  const room = started();
  runTo(room, room.tick + 20);
  const view = fuseDriversView(room);
  assert.equal(view.tick, room.tick);
  assert.equal(view.phase, "running");
  assert.equal(view.track, room.settings.track);
  assert.deepEqual(
    view.drivers.map((driver) => driver.truck),
    [0, 1],
  );
  assert.equal(
    defined(view.race, "race").tick,
    defined(room.race, "race").tick,
  );
});

test("a seat that leaves in the lobby frees its slot for the next driver", () => {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "fox", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
    ],
  });
  assert.equal(players(room).length, 2);
  fold(room, { a: [[LEAVE, "b"]] });
  assert.equal(players(room).length, 1);
  fold(room, { a: [[JOIN, "c", "Cy", 1, "owl", 1]] });
  assert.deepEqual(
    players(room).map((seat) => seat.id),
    ["a", "c"],
  );
});

test("a join beyond the grid is refused at the entry boundary", () => {
  const ok = [1, 1, JOIN, "p", "P", CAPACITY - 1, "fox", 1];
  const beyond = [1, 1, JOIN, "p", "P", CAPACITY, "fox", 1];
  assert.ok(isFuseDriversEntry(ok));
  assert.ok(
    !isFuseDriversEntry(beyond),
    "a slot past the last one on the grid",
  );
});

test("settings change the track for the next race, not the running one", () => {
  const names = trackNames();
  const other = defined(names[1] ?? names[0]);
  const room = started();
  const running = defined(room.race, "race").trackName;
  fold(room, { a: [[SETTINGS, { track: other, display: false }]] });
  assert.equal(
    defined(room.race, "race").trackName,
    running,
    "the race in progress keeps its map",
  );
  assert.equal(room.settings.track, other);
});

test("the game reports the step cadence the fold will run", () => {
  const room = started();
  const before = room.tick;
  const promised = fuseDriversGame.steps(room);
  const raceBefore = defined(room.race, "race").tick;
  fold(room);
  assert.equal(room.tick, before + 1);
  assert.equal(defined(room.race, "race").tick, raceBefore + promised);
  assert.ok(promised >= 1 && promised <= fuseDriversGame.maxSteps);
});
