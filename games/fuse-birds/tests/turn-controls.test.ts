import { test } from "node:test";
import assert from "node:assert/strict";
import type { Frame } from "fuse-netcode";
import { createMatch, getView } from "../src/engine/index.js";
import type { BirdsView } from "../src/online/game.js";
import { canPlayTurn } from "../src/app/turn-controls.js";

function recoveredTurn(): Frame<BirdsView> {
  const world = getView(createMatch("match", 42, [{ id: "a", name: "Skye" }]));
  return {
    tick: 3,
    logTick: 1,
    managerId: "a",
    matchId: "match",
    stage: "running",
    world: { ...world, phase: "aiming" },
    seats: [
      {
        id: "a",
        name: "Skye",
        slot: 0,
        avatarId: "owl",
        connected: false,
        away: true,
        bot: false,
      },
    ],
  };
}

test("a recovered active turn cannot accept controls until the returning seat is connected", () => {
  const frame = recoveredTurn();
  assert.equal(canPlayTurn(frame, "a", false, true), false);
  const connected = {
    ...frame,
    seats: frame.seats.map((seat) => ({
      ...seat,
      connected: true,
      away: false,
    })),
  };
  assert.equal(canPlayTurn(connected, "a", false, true), true);
  assert.equal(
    canPlayTurn(
      {
        ...connected,
        seats: connected.seats.map((seat) => ({ ...seat, away: true })),
      },
      "a",
      false,
      true,
    ),
    false,
  );
  assert.equal(canPlayTurn(connected, "a", true, true), false);
  assert.equal(canPlayTurn(connected, "a", false, false), false);
  assert.equal(canPlayTurn(connected, "b", false, true), false);
  assert.equal(
    canPlayTurn(
      {
        ...connected,
        seats: connected.seats.map((seat) => ({ ...seat, watcher: true })),
      },
      "a",
      false,
      true,
    ),
    false,
  );
  assert.equal(
    canPlayTurn({ ...connected, world: null }, "a", false, true),
    false,
  );
  assert.equal(canPlayTurn(null, "a", false, true), false);
});
