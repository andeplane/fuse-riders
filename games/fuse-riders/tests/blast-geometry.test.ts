import assert from "node:assert/strict";
import test from "node:test";
import { segmentIntersectsDisk } from "../src/engine/blast-geometry.ts";
const disk = { x: 100, y: 100, radius: 50 };
test("disk uses radial distance rather than bounding square or cross", () => {
  assert.equal(segmentIntersectsDisk(130, 130, 130, 130, disk), true);
  assert.equal(segmentIntersectsDisk(140, 140, 140, 140, disk), false);
  assert.equal(segmentIntersectsDisk(150, 100, 150, 100, disk), true);
});
test("swept disk detects crossing, tangent, radius padding and endpoint misses", () => {
  assert.equal(segmentIntersectsDisk(0, 100, 200, 100, disk), true);
  assert.equal(segmentIntersectsDisk(0, 150, 200, 150, disk), true);
  assert.equal(segmentIntersectsDisk(0, 151, 200, 151, disk), false);
  assert.equal(segmentIntersectsDisk(0, 151, 200, 151, disk, 1), true);
  assert.equal(segmentIntersectsDisk(0, 100, 49, 100, disk), false);
  assert.equal(segmentIntersectsDisk(151, 100, 200, 100, disk), false);
});
