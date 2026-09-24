import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  step,
  neighbors,
  loadMap,
  encodeState,
  decodeState,
  hashState,
  isAction,
  type World,
  type MapDefinition,
  type Command,
} from "../src/engine/index.ts";
function map(): MapDefinition {
  return {
    schemaVersion: 1,
    id: "test",
    width: 8,
    height: 8,
    layout: "odd-r",
    cells: Array.from({ length: 64 }, (_, i) =>
      i === 27
        ? { terrain: "deposit", resourceKind: "biomass" }
        : i === 36
          ? { terrain: "deposit", resourceKind: "insight" }
          : { terrain: "open" },
    ),
    spawns: [
      { slot: 0, cellIndex: 9 },
      { slot: 1, cellIndex: 14 },
      { slot: 2, cellIndex: 49 },
      { slot: 3, cellIndex: 54 },
    ],
  };
}
const start = (debug = false) =>
  createMatch(map(), { instantConstruction: debug, instantResearch: debug }, [
    { id: "a", slot: 0 },
  ]);
const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w = step(w);
  return w;
};
const command = (
  sequence: number,
  action: Command["action"],
  playerId = "a",
): Command => ({ sequence, action, playerId });
test("map schema and odd-r boundaries are validated", () => {
  assert.deepEqual(neighbors(map(), 0), [1, 8]);
  assert.equal(neighbors(map(), 9).length, 6);
  assert.throws(() => loadMap({ ...map(), schemaVersion: 2 }));
  assert.throws(() =>
    loadMap({
      ...map(),
      spawns: [
        { slot: 0, cellIndex: 9 },
        { slot: 0, cellIndex: 10 },
      ],
    }),
  );
  assert.throws(() => loadMap({ ...map(), cells: [] }));
  assert.equal(isAction({ type: "startResearch", research: "shield" }), false);
  assert.equal(isAction({ type: "setPriority", cell: 10, weight: NaN }), false);
});
test("four independent economies, pure steps and exact checkpoint replay", () => {
  const w = createMatch(
    map(),
    {},
    ["a", "b", "c", "d"].map((id, slot) => ({ id, slot })),
  );
  const before = encodeState(w);
  const after = run(w, 20);
  assert.equal(encodeState(w), before);
  for (const p of after.players) {
    assert.equal(p.biomass, 61000);
    assert.equal(p.insight, 500);
  }
  assert.equal(after.particles.length, 512);
  assert.equal(hashState(after), hashState(decodeState(encodeState(after))));
  assert.equal(
    hashState(run(after, 20)),
    hashState(run(decodeState(encodeState(after)), 20)),
  );
});
test("queued ghosts wait for connectivity, builder delivers, debug does not teleport", () => {
  let w = start(true);
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 12, kind: "neuron" }),
    command(1, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  assert.ok(w.structures.some((s) => s.cell === 10));
  assert.equal(w.players[0]!.queue.find((j) => j.cell === 12)!.paid, false);
  w = run(w, 2);
  w = step(w, [
    command(2, { type: "queueConstruction", cell: 11, kind: "neuron" }),
  ]);
  const moving = w.players[0]!.worker;
  assert.equal(moving.mode, "outbound");
  assert.ok(moving.arrivesAt > w.tick);
  assert.equal(
    w.structures.some((s) => s.cell === 11),
    false,
  );
  w = run(w, 20);
  assert.ok(w.structures.some((s) => s.cell === 11));
  assert.ok(w.structures.some((s) => s.cell === 12));
});
test("ordinary construction takes time; no duplicated spending and foreign priority rejected", () => {
  let w = start();
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  assert.equal(w.players[0]!.biomass, 40050);
  assert.equal(w.structures.length, 1);
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  assert.equal(w.players[0]!.queue.length, 1);
  w = run(w, 118);
  assert.equal(w.structures.length, 2);
  w = step(w, [command(1, { type: "setPriority", cell: 55, weight: 3 })]);
  assert.ok(w.outcomes.some((o) => o.type === "rejected"));
});
test("mining follows owned connected adjacency and research changes future builds", () => {
  let w = start(true);
  w = run(w, 400);
  w = step(w, [command(0, { type: "startResearch", research: "growth" })]);
  assert.deepEqual(w.players[0]!.research, ["growth"]);
  assert.equal(w.players[0]!.insight, 25);
  w = step(w, [
    command(1, { type: "queueConstruction", cell: 18, kind: "neuron" }),
  ]);
  w = run(w, 10);
  assert.ok(w.structures.some((s) => s.cell === 18));
  w = step(w, [
    command(2, { type: "queueConstruction", cell: 19, kind: "neuron" }),
  ]);
  w = run(w, 12);
  const before = w.players[0]!.biomass;
  w = run(w, 20);
  assert.equal(w.players[0]!.biomass - before, 2000);
});
test("priority routes conserved particles with edge capacity and visible latency", () => {
  let w = start(true);
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  w = step(w, [command(1, { type: "setPriority", cell: 10, weight: 3 })]);
  assert.equal(w.particles.filter((p) => p.mode === "transit").length, 8);
  assert.equal(w.particles.filter((p) => p.cell === 10).length, 0);
  for (let i = 0; i < 20; i++) {
    w = step(w);
    assert.equal(w.particles.length, 128);
    assert.ok(w.particles.filter((p) => p.mode === "transit").length <= 32);
  }
  assert.equal(
    w.particles.filter((p) => p.cell === 10 && p.mode === "stationed").length,
    32,
  );
  assert.equal(
    hashState(run(w, 5)),
    hashState(run(decodeState(encodeState(w)), 5)),
  );
});
test("tower needs six owned neighbors and remains queued otherwise", () => {
  let w = start(true);
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 10, kind: "tower" }),
  ]);
  w = run(w, 100);
  assert.equal(w.structures.length, 1);
  assert.equal(w.players[0]!.queue[0]!.paid, false);
});
test("checkpoint rejects conservation, ownership and coordinate corruption atomically", () => {
  const w = start();
  const original = hashState(w);
  const malformed = structuredClone(w);
  malformed.particles.pop();
  assert.throws(() => decodeState(encodeState(malformed)));
  const foreign = structuredClone(w);
  foreign.structures[0]!.ownerId = "stranger";
  assert.throws(() => decodeState(encodeState(foreign)));
  const bad = structuredClone(w);
  bad.players[0]!.worker.to = 10000;
  assert.throws(() => decodeState(encodeState(bad)));
  assert.equal(hashState(w), original);
});
test("combat spends actual particles and simultaneous brain damage can draw", () => {
  const m = map();
  m.spawns = [
    { slot: 0, cellIndex: 9 },
    { slot: 1, cellIndex: 10 },
  ];
  let w = createMatch(m, {}, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  w.structures.forEach((s) => (s.hp = 8));
  w = run(w, 20);
  assert.equal(w.finished, true);
  assert.equal(w.winnerId, null);
  assert.ok(w.players.every((p) => !p.alive));
  assert.equal(w.particles.length, 0);
});

test("allied tower needs its own delivered ammunition and loses power with support", () => {
  let w = start(true);
  const p = w.players[0]!;
  p.biomass = 200000;
  const center = 18;
  for (const cell of neighbors(w.map, center))
    if (!w.structures.some((s) => s.cell === cell))
      w.structures.push({
        id: w.nextEntityId++,
        cell,
        ownerId: "a",
        kind: "neuron",
        hp: 60,
        connected: true,
      });
  w = step(w, [
    command(0, { type: "queueConstruction", cell: center, kind: "tower" }),
  ]);
  w = run(w, 20);
  assert.ok(w.structures.some((s) => s.cell === center && s.kind === "tower"));
  w = step(w, [command(1, { type: "setPriority", cell: center, weight: 3 })]);
  w = run(w, 30);
  assert.equal(
    w.particles.filter((q) => q.mode === "stationed" && q.cell === center)
      .length,
    32,
  );
});

test("disconnected particles recover without duplication, and checkpoint survives branch cuts", () => {
  let w = start(true);
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  w = step(w, [command(1, { type: "setPriority", cell: 10, weight: 3 })]);
  w = run(w, 20);
  w.structures = w.structures.filter((s) => s.cell !== 10);
  w = step(w);
  assert.equal(w.particles.filter((q) => q.mode === "recovering").length, 32);
  assert.doesNotThrow(() => decodeState(encodeState(w)));
  w = run(w, 130);
  assert.equal(w.particles.length, 128);
  assert.ok(w.particles.every((q) => q.mode === "stationed" && q.cell === 9));
});

test("research does not mutate properties of already deployed particles", () => {
  let w = start(true);
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  w = step(w, [command(1, { type: "setPriority", cell: 10, weight: 3 })]);
  w = run(w, 400);
  w = step(w, [command(2, { type: "startResearch", research: "excitation" })]);
  assert.ok(
    w.particles.filter((q) => q.cell === 10).every((q) => q.attack === 2),
  );
  w = step(w, [command(3, { type: "setPriority", cell: 10, weight: 0 })]);
  w = run(w, 30);
  w = step(w, [command(4, { type: "setPriority", cell: 10, weight: 3 })]);
  w = run(w, 30);
  assert.ok(
    w.particles.filter((q) => q.cell === 10).every((q) => q.attack === 3),
  );
});
