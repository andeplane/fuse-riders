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
import {
  driveGameTick,
  MAX_STEPS_PER_TICK,
  stepsCover,
  type TickSteps,
} from "../src/engine/tick-driver.js";
import type { InputIntent } from "../src/engine/state.js";
import { GUN_AIM_STEP } from "../src/engine/gun.js";
import { readFileSync } from "node:fs";
import { setArmed } from "./fixtures/rider-state.ts";
import { isArmed } from "../src/engine/weapons.ts";

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

test("one shared tick is one step unless asked for more, and applyTick has no tick loop of its own", () => {
  const game = match(defaultRoomSettings());
  const before = game.tick;
  driveGameTick(game, new Map(), defaultRoomSettings());
  assert.equal(game.tick, before + 1);
  const source = readFileSync(
    "games/fuse-riders/src/engine/apply-tick.ts",
    "utf8",
  );
  assert.match(source, /driveGameTick\(/);
  assert.doesNotMatch(
    source,
    /\bstep\(|startNextRound\(/,
    "round progression lives in the driver alone",
  );
});

/** Plays a match past its countdown, so a step has a round to play. */
function playing(riders = 3): GameState {
  const game = match(defaultRoomSettings(), riders);
  while (game.phase === "countdown")
    driveGameTick(game, new Map(), defaultRoomSettings());
  assert.equal(game.phase, "playing");
  return game;
}

test("extra steps get the later inputs: the tick's bomb commands reach the first step alone", () => {
  const game = playing();
  const press: InputIntent = {
      left: true,
      right: false,
      bomb: true,
      bombCommands: [{ action: "press" }],
    },
    held: InputIntent = { left: true, right: false, bomb: true };
  const seen: { tick: number; inputs: ReadonlyMap<string, InputIntent> }[] = [];
  const steps: TickSteps = {
    count: 3,
    later: (current) => {
      const inputs = new Map([["p0", held]]);
      seen.push({ tick: current.tick, inputs });
      return inputs;
    },
  };
  const before = game.tick;
  driveGameTick(
    game,
    new Map([["p0", press]]),
    defaultRoomSettings(),
    undefined,
    steps,
  );
  assert.equal(game.tick, before + 3, "three steps in one tick");
  assert.deepEqual(
    seen.map((call) => call.tick),
    [before + 1, before + 2],
    "each later step asks for its inputs on the game the previous step left",
  );
  assert.ok(
    seen.every((call) => !call.inputs.get("p0")!.bombCommands),
    "no command is repeated",
  );
  assert.equal(
    game.players.get("p0")!.bombChargeStartedTick,
    before + 1,
    "the press started one charge, on the first step",
  );
});

test("a held Gun sight sweeps on every step of a multi-step tick, as it would over as many ordinary ticks", () => {
  const game = playing();
  const rider = game.players.get("p0")!;
  setArmed(rider, "gun", true);
  rider.bombReadyAtTick = game.tick;
  driveGameTick(
    game,
    new Map([
      [
        "p0",
        {
          left: false,
          right: false,
          bomb: true,
          bombCommands: [{ action: "press" }],
        },
      ],
    ]),
    defaultRoomSettings(),
  );
  assert.equal(rider.gunAim, 0, "the press raised the sight");
  const held: InputIntent = { left: false, right: true, bomb: true };
  const heading = rider.angle;
  driveGameTick(
    game,
    new Map([["p0", held]]),
    defaultRoomSettings(),
    undefined,
    {
      count: 3,
      later: () => new Map([["p0", held]]),
    },
  );
  assert.ok(Math.abs(rider.gunAim! - 3 * GUN_AIM_STEP) < 1e-12);
  assert.equal(rider.angle, heading, "steering swept the sight, not the rider");
  assert.equal(isArmed(rider, "gun"), true, "nothing fired");
});

test("a round that ends on an early step is not stepped on into its pause", () => {
  const game = playing();
  eliminatePlayer(game, "p1");
  eliminatePlayer(game, "p2");
  const before = game.tick;
  let asked = 0;
  driveGameTick(game, new Map(), defaultRoomSettings(), undefined, {
    count: 3,
    later: () => {
      asked++;
      return new Map();
    },
  });
  assert.equal(game.phase, "roundOver");
  assert.equal(game.tick, before + 1, "one step: the round ended on it");
  assert.equal(asked, 0);
});

test("a game clock belongs to a log tick its steps can cover", () => {
  assert.ok(stepsCover(0, 0));
  assert.ok(stepsCover(10, 10));
  assert.ok(stepsCover(10, 10 * MAX_STEPS_PER_TICK));
  assert.ok(!stepsCover(10, 9), "every log tick steps at least once");
  assert.ok(
    !stepsCover(10, 10 * MAX_STEPS_PER_TICK + 1),
    "and at most MAX_STEPS_PER_TICK times",
  );
});
