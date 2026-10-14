import test from "node:test";
import assert from "node:assert/strict";
import { showHookRoundControls } from "../src/app/control-guide.js";
import { createWorld, DEFAULT_TUNING } from "../src/engine/world.js";
import { toView } from "../src/engine/view.js";

test("Hook competitive controls show during each countdown and disappear for play and results", () => {
  for (const rules of ["score", "elimination"] as const) {
    const view = toView(createWorld({ ...DEFAULT_TUNING, rules }));
    for (const phase of [
      "waiting",
      "countdown",
      "active",
      "over",
      "countdown",
    ] as const) {
      view.contest.phase = phase;
      assert.equal(showHookRoundControls(view), phase === "countdown");
    }
  }
});

test("Hook free play repeats its five-second control guide for every fresh round", () => {
  for (let round = 0; round < 2; round++) {
    const world = createWorld();
    assert.equal(showHookRoundControls(toView(world)), true);
    world.tick = 299;
    assert.equal(showHookRoundControls(toView(world)), true);
    world.tick = 300;
    assert.equal(showHookRoundControls(toView(world)), false);
  }
});
