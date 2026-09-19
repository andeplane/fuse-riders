import assert from "node:assert/strict";
import test from "node:test";
import {
  VOLLEY_FLIGHT_STEPS,
  createVolleyFlightPaths,
  volleyAngles,
} from "../src/engine/launch-modifiers.ts";

const bounds = { minX: 20, maxX: 1580, minY: 20, maxY: 880 };

test("creates a deterministic straight triple fan with seven points per bomb", () => {
  assert.deepEqual(volleyAngles(1), [0.78, 1, 1.22]);
  const start = { x: 800, y: 450 };
  const paths = createVolleyFlightPaths(start, 0, 120, bounds);
  assert.equal(paths.length, 3);
  for (const path of paths) {
    assert.equal(path.length, VOLLEY_FLIGHT_STEPS + 1);
    assert.ok(path.every((point) => point.angle === path[0]!.angle));
    for (let step = 1; step < path.length; step += 1) {
      assert.ok(
        Math.abs(
          Math.hypot(
            path[step]!.x - path[step - 1]!.x,
            path[step]!.y - path[step - 1]!.y,
          ) - 20,
        ) < 1e-10,
      );
    }
  }
  assert.deepEqual(paths, createVolleyFlightPaths(start, 0, 120, bounds));
  assert.deepEqual(start, { x: 800, y: 450 });
});

test("all fan paths clamp to safe bounds", () => {
  const paths = createVolleyFlightPaths({ x: 21, y: 21 }, 0, 4000, bounds);
  assert.ok(
    paths
      .flat()
      .every(
        (point) =>
          point.x >= bounds.minX &&
          point.x <= bounds.maxX &&
          point.y >= bounds.minY &&
          point.y <= bounds.maxY,
      ),
  );
});

test("rejects invalid geometry", () => {
  assert.throws(() => volleyAngles(NaN));
  assert.throws(() => createVolleyFlightPaths({ x: 10, y: 10 }, 0, -1, bounds));
  assert.throws(() =>
    createVolleyFlightPaths({ x: Infinity, y: 10 }, 0, 120, bounds),
  );
  assert.throws(() =>
    createVolleyFlightPaths({ x: 10, y: 10 }, 0, 120, {
      ...bounds,
      minX: 2000,
    }),
  );
  assert.throws(() =>
    createVolleyFlightPaths({ x: 10, y: 10 }, 0, 120, {
      ...bounds,
      minY: 2000,
    }),
  );
});
