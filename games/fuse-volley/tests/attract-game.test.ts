import assert from "node:assert/strict";
import { test } from "node:test";
import { createAttractGame } from "fuse-netcode";
import { DEFAULT_SETTINGS, fuseVolleyGame } from "../src/online/game.js";

test("singles attract play starts two bots and advances a real volleyball world", () => {
  const demo = createAttractGame(fuseVolleyGame, DEFAULT_SETTINGS, { bots: 2 });
  assert.ok(demo.view().world);
  const before = demo.view().world!.step;
  demo.advance();
  assert.ok(demo.view().world!.step > before);
  assert.throws(
    () => createAttractGame(fuseVolleyGame, DEFAULT_SETTINGS),
    /attract match did not start/,
  );
});
