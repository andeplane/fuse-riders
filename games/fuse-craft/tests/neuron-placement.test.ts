import test from "node:test";
import assert from "node:assert/strict";
import { planNeuronPlacement } from "../src/app/neuron-placement.js";
import {
  createMatch,
  decodeState,
  encodeState,
  hashState,
  step,
  RULES,
  type Command,
  type MapDefinition,
  type World,
} from "../src/engine/index.ts";
import { planSupport } from "../src/engine/catalog.js";
import { bundledMap, DEFAULT_MAP } from "../src/online/maps.js";

function world() {
  return createMatch(bundledMap(DEFAULT_MAP) as MapDefinition, {}, [
    { id: "a", slot: 0 },
  ]);
}
const order = (cell: number, sequence: number): Command => ({
  playerId: "a",
  sequence,
  action: { type: "queueConstruction", kind: "neuron", cell },
});
function queue(w: World, target: number) {
  const plan = planNeuronPlacement(w, w.players[0]!, target);
  assert.ok(plan.cells.length, plan.hint);
  return step(
    w,
    plan.cells.map((cell, i) => order(cell, w.tick * 32 + i + 1)),
  );
}

test("the screenshot's first site queues the hidden missing neighbour first", () => {
  const w = world();
  assert.equal(w.structures[0]!.cell, 90);
  assert.deepEqual(planNeuronPlacement(w, w.players[0]!, 92).cells, [91, 92]);
});

test("the full screenshot queue bridges gaps and grows through ordinary replayable orders", () => {
  let w = world();
  w.players[0]!.biomass = 500_000;
  for (const target of [92, 122, 151, 152, 181, 183, 147]) w = queue(w, target);
  assert.ok(
    w.players[0]!.queue.some((j) => j.cell === 153),
    "routes around deposit182",
  );
  assert.ok(!w.players[0]!.queue.some((j) => j.cell === 182));
  assert.ok(
    [...planSupport(w, w.players[0]!).values()].every(
      (s) => s !== "unsupported",
    ),
  );
  let replay = decodeState(encodeState(w));
  for (let t = 0; t < 12 * (RULES.constructionTicks + 2); t++) {
    w = step(w);
    replay = step(replay);
  }
  assert.equal(hashState(replay), hashState(w));
  assert.equal(w.players[0]!.queue.length, 0);
  for (const cell of [92, 122, 151, 152, 181, 183, 147])
    assert.ok(w.structures.some((s) => s.cell === cell && s.connected));
});

test("reuses a supported queued line rather than adding duplicate bridges", () => {
  const w = queue(world(), 92);
  assert.deepEqual(planNeuronPlacement(w, w.players[0]!, 122).cells, [122]);
  assert.deepEqual(planNeuronPlacement(w, w.players[0]!, 92).cells, []);
});

test("can bridge an older unsupported queued neuron", () => {
  const w = step(world(), [order(92, 1)]);
  assert.deepEqual(planNeuronPlacement(w, w.players[0]!, 122).cells, [91, 122]);
});

test("rejects the whole path when queue capacity cannot fit it", () => {
  const w = world();
  w.players[0]!.queue = Array.from(
    { length: RULES.queueLimit - 1 },
    (_, i) => ({
      cell: 400 + i,
      kind: "neuron",
      paid: false,
      progress: 0,
      duration: 0,
      hp: 60,
    }),
  );
  const before = encodeState(w);
  const plan = planNeuronPlacement(w, w.players[0]!, 92);
  assert.deepEqual(plan.cells, []);
  assert.match(plan.hint, /needs 2 queue spaces; only 1 free/);
  assert.equal(encodeState(w), before, "planning never mutates state");
});

test("an unreachable hex does not gain a permanently stalled plan", () => {
  const w = world();
  for (let cell = 0; cell < w.map.cells.length; cell++)
    if (cell !== 90 && cell !== 92) w.map.cells[cell] = { terrain: "blocked" };
  const plan = planNeuronPlacement(w, w.players[0]!, 92);
  assert.deepEqual(plan.cells, []);
  assert.match(plan.hint, /No open path/);
});

test("routes around enemy buildings and paid construction sites", () => {
  const w = world();
  w.structures.push({
    id: w.nextEntityId++,
    ownerId: "b",
    kind: "neuron",
    cell: 91,
    hp: 60,
    connected: false,
  });
  assert.ok(!planNeuronPlacement(w, w.players[0]!, 92).cells.includes(91));
  const other = createMatch(w.map, {}, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  other.players[1]!.queue.push({
    cell: 91,
    kind: "neuron",
    paid: true,
    progress: 1,
    duration: RULES.constructionTicks,
    hp: 60,
  });
  const plan = planNeuronPlacement(other, other.players[0]!, 92);
  assert.ok(plan.cells.length > 0);
  assert.ok(!plan.cells.includes(91));
});

test("a waiting neuron claimed by a rival cannot anchor a route", () => {
  const map: MapDefinition = {
    schemaVersion: 1,
    id: "contested",
    width: 3,
    height: 2,
    layout: "odd-r",
    cells: Array.from({ length: 6 }, () => ({ terrain: "open" })),
    spawns: [
      { slot: 0, cellIndex: 0 },
      { slot: 1, cellIndex: 2 },
    ],
  };
  let w = createMatch(map, {}, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  w.players[0]!.biomass = 0;
  w.players[1]!.biomass = 100_000;
  w = step(w, [order(1, 1), { ...order(1, 1), playerId: "b" }]);
  assert.equal(w.players[0]!.queue[0]!.paid, false);
  assert.equal(w.players[1]!.queue[0]!.paid, true);
  const plan = planNeuronPlacement(w, w.players[0]!, 4);
  assert.deepEqual(plan.cells, [3, 4]);
  w.players[0]!.biomass = 100_000;
  w = step(
    w,
    plan.cells.map((cell, i) => order(cell, i + 2)),
  );
  for (let t = 0; t < 2 * (RULES.constructionTicks + 2); t++) w = step(w);
  assert.ok(
    w.structures.some((s) => s.ownerId === "a" && s.cell === 4 && s.connected),
  );
});
