import assert from "node:assert/strict";
import { test } from "node:test";
import { createAttractGame } from "fuse-netcode";
import { diceGame, DEFAULT_SETTINGS } from "../src/game/index.js";

test("a local attract game runs genuine seeded bot turns, with bounded deterministic loops", () => {
  const a = createAttractGame(diceGame, DEFAULT_SETTINGS, {
    bots: 3,
    warmup: 20,
    loopTicks: 120,
  });
  const b = createAttractGame(diceGame, DEFAULT_SETTINGS, {
    bots: 3,
    warmup: 20,
    loopTicks: 120,
  });
  assert.equal(a.view().phase, "running");
  assert.equal(a.view().players.length, 3);
  assert.ok(a.view().players.every((player) => player.bot));
  let rolled = false;
  for (let tick = 0; tick < 320; tick++) {
    a.advance();
    b.advance();
    assert.deepEqual(a.view(), b.view());
    rolled ||= !!a.view().lastRoll;
  }
  assert.ok(
    rolled,
    "the real dice engine rolls and scores without a human input",
  );
  assert.ok(a.tick() <= 120);
  assert.notEqual(a.scope(), "menu-demo-1");
});

test("attract setup respects capacity and refuses management entries rejected by a game", () => {
  const demo = createAttractGame(diceGame, DEFAULT_SETTINGS, { bots: 99 });
  assert.equal(demo.view().players.length, diceGame.seating.capacity);
  const refusing = {
    ...diceGame,
    seating: { ...diceGame.seating, botName: () => "" },
  };
  assert.throws(
    () => createAttractGame(refusing, DEFAULT_SETTINGS),
    /invalid attract entry/,
  );
});
