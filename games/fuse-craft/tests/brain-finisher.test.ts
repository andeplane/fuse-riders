import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMatch,
  decodeState,
  step,
  encodeState,
  hashState,
} from "../src/engine/index.ts";
import { aiCommands } from "../src/engine/ai.ts";
import { STRUCTURES, attackCells } from "../src/engine/catalog.ts";
const snapshot = (slot = 0) =>
  decodeState(
    readFileSync(
      new URL(
        `./fixtures/pressure-relay-902-seat${slot}.world.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
for (const slot of [0, 1]) {
  const cell = slot === 0 ? 357 : 122;
  test(`902s safe brain shot precedes flank conduit, seat ${slot}`, () => {
    const world = snapshot(slot),
      before = encodeState(world),
      commands = aiCommands(world, "alpha", "pressure");
    assert.deepEqual(
      commands.find((c) => c.action.type === "queueConstruction")?.action,
      { type: "queueConstruction", kind: "siege", cell },
    );
    assert.equal(encodeState(world), before);
    const next = step(world, commands);
    assert.ok(!next.outcomes.some((o) => o.type === "rejected"));
    assert.ok(
      next.players
        .find((p) => p.id === "alpha")!
        .queue.some((j) => j.kind === "siege" && j.cell === cell),
    );
  });
  test(`structure iteration order preserves finishing commands, seat ${slot}`, () => {
    const world = snapshot(slot),
      reversed = snapshot(slot);
    reversed.structures.reverse();
    const commands = aiCommands(world, "alpha", "pressure"),
      reversedCommands = aiCommands(reversed, "alpha", "pressure");
    assert.deepEqual(reversedCommands, commands);
    // Array order is part of the serialized checkpoint hash. Apply the
    // order-independent decision to the same authoritative input state.
    assert.equal(
      hashState(step(world, reversedCommands)),
      hashState(step(world, commands)),
    );
  });
  test(`checkpoint preserves finishing commands and next hash, seat ${slot}`, () => {
    const world = snapshot(slot),
      restored = decodeState(encodeState(world));
    const commands = aiCommands(world, "alpha", "pressure"),
      replayCommands = aiCommands(restored, "alpha", "pressure");
    assert.deepEqual(replayCommands, commands);
    assert.equal(
      hashState(step(restored, replayCommands)),
      hashState(step(world, commands)),
    );
  });
}
test("unaffordable brain shot keeps ordinary policy choice", () => {
  const world = snapshot();
  world.players[0]!.biomass = 0;
  assert.ok(
    !aiCommands(world, "alpha", "pressure").some(
      (c) =>
        c.action.type === "queueConstruction" &&
        c.action.kind === "siege" &&
        c.action.cell === 357,
    ),
  );
});
test("without ballistics ordinary policy choice is preserved", () => {
  const world = snapshot();
  world.players[0]!.research = world.players[0]!.research.filter(
    (r) => r !== "ballistics",
  );
  assert.ok(
    !aiCommands(world, "alpha", "pressure").some(
      (c) =>
        c.action.type === "queueConstruction" &&
        c.action.kind === "siege" &&
        c.action.cell === 357,
    ),
  );
});
test("threatened finishing site keeps ordinary policy choice", () => {
  const world = snapshot();
  for (const cell of [405, 381])
    world.structures.push({
      id: world.nextEntityId++,
      ownerId: "beta",
      cell,
      kind: "neuron",
      hp: STRUCTURES.neuron.hp,
      connected: true,
    });
  world.structures.push({
    id: world.nextEntityId++,
    ownerId: "beta",
    cell: 358,
    kind: "tower",
    hp: STRUCTURES.tower.hp,
    connected: true,
  });
  assert.ok(attackCells(world.map, 358, "tower").has(357));
  assert.ok(
    !aiCommands(world, "alpha", "pressure").some(
      (c) =>
        c.action.type === "queueConstruction" &&
        c.action.kind === "siege" &&
        c.action.cell === 357,
    ),
  );
});
for (const rotated of [false, true])
  test(`critical supply counterbattery repair deliberately precedes finishing, rotated=${rotated}`, () => {
    const at = (cell: number) => (rotated ? 47 - cell : cell);
    const world = createMatch(
      {
        schemaVersion: 1,
        id: "repair-before-finish",
        width: 8,
        height: 6,
        layout: "odd-r",
        cells: Array.from({ length: 48 }, () => ({ terrain: "open" })),
        spawns: [
          { slot: 0, cellIndex: at(0) },
          { slot: 1, cellIndex: at(26) },
        ],
      },
      {},
      [
        { id: "a", slot: 0 },
        { id: "b", slot: 1 },
      ],
    );
    for (const [cell, ownerId, kind, connected] of [
      [1, "a", "tower", true],
      [8, "a", "neuron", true],
      [3, "a", "tower", false],
      [11, "b", "tower", false],
    ] as const)
      world.structures.push({
        id: world.nextEntityId++,
        cell: at(cell),
        ownerId,
        kind,
        connected,
        hp: STRUCTURES[kind].hp,
      });
    const player = world.players[0]!;
    player.research = [
      "growth",
      "excitation",
      "ballistics",
      "conduction",
      "resonance",
    ];
    player.biomass = 1000000;
    player.insight = 1000000;
    assert.ok(attackCells(world.map, at(2), "siege").has(at(26)));
    assert.deepEqual(
      aiCommands(world, "a", "pressure").find(
        (c) => c.action.type === "queueConstruction",
      )?.action,
      { type: "queueConstruction", kind: "siege", cell: at(2) },
    );
    Object.assign(player.statistics, { built: 6, lost: 3 });
    const commands = aiCommands(world, "a", "pressure");
    assert.deepEqual(
      commands.find((c) => c.action.type === "queueConstruction")?.action,
      { type: "queueConstruction", kind: "siege", cell: at(17) },
    );
    assert.ok(attackCells(world.map, at(17), "siege").has(at(11)));
    assert.ok(!attackCells(world.map, at(11), "tower").has(at(17)));
    assert.ok(!attackCells(world.map, at(17), "siege").has(at(26)));
    assert.equal(
      step(world, commands).outcomes.some((o) => o.type === "rejected"),
      false,
    );
  });
