import assert from "node:assert/strict";
import { test } from "node:test";
import { createAttractGame } from "fuse-netcode";
import { DEFAULT_SETTINGS, fuseSurgeGame } from "../src/online/game.js";

test("attract play seats bots on the deck and advances a real match", () => {
  const demo = createAttractGame(fuseSurgeGame, DEFAULT_SETTINGS, { bots: 4 });
  const world = demo.view().world;
  assert.ok(world);
  assert.equal(world.riders.length, 4);
  const before = world.step;
  demo.advance();
  assert.ok(demo.view().world!.step > before);
  assert.throws(
    () => createAttractGame(fuseSurgeGame, DEFAULT_SETTINGS, { bots: 1 }),
    /attract match did not start/,
  );
});
