import test from "node:test";
import assert from "node:assert/strict";
import {
  canvasToWorld,
  easeFrame,
  fitZoom,
  followKeepers,
  wholeArena,
} from "../src/render/camera.js";

const SPIRE = { width: 2240, height: 1260 },
  BELFRY = { width: 1600, height: 900 };

test("the camera fits the whole arena, and the old maps keep the fixed view", () => {
  assert.equal(fitZoom(BELFRY), 1);
  assert.deepEqual(wholeArena(BELFRY), { x: 800, y: 450, zoom: 1 });
  assert.equal(fitZoom(SPIRE), 1600 / 2240);
  assert.deepEqual(wholeArena(SPIRE), { x: 1120, y: 630, zoom: 1600 / 2240 });
  // Follow keepers never changes a 1600 × 900 map.
  assert.deepEqual(
    followKeepers(BELFRY, [{ x: 300, y: 700 }]),
    wholeArena(BELFRY),
  );
});

test("follow keepers frames the living keepers between the whole arena and 1, inside the arena", () => {
  const one = followKeepers(SPIRE, [{ x: 300, y: 1100 }]);
  assert.equal(one.zoom, 1, "never past 1");
  // Kept inside the arena: the view's half-size from the edges.
  assert.equal(one.x, 800);
  assert.equal(one.y, 1260 - 450);
  const spread = followKeepers(SPIRE, [
    { x: 40, y: 100 },
    { x: 2200, y: 1200 },
  ]);
  assert.deepEqual(spread, wholeArena(SPIRE), "never out past the whole arena");
  const pair = followKeepers(SPIRE, [
    { x: 900, y: 700 },
    { x: 1500, y: 760 },
  ]);
  assert.ok(pair.zoom > fitZoom(SPIRE) && pair.zoom <= 1);
  assert.equal(pair.x, 1200);
  assert.deepEqual(followKeepers(SPIRE, []), wholeArena(SPIRE));
});

test("canvas points map through the current frame, and frames ease", () => {
  const whole = wholeArena(SPIRE);
  assert.deepEqual(canvasToWorld(whole, 0, 0), { x: 0, y: 0 });
  assert.deepEqual(canvasToWorld(whole, 1, 1), { x: 2240, y: 1260 });
  const near = { x: 800, y: 810, zoom: 1 };
  assert.deepEqual(canvasToWorld(near, 0.5, 0.5), { x: 800, y: 810 });
  assert.deepEqual(canvasToWorld(near, 0, 1), { x: 0, y: 1260 });
  const half = easeFrame(whole, near, 0.5);
  assert.equal(half.x, 960);
  assert.equal(half.zoom, (whole.zoom + 1) / 2);
});
