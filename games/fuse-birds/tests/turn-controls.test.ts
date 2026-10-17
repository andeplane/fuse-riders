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
  type Gate = Pick<Session, "admitted" | "turnTimeLeft">;
  const blocked: Gate = { admitted: false, turnTimeLeft: 20 };
  const admitted: Gate = { admitted: true, turnTimeLeft: 20 };
  const timedOut: Gate = { admitted: true, turnTimeLeft: 0 };
  const practice: Gate = { admitted: true, turnTimeLeft: undefined };
  assert.equal(canPlayTurn(frame, "a", false, true, blocked), false);
  assert.equal(canPlayTurn(frame, "a", false, true, admitted), true);
  assert.equal(
    canPlayTurn(frame, "a", false, true, timedOut),
    false,
    "a lagging world's aiming turn the shared log has already timed out",
  );
  assert.equal(canPlayTurn(frame, "a", false, true, practice), true);
  assert.equal(canPlayTurn(frame, "a", true, true, admitted), false);
  assert.equal(canPlayTurn(frame, "a", false, false, admitted), false);
  assert.equal(canPlayTurn(frame, "b", false, true, admitted), false);
  assert.equal(
    canPlayTurn({ ...frame, world: null }, "a", false, true, admitted),
    false,
  );
  assert.equal(canPlayTurn(null, "a", false, true, admitted), false);
});
