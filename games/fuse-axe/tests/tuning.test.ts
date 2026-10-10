import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPACITY,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  SUB,
  VIEW_H,
  VIEW_W,
  px,
} from "../src/engine/tuning.js";

test("the native screen is 16:9 and a log tick folds 50 ms of steps", () => {
  assert.equal(VIEW_W * 9, VIEW_H * 16);
  assert.equal((STEPS_PER_TICK * 1000) / STEPS_PER_SECOND, 50);
  assert.equal(CAPACITY, 5);
});

test("px turns pixels into whole sub-units", () => {
  assert.equal(px(1), SUB);
  assert.equal(px(0.5), SUB / 2);
  assert.ok(Number.isInteger(px(1.3)));
});

test("px mirrors across zero and never returns -0", () => {
  const half = 0.5 / SUB; // Exactly half a sub-unit, where rounding direction shows.
  assert.equal(px(half), 1);
  assert.equal(px(-half), -1);
  assert.equal(px(-1.5), -px(1.5));
  assert.ok(Object.is(px(-0.0001), 0));
  assert.ok(Object.is(px(-0), 0));
});
