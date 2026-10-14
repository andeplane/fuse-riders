import { test } from "node:test";
import assert from "node:assert/strict";
import type { Frame } from "fuse-netcode";
import { createMatch, getView } from "../src/engine/index.js";
import type { BirdsView } from "../src/online/game.js";
import type { Session } from "../src/online/runtime.js";
import { canPlayTurn } from "../src/app/turn-controls.js";

test("controls require runtime admission even when a recovered frame reports the old seat connected", () => {
  const world = getView(createMatch("match", 42, [{ id: "a", name: "Skye" }]));
  const frame: Frame<BirdsView> = {
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
        connected: true,
        generation: 1,
        bot: false,
      },
    ],
  };
  const blocked: Pick<Session, "admitted"> = { admitted: false };
  const admitted: Pick<Session, "admitted"> = { admitted: true };
  assert.equal(canPlayTurn(frame, "a", false, true, blocked), false);
  assert.equal(canPlayTurn(frame, "a", false, true, admitted), true);
  assert.equal(canPlayTurn(frame, "a", true, true, admitted), false);
  assert.equal(canPlayTurn(frame, "a", false, false, admitted), false);
  assert.equal(canPlayTurn(frame, "b", false, true, admitted), false);
  assert.equal(
    canPlayTurn({ ...frame, world: null }, "a", false, true, admitted),
    false,
  );
  assert.equal(canPlayTurn(null, "a", false, true, admitted), false);
});
