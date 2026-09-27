import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createMatch, step, encodeState } from "../src/engine/index.js";
import { renderBoard } from "../src/render/board.js";

function fixture(upgrade = false) {
  let world = createMatch(
    {
      schemaVersion: 1,
      id: "construction",
      width: 8,
      height: 4,
      layout: "odd-r",
      cells: Array.from({ length: 32 }, () => ({ terrain: "open" })),
      spawns: [{ slot: 0, cellIndex: 0 }],
    },
    {},
    [{ id: "a", slot: 0 }],
  );
  world.players[0]!.research = ["growth"];
  world.players[0]!.biomass = 100_000;
  for (const cell of [1, 2])
    world.structures.push({
      id: world.nextEntityId++,
      ownerId: "a",
      kind: "neuron",
      cell,
      hp: 60,
      connected: true,
    });
  world = step(world, [
    {
      playerId: "a",
      sequence: 1,
      action: {
        type: "queueConstruction",
        kind: "tower",
        cell: upgrade ? 2 : 3,
      },
    },
  ]);
  assert.equal(
    world.outcomes.some((o) => o.type === "rejected"),
    false,
  );
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  return { world, svg };
}

test("construction rises with real progress, shares depth ordering and never changes authority", () => {
  let { world, svg } = fixture();
  renderBoard(svg, world, 3, false, false, 1000);
  assert.equal(
    svg.querySelector(".site-assembly")!.getAttribute("display"),
    "none",
  );
  const zero = svg.querySelector(".construction-body clipPath rect")!;
  assert.equal(Number(zero.getAttribute("height")), 0);
  while (world.players[0]!.queue[0]!.progress < 60) world = step(world);
  const before = encodeState(world);
  const frame = renderBoard(svg, world, 3, false, false, 1000);
  const body = svg.querySelector(".construction-body")!;
  assert.equal(body.parentElement!.getAttribute("class"), "structure-layer");
  assert.equal(body.getAttribute("pointer-events"), "none");
  assert.equal(svg.querySelector(".queue-layer .building-art"), null);
  const clip = body.querySelector("clipPath rect")!;
  const q = world.players[0]!.queue[0]!;
  assert.equal(
    Number(clip.getAttribute("height")),
    (84 * q.progress) / q.duration,
  );
  const depth = [...svg.querySelector(".structure-layer")!.children].map((n) =>
    Number(n.getAttribute("data-cell")),
  );
  assert.deepEqual(
    depth,
    [...depth].sort((a, b) => a - b),
  );
  frame.animate(1200);
  const phase = body.outerHTML;
  frame.animate(1500);
  assert.notEqual(body.outerHTML, phase);
  frame.animate(1200);
  assert.equal(body.outerHTML, phase);
  assert.equal(encodeState(world), before);
  assert.equal(body.querySelectorAll(".site-spark").length, 6);
  assert.equal(body.querySelectorAll(".site-tool").length, 3);
  assert.equal(/NaN|Infinity/.test(body.outerHTML), false);
  const still = renderBoard(svg, world, 3, false, true, 1200);
  assert.equal(
    svg.querySelector(".site-assembly")!.getAttribute("display"),
    "none",
  );
  const reduced = svg.querySelector(".construction-body")!.outerHTML;
  still.animate(9000);
  assert.equal(svg.querySelector(".construction-body")!.outerHTML, reduced);
  assert.equal(encodeState(world), before);
});

test("upgrade keeps its original structure and clears fabrication on cancel, completion and rollback", () => {
  let { world, svg } = fixture(true);
  const initial = world;
  while (world.players[0]!.queue[0]!.progress < 20) world = step(world);
  renderBoard(svg, world, 2, false, false, 1000);
  assert.ok(svg.querySelector('.structure[data-cell="2"]'));
  assert.ok(svg.querySelector('.construction-body[data-cell="2"]'));
  const cancelled = step(world, [
    {
      playerId: "a",
      sequence: 2,
      action: { type: "cancelConstruction", cell: 2 },
    },
  ]);
  renderBoard(svg, cancelled, 2, false, false, 1050);
  assert.equal(svg.querySelector(".construction-body"), null);
  assert.ok(svg.querySelector('.structure-neuron[data-cell="2"]'));
  while (world.players[0]!.queue.length) world = step(world);
  renderBoard(svg, world, 2, false, false, 2000);
  assert.equal(svg.querySelector(".construction-body"), null);
  assert.ok(svg.querySelector('.structure-tower[data-cell="2"]'));
  renderBoard(svg, initial, 2, false, false, 1000);
  assert.equal(svg.querySelectorAll(".construction-body").length, 1);
  assert.equal(
    Number(
      svg
        .querySelector(".construction-body clipPath rect")!
        .getAttribute("height"),
    ),
    0,
  );
});
