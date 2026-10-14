import test from "node:test";
import assert from "node:assert/strict";
import { showAxeRoundControls } from "../src/app/control-guide.js";
import { createWorld } from "../src/engine/index.js";
import { createRoom, DEFAULT_SETTINGS, view } from "../src/online/game.js";

test("controls replay at the beginning of each Axe stage and camp, without appearing on results", () => {
  const room = createRoom("guide", DEFAULT_SETTINGS);
  assert.equal(showAxeRoundControls(view(room)), false);
  for (const stage of [1, 2, 3, 4]) {
    room.stage = "running";
    room.round = stage;
    room.world = createWorld({ seed: stage, stage, heroes: [] });
    assert.equal(showAxeRoundControls(view(room)), true);
    room.world.step = 299;
    assert.equal(showAxeRoundControls(view(room)), true);
    room.world.step = 300;
    assert.equal(showAxeRoundControls(view(room)), false);
  }
  room.stage = "between";
  room.world!.step = 0;
  assert.equal(showAxeRoundControls(view(room)), false);
  room.world!.camp = true;
  assert.equal(showAxeRoundControls(view(room)), true);
  room.stage = "over";
  assert.equal(showAxeRoundControls(view(room)), false);
});
