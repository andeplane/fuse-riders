import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aiCommands, AI_STRATEGIES } from "../src/engine/ai.js";
import { CONSTRUCTIONS, STRUCTURES } from "../src/engine/catalog.js";
import { weaponCells } from "../src/engine/map.js";
import {
  createMatch,
  loadMap,
  step,
  encodeState,
  decodeState,
  hashState,
} from "../src/engine/index.js";

const map = loadMap(
  JSON.parse(
    readFileSync(new URL("../maps/skirmish-24.json", import.meta.url), "utf8"),
  ),
);

for (const rotated of [false, true])
  test(`AI changes an attrition front into a legal safe advance (rotated=${rotated})`, () => {
    const cellAt = (cell: number) => (rotated ? 47 - cell : cell);
    const world = createMatch(
      {
        schemaVersion: 1,
        id: "attrition-flank",
        width: 8,
        height: 6,
        layout: "odd-r",
        cells: Array.from({ length: 48 }, () => ({ terrain: "open" })),
        spawns: [
          { slot: 0, cellIndex: cellAt(0) },
          { slot: 1, cellIndex: cellAt(47) },
        ],
      },
      {},
      [
        { id: "a", slot: 0 },
        { id: "b", slot: 1 },
      ],
    );
    for (const [ownerId, cells] of [
      ["a", [1, 2, 8, 9, 10, 11, 12, 18]],
      ["b", [39, 31, 23, 15, 14, 22]],
    ] as const)
      for (const cell of cells) {
        const kind = [11, 12, 18].includes(cell)
          ? "siege"
          : [15, 14, 22].includes(cell)
            ? "tower"
            : "neuron";
        world.structures.push({
          id: world.nextEntityId++,
          cell: cellAt(cell),
          ownerId,
          kind,
          hp: STRUCTURES[kind].hp,
          connected: true,
        });
      }
    for (const p of world.players) {
      p.research = [
        "growth",
        "excitation",
        "conduction",
        "ballistics",
        "resonance",
      ];
      p.biomass = 1_000_000;
      p.insight = 1_000_000;
    }
    for (const [sitesLost, lost, kind, cell] of [
      [0, 0, "tower", 20],
      [1, 7, "tower", 20],
      [2, 0, "neuron", 19],
      [0, 8, "neuron", 19],
    ] as const) {
      Object.assign(world.players[0]!.statistics, { sitesLost, lost });
      const before = encodeState(world);
      const commands = aiCommands(world, "a");
      assert.deepEqual(
        commands.find((c) => c.action.type === "queueConstruction")?.action,
        { type: "queueConstruction", kind, cell: cellAt(cell) },
      );
      const next = step(world, commands);
      assert.equal(
        next.outcomes.some((o) => o.type === "rejected"),
        false,
      );
      assert.equal(
        hashState(step(decodeState(before), commands)),
        hashState(next),
      );
      assert.equal(encodeState(world), before);
      const reordered = decodeState(before);
      reordered.structures.reverse();
      assert.deepEqual(aiCommands(reordered, "a"), commands);
    }
    // The safer step is farther from the brain than our existing forward gun:
    // a greedy requirement to reduce plain distance would reject it.
    const withinFive = weaponCells(world.map, cellAt(47), 5);
    assert.equal(withinFive.has(cellAt(12)), true);
    assert.equal(withinFive.has(cellAt(19)), false);
    assert.equal(weaponCells(world.map, cellAt(47), 6).has(cellAt(19)), true);
    // Blocking that route forces another safe branch, not a plan through rock.
    world.map.cells[cellAt(19)] = { terrain: "blocked" };
    const detour = aiCommands(world, "a");
    assert.deepEqual(
      detour.find((c) => c.action.type === "queueConstruction")?.action,
      { type: "queueConstruction", kind: "neuron", cell: cellAt(26) },
    );
    assert.equal(
      step(world, detour).outcomes.some((o) => o.type === "rejected"),
      false,
    );
    assert.ok(decodeState(encodeState(world)));
  });
test("AI anchors exposed construction only after repeated site losses, without duplicating protection", () => {
  const world = createMatch(
    {
      schemaVersion: 1,
      id: "exposed-advance",
      width: 8,
      height: 6,
      layout: "odd-r",
      cells: Array.from({ length: 48 }, () => ({ terrain: "open" })),
      spawns: [
        { slot: 0, cellIndex: 0 },
        { slot: 1, cellIndex: 47 },
      ],
    },
    {},
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
    ],
  );
  for (const p of world.players) {
    p.research = ["growth", "excitation", "ballistics"];
    p.biomass = 100_000;
  }
  for (const [ownerId, cells] of [
    ["a", [1, 2]],
    ["b", [39, 31, 23, 15, 14, 13]],
  ] as const)
    for (const cell of cells) {
      const kind = cell === 13 ? "siege" : "neuron";
      world.structures.push({
        id: world.nextEntityId++,
        cell,
        ownerId,
        kind,
        hp: STRUCTURES[kind].hp,
        connected: true,
      });
    }
  for (const sitesLost of [0, 1, 2]) {
    world.players[0]!.statistics.sitesLost = sitesLost;
    const commands = aiCommands(world, "a");
    assert.deepEqual(
      commands.find((c) => c.action.type === "queueConstruction")?.action,
      {
        type: "queueConstruction",
        kind: sitesLost === 2 ? "bastion" : "siege",
        cell: 3,
      },
    );
    assert.equal(
      step(world, commands).outcomes.some((o) => o.type === "rejected"),
      false,
    );
  }
  const anchor = world.structures.find(
    (s) => s.ownerId === "a" && s.cell === 2,
  )!;
  anchor.kind = "bastion";
  anchor.hp = STRUCTURES.bastion.hp;
  assert.ok(decodeState(encodeState(world)));
  assert.deepEqual(
    aiCommands(world, "a").find((c) => c.action.type === "queueConstruction")
      ?.action,
    { type: "queueConstruction", kind: "siege", cell: 3 },
  );
});

test("AI reconnects an isolated investment before expanding toward the enemy", () => {
  const world = createMatch(
    {
      schemaVersion: 1,
      id: "repair",
      width: 8,
      height: 4,
      layout: "odd-r",
      cells: Array.from({ length: 32 }, () => ({ terrain: "open" })),
      spawns: [
        { slot: 0, cellIndex: 0 },
        { slot: 1, cellIndex: 24 },
      ],
    },
    {},
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
    ],
  );
  world.structures.push({
    id: world.nextEntityId++,
    cell: 2,
    ownerId: "a",
    kind: "tower",
    hp: 120,
    connected: false,
  });
  const build = aiCommands(world, "a").find(
    (c) => c.action.type === "queueConstruction",
  );
  assert.deepEqual(build?.action, {
    type: "queueConstruction",
    kind: "neuron",
    cell: 1,
  });
  // A currently disconnected enemy gun still matters to the durability of a
  // repaired connection: both networks may reactivate together.
  world.structures.push({
    id: world.nextEntityId++,
    cell: 11,
    ownerId: "b",
    kind: "siege",
    hp: 80,
    connected: false,
  });
  for (const [research, kind] of [
    [[], "tower"],
    [["growth"], "bastion"],
  ] as const) {
    world.players[0]!.research = [...research];
    const commands = aiCommands(world, "a");
    assert.deepEqual(
      commands.find((c) => c.action.type === "queueConstruction")?.action,
      { type: "queueConstruction", kind, cell: 1 },
    );
    assert.equal(
      step(world, commands).outcomes.some((o) => o.type === "rejected"),
      false,
    );
  }
});
test("AI clears a dormant gun from outside its range before reconnecting a vulnerable branch", () => {
  const world = createMatch(
    {
      schemaVersion: 1,
      id: "counterbattery-repair",
      width: 8,
      height: 6,
      layout: "odd-r",
      cells: Array.from({ length: 48 }, () => ({ terrain: "open" })),
      spawns: [
        { slot: 0, cellIndex: 0 },
        { slot: 1, cellIndex: 40 },
      ],
    },
    {},
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
    ],
  );
  world.players[0]!.research = ["growth", "excitation", "ballistics"];
  world.structures.push(
    {
      id: world.nextEntityId++,
      ownerId: "a",
      cell: 1,
      kind: "neuron",
      hp: 60,
      connected: true,
    },
    {
      id: world.nextEntityId++,
      ownerId: "a",
      cell: 3,
      kind: "tower",
      hp: 120,
      connected: false,
    },
    {
      id: world.nextEntityId++,
      ownerId: "b",
      cell: 11,
      kind: "tower",
      hp: 120,
      connected: false,
    },
  );
  for (const [built, lost] of [
    [0, 0],
    [4, 2],
    [7, 3],
  ]) {
    Object.assign(world.players[0]!.statistics, { built, lost });
    assert.deepEqual(
      aiCommands(world, "a", "pressure").find(
        (c) => c.action.type === "queueConstruction",
      )?.action,
      { type: "queueConstruction", kind: "bastion", cell: 2 },
      "an isolated supply cut receives a durable repair before artillery escalation",
    );
  }
  Object.assign(world.players[0]!.statistics, { built: 6, lost: 3 });
  const commands = aiCommands(world, "a", "pressure");
  assert.deepEqual(
    commands.find((c) => c.action.type === "queueConstruction")?.action,
    { type: "queueConstruction", kind: "siege", cell: 8 },
  );
  assert.equal(
    step(world, commands).outcomes.some((o) => o.type === "rejected"),
    false,
  );
  world.structures.push({
    id: world.nextEntityId++,
    ownerId: "a",
    cell: 8,
    kind: "siege",
    hp: 80,
    connected: true,
  });
  const supplied = aiCommands(world, "a", "pressure");
  assert.ok(
    supplied.some(
      (c) =>
        c.action.type === "setPriority" &&
        c.action.cell === 8 &&
        c.action.weight > 0,
    ),
  );
  const nextBuild = supplied.find(
    (c) => c.action.type === "queueConstruction",
  )?.action;
  assert.equal(
    nextBuild?.type === "queueConstruction" && nextBuild.kind === "siege",
    false,
  );
  for (const cell of [24, 25, 32, 33])
    world.structures.push({
      id: world.nextEntityId++,
      ownerId: "a",
      cell,
      kind: "siege",
      hp: 80,
      connected: true,
    });
  const crowded = aiCommands(world, "a", "pressure");
  const priorities = crowded.filter(
    (c) => c.action.type === "setPriority" && c.action.weight > 0,
  );
  assert.ok(
    priorities.some(
      (c) => c.action.type === "setPriority" && c.action.cell === 8,
    ),
  );
  assert.ok(priorities.length <= 4);
});
for (const biomass of [20_000, 100_000])
  test(`defensive opening reserves its anchor at ${biomass} biomass`, () => {
    const world = createMatch(
      {
        schemaVersion: 1,
        id: "fortification",
        width: 8,
        height: 4,
        layout: "odd-r",
        cells: Array.from({ length: 32 }, () => ({ terrain: "open" })),
        spawns: [
          { slot: 0, cellIndex: 0 },
          { slot: 1, cellIndex: 4 },
        ],
      },
      {},
      [
        { id: "a", slot: 0 },
        { id: "b", slot: 1 },
      ],
    );
    world.players[0]!.research = ["growth"];
    world.players[0]!.biomass = biomass;
    const before = encodeState(world);
    const commands = aiCommands(world, "a", "defensive");
    const build = commands.find((c) => c.action.type === "queueConstruction");
    assert.deepEqual(build?.action, {
      type: "queueConstruction",
      kind: "bastion",
      cell: 1,
    });
    const next = step(world, commands);
    assert.equal(
      next.outcomes.some((o) => o.type === "rejected"),
      false,
    );
    assert.equal(encodeState(world), before);
    assert.equal(
      next.players[0]!.queue[0]!.paid,
      biomass >= CONSTRUCTIONS.bastion.cost,
    );
    if (biomass < CONSTRUCTIONS.bastion.cost) {
      let saving = next;
      for (
        let tick = 0;
        tick < 1400 && saving.players[0]!.statistics.built === 0;
        tick++
      )
        saving = step(saving, aiCommands(saving, "a", "defensive"));
      assert.ok(
        saving.structures.some(
          (s) => s.ownerId === "a" && s.kind === "bastion",
        ),
      );
      assert.equal(
        saving.players[0]!.statistics.built,
        1,
        "the reserved building completes without spending on cheaper alternatives",
      );
      assert.ok(decodeState(encodeState(saving)));
    }
  });

test("AI concentrates ammunition on guns that can hit paid construction", () => {
  const world = createMatch(
    {
      schemaVersion: 1,
      id: "site-supply",
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
  world.players[0]!.research = ["excitation", "ballistics"];
  world.players[0]!.priorities[0] = 3;
  for (const cell of [1, 2, 3])
    world.structures.push({
      id: world.nextEntityId++,
      cell,
      ownerId: "a",
      kind: cell === 3 ? "siege" : "neuron",
      hp: cell === 3 ? 80 : 60,
      connected: true,
    });
  world.players[1]!.queue.push({
    cell: 6,
    kind: "neuron",
    paid: true,
    progress: 1,
    duration: 120,
    hp: 60,
  });
  world.players[1]!.worker.mode = "building";
  assert.ok(decodeState(encodeState(world)));
  const commands = aiCommands(world, "a");
  assert.ok(
    commands.some(
      (c) =>
        c.action.type === "setPriority" &&
        c.action.cell === 3 &&
        c.action.weight === 3,
    ),
  );
  assert.ok(
    commands.some(
      (c) =>
        c.action.type === "setPriority" &&
        c.action.cell === 0 &&
        c.action.weight === 0,
    ),
  );
  assert.equal(
    commands.filter(
      (c) => c.action.type === "setPriority" && c.action.weight > 0,
    ).length,
    1,
  );
});

test("AI does not sacrifice its builder repeatedly on a threatened repair", () => {
  const world = createMatch(
    {
      schemaVersion: 1,
      id: "exposed-repair",
      width: 8,
      height: 4,
      layout: "odd-r",
      cells: Array.from({ length: 32 }, () => ({ terrain: "open" })),
      spawns: [
        { slot: 0, cellIndex: 0 },
        { slot: 1, cellIndex: 9 },
      ],
    },
    {},
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
    ],
  );
  world.structures.push({
    id: world.nextEntityId++,
    cell: 2,
    ownerId: "a",
    kind: "tower",
    hp: 120,
    connected: false,
  });
  assert.equal(
    aiCommands(world, "a").some(
      (c) =>
        c.action.type === "queueConstruction" &&
        c.action.kind === "neuron" &&
        c.action.cell === 1,
    ),
    false,
  );
});
test("skirmish arena is larger, connected and rotationally symmetric", () => {
  assert.equal(map.cells.length, 480);
  for (let cell = 0; cell < map.cells.length; cell++)
    assert.deepEqual(map.cells[cell], map.cells[map.cells.length - 1 - cell]);
  assert.equal(
    map.spawns[0]!.cellIndex + map.spawns[1]!.cellIndex,
    map.cells.length - 1,
  );
});
for (const id of [
  "open-front",
  "narrow-front",
  "lean-resources",
  "close-quarters",
])
  test(`${id} is connected and gives symmetric starts and terrain`, () => {
    const scenario = loadMap(
      JSON.parse(
        readFileSync(new URL(`../maps/${id}.json`, import.meta.url), "utf8"),
      ),
    );
    for (let cell = 0; cell < scenario.cells.length; cell++)
      assert.deepEqual(
        scenario.cells[cell],
        scenario.cells[scenario.cells.length - 1 - cell],
      );
    assert.equal(
      scenario.spawns[0]!.cellIndex + scenario.spawns[1]!.cellIndex,
      scenario.cells.length - 1,
    );
  });
test("opposite starts make rotated opening decisions without an absolute-cell preference", () => {
  let left = createMatch(map, {}, [
    { id: "ai", slot: 0 },
    { id: "idle", slot: 1 },
  ]);
  let right = createMatch(map, {}, [
    { id: "ai", slot: 1 },
    { id: "idle", slot: 0 },
  ]);
  for (let tick = 0; tick < 1200; tick++) {
    const a = aiCommands(left, "ai");
    const b = aiCommands(right, "ai");
    const rotated = a.map((command) => ({
      ...command,
      action:
        "cell" in command.action
          ? {
              ...command.action,
              cell: map.cells.length - 1 - command.action.cell,
            }
          : command.action,
    }));
    assert.deepEqual(b, rotated, `opening decision at tick ${tick}`);
    left = step(left, a);
    right = step(right, b);
  }
  assert.deepEqual(
    left.players.find((p) => p.id === "ai")!.statistics,
    right.players.find((p) => p.id === "ai")!.statistics,
  );
});
for (const strategy of AI_STRATEGIES)
  test(`${strategy} AI grows using valid commands and replays from checkpoint`, () => {
    let world = createMatch(map, {}, [
      { id: "human", slot: 0 },
      { id: "ai", slot: 1 },
    ]);
    const before = encodeState(world);
    aiCommands(world, "ai", strategy);
    assert.equal(encodeState(world), before, "policy must not mutate input");
    let restored = decodeState(before);
    for (let tick = 0; tick < 1000; tick++) {
      world = step(world, aiCommands(world, "ai", strategy));
      restored = step(restored, aiCommands(restored, "ai", strategy));
      assert.equal(
        world.outcomes.some((e) => e.type === "rejected"),
        false,
      );
      if (tick % 100 === 0) restored = decodeState(encodeState(restored));
    }
    assert.equal(hashState(world), hashState(restored));
    const ai = world.players.find((p) => p.id === "ai")!;
    assert.ok(ai.statistics.built >= 3);
    assert.ok(ai.research.length > 0 || ai.researchJob);
    assert.ok(
      world.particles.some(
        (p) => p.ownerId === "ai" && p.cell !== map.spawns[1]!.cellIndex,
      ),
    );
    assert.equal(
      world.players.find((p) => p.id === "human")!.statistics.built,
      0,
    );
  });
