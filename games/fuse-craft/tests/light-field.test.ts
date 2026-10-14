import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import {
  EMBERS,
  LIGHT_STRIDE,
  LightField,
  rgb,
  SPARKS,
  type LightRenderer,
  type LightTransform,
} from "../src/render/light-field.js";
import { renderBoard } from "../src/render/board.js";
import { createMatch, encodeState, loadMap } from "../src/engine/index.js";

test("lights are packed as eight floats and respect the budget", () => {
  const field = new LightField(2);
  field.begin();
  field.add(10, 20, 5, [1, 0.5, 0], 0.8, 3);
  field.add(1, 1, 1, [1, 1, 1], 0.001);
  field.add(2, 2, 2, [1, 1, 1], 1);
  field.add(3, 3, 3, [1, 1, 1], 1);
  assert.equal(field.size, 2, "near-invisible and over-budget lights drop");
  assert.deepEqual(
    [...field.instances.subarray(0, LIGHT_STRIDE)].map((v) =>
      Number(v.toFixed(2)),
    ),
    [10, 20, 5, 1, 0.5, 0, 0.8, 3],
  );
  field.begin();
  assert.equal(field.size, 0);
});

test("a burst waits for its impact time, flies, lands and expires", () => {
  const field = new LightField();
  field.burst(100, 100, 1000, 7, SPARKS(rgb("#ff8800")));
  field.step(0, false);
  field.begin();
  field.step(500, false);
  assert.equal(field.size, 0, "nothing shows before the hit arrives");
  field.begin();
  field.step(1016, false);
  const first = [...field.instances.subarray(0, field.size * LIGHT_STRIDE)];
  assert.ok(field.size >= 10);
  field.begin();
  field.step(1100, false);
  const later = [...field.instances.subarray(0, field.size * LIGHT_STRIDE)];
  assert.notDeepEqual(later, first, "sparks move");
  for (let t = 1116; t < 3000; t += 16) {
    field.begin();
    field.step(t, false);
  }
  assert.equal(field.live, 0, "every spark expires");
});

test("the same seed makes the same burst", () => {
  const run = () => {
    const field = new LightField();
    field.step(0, false);
    field.burst(0, 0, 0, 42, EMBERS);
    field.begin();
    field.step(16, false);
    return [...field.instances.subarray(0, field.size * LIGHT_STRIDE)];
  };
  assert.deepEqual(run(), run());
});

test("reduced motion clears transient light", () => {
  const field = new LightField();
  field.burst(0, 0, 0, 1, EMBERS);
  field.flash(0, 0, 0, 50, [1, 1, 1], 1, 400);
  field.begin();
  field.step(10, true);
  assert.equal(field.live, 0);
  assert.equal(field.size, 0);
});

test("the board lights its network and bursts on combat without touching state", () => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  // linkedom has no layout; the renderer only needs a transform.
  svg.getScreenCTM = () =>
    ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) as DOMMatrix;
  const draws: { count: number; transform: LightTransform }[] = [];
  const light: LightRenderer = {
    draw: (_instances, count, transform) => draws.push({ count, transform }),
  };
  const map = loadMap(
    JSON.parse(
      readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
    ),
  );
  const world = createMatch(map, {}, [{ id: "solo", slot: 0 }]);
  const brain = world.structures[0]!;
  const neuron = {
    id: world.nextEntityId++,
    cell: brain.cell + 1,
    ownerId: "solo",
    kind: "neuron" as const,
    hp: 60,
    connected: true,
  };
  world.structures.push(neuron);
  const quiet = renderBoard(
    svg,
    world,
    null,
    false,
    false,
    0,
    {},
    undefined,
    light,
  );
  const calm = draws.at(-1)!.count;
  assert.ok(calm > 3, "brain, neuron, deposits and the axon signal glow");
  world.tick++;
  world.outcomes = [
    {
      tick: world.tick,
      playerId: "solo",
      type: "damage",
      cell: neuron.cell,
      fromCell: brain.cell,
      amount: 5,
    },
  ];
  const before = encodeState(world);
  const frame = renderBoard(
    svg,
    world,
    null,
    false,
    false,
    100,
    {},
    undefined,
    light,
  );
  // A pulse shot lands 55 ms after the tick; sparks live a few hundred ms.
  frame.animate(180);
  frame.animate(196);
  assert.ok(draws.at(-1)!.count > calm + 8, "the hit throws sparks");
  assert.equal(encodeState(world), before);
  quiet.animate(0);
  const reduced = renderBoard(
    svg,
    world,
    null,
    false,
    true,
    2000,
    {},
    undefined,
    light,
  );
  reduced.animate(2100);
  assert.ok(draws.at(-1)!.count > 0, "steady glows remain with reduced motion");
});
