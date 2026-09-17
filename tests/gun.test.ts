import test from "node:test";
import assert from "node:assert/strict";
import { cutTrailHole } from "../src/shared/gun.js";
const trail = {
  x1: 0,
  y1: 0,
  x2: 200,
  y2: 0,
  createdTick: 12,
  expiresAtTick: 90,
};
test("gun holes split trails precisely, keeping expiry metadata and distant trails", () => {
  assert.deepEqual(cutTrailHole(trail, 100, 0, 50), [
    { ...trail, x2: 50 },
    { ...trail, x1: 150 },
  ]);
  assert.deepEqual(cutTrailHole(trail, 100, 100, 50), [trail]);
  assert.deepEqual(cutTrailHole(trail, 100, 0, 300), []);
  assert.deepEqual(cutTrailHole({ ...trail, x2: 0 }, 0, 0, 50), []);
  assert.deepEqual(cutTrailHole(trail, 0, 0, 50), [{ ...trail, x1: 50 }]);
});
