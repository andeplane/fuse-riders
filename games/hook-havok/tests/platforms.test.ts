import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, NEUTRAL, S } from "../src/engine/world.js";
import { step } from "../src/engine/step.js";
import { decodeWorld } from "../src/engine/codec.js";
import { movePlayer, sweep } from "../src/engine/collision.js";
import { TouchInput } from "../src/app/touch-input.js";
test("a full jump passes through the lower ledge and lands on its top", () => {
  const w = createWorld();
  w.input = { ...NEUTRAL, jump: true };
  let passed = false;
  for (let i = 0; i < 100; i++) {
    step(w);
    if (w.feet < 670 * S) passed = true;
    assert.deepEqual(decodeWorld(w), w);
  }
  assert.ok(passed);
  assert.equal(w.grounded, true);
  assert.ok(Math.abs(w.feet - 670 * S) <= 1);
});
test("drop is one press per ledge, lands below, detaches hook and replays from an intersecting checkpoint", () => {
  const w = createWorld();
  w.feet = 670 * S - 1;
  w.hook = {
    phase: "attached",
    x: 310 * S,
    y: 698 * S + 1,
    vx: 0,
    vy: 0,
    life: 50,
    distance: 0,
    platform: 1,
  };
  w.previous.fire = true;
  w.input = { ...NEUTRAL, drop: true, fire: true, jump: true };
  step(w);
  assert.equal(w.grounded, false);
  assert.equal(w.hook.phase, "ready");
  assert.ok(w.vy > 0);
  const restored = decodeWorld(w)!;
  assert.ok(restored);
  for (let i = 0; i < 100; i++) {
    step(w);
    step(restored);
  }
  assert.deepEqual(w, restored);
  assert.equal(w.grounded, true);
  assert.ok(Math.abs(w.feet - 810 * S) <= 1);
  w.input = { ...NEUTRAL };
  step(w);
  w.input = { ...NEUTRAL, drop: true };
  for (let i = 0; i < 30; i++) step(w);
  assert.equal(w.deaths, 1);
});
test("one-way tops catch fast falls but never sides or rising bodies; hooks retain solid geometry", () => {
  const w = createWorld();
  w.x = 300 * S;
  w.feet = 640 * S;
  w.vy = 100 * S;
  movePlayer(w);
  assert.ok(Math.abs(w.feet - 670 * S) <= 1);
  assert.equal(w.grounded, true);
  w.feet = 700 * S;
  w.vy = -100 * S;
  movePlayer(w);
  assert.equal(w.feet, 600 * S);
  w.x = 190 * S;
  w.feet = 690 * S;
  w.vx = 70 * S;
  w.vy = 0;
  movePlayer(w);
  assert.equal(w.x, 260 * S);
  assert.equal(sweep(300 * S, 720 * S, 0, -100 * S)?.platform, 1);
  assert.equal(sweep(190 * S, 680 * S, 70 * S, 0)?.platform, 1);
});
test("down thumb input has a dead zone and clears on release/cancel", () => {
  const t = new TouchInput();
  t.begin("move", 1);
  t.update("move", 1, 0, 0.2);
  assert.equal(t.state.drop, false);
  t.update("move", 1, 0, 0.8);
  assert.equal(t.state.drop, true);
  assert.equal(t.state.jump, false);
  t.end("move", 1);
  assert.equal(t.state.drop, false);
  t.begin("move", 2);
  t.update("move", 2, 0, 0.8);
  t.clear();
  assert.equal(t.state.drop, false);
});
