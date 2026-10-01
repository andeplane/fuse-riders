import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  decodeState,
  encodeState,
  neighbors,
  step,
  RULES,
  type Command,
  type MapDefinition,
  type World,
} from "../src/engine/index.ts";
import { connectedFrontier, planSupport } from "../src/engine/catalog.ts";
import { DEFAULT_MAP, bundledMap } from "../src/online/maps.ts";

const command = (
  sequence: number,
  action: Command["action"],
  playerId = "a",
): Command => ({ sequence, action, playerId });
const queueNeuron = (sequence: number, cell: number, playerId = "a") =>
  command(
    sequence,
    { type: "queueConstruction", kind: "neuron", cell },
    playerId,
  );
const run = (w: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) w = step(w);
  return w;
};
const brainOf = (w: World, id = "a") =>
  w.structures.find((s) => s.ownerId === id && s.kind === "brain")!.cell;

/** The shortest walk over open hexes from one cell to another. */
function route(map: World["map"], from: number, to: number): number[] {
  const previous = new Map<number, number>([[from, -1]]);
  const frontier = [from];
  for (const cell of frontier) {
    if (cell === to) break;
    for (const n of neighbors(map, cell))
      if (!previous.has(n) && (map.cells[n]!.terrain === "open" || n === to)) {
        previous.set(n, cell);
        frontier.push(n);
      }
  }
  const path: number[] = [];
  for (let c = to; c !== -1; c = previous.get(c)!) path.unshift(c);
  return path;
}

function tiny(): MapDefinition {
  return {
    schemaVersion: 1,
    id: "tiny",
    width: 8,
    height: 8,
    layout: "odd-r",
    cells: Array.from({ length: 64 }, () => ({ terrain: "open" as const })),
    spawns: [
      { slot: 0, cellIndex: 9 },
      { slot: 1, cellIndex: 54 },
    ],
  };
}

test("a Shift-queued line of sixteen neurons grows one after another from the brain", () => {
  let w = createMatch(bundledMap(DEFAULT_MAP) as MapDefinition, {}, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  const line = route(w.map, brainOf(w), brainOf(w, "b")).slice(1, 17);
  assert.equal(line.length, 16);
  w.players[0]!.biomass = 16 * RULES.neuronCost;
  w = step(
    w,
    line.map((cell, i) => queueNeuron(i + 1, cell)),
  );
  const support = planSupport(w, w.players[0]!);
  assert.equal(support.get(line[1]!), "chained");
  assert.equal(support.get(line[15]!), "chained");
  const built: number[] = [];
  for (let t = 0; t < 16 * (RULES.constructionTicks + 20); t++) {
    w = step(w);
    for (const o of w.outcomes)
      if (o.playerId === "a" && o.type === "constructed") built.push(o.cell!);
  }
  assert.deepEqual(built, line, "each neuron grows once its predecessor is up");
  assert.equal(w.players[0]!.queue.length, 0);
});

test("a line started one hex away from the network is reported unsupported", () => {
  const w = createMatch(tiny(), {}, [{ id: "a", slot: 0 }]);
  const brain = brainOf(w);
  const ring1 = neighbors(w.map, brain);
  const ring2 = neighbors(w.map, ring1[0]!).filter(
    (c) => c !== brain && !ring1.includes(c),
  );
  const player = w.players[0]!;
  assert.equal(
    planSupport(w, player, { cell: ring1[0]!, kind: "neuron" }).get(ring1[0]!),
    "connected",
  );
  assert.equal(
    planSupport(w, player, { cell: ring2[0]!, kind: "neuron" }).get(ring2[0]!),
    "unsupported",
  );
  assert.deepEqual(
    connectedFrontier(w, player, "neuron"),
    [...ring1].sort((a, b) => a - b),
  );
});

test("a paid neuron cut off from the network is refunded and frees its sprout slot", () => {
  let w = createMatch(tiny(), {}, [{ id: "a", slot: 0 }]);
  const brain = brainOf(w);
  const [first, other] = neighbors(w.map, brain);
  const outer = neighbors(w.map, first!).find(
    (c) => c !== brain && !neighbors(w.map, brain).includes(c),
  )!;
  w.players[0]!.biomass = 10 * RULES.neuronCost;
  w = step(w, [queueNeuron(1, first!), queueNeuron(2, outer)]);
  w = run(w, RULES.constructionTicks + 5);
  assert.ok(w.structures.some((s) => s.cell === first));
  const growing = w.players[0]!.queue.find((j) => j.cell === outer)!;
  assert.equal(growing.paid, true, "the outer neuron sprouts from the first");
  // The anchor dies mid-growth.
  w.structures = w.structures.filter((s) => s.cell !== first);
  const before = w.players[0]!.biomass;
  w = step(w);
  const stalled = w.players[0]!.queue.find((j) => j.cell === outer)!;
  assert.deepEqual(
    [stalled.paid, stalled.progress, stalled.duration],
    [false, 0, 0],
  );
  assert.ok(
    w.outcomes.some((o) => o.type === "stalled" && o.cell === outer),
    "the player is told the sprout stalled",
  );
  assert.ok(w.players[0]!.biomass >= before + RULES.neuronCost);
  assert.doesNotThrow(() => decodeState(encodeState(w)));
  // The slot is free, so another plan grows instead of waiting forever.
  w = step(w, [queueNeuron(3, other!)]);
  w = run(w, RULES.constructionTicks + 5);
  assert.ok(w.structures.some((s) => s.cell === other));
  // And the stalled plan resumes once something connected touches it again.
  w = step(w, [queueNeuron(4, first!)]);
  w = run(w, 2 * RULES.constructionTicks + 10);
  assert.ok(w.structures.some((s) => s.cell === outer));
  assert.equal(w.players[0]!.queue.length, 0);
});

test("a waiting plan on a hex someone else built is dropped with an outcome", () => {
  let w = createMatch(tiny(), {}, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  const far = 36;
  w = step(w, [queueNeuron(1, far)]);
  assert.equal(w.players[0]!.queue.length, 1);
  w.structures.push({
    id: w.nextEntityId++,
    cell: far,
    ownerId: "b",
    kind: "neuron",
    hp: 60,
    connected: false,
  });
  w = step(w);
  assert.equal(w.players[0]!.queue.length, 0);
  assert.ok(
    w.outcomes.some(
      (o) => o.playerId === "a" && o.type === "dropped" && o.cell === far,
    ),
  );
});

test("stalled and dropped outcomes survive a checkpoint", () => {
  const w = createMatch(tiny(), {}, [{ id: "a", slot: 0 }]);
  w.outcomes = [
    { tick: 0, playerId: "a", type: "stalled", cell: 10, amount: 1 },
    { tick: 0, playerId: "a", type: "dropped", cell: 11, reason: "hex taken" },
  ];
  assert.deepEqual(decodeState(encodeState(w)).outcomes, w.outcomes);
});
