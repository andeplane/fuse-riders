import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createMatch, encodeState } from "../src/engine/index.js";
import { renderBoard } from "../src/render/board.js";

test("damaged buildings show stable raised plumes, respect reduced motion and clear on restoration", () => {
  const world = createMatch(
    {
      schemaVersion: 1,
      id: "damage",
      width: 4,
      height: 4,
      layout: "odd-r",
      cells: Array.from({ length: 16 }, () => ({ terrain: "open" })),
      spawns: [{ slot: 0, cellIndex: 0 }],
    },
    {},
    [{ id: "a", slot: 0 }],
  );
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  renderBoard(svg, world, 0, false, false, 1000);
  assert.equal(svg.querySelector(".damage-plume"), null);
  world.structures[0]!.hp = 60;
  const before = encodeState(world);
  const frame = renderBoard(svg, world, 0, false, false, 1000);
  const plume = svg.querySelector(".damage-plume")!;
  assert.equal(plume.getAttribute("pointer-events"), "none");
  assert.ok(plume.closest(".structure-brain"));
  assert.equal(plume.querySelectorAll(".damage-smoke").length, 4);
  frame.animate(1300);
  const phase = plume.outerHTML;
  frame.animate(1800);
  assert.notEqual(plume.outerHTML, phase);
  frame.animate(1300);
  assert.equal(plume.outerHTML, phase);
  assert.equal(encodeState(world), before);
  const still = renderBoard(svg, world, 0, false, true, 1300);
  const reduced = svg.querySelector(".damage-plume")!.outerHTML;
  still.animate(9000);
  assert.equal(svg.querySelector(".damage-plume")!.outerHTML, reduced);
  assert.equal(/NaN|Infinity/.test(reduced), false);
  world.structures[0]!.hp = 240;
  renderBoard(svg, world, 0, false, false, 9000);
  assert.equal(svg.querySelector(".damage-plume"), null);
});
