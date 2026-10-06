import test from "node:test";
import assert from "node:assert/strict";
import type { MapDefinition } from "../src/engine/types.js";
import { rockRelief } from "../src/render/terrain-relief.js";
import { hexVertices } from "../src/render/projection.js";

const map: MapDefinition = {
  schemaVersion: 1,
  id: "relief",
  width: 4,
  height: 3,
  layout: "odd-r",
  cells: Array.from({ length: 12 }, (_, cell) =>
    cell === 5 || cell === 6 ? { terrain: "blocked" } : { terrain: "open" },
  ),
  spawns: [
    { slot: 0, cellIndex: 0 },
    { slot: 1, cellIndex: 11 },
  ],
};

test("adjoining stone blockers share a ledge without an internal cliff wall", () => {
  const relief = rockRelief(map);
  assert.equal(relief.length, 2);
  // Two isolated outcrops have twelve front-wall segments. Joining them
  // removes the two segments on their common east/west boundary.
  assert.equal(
    relief.reduce((count, rock) => count + rock.edges.length, 0),
    10,
  );
  assert.equal(relief[0]!.top.length, 11);
  assert.equal(relief[1]!.top.length, 11);
  assert.deepEqual(rockRelief(map), relief);
  for (const rock of relief) {
    const polygon = hexVertices(map.width, rock.cell);
    for (const point of rock.top) {
      const crosses = polygon.map((a, i) => {
        const b = polygon[(i + 1) % polygon.length]!;
        return (
          (b[0]! - a[0]!) * (point[1] - a[1]!) -
          (b[1]! - a[1]!) * (point[0] - a[0]!)
        );
      });
      assert.ok(
        crosses.every((c) => c >= -0.01) || crosses.every((c) => c <= 0.01),
        "ground footprint stays within its blocked hex",
      );
    }
  }
});

test("water and void blockers never receive stone relief", () => {
  const variants: MapDefinition = {
    ...map,
    cells: map.cells.map((cell, i) =>
      i === 5
        ? { terrain: "blocked", variant: "blocker-water" }
        : i === 6
          ? { terrain: "blocked", variant: "blocker-void" }
          : cell,
    ),
  };
  assert.deepEqual(rockRelief(variants), []);
});
