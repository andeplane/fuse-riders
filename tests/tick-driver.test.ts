import assert from "node:assert/strict";
import test from "node:test";
import {
  addPlayer,
  createGame,
  eliminatePlayer,
  setPlayerConnected,
  startMatch,
  type GameState,
} from "../src/engine/game.js";
import {
  defaultRoomSettings,
  type RoomSettings,
} from "../src/engine/room-settings.js";
import { driveGameTick, STEPS_PER_TICK } from "../src/engine/tick-driver.js";
import { readFileSync } from "node:fs";

function match(settings: RoomSettings, riders = 3): GameState {
  const game = createGame("driver", settings);
  for (let slot = 0; slot < riders; slot++)
    addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: "#fff" });
  startMatch(game);
  return game;
}
/** Ends the round in play and drives to the tick its pause runs out on, returning that tick's report. */
function driveThroughRoundOver(game: GameState, room: RoomSettings) {
  const riders = [...game.players.keys()];
  while (game.phase === "countdown") driveGameTick(game, new Map(), room);
  for (const id of riders.slice(1)) eliminatePlayer(game, id);
  let last = driveGameTick(game, new Map(), room);
  assert.equal(game.phase, "roundOver");
  const pauseEnds = game.phaseEndsAtTick!;
  while (game.tick < pauseEnds) {
    assert.equal(last.roundStarted, false, "not before the pause has run out");
    last = driveGameTick(game, new Map(), room);
  }
  return last;
}

test("the driver starts the next round when the pause runs out, under the room's settings but the match's format", () => {
  const started = { ...defaultRoomSettings(), length: 3 };
  const game = match(started);
  const room: RoomSettings = {
    ...defaultRoomSettings(),
    length: 9,
    chainReaction: false,
    aimBounce: false,
    map: "classic",
    weights: { star: 1 },
  };
  const driven = driveThroughRoundOver(game, room);
  assert.equal(driven.roundStarted, true);
  assert.deepEqual(driven.removed, []);
  assert.equal(game.phase, "countdown");
  assert.equal(game.round, 2);
  assert.deepEqual(game.settings, { ...room, length: 3 });
  assert.notEqual(game.settings, room, "the game does not alias the room");
});

test("the round boundary drops absent riders and reports them; with one rider left the game waits", () => {
  const game = match(defaultRoomSettings());
  setPlayerConnected(game, "p1", false);
  const driven = driveThroughRoundOver(game, defaultRoomSettings());
  assert.deepEqual(driven.removed, ["p1"]);
  assert.equal(driven.roundStarted, true);
  assert.deepEqual([...game.players.keys()], ["p0", "p2"]);

  const lonely = match(defaultRoomSettings(), 2);
  setPlayerConnected(lonely, "p1", false);
  const waiting = driveThroughRoundOver(lonely, defaultRoomSettings());
  assert.deepEqual(waiting.removed, ["p1"]);
  assert.equal(waiting.roundStarted, false);
  assert.equal(lonely.phase, "roundOver");
  assert.deepEqual(
    driveGameTick(lonely, new Map(), defaultRoomSettings()).removed,
    [],
    "nobody is removed twice",
  );
});

test("outside play nobody holds a charge", () => {
  const game = match(defaultRoomSettings());
  const rider = game.players.get("p0")!;
  rider.bombChargeStartedTick = 1;
  driveGameTick(game, new Map(), defaultRoomSettings());
  assert.equal(game.phase, "countdown");
  assert.equal(rider.bombChargeStartedTick, undefined);
});

test("one shared tick is one step, and applyTick has no tick loop of its own", () => {
  assert.equal(STEPS_PER_TICK, 1);
  const game = match(defaultRoomSettings());
  const before = game.tick;
  driveGameTick(game, new Map(), defaultRoomSettings());
  assert.equal(game.tick, before + STEPS_PER_TICK);
  const source = readFileSync("src/engine/apply-tick.ts", "utf8");
  assert.match(source, /driveGameTick\(/);
  assert.doesNotMatch(
    source,
    /\bstep\(|startNextRound\(/,
    "round progression lives in the driver alone",
  );
});
