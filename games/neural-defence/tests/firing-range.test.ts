import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createMatch, encodeState } from "../src/engine/index.js";
import { renderBoard } from "../src/render/board.js";

test("selection reveals terrain-aware Siege firing cells and clears stale range", () => {
  const world = createMatch(
    {
      schemaVersion: 1,
      id: "range",
      width: 8,
      height: 4,
      layout: "odd-r",
      cells: Array.from({ length: 32 }, () => ({ terrain: "open" as const })),
      spawns: [{ slot: 0, cellIndex: 3 }],
    },
    {},
    [{ id: "a", slot: 0 }],
  );
  world.structures[0]!.kind = "siege";
  world.structures[0]!.hp = 80;
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  const before = encodeState(world);
  renderBoard(svg, world, 3, false, false, 1000);
  assert.ok(svg.querySelector('[data-range-cell="6"]'));
  assert.equal(svg.querySelector('[data-range-cell="4"]'), null);
  assert.equal(svg.querySelector('[data-range-cell="5"]'), null);
  assert.equal(svg.querySelector('[data-range-cell="3"]'), null);
  assert.equal(
    svg.querySelector(".firing-range-layer")!.getAttribute("pointer-events"),
    "none",
  );
  assert.equal(encodeState(world), before);
  world.map.cells[4] = { terrain: "blocked" };
  renderBoard(svg, world, 3, false, true, 1100);
  assert.ok(
    svg.querySelector('[data-range-cell="5"]'),
    "terrain detour moves cell into Siege reach",
  );
  assert.equal(svg.querySelector('[data-range-cell="4"]'), null);
  renderBoard(svg, world, null, false, false, 1200);
  assert.equal(svg.querySelectorAll(".firing-range-cell").length, 0);
  renderBoard(svg, world, 7, false, false, 1200);
  assert.equal(svg.querySelectorAll(".firing-range-cell").length, 0);
});
