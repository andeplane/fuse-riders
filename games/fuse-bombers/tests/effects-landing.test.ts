import test from "node:test";
import assert from "node:assert/strict";
import { createGrid, fillRect, solidAt } from "../src/engine/grid.js";
import { CHUNK_FOOT, restingPlace } from "../src/render/effects/landing.js";

// Debris stops where its path met the rock, not where the frame ended (a fast chunk ends it well inside).

function floorAt(y: number) {
  const grid = createGrid(400, 400, 4);
  fillRect(grid, 0, y, 400, 400, "rock");
  return grid;
}

test("a fast chunk rests on the floor it came through, not deep inside it", () => {
  const grid = floorAt(200);
  // 50 px in one frame: its foot ends 33 px inside the rock.
  const rest = restingPlace(grid, { x: 100, y: 160 }, { x: 100, y: 230 });
  assert.ok(solidAt(grid, 100, 230 + CHUNK_FOOT));
  assert.equal(rest.x, 100);
  assert.ok(Math.abs(rest.y + CHUNK_FOOT - 200) < 1e-9, `rests at ${rest.y}`);
  assert.ok(!solidAt(grid, rest.x, rest.y - 1));
});

test("a slanting path stops at the point it entered the rock", () => {
  const grid = floorAt(200);
  const from = { x: 100, y: 150 };
  const to = { x: 160, y: 260 };
  const rest = restingPlace(grid, from, to);
  // The foot is on the floor's surface, on the line from `from` to `to`.
  assert.ok(Math.abs(rest.y + CHUNK_FOOT - 200) < 1e-9);
  const along = (rest.y - from.y) / (to.y - from.y);
  assert.ok(Math.abs(rest.x - (from.x + along * (to.x - from.x))) < 1e-9);
  assert.ok(rest.x > from.x && rest.x < to.x);
});

test("a chunk that hits the side of a wall stops against the wall", () => {
  const grid = createGrid(400, 400, 4);
  fillRect(grid, 200, 0, 400, 400, "rock");
  const rest = restingPlace(grid, { x: 150, y: 100 }, { x: 260, y: 130 });
  assert.ok(Math.abs(rest.x - 200) < 1e-9, `rests at ${rest.x}`);
  assert.ok(rest.y > 100 && rest.y < 130);
});

test("a chunk already at rest stays put, and one that never reached rock is left where it is", () => {
  const grid = floorAt(200);
  const resting = { x: 100, y: 200 - CHUNK_FOOT };
  assert.deepEqual(restingPlace(grid, resting, resting), resting);
  const flying = { x: 100, y: 120 };
  assert.deepEqual(restingPlace(grid, { x: 100, y: 100 }, flying), flying);
});
