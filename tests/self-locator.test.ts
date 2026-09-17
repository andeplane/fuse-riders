import {
  createGame,
  addPlayer,
  startMatch,
  toSnapshot,
  SLOT_COLORS,
} from "../src/shared/game.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SELF_LOCATOR_LINGER_TICKS,
  SELF_LOCATOR_REACH,
  selfLocatorRings,
  selfLocatorSide,
  selfLocatorStrength,
} from "../src/client/self-locator.js";
import type { ViewSnapshot } from "../src/client/snapshot-stream.js";

const view = (overrides: Partial<ViewSnapshot>): ViewSnapshot => {
  const game = createGame("self-locator");
  addPlayer(game, { id: "me", name: "Anders", slot: 0, color: SLOT_COLORS[0] });
  addPlayer(game, { id: "ai", name: "AI Ada", slot: 1, color: SLOT_COLORS[1] });
  startMatch(game);
  return { ...toSnapshot(game), tick: game.tick, round: 1, ...overrides };
};

test("the locator is at full strength for the whole countdown", () => {
  assert.equal(selfLocatorStrength(view({})), 1);
  assert.equal(
    selfLocatorStrength(
      view({ phase: "countdown", tick: 59, phaseEndsAtTick: 60 }),
    ),
    1,
  );
});

test("the locator fades over the first moments of play and then stays gone", () => {
  const playing = (tick: number, presentationTick?: number) =>
    selfLocatorStrength(
      view({ phase: "playing", roundStartedTick: 60, tick, presentationTick }),
    );
  assert.equal(playing(60), 1);
  assert.equal(playing(60 + SELF_LOCATOR_LINGER_TICKS / 2), 0.5);
  assert.equal(playing(60 + SELF_LOCATOR_LINGER_TICKS), 0);
  assert.equal(playing(60 + SELF_LOCATOR_LINGER_TICKS * 10), 0);
  // Rendering between ticks fades smoothly instead of stepping at the tick rate.
  assert.equal(playing(60, 60 + SELF_LOCATOR_LINGER_TICKS / 4), 0.75);
  // A rolled-back view may briefly present a tick from before the round started.
  assert.equal(playing(58), 1);
});

test("the locator stays off outside the opening of a round", () => {
  for (const phase of ["lobby", "roundOver", "matchOver"] as const)
    assert.equal(selfLocatorStrength(view({ phase })), 0);
  assert.equal(
    selfLocatorStrength(
      view({ phase: "playing", roundStartedTick: undefined, tick: 60 }),
    ),
    0,
  );
});

test("the arrow sits above the rider unless the top boundary leaves no room", () => {
  assert.equal(selfLocatorSide(450, 0), -1);
  assert.equal(selfLocatorSide(SELF_LOCATOR_REACH, 0), -1);
  assert.equal(selfLocatorSide(SELF_LOCATOR_REACH - 1, 0), 1);
  assert.equal(selfLocatorSide(200, 80), 1);
});

test("rings close in on the rider, brightening as they arrive, with one always on its way", () => {
  const [first, second] = selfLocatorRings(0);
  assert.deepEqual(first, { radius: 230, alpha: 0 });
  assert.deepEqual(second, { radius: 130, alpha: 0.5 });
  const later = selfLocatorRings(550);
  assert.deepEqual(later[0], { radius: 130, alpha: 0.5 });
  assert.deepEqual(later[1], { radius: 230, alpha: 0 });
  for (const now of [-400, 123, 9_999_999])
    for (const ring of selfLocatorRings(now)) {
      assert.ok(ring.radius > 30 && ring.radius <= 230);
      assert.ok(ring.alpha >= 0 && ring.alpha < 1);
    }
});
