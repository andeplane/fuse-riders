import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  step,
  encodeState,
  decodeState,
  hashState,
  type StructureKind,
} from "../src/engine/index.js";
import {
  STRUCTURES,
  attackCells,
  protectionCells,
} from "../src/engine/catalog.js";

function fixture() {
  return createMatch(
    {
      schemaVersion: 1,
      id: "blindspot",
      width: 8,
      height: 4,
      layout: "odd-r",
      cells: Array.from({ length: 32 }, () => ({ terrain: "open" })),
      spawns: [
        { slot: 0, cellIndex: 0 },
        { slot: 1, cellIndex: 7 },
      ],
    },
    {},
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
    ],
  );
}

test("supplied Siege cannot hit inside two steps, fires at three and takes close retaliation", () => {
  const w = fixture();
  for (const [ownerId, cell, kind] of [
    ["a", 1, "neuron"],
    ["a", 2, "neuron"],
    ["a", 3, "siege"],
    ["b", 4, "tower"],
    ["b", 5, "neuron"],
    ["b", 6, "neuron"],
  ] as [string, number, StructureKind][]) {
    w.structures.push({
      id: w.nextEntityId++,
      ownerId,
      cell,
      kind,
      hp: cell === 3 ? 40 : STRUCTURES[kind].hp,
      connected: true,
    });
  }
  w.tick = 79;
  for (const [owner, cell] of [
    ["a", 3],
    ["b", 4],
  ] as const) {
    const p = w.players.find((p) => p.id === owner)!;
    p.research = ["growth", "excitation", "ballistics"];
    p.priorities = { [cell]: 3 };
    for (const q of w.particles.filter((q) => q.ownerId === owner).slice(0, 8))
      Object.assign(q, { cell, destination: cell, from: cell, to: cell });
  }
  const before = encodeState(w);
  const next = step(w),
    hits = next.outcomes.filter((o) => o.type === "damage");
  assert.ok(
    hits.some((o) => o.playerId === "a" && o.fromCell === 3 && o.cell === 6),
  );
  assert.ok(
    !hits.some((o) => o.playerId === "a" && (o.cell === 4 || o.cell === 5)),
  );
  assert.ok(
    hits.some((o) => o.playerId === "b" && o.fromCell === 4 && o.cell === 3),
  );
  assert.equal(hashState(next), hashState(step(decodeState(before))));
  assert.equal(encodeState(w), before);
  const priority = decodeState(before);
  priority.structures.find((s) => s.cell === 3)!.hp = STRUCTURES.siege.hp;
  assert.ok(
    step(priority).outcomes.some(
      (o) => o.type === "damage" && o.fromCell === 4 && o.cell === 2,
    ),
    "a Siege inside its blind spot is not a retaliating threat ahead of a weaker target",
  );
  // The inner targets cannot drain ammunition when they are all that remain.
  const closeOnly = decodeState(before);
  closeOnly.structures = closeOnly.structures.filter((s) => s.cell !== 6);
  const idle = step(closeOnly);
  assert.ok(
    !idle.outcomes.some((o) => o.type === "damage" && o.fromCell === 3),
  );
  assert.equal(
    idle.particles.filter((p) => p.ownerId === "a" && p.mode === "recovering")
      .length,
    0,
  );
});

test("minimum range follows terrain-aware reach and leaves protection unchanged", () => {
  const w = fixture();
  assert.equal(attackCells(w.map, 3, "siege").has(4), false);
  assert.equal(attackCells(w.map, 3, "siege").has(5), false);
  assert.equal(attackCells(w.map, 3, "siege").has(6), true);
  assert.equal(attackCells(w.map, 3, "tower").has(5), true);
  const field = [...protectionCells(w, "bastion", 3)];
  assert.ok(field.includes(4) && field.includes(5));
  w.map.cells[4] = { terrain: "blocked" };
  assert.equal(
    attackCells(w.map, 3, "siege").has(5),
    true,
    "detour now takes three steps",
  );
  w.map.cells[11] = { terrain: "blocked" };
  assert.equal(
    attackCells(w.map, 3, "siege").has(5),
    false,
    "remaining detour exceeds maximum reach",
  );
});
