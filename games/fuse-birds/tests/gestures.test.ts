import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_VX, MAX_VY } from "../src/engine/view-kit.js";
import {
  createGestures,
  cancelGesture,
  pointerDown,
  pointerMove,
  pointerUp,
} from "../src/app/gestures.js";
const map = { width: 1536, height: 768 },
  viewport = { width: 1000, height: 600 },
  bird = { x: 768, y: 384 };
test("the slingshot can select the complete engine launch range", () => {
  const state = createGestures({ x: 768, y: 384, zoom: 1 });
  pointerDown(state, { id: 1, x: 500, y: 300 }, true, map, viewport, bird);
  pointerMove(state, { id: 1, x: 200, y: 600 }, map, viewport);
  assert.deepEqual(pointerUp(state, 1), { vx: MAX_VX, vy: -MAX_VY });
  pointerDown(state, { id: 2, x: 500, y: 300 }, true, map, viewport, bird);
  pointerMove(state, { id: 2, x: 500, y: 0 }, map, viewport);
  assert.deepEqual(pointerUp(state, 2), { vx: 0, vy: MAX_VY });
});
test("the same pull fires the same quantized vector at different zooms", () => {
  const shoot = (zoom: number) => {
    const state = createGestures({ x: 768, y: 384, zoom });
    pointerDown(state, { id: 1, x: 500, y: 300 }, true, map, viewport, bird);
    pointerMove(state, { id: 1, x: 420, y: 380 }, map, viewport);
    return pointerUp(state, 1);
  };
  assert.deepEqual(shoot(1), shoot(4));
  assert.ok(shoot(1)!.vy < 0);
});
test("pinching cancels a pending aim until all fingers lift, and preserves camera limits", () => {
  const state = createGestures({ x: 768, y: 384, zoom: 2 });
  pointerDown(state, { id: 1, x: 500, y: 300 }, true, map, viewport, bird);
  pointerMove(state, { id: 1, x: 420, y: 380 }, map, viewport);
  assert.ok(state.aim);
  pointerDown(state, { id: 2, x: 600, y: 300 }, true, map, viewport, bird);
  assert.equal(state.aim, undefined);
  pointerMove(state, { id: 2, x: 800, y: 300 }, map, viewport);
  assert.ok(state.camera.zoom > 2);
  assert.equal(pointerUp(state, 2), undefined);
  pointerMove(state, { id: 1, x: 200, y: 400 }, map, viewport);
  assert.equal(pointerUp(state, 1), undefined);
  assert.equal(state.cancelled, false);
});
test("dragging away from the bird pans; blur, resize or weapon switch can cancel safely", () => {
  const state = createGestures({ x: 768, y: 384, zoom: 3 });
  pointerDown(state, { id: 1, x: 100, y: 300 }, true, map, viewport, bird);
  pointerMove(state, { id: 1, x: 50, y: 320 }, map, viewport);
  assert.ok(state.camera.x > 768);
  assert.equal(pointerUp(state, 1), undefined);
  pointerDown(state, { id: 2, x: 500, y: 300 }, false, map, viewport, bird);
  cancelGesture(state);
  assert.equal(pointerUp(state, 2), undefined);
  pointerMove(state, { id: 99, x: 50, y: 50 }, map, viewport);
  assert.equal(state.mode, "idle");
});
