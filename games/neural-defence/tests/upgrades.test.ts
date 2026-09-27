import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  step,
  encodeState,
  decodeState,
  hashState,
  type World,
  type BuildKind,
} from "../src/engine/index.js";
import {
  STRUCTURES,
  CONSTRUCTIONS,
  constructionQueueAvailability,
} from "../src/engine/catalog.js";
import { aiCommands } from "../src/engine/ai.js";

function fixture() {
  const w = createMatch(
    {
      schemaVersion: 1,
      id: "upgrade",
      width: 8,
      height: 4,
      layout: "odd-r",
      cells: Array.from({ length: 32 }, () => ({ terrain: "open" })),
      spawns: [
        { slot: 0, cellIndex: 0 },
        { slot: 1, cellIndex: 31 },
      ],
    },
    {},
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
    ],
  );
  w.structures.push({
    id: w.nextEntityId++,
    cell: 1,
    ownerId: "a",
    kind: "neuron",
    hp: 30,
    connected: true,
  });
  w.players[0]!.biomass = 200_000;
  w.players[0]!.research = [
    "growth",
    "excitation",
    "ballistics",
    "conduction",
    "resonance",
  ];
  return w;
}
function queue(w: World, kind: BuildKind = "tower") {
  return step(w, [
    {
      playerId: "a",
      sequence: w.players[0]!.sequence + 1,
      action: { type: "queueConstruction", cell: 1, kind },
    },
  ]);
}
test("timed specialization preserves identity, live conduit and damage fraction through replay", () => {
  let w = fixture();
  const id = w.structures.find((s) => s.cell === 1)!.id;
  const before = w.players[0]!.biomass;
  w = queue(w);
  assert.equal(w.players[0]!.queue[0]!.upgradeFrom, id);
  assert.equal(w.players[0]!.queue[0]!.paid, true);
  assert.equal(w.players[0]!.biomass, before - CONSTRUCTIONS.tower.cost + 50);
  assert.equal(w.structures.find((s) => s.id === id)!.kind, "neuron");
  assert.equal(w.structures.find((s) => s.id === id)!.connected, true);
  let replay = decodeState(encodeState(w));
  for (let t = 0; t < CONSTRUCTIONS.tower.duration + 30; t++) {
    w = step(w);
    replay = step(replay);
    assert.ok(decodeState(encodeState(w)));
  }
  const tower = w.structures.find((s) => s.id === id)!;
  assert.equal(tower.kind, "tower");
  assert.equal(tower.hp, STRUCTURES.tower.hp / 2);
  assert.equal(w.structures.filter((s) => s.cell === 1).length, 1);
  assert.equal(hashState(w), hashState(replay));
});
test("cancellation keeps the source and delivered cost stays spent", () => {
  let w = queue(fixture());
  const before = w.players[0]!.biomass;
  w = step(w, [
    {
      playerId: "a",
      sequence: w.players[0]!.sequence + 1,
      action: { type: "cancelConstruction", cell: 1 },
    },
  ]);
  assert.equal(w.players[0]!.queue.length, 0);
  assert.equal(w.structures.find((s) => s.cell === 1)!.kind, "neuron");
  assert.equal(w.players[0]!.biomass, before + 50);
  assert.ok(decodeState(encodeState(w)));
});
test("source destruction cancels an upgrade instead of creating a new shield", () => {
  let w = fixture();
  w.structures.find((s) => s.cell === 1)!.hp = 1;
  w.structures.push({
    id: w.nextEntityId++,
    cell: 2,
    ownerId: "b",
    kind: "neuron",
    hp: 60,
    connected: true,
  });
  // The enemy network joins the nearby weapon through row one.
  for (const cell of [3, 4, 5, 6, 7, 15, 23])
    w.structures.push({
      id: w.nextEntityId++,
      cell,
      ownerId: "b",
      kind: "neuron",
      hp: 60,
      connected: true,
    });
  const ammo = w.particles.find((q) => q.ownerId === "b")!;
  ammo.cell = 2;
  ammo.destination = 2;
  w.players[1]!.priorities[2] = 3;
  w.tick = STRUCTURES.neuron.cadence - 2;
  w = queue(w);
  assert.equal(w.players[0]!.queue[0]!.paid, true);
  w = step(w);
  assert.ok(w.outcomes.some((o) => o.type === "destroyed" && o.cell === 1));
  assert.equal(w.players[0]!.queue.length, 0);
  assert.equal(
    w.structures.some((s) => s.cell === 1),
    false,
  );
  assert.ok(decodeState(encodeState(w)));
});
test("upgrade availability and checkpoint reject wrong sources and duplicate paid occupancy", () => {
  let w = fixture();
  assert.equal(
    constructionQueueAvailability(w, w.players[0]!, "tower", 1).allowed,
    true,
  );
  assert.equal(
    constructionQueueAvailability(w, w.players[1]!, "tower", 1).allowed,
    false,
  );
  assert.equal(
    constructionQueueAvailability(w, w.players[0]!, "tower", 0).allowed,
    false,
  );
  assert.equal(
    constructionQueueAvailability(w, w.players[0]!, "neuron", 1).allowed,
    false,
  );
  w = queue(w);
  assert.equal(
    constructionQueueAvailability(w, w.players[0]!, "tower", 1).allowed,
    false,
  );
  for (const source of [
    undefined,
    0,
    w.structures.find((s) => s.ownerId === "b")!.id,
  ]) {
    const corrupt = structuredClone(w);
    corrupt.players[0]!.queue[0]!.upgradeFrom = source;
    assert.throws(() => decodeState(encodeState(corrupt)), /construction/);
  }
  assert.equal(
    aiCommands(w, "a").some((c) => c.action.type === "cancelConstruction"),
    false,
  );
});
test("economic specialization clears attack orders and retains existing supply", () => {
  let w = fixture();
  w.map.cells[9] = { terrain: "deposit", resourceKind: "biomass" };
  w.players[0]!.priorities[1] = 3;
  w = queue(w, "harvester");
  for (let t = 0; t < CONSTRUCTIONS.harvester.duration + 30; t++) w = step(w);
  assert.equal(w.structures.find((s) => s.cell === 1)!.kind, "harvester");
  assert.equal(w.players[0]!.priorities[1], undefined);
  assert.equal(w.particles.filter((q) => q.ownerId === "a").length, 128);
  assert.ok(decodeState(encodeState(w)));
});
