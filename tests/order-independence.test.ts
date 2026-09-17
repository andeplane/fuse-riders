import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BotController } from "../src/shared/bot-controller.js";
import {
  applyTick,
  createRoomState,
  hashRoomState,
  type RoomState,
  type StreamEntries,
} from "../src/shared/apply-tick.js";
import {
  defaultRoomSettings,
  roomPickup,
} from "../src/shared/room-settings.js";
import { PICKUP_TYPES } from "../src/shared/game.js";
import type { Recording } from "./fixtures/replay-log.js";

test("every weighted pickup interval is independent of object insertion order", () => {
  const weights = Object.fromEntries(
    PICKUP_TYPES.map((type, index) => [type, index + 1]),
  );
  const reversed = Object.fromEntries(Object.entries(weights).reverse());
  for (let sample = 0; sample < 1000; sample++)
    assert.equal(
      roomPickup(sample / 1000, weights),
      roomPickup(sample / 1000, reversed),
    );
});

function permute(state: RoomState): void {
  state.game.players = new Map([...state.game.players].reverse());
  state.game.bombs = new Map([...state.game.bombs].reverse());
  state.game.matchStats = new Map([...state.game.matchStats].reverse());
  state.folds = new Map([...state.folds].reverse());
  state.bots = new Set([...state.bots].reverse());
  state.settings.weights = Object.fromEntries(
    Object.entries(state.settings.weights).reverse(),
  );
  if (state.game.settings)
    state.game.settings.weights = Object.fromEntries(
      Object.entries(state.game.settings.weights).reverse(),
    );
}

test("the whole mechanic replay survives reversed map and settings insertion order at every tick", () => {
  const recording: Recording = JSON.parse(
    readFileSync(
      new URL("./fixtures/mechanics-recording.json", import.meta.url),
      "utf8",
    ),
  );
  const golden: { hashes: string[] } = JSON.parse(
    readFileSync(
      new URL("./fixtures/golden-hashes.json", import.meta.url),
      "utf8",
    ),
  );
  const state = createRoomState(recording.matchId, defaultRoomSettings());
  const bots = new BotController();
  let bombTicks = 0;
  for (let tick = 1; tick <= recording.ticks; tick++) {
    const streams = new Map<string, StreamEntries>(
      Object.entries(recording.entries)
        .reverse()
        .map(([member, entries]) => [
          member,
          {
            generation: 1,
            entries: entries.filter((entry) => entry[1] === tick),
          },
        ]),
    );
    permute(state);
    applyTick(state, recording.creator, streams, bots);
    if (state.game.bombs.size > 1) bombTicks++;
    assert.equal(
      hashRoomState(state),
      golden.hashes[tick - 1],
      `insertion order changed tick ${tick}`,
    );
  }
  assert.ok(bombTicks > 0, "the workload exercises concurrent bombs");
});
