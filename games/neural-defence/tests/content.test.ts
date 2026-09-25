import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  step,
  decodeState,
  encodeState,
  type World,
  type StructureKind,
} from "../src/engine/index.js";
import { STRUCTURES, PARTICLES } from "../src/engine/catalog.js";

function fixture(enemyCell = 5) {
  return createMatch(
    {
      schemaVersion: 1,
      id: "content-test",
      width: 8,
      height: 2,
      layout: "odd-r",
      cells: Array.from({ length: 16 }, () => ({ terrain: "open" as const })),
      spawns: [
        { slot: 0, cellIndex: 0 },
        { slot: 1, cellIndex: enemyCell },
      ],
    },
    {},
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
    ],
  );
}
function advance(world: World, ticks: number) {
  for (let i = 0; i < ticks; i++) world = step(world);
  return world;
}
test("checkpoints reject prerequisite bypasses in research jobs, particles, sites and towers", () => {
  const reject = (change: (world: World) => void) => {
    const world = fixture();
    change(world);
    assert.throws(() => decodeState(encodeState(world)));
  };
  reject((world) => {
    world.players[0]!.researchJob = { kind: "ballistics", completesAt: 1 };
  });
  reject((world) => {
    Object.assign(world.particles[0]!, { kind: "heavy", attack: 4, speed: 7 });
  });
  reject((world) => {
    world.players[0]!.queue.push({
      cell: 1,
      kind: "siege",
      paid: false,
      progress: 0,
      duration: 0,
      hp: 20,
    });
  });
  reject((world) => {
    world.structures.push({
      id: world.nextEntityId++,
      ownerId: "a",
      cell: 1,
      kind: "siege",
      hp: 80,
      connected: true,
    });
  });
  const valid = fixture();
  valid.players[0]!.research = ["excitation"];
  valid.players[0]!.researchJob = { kind: "ballistics", completesAt: 1 };
  assert.ok(decodeState(encodeState(valid)));
});
test("tower roles consume finite supply at their own range and cadence", () => {
  for (const kind of ["tower", "siege", "relay"] as StructureKind[]) {
    let w = fixture();
    w.players[0]!.research = [
      "excitation",
      "ballistics",
      "conduction",
      "resonance",
    ];
    for (const cell of [1, 2])
      w.structures.push({
        id: w.nextEntityId++,
        cell,
        ownerId: "a",
        kind: cell === 2 ? kind : "neuron",
        hp: STRUCTURES[cell === 2 ? kind : "neuron"].hp,
        connected: true,
      });
    w = step(w, [
      {
        playerId: "a",
        sequence: 0,
        action: { type: "setPriority", cell: 2, weight: 3 },
      },
    ]);
    w = advance(w, 79);
    const damage = w.players.find((p) => p.id === "a")!.statistics.damage;
    assert.equal(
      damage > 0,
      kind === "siege",
      "only siege reaches the enemy three hexes away",
    );
    assert.equal(w.particles.filter((p) => p.ownerId === "a").length, 128);
    assert.ok(decodeState(encodeState(w)));
  }
});
test("all three towers fire their catalog volley and cadence when equally supplied", () => {
  for (const kind of ["tower", "siege", "relay"] as const) {
    let w = fixture(4);
    w.players[0]!.research = [
      "excitation",
      "ballistics",
      "conduction",
      "resonance",
    ];
    for (const cell of [1, 2])
      w.structures.push({
        id: w.nextEntityId++,
        ownerId: "a",
        cell,
        kind: cell === 1 ? "neuron" : kind,
        hp: cell === 1 ? 60 : STRUCTURES[kind].hp,
        connected: true,
      });
    w = step(w, [
      {
        playerId: "a",
        sequence: 0,
        action: { type: "setPriority", cell: 2, weight: 3 },
      },
    ]);
    const shots: { tick: number; amount: number }[] = [];
    while (w.tick < STRUCTURES[kind].cadence * 2) {
      w = step(w);
      for (const event of w.outcomes)
        if (event.type === "damage" && event.fromCell === 2)
          shots.push({ tick: event.tick, amount: event.amount! });
    }
    assert.deepEqual(
      shots,
      [1, 2].map((n) => ({
        tick: STRUCTURES[kind].cadence * n,
        amount: STRUCTURES[kind].volley * 3,
      })),
      kind,
    );
  }
});

test("particle refits require research and preserve units already on the front", () => {
  let w = fixture();
  w = step(w, [
    {
      playerId: "a",
      sequence: 0,
      action: { type: "setParticleKind", kind: "heavy" },
    },
  ]);
  assert.ok(w.outcomes.some((e) => e.type === "rejected"));
  w.players[0]!.research = [
    "excitation",
    "ballistics",
    "conduction",
    "resonance",
  ];
  w.structures.push({
    id: w.nextEntityId++,
    cell: 1,
    ownerId: "a",
    kind: "neuron",
    hp: 60,
    connected: true,
  });
  w = step(w, [
    {
      playerId: "a",
      sequence: 1,
      action: { type: "setPriority", cell: 1, weight: 3 },
    },
    {
      playerId: "a",
      sequence: 2,
      action: { type: "setParticleKind", kind: "heavy" },
    },
  ]);
  w = advance(w, 15);
  const heavy = w.particles.find((p) => p.ownerId === "a" && p.cell === 1)!;
  assert.equal(heavy.kind, "heavy");
  assert.equal(heavy.attack, PARTICLES.heavy.attack + 1);
  assert.equal(heavy.speed, PARTICLES.heavy.speed - 1);
  w = step(w, [
    {
      playerId: "a",
      sequence: 3,
      action: { type: "setParticleKind", kind: "swift" },
    },
  ]);
  assert.equal(w.particles.find((p) => p.id === heavy.id)!.kind, "heavy");
  assert.equal(w.players[0]!.particleKind, "swift");
  assert.ok(decodeState(encodeState(w)));
  const corrupt = structuredClone(w);
  corrupt.players[0]!.research = [];
  assert.throws(() => decodeState(encodeState(corrupt)));
});
