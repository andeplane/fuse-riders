import {
  createGame,
  addPlayer,
  startMatch,
  toView,
  RIDER_COLORS,
  TICK_HZ,
} from "../src/engine/game.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SELF_LOCATOR_FADE_SECONDS,
  SELF_LOCATOR_REACH,
  selfLocatorRing,
  selfLocatorSide,
  selfLocatorStrength,
} from "../src/render/self-locator.js";
import type { WorldView } from "../src/engine/view.js";
import { classicSettings } from "./fixtures/classic-settings.js";

const SELF_LOCATOR_FADE_TICKS = SELF_LOCATOR_FADE_SECONDS * TICK_HZ;
const view = (overrides: Partial<WorldView>): WorldView => {
  const game = createGame("self-locator", classicSettings());
  addPlayer(game, {
    id: "me",
    name: "Anders",
    slot: 0,
    color: RIDER_COLORS[0],
  });
  addPlayer(game, {
    id: "ai",
    name: "AI Ada",
    slot: 1,
    color: RIDER_COLORS[1],
  });
  startMatch(game);
  return { ...toView(game), tick: game.tick, round: 1, ...overrides };
};

const countdown = (tick: number, presentationTick?: number) =>
  selfLocatorStrength(
    view({ phase: "countdown", phaseEndsAtTick: 60, tick, presentationTick }),
  );

test("the locator opens the countdown at full strength", () => {
  assert.equal(selfLocatorStrength(view({})), 1);
  assert.equal(countdown(0), 1);
  assert.equal(countdown(60 - SELF_LOCATOR_FADE_TICKS), 1);
});

test("the locator fades out over the end of the countdown", () => {
  assert.equal(countdown(60 - SELF_LOCATOR_FADE_TICKS / 2), 0.5);
  assert.equal(countdown(60), 0);
  // Rendering between ticks fades smoothly instead of stepping at the tick rate: the live view interpolates `tick`.
  assert.equal(countdown(60 - SELF_LOCATOR_FADE_TICKS / 4), 0.25);
  assert.equal(countdown(59.5), 0.5 / SELF_LOCATOR_FADE_TICKS);
  assert.equal(countdown(40, 60 - SELF_LOCATOR_FADE_TICKS / 4), 0.25);
  // A view presented past the end of the countdown never goes negative.
  assert.equal(countdown(60, 63), 0);
});

test("the locator is gone once play has started", () => {
  for (const tick of [60, 61, 80, 600])
    assert.equal(
      selfLocatorStrength(
        view({ phase: "playing", roundStartedTick: 60, tick }),
      ),
      0,
    );
  // A rolled-back view may briefly present a tick from before the round started.
  assert.equal(
    selfLocatorStrength(
      view({ phase: "playing", roundStartedTick: 60, tick: 58 }),
    ),
    0,
  );
});

test("the locator stays off outside the countdown", () => {
  for (const phase of ["lobby", "roundOver", "matchOver"] as const)
    assert.equal(selfLocatorStrength(view({ phase })), 0);
  assert.equal(
    selfLocatorStrength(
      view({ phase: "countdown", phaseEndsAtTick: undefined }),
    ),
    0,
  );
});

test("the arrow sits above the rider unless the top boundary leaves no room", () => {
  assert.equal(selfLocatorSide(450, 0), -1);
  assert.equal(selfLocatorSide(SELF_LOCATOR_REACH, 0), -1);
  assert.equal(selfLocatorSide(SELF_LOCATOR_REACH - 1, 0), 1);
  assert.equal(selfLocatorSide(SELF_LOCATOR_REACH + 79, 80), 1);
  assert.equal(selfLocatorSide(SELF_LOCATOR_REACH + 80, 80), -1);
});

test("the ring closes in on the rider, brightening as it arrives, over and over", () => {
  assert.deepEqual(selfLocatorRing(0), { radius: 120, alpha: 0 });
  assert.deepEqual(selfLocatorRing(750), { radius: 75, alpha: 0.5 });
  assert.deepEqual(selfLocatorRing(1500), { radius: 120, alpha: 0 });
  for (const now of [-400, 123, 9_999_999]) {
    const ring = selfLocatorRing(now);
    assert.ok(ring.radius > 30 && ring.radius <= 120);
    assert.ok(ring.alpha >= 0 && ring.alpha < 1);
  }
});
