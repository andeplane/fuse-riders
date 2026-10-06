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
import {
  STRUCTURES,
  PARTICLES,
  constructionQueueAvailability,
} from "../src/engine/catalog.js";

test("economic buildings require adjacent deposits, cap specialist bonuses and reject attack orders", () => {
  let w = fixture(7);
  w.map.cells[9] = { terrain: "deposit", resourceKind: "biomass" };
  const player = w.players[0]!;
  player.research = ["growth"];
  assert.equal(
    constructionQueueAvailability(w, player, "harvester", 4).allowed,
    false,
  );
  assert.equal(
    constructionQueueAvailability(w, player, "harvester", 1).allowed,
    true,
  );
  const add = (cell: number) =>
    w.structures.push({
      id: w.nextEntityId++,
      ownerId: "a",
      cell,
      kind: "harvester",
      hp: 70,
      connected: true,
    });
  add(1);
  const before = player.biomass;
  w = step(w, [
    {
      playerId: "a",
      sequence: 0,
      action: { type: "setPriority", cell: 1, weight: 3 },
    },
  ]);
  assert.ok(w.outcomes.some((e) => e.type === "rejected"));
  assert.equal(
    w.players[0]!.biomass - before,
    150,
    "base 50 plus two extraction shares",
  );
  add(2);
  const second = w.players[0]!.biomass;
  w = step(w);
  assert.equal(
    w.players[0]!.biomass - second,
    200,
    "two miners plus only one one-share bonus",
  );
  assert.ok(decodeState(encodeState(w)));
  const corrupt = structuredClone(w);
  corrupt.players[0]!.priorities[1] = 3;
  assert.throws(() => decodeState(encodeState(corrupt)), /priorities/);
  const illegal = fixture();
  illegal.players[0]!.research = ["growth"];
  illegal.players[0]!.queue.push({
    cell: 1,
    kind: "harvester",
    paid: false,
    progress: 0,
    duration: 0,
    hp: STRUCTURES.harvester.hp,
  });
  assert.throws(() => decodeState(encodeState(illegal)), /construction/);
});

test("disconnected Harvesters lose extraction and never fire even with stranded particles", () => {
  let w = fixture(3);
  w.map.cells[10] = { terrain: "deposit", resourceKind: "insight" };
  w.players[0]!.research = ["growth"];
  w.structures.push({
    id: w.nextEntityId++,
    ownerId: "a",
    cell: 2,
    kind: "harvester",
    hp: 70,
    connected: false,
  });
  const before = w.players[0]!.insight;
  w = advance(w, 20);
  assert.equal(w.players[0]!.insight - before, 500);
  assert.equal(w.players[0]!.statistics.damage, 0);
  assert.ok(decodeState(encodeState(w)));
});

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
test("construction uses catalog durability and preserves damage through completion", () => {
  let world = fixture(7);
  world.players[0]!.research = ["growth"];
  world.players[0]!.biomass = 100_000;
  world = step(world, [
    {
      playerId: "a",
      sequence: 0,
      action: { type: "queueConstruction", kind: "bastion", cell: 1 },
    },
  ]);
  assert.equal(world.players[0]!.queue[0]!.hp, STRUCTURES.bastion.hp);
  assert.equal(world.players[0]!.queue[0]!.paid, true);
  world.players[0]!.queue[0]!.hp -= 35;
  assert.ok(decodeState(encodeState(world)));
  world = advance(world, 350);
  assert.equal(
    world.structures.find((s) => s.cell === 1)?.hp,
    STRUCTURES.bastion.hp - 35,
  );
  assert.ok(decodeState(encodeState(world)));
});
test("an exposed brain takes priority over a weaker completed decoy", () => {
  let world = fixture(5);
  world.players[0]!.research = ["excitation", "ballistics"];
  for (const [ownerId, cell, kind] of [
    ["a", 1, "neuron"],
    ["a", 2, "siege"],
    ["b", 12, "neuron"],
  ] as const)
    world.structures.push({
      id: world.nextEntityId++,
      ownerId,
      cell,
      kind,
      hp: STRUCTURES[kind].hp,
      connected: true,
    });
  world = step(world, [
    {
      playerId: "a",
      sequence: 0,
      action: { type: "setPriority", cell: 2, weight: 3 },
    },
  ]);
  world = advance(world, STRUCTURES.siege.cadence - 1);
  const attack = world.outcomes.find(
    (e) => e.type === "damage" && e.fromCell === 2,
  );
  assert.equal(
    attack?.cell,
    5,
    "shoot the brain, not the lower-HP neuron beside it",
  );
});

test("disconnected weapons cannot distract from connected threats", () => {
  let world = fixture(7);
  for (const player of world.players)
    player.research = ["excitation", "ballistics"];
  for (const [ownerId, cell, kind] of [
    ["a", 1, "neuron"],
    ["a", 2, "siege"],
    ["b", 5, "siege"],
    ["b", 6, "neuron"],
    ["b", 20, "tower"],
  ] as const)
    world.structures.push({
      id: world.nextEntityId++,
      ownerId,
      cell,
      kind,
      hp: cell === 20 ? 10 : STRUCTURES[kind].hp,
      connected: cell !== 20,
    });
  world = step(world, [
    {
      playerId: "a",
      sequence: 0,
      action: { type: "setPriority", cell: 2, weight: 3 },
    },
  ]);
  world = advance(world, STRUCTURES.siege.cadence - 1);
  assert.equal(
    world.outcomes.find((e) => e.type === "damage" && e.fromCell === 2)?.cell,
    5,
  );
});

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
    let w = fixture(kind === "siege" ? 5 : 4);
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
  // Neurons carry no weapon; particles station on armed structures.
  w.structures.push({
    id: w.nextEntityId++,
    cell: 1,
    ownerId: "a",
    kind: "tower",
    hp: 120,
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
