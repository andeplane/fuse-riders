import assert from "node:assert/strict";
import test from "node:test";
import { BotController } from "../src/engine/bot-controller.js";
import {
  applyTick,
  createRoomState,
  type RoomState,
} from "../src/engine/apply-tick.js";
import {
  PHASES,
  TickFault,
  addPlayer,
  createGame,
  startMatch,
  step,
  COUNTDOWN_TICKS,
  type Phase,
} from "../src/engine/game.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import { classicSettings } from "./fixtures/classic-settings.js";

/**
 * The seam: PHASES with one more phase in the middle of the tick, after riders have been moved and pickups collected
 * and before anything is committed, that throws on the ticks it is told to. No engine code is patched.
 */
function failingAt(shouldFail: (tick: number) => boolean): Phase[] {
  const at = PHASES.findIndex((phase) => phase.name === "commitMovement");
  assert.ok(at > 0);
  return [
    ...PHASES.slice(0, at),
    {
      name: "injectedFailure",
      when: "playing",
      run: ({ state }) => {
        if (shouldFail(state.tick)) throw new Error("injected");
      },
    },
    ...PHASES.slice(at),
  ];
}

function room(): RoomState {
  const state = createRoomState("fault", defaultRoomSettings());
  addPlayer(state.game, { id: "p0", name: "P0", slot: 0, color: "#fff" });
  addPlayer(state.game, { id: "bot:1", name: "Ada", slot: 1, color: "#fff" });
  state.bots.add("bot:1");
  startMatch(state.game);
  return state;
}

test("a phase that throws surfaces as a TickFault naming the tick and the phase, and the state is left mid-tick", () => {
  const game = createGame("fault", classicSettings());
  for (let slot = 0; slot < 2; slot++)
    addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: "#fff" });
  startMatch(game);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(game, new Map());
  const failing = game.tick + 1;
  const before = structuredClone(game);
  assert.throws(
    () =>
      step(
        game,
        new Map(),
        failingAt((tick) => tick === failing),
      ),
    (error) =>
      error instanceof TickFault &&
      error.tick === failing &&
      error.phase === "injectedFailure" &&
      error.cause instanceof Error &&
      error.cause.message === "injected",
  );
  // Exactly as before the pipeline: a throw leaves the state part-way through the tick. The clock moved and nobody did.
  // Naming the phase is all this stage adds; what a driver does about it is the follow-up to #253 C8.
  assert.equal(game.tick, failing);
  assert.deepEqual(
    [...game.players.values()].map(({ x, y }) => [x, y]),
    [...before.players.values()].map(({ x, y }) => [x, y]),
  );
  // Without the injected phase the same list is the ordinary tick.
  const control = structuredClone(before);
  step(control, new Map());
  const viaSeam = structuredClone(before);
  step(
    viaSeam,
    new Map(),
    failingAt(() => false),
  );
  assert.deepEqual(viaSeam, control);
});

test("applyTick passes the seam through and does not hide the throw", () => {
  const state = room();
  const bots = new BotController();
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++)
    applyTick(state, "p0", new Map(), bots);
  assert.throws(
    () =>
      applyTick(
        state,
        "p0",
        new Map(),
        bots,
        failingAt(() => true),
      ),
    (error) => error instanceof TickFault && error.phase === "injectedFailure",
  );
});
