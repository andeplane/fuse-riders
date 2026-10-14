import test from "node:test";
import assert from "node:assert/strict";
import {
  dendriteGeometry,
  neuronForm,
  neuronSeed,
  somaPath,
} from "../src/render/neuron-form.js";
import {
  contourPath,
  creepContours,
  creepPatternMarkup,
  veinMarkup,
} from "../src/render/creep.js";
import { GROUND } from "../src/render/projection.js";
import { organicBurst } from "../src/render/organic-burst.js";
import { renderBoard } from "../src/render/board.js";
import { createMatch, encodeState, loadMap } from "../src/engine/index.js";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";

test("neuron forms are stable per seed and differ between cells", () => {
  const a = neuronForm(neuronSeed(14));
  assert.deepEqual(neuronForm(neuronSeed(14)), a);
  const shapes = new Set(
    Array.from({ length: 12 }, (_, cell) =>
      JSON.stringify(neuronForm(neuronSeed(cell))),
    ),
  );
  assert.equal(shapes.size, 12);
  const counts = new Set(
    Array.from(
      { length: 40 },
      (_, cell) => neuronForm(neuronSeed(cell)).dendrites.length,
    ),
  );
  assert.ok(counts.size >= 3, "dendrite counts vary across neurons");
});

test("a neuron grows one dendrite toward each connected neighbour without reshaping the rest", () => {
  const seed = neuronSeed(40);
  const alone = neuronForm(seed);
  const east = { cell: 41, dx: 60, dy: 0 };
  const linked = neuronForm(seed, [east]);
  const toward = linked.dendrites.filter((d) => d.toward !== null);
  assert.deepEqual(
    toward.map((d) => d.key),
    ["n41"],
  );
  assert.ok(Math.abs(toward[0]!.angle) < 1e-9, "points at the neighbour");
  assert.ok(toward[0]!.length > 25, "reaches toward the neighbour");
  assert.equal(linked.radius, alone.radius);
  // Free dendrites keep their shape; only ones crowding the new link are hidden.
  const before = new Map(alone.dendrites.map((d) => [d.key, d]));
  for (const d of linked.dendrites.filter((d) => d.toward === null))
    assert.deepEqual(d, before.get(d.key));
  const south = { cell: 64, dx: 30, dy: 1.5 * 35 * GROUND.depth };
  const both = neuronForm(seed, [south, east]);
  assert.deepEqual(
    both.dendrites.filter((d) => d.toward !== null).map((d) => d.key),
    ["n41", "n64"],
  );
  assert.deepEqual(
    both.dendrites.find((d) => d.key === "n41"),
    toward[0],
    "adding a neighbour leaves existing neighbour dendrites unchanged",
  );
});

test("dendrite geometry starts at the soma and ends at its tips", () => {
  const form = neuronForm(neuronSeed(3), [{ cell: 4, dx: 60, dy: 0 }]);
  const d = form.dendrites.find((d) => d.key === "n4")!;
  const g = dendriteGeometry(form, d, 100, 50);
  assert.ok(g.root[0] > 100, "root sits on the soma rim facing east");
  const tip = g.spine[g.spine.length - 1]!;
  assert.ok(Math.abs(tip[0] - (g.root[0] + d.length)) < 0.5);
  assert.equal(g.tips.length, 1 + d.branches.length);
  assert.match(g.outlines[0]!, /^M[\d.\s L-]+Z$/);
  assert.match(somaPath(form, 100, 50), /^M.*Z$/);
});

test("creep blobs merge when close and stay apart when far", () => {
  const board = { width: 600, height: 300, roughness: 0 };
  const near = creepContours(
    [
      { x: 150, y: 150, radius: 50 },
      { x: 220, y: 150, radius: 50 },
    ],
    board,
  );
  assert.equal(near.length, 1);
  const far = creepContours(
    [
      { x: 100, y: 150, radius: 40 },
      { x: 450, y: 150, radius: 40 },
    ],
    board,
  );
  assert.equal(far.length, 2);
  assert.deepEqual(creepContours([], board), []);
  assert.deepEqual(creepContours([{ x: 1, y: 1, radius: 0 }], board), []);
});

test("a lone creep blob has its visible radius, squashed onto the ground", () => {
  const [loop] = creepContours([{ x: 300, y: 150, radius: 60 }], {
    width: 600,
    height: 300,
    step: 3,
    roughness: 0,
  });
  const xs = loop!.map((p) => p[0]),
    ys = loop!.map((p) => p[1]);
  assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs)) / 2 - 60) < 3);
  assert.ok(
    Math.abs((Math.max(...ys) - Math.min(...ys)) / 2 - 60 * GROUND.depth) < 3,
  );
});

test("creep edge noise is deterministic, never detaches and blobs at the board edge still close", () => {
  const blobs = [{ x: 0, y: 0, radius: 70 }];
  const options = { width: 400, height: 300, seed: 7 };
  const a = contourPath(creepContours(blobs, options));
  assert.equal(a, contourPath(creepContours(blobs, options)));
  assert.notEqual(
    a,
    contourPath(creepContours(blobs, { ...options, seed: 8 })),
  );
  assert.equal(creepContours(blobs, options).length, 1);
  assert.equal((a.match(/Z/g) ?? []).length, 1);
});

test("tissue pattern and veins are team-specific markup", () => {
  assert.notEqual(creepPatternMarkup(0), creepPatternMarkup(1));
  assert.match(creepPatternMarkup(2), /<pattern id="nd-creep-2"/);
  const veins = veinMarkup(100, 100, 50, 3);
  assert.equal(veins, veinMarkup(100, 100, 50, 3));
  assert.ok((veins.match(/class="creep-vein"/g) ?? []).length >= 3);
});

test("a destroyed neuron bursts into droplets and a fading splat, then cleans up", () => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  const map = loadMap(
    JSON.parse(
      readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
    ),
  );
  const world = createMatch(map, {}, [{ id: "solo", slot: 0 }]);
  const neuron = {
    id: world.nextEntityId++,
    cell: world.structures[0]!.cell + 1,
    ownerId: "solo",
    kind: "neuron" as const,
    hp: 60,
    connected: true,
  };
  world.structures.push(neuron);
  renderBoard(svg, world, null, false, false, 0);
  world.structures = world.structures.filter((s) => s !== neuron);
  world.tick++;
  world.outcomes = [
    {
      tick: world.tick,
      playerId: "solo",
      type: "destroyed",
      cell: neuron.cell,
    },
  ];
  const before = encodeState(world);
  const frame = renderBoard(svg, world, null, false, false, 50);
  const burst = svg.querySelector(".organic-burst")!;
  assert.ok(burst, "the neuron bursts");
  assert.ok(
    svg.querySelector(".organic-splat"),
    "and leaves a splat on the ground",
  );
  const droplets = [...burst.querySelectorAll(".organic-droplet")];
  assert.ok(droplets.length >= 8);
  const start = droplets.map((d) => d.getAttribute("cy"));
  frame.animate(500);
  assert.notDeepEqual(
    droplets.map((d) => d.getAttribute("cy")),
    start,
    "droplets fly",
  );
  assert.equal(encodeState(world), before, "presentation only");
  frame.animate(5000);
  assert.equal(svg.querySelector(".organic-burst"), null);
  assert.equal(svg.querySelector(".organic-splat"), null);
});

test("a burst is repeatable at a given age", () => {
  const { document } = parseHTML("<html></html>");
  const burst = organicBurst(document, { x: 100, y: 80 }, 1, 7, 0);
  burst.animate(0.3);
  const at = burst.element.outerHTML + burst.ground.outerHTML;
  burst.animate(0.8);
  burst.animate(0.3);
  assert.equal(burst.element.outerHTML + burst.ground.outerHTML, at);
});
