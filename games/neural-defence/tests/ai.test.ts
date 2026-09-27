import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aiCommands, AI_STRATEGIES } from "../src/engine/ai.js";
import { CONSTRUCTIONS } from "../src/engine/catalog.js";
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
