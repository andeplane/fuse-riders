import test from "node:test";
import assert from "node:assert/strict";
import {
  SNAP_DISTANCE,
  clamp01,
  continuous,
  interpolateUnit,
  interpolateView,
  lerpWrapped,
  viewTime,
  wrap,
  wrapDistance,
} from "../src/render/interpolation.js";
import { openingView, unitView, withUnit } from "./render-kit.js";

test("wrap folds any x onto the screen", () => {
  assert.equal(wrap(10), 10);
  assert.equal(wrap(490), 10);
  assert.equal(wrap(-10), 470);
  assert.equal(wrap(-490), 470);
  assert.equal(wrap(25, 20), 5);
});

test("wrapDistance takes the short way across the seam", () => {
  assert.equal(wrapDistance(10, 30), 20);
  assert.equal(wrapDistance(470, 10), 20);
  assert.equal(wrapDistance(10, 470), -20);
  assert.equal(wrapDistance(0, 240), 240);
  assert.equal(wrapDistance(2, 18, 20), -4);
});

test("lerpWrapped blends through the seam and stays on the screen", () => {
  assert.equal(lerpWrapped(100, 110, 0.5), 105);
  assert.equal(lerpWrapped(475, 5, 0.5), 0);
  assert.equal(lerpWrapped(478, 6, 0.25), 0);
  assert.equal(lerpWrapped(5, 475, 0.5), 0);
  assert.equal(lerpWrapped(5, 475, 0.8), 477);
});

test("clamp01 keeps alpha between the two steps", () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(0.4), 0.4);
  assert.equal(clamp01(3), 1);
});

test("a unit blends between steps, also across the wrap", () => {
  const before = unitView({ x: 476, y: 100 });
  const after = unitView({ x: 4, y: 104, facing: -1 });
  const mid = interpolateUnit(before, after, 0.5);
  assert.equal(mid.x, 0);
  assert.equal(mid.y, 102);
  assert.equal(mid.facing, -1, "discrete things are the newer step's");
});

test("a unit that jumped snaps to the newer step", () => {
  const after = unitView({ x: 300, y: 100 });
  assert.equal(interpolateUnit(undefined, after, 0.5), after);
  assert.equal(interpolateUnit(unitView({ x: 100 }), after, 0.5), after);
  assert.equal(
    interpolateUnit(
      unitView({ x: 300, y: 100 - SNAP_DISTANCE - 1 }),
      after,
      0.5,
    ),
    after,
  );
  for (const patch of [{ dead: true }, { riding: true }, { eaten: true }])
    assert.equal(
      continuous(unitView({ x: 300, ...patch }), after),
      false,
      JSON.stringify(patch),
    );
  assert.equal(continuous(unitView({ x: 300 - SNAP_DISTANCE }), after), true);
});

test("a view blends units, loose berries and the snail", () => {
  const base = openingView();
  const previous = {
    ...withUnit(base, 0, { x: 470, y: 50 }),
    loose: [
      { x: 100, y: 60 },
      { x: 10, y: 10 },
    ],
    snail: { ...base.snail, x: 200 },
  };
  const current = {
    ...withUnit(base, 0, { x: 2, y: 54 }),
    step: base.step + 1,
    loose: [
      { x: 104, y: 62 },
      { x: 300, y: 10 },
    ],
    snail: { ...base.snail, x: 201 },
  };
  const mid = interpolateView(previous, current, 0.5);
  assert.equal(mid.units[0]?.x, 476);
  assert.equal(mid.units[0]?.y, 52);
  assert.deepEqual(mid.loose[0], { x: 102, y: 61 });
  assert.deepEqual(
    mid.loose[1],
    { x: 300, y: 10 },
    "a berry that jumped snaps",
  );
  assert.equal(mid.snail.x, 200.5);
  assert.equal(mid.step, current.step);
  assert.equal(viewTime(previous, current, 0.5), base.step + 0.5);
  assert.equal(viewTime(previous, current, 7), current.step);
});

test("berries are not blended when their number changed or they fell far", () => {
  const base = openingView();
  const previous = { ...base, loose: [{ x: 100, y: 60 }] };
  const more = {
    ...base,
    step: base.step + 1,
    loose: [
      { x: 104, y: 62 },
      { x: 300, y: 10 },
    ],
  };
  assert.deepEqual(interpolateView(previous, more, 0.5).loose, more.loose);
  const fell = { ...base, step: base.step + 1, loose: [{ x: 100, y: 160 }] };
  assert.deepEqual(interpolateView(previous, fell, 0.5).loose, fell.loose);
  const snail = {
    ...base,
    step: base.step + 1,
    snail: { ...base.snail, x: base.snail.x + 100 },
  };
  assert.equal(interpolateView(base, snail, 0.5).snail.x, base.snail.x + 100);
});

test("views that are not neighbours are not blended", () => {
  const base = openingView();
  const moved = withUnit(base, 0, { x: (base.units[0]?.x ?? 0) + 4 });
  assert.equal(interpolateView(base, base, 0.5), base);
  const next = { ...moved, step: base.step + 1 };
  assert.equal(interpolateView(base, next, 1), next);
  assert.equal(interpolateView(base, next, 2), next);
  const back = { ...moved, step: base.step - 1 };
  assert.equal(interpolateView(base, back, 0.5), back);
  assert.equal(viewTime(base, back, 0.5), back.step);
  const far = { ...moved, step: base.step + 7 };
  assert.equal(interpolateView(base, far, 0.5), far);
  assert.equal(viewTime(base, far, 0.5), far.step);
  const other = { ...next, map: { ...base.map, id: 2 as const } };
  assert.equal(interpolateView(base, other, 0.5), other);
});
