import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  step,
  encodeState,
  decodeState,
  hashState,
  type World,
  type StructureKind,
} from "../src/engine/index.js";
import { STRUCTURES } from "../src/engine/catalog.js";
import { aiCommands } from "../src/engine/ai.js";

function add(w: World, ownerId: string, kind: StructureKind, cell: number) {
  w.structures.push({
    id: w.nextEntityId++,
    ownerId,
    kind,
    cell,
    hp: STRUCTURES[kind].hp,
    connected: true,
  });
}
function fixture(stock = 2) {
  const w = createMatch(
    {
      schemaVersion: 1,
      id: "protection",
      width: 8,
      height: 4,
      layout: "odd-r",
      cells: Array.from({ length: 32 }, () => ({ terrain: "open" })),
      spawns: [
        { slot: 0, cellIndex: 24 },
        { slot: 1, cellIndex: 4 },
      ],
    },
    {},
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
    ],
  );
  add(w, "a", "neuron", 16);
  add(w, "a", "bastion", 8);
  add(w, "a", "neuron", 1);
  add(w, "b", "tower", 3);
  w.tick = 19;
  w.players[0]!.research = ["growth"];
  w.players[0]!.priorities = { 8: 3 };
  w.players[1]!.priorities = { 3: 3 };
  for (const [owner, cell, count] of [
    ["a", 8, stock],
    ["b", 3, 8],
  ] as const)
    for (const q of w.particles
      .filter((q) => q.ownerId === owner)
      .slice(0, count))
      Object.assign(q, { cell, destination: cell, from: cell, to: cell });
  return w;
}
test("supplied Bastion halves incoming damage with finite particles and replays", () => {
  const w = fixture();
  const before = encodeState(w);
  const next = step(w);
  assert.equal(next.structures.find((s) => s.cell === 1)!.hp, 52);
  assert.deepEqual(
    next.outcomes.filter((o) => o.type === "shielded"),
    [
      {
        tick: 20,
        playerId: "a",
        type: "shielded",
        cell: 1,
        fromCell: 8,
        amount: 8,
      },
    ],
  );
  assert.equal(next.players[1]!.statistics.damage, 8);
  assert.equal(
    next.particles.filter((q) => q.ownerId === "a" && q.mode === "recovering")
      .length,
    2,
  );
  assert.equal(next.particles.filter((q) => q.ownerId === "a").length, 128);
  assert.equal(hashState(step(decodeState(before))), hashState(next));
  assert.ok(decodeState(encodeState(next)));
  const invalid = structuredClone(next);
  invalid.outcomes.find((o) => o.type === "shielded")!.amount = 0;
  assert.throws(() => decodeState(encodeState(invalid)), /invalid events/);
  assert.equal(encodeState(w), before);
});
for (const condition of ["empty", "disconnected"] as const)
  test(`${condition} protector cannot absorb`, () => {
    const w = fixture(condition === "empty" ? 0 : 2);
    if (condition === "disconnected")
      w.structures = w.structures.filter((s) => s.cell !== 16);
    const next = step(w);
    assert.equal(next.structures.find((s) => s.cell === 1)!.hp, 44);
    assert.equal(
      next.outcomes.some((o) => o.type === "shielded"),
      false,
    );
  });
test("simultaneous attackers cannot reuse protection ammunition", () => {
  const w = fixture(1);
  add(w, "b", "tower", 2);
  for (const q of w.particles.filter((q) => q.ownerId === "b").slice(8, 16))
    Object.assign(q, { cell: 2, destination: 2, from: 2, to: 2 });
  w.players[1]!.priorities[2] = 3;
  const next = step(w);
  assert.equal(next.structures.find((s) => s.cell === 1)!.hp, 32);
  assert.equal(
    next.outcomes
      .filter((o) => o.type === "shielded")
      .reduce((sum, o) => sum + o.amount!, 0),
    4,
  );
  assert.equal(next.players[1]!.statistics.damage, 28);
});

test("overlapping fields do not stack their absorption percentage", () => {
  const w = fixture(4);
  add(w, "a", "bastion", 9);
  for (const q of w.particles.filter((q) => q.ownerId === "a").slice(4, 8))
    Object.assign(q, { cell: 9, destination: 9, from: 9, to: 9 });
  w.players[0]!.priorities[9] = 3;
  const next = step(w);
  assert.equal(next.structures.find((s) => s.cell === 1)!.hp, 52);
  assert.equal(
    next.outcomes
      .filter((o) => o.type === "shielded")
      .reduce((n, o) => n + o.amount!, 0),
    8,
  );
});

test("mixed-strength salvos allocate shared protection independently of structure order", () => {
  const w = fixture(1);
  add(w, "b", "neuron", 2);
  const q = w.particles.filter((q) => q.ownerId === "b")[8]!;
  Object.assign(q, { cell: 2, destination: 2, from: 2, to: 2 });
  w.players[1]!.priorities[2] = 3;
  const reversed = structuredClone(w);
  reversed.structures.reverse();
  const a = step(w),
    b = step(reversed);
  assert.equal(a.structures.find((s) => s.cell === 1)!.hp, 46);
  assert.equal(b.structures.find((s) => s.cell === 1)!.hp, 46);
  assert.equal(
    a.players[1]!.statistics.damage,
    b.players[1]!.statistics.damage,
  );
  assert.deepEqual(
    a.outcomes.filter((o) => ["shielded", "damage"].includes(o.type)),
    b.outcomes.filter((o) => ["shielded", "damage"].includes(o.type)),
  );
});
test("AI supplies an anchor protecting an attacked neighbor outside its gun range", () => {
  const w = fixture(0);
  w.tick = 20;
  w.players[0]!.priorities = {};
  assert.ok(
    aiCommands(w, "a", "defensive").some(
      (c) =>
        c.action.type === "setPriority" &&
        c.action.cell === 8 &&
        c.action.weight > 0,
    ),
  );
});

test("a protector can shield itself", () => {
  const w = fixture();
  const rear = w.structures.find((s) => s.cell === 8)!;
  rear.kind = "neuron";
  rear.hp = STRUCTURES.neuron.hp;
  const front = w.structures.find((s) => s.cell === 1)!;
  front.kind = "bastion";
  front.hp = STRUCTURES.bastion.hp;
  w.players[0]!.priorities = { 1: 3 };
  for (const q of w.particles.filter((q) => q.ownerId === "a" && q.cell === 8))
    Object.assign(q, { cell: 1, destination: 1, from: 1, to: 1 });
  const next = step(w);
  assert.equal(next.structures.find((s) => s.cell === 1)!.hp, 232);
  assert.equal(next.outcomes.find((o) => o.type === "shielded")?.fromCell, 1);
});

for (const upgrade of [false, true])
  test(`protection covers ${upgrade ? "an upgrade source once" : "paid construction"}`, () => {
    let w = fixture();
    w.tick = 0;
    w.players[0]!.biomass = 100_000;
    if (!upgrade) w.structures = w.structures.filter((s) => s.cell !== 1);
    w = step(w, [
      {
        playerId: "a",
        sequence: 1,
        action: { type: "queueConstruction", kind: "tower", cell: 1 },
      },
    ]);
    assert.equal(w.players[0]!.queue[0]!.paid, true);
    w.tick = 19;
    const next = step(w);
    assert.equal(next.outcomes.filter((o) => o.type === "shielded").length, 1);
    assert.equal(
      upgrade
        ? next.structures.find((s) => s.cell === 1)!.hp
        : next.players[0]!.queue[0]!.hp,
      upgrade ? 52 : 112,
    );
    if (upgrade) assert.equal(next.players[0]!.queue[0]!.hp, 120);
    assert.ok(decodeState(encodeState(next)));
  });

test("Bastion firing spends ammunition before shields, never twice", () => {
  const w = fixture(12);
  w.structures = w.structures.filter((s) => s.cell !== 1);
  add(w, "b", "tower", 1);
  add(w, "b", "neuron", 2);
  w.players[1]!.priorities = { 1: 3 };
  for (const q of w.particles.filter((q) => q.ownerId === "b" && q.cell === 3))
    Object.assign(q, { cell: 1, destination: 1, from: 1, to: 1 });
  const next = step(w);
  assert.equal(
    next.outcomes.some((o) => o.type === "shielded"),
    false,
  );
  assert.equal(next.structures.find((s) => s.cell === 8)!.hp, 224);
  assert.equal(next.structures.find((s) => s.cell === 1)!.hp, 96);
  assert.equal(
    next.particles.filter((q) => q.ownerId === "a" && q.mode === "recovering")
      .length,
    12,
  );
});
