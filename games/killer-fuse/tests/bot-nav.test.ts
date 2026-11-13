import test from "node:test";
import assert from "node:assert/strict";
import { MAP_IDS, WIDTH, arenaOf, S } from "../src/engine/index.js";
import {
  CELL,
  COLS,
  ROWS,
  UNREACHABLE,
  cellCentre,
  cellOf,
  flyNav,
  flyToward,
  workerNav,
  type Edge,
} from "../src/engine/nav.js";

/** The platform that is the mirror image of `index`. */
function twin(mapId: 1 | 2 | 3, index: number): number {
  const solids = arenaOf(mapId).solids;
  const solid = solids[index];
  assert.ok(solid);
  const other = solids.findIndex(
    (s) =>
      s.y === solid.y && s.w === solid.w && s.x === WIDTH - solid.x - solid.w,
  );
  assert.ok(other >= 0, `platform ${index} has no mirror image`);
  return other;
}

const key = (edge: Edge): string =>
  [
    edge.from,
    edge.to,
    edge.x,
    edge.jump,
    edge.first,
    edge.second,
    edge.cost,
  ].join(",");

for (const mapId of MAP_IDS)
  for (const speed of [false, true])
    test(`map ${mapId}${speed ? " at speed" : ""}: the Worker graph is its own mirror image, so neither team has the better routes`, () => {
      const nav = workerNav(mapId, speed);
      assert.ok(nav.edges.length > 20);
      const keys = new Set(nav.edges.map(key));
      assert.equal(keys.size, nav.edges.length, "no move is listed twice");
      for (const edge of nav.edges) {
        const mirror: Edge = {
          ...edge,
          from: twin(mapId, edge.from),
          to: twin(mapId, edge.to),
          x: WIDTH - edge.x,
          first: edge.first === 0 ? 0 : edge.first < 0 ? 1 : -1,
          second: edge.second === 0 ? 0 : edge.second < 0 ? 1 : -1,
        };
        assert.ok(keys.has(key(mirror)), `no mirror of move ${key(edge)}`);
      }
      const count = arenaOf(mapId).solids.length;
      for (let from = 0; from < count; from += 1)
        for (let to = 0; to < count; to += 1) {
          const there = nav.dist[from]?.[to];
          assert.equal(
            there,
            nav.dist[twin(mapId, from)]?.[twin(mapId, to)],
            `${from} to ${to}`,
          );
          assert.ok(
            there !== undefined && there < UNREACHABLE,
            `${from} to ${to}`,
          );
        }
    });

for (const mapId of MAP_IDS)
  test(`map ${mapId}: a flyer's way to a mirrored target is the mirror image of the way`, () => {
    const nav = flyNav(mapId);
    const flipCell = (cell: number): number =>
      cell - (cell % COLS) + (COLS - 1 - (cell % COLS));
    for (let cell = 0; cell < COLS * ROWS; cell += 1) {
      assert.equal(nav.free[cell], nav.free[flipCell(cell)]);
      assert.equal(
        nav.nearest[flipCell(cell)],
        flipCell(nav.nearest[cell] ?? -1),
      );
    }
    let checked = 0;
    // Points a few pixels inside their cells, skipping any on a cell border, where a point and its mirror image fall in cells that are not mirror images.
    for (let x = 5 * S; x < WIDTH; x += 37 * S)
      for (let y = 9 * S; y < 250 * S; y += 31 * S)
        for (let tx = 7 * S; tx < WIDTH; tx += 53 * S)
          for (let ty = 11 * S; ty < 250 * S; ty += 43 * S) {
            if (x % CELL === 0 || tx % CELL === 0) continue;
            checked += 1;
            const way = flyToward(mapId, x, y, tx, ty);
            const mirror = flyToward(mapId, WIDTH - x, y, WIDTH - tx, ty);
            assert.deepEqual(
              mirror,
              { x: WIDTH - way.x, y: way.y },
              `from ${x / S}, ${y / S} to ${tx / S}, ${ty / S}`,
            );
          }
    assert.ok(checked > 3000);
    assert.equal(cellOf(cellCentre(17).x, cellCentre(17).y), 17);
    assert.equal(CELL % S, 0);
  });
