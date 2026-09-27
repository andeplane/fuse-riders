import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  step,
  encodeState,
  decodeState,
  hashState,
} from "../src/engine/index.js";
import { aiCommands } from "../src/engine/ai.js";
import { STRUCTURES, attackCells } from "../src/engine/catalog.js";
for (const rotated of [false, true])
  for (const activeGun of [false, true])
    test(`attrition can advance with ${activeGun ? 1 : 0} engaged guns, rotated=${rotated}`, () => {
      const cellAt = (cell: number) => (rotated ? 47 - cell : cell);
      const w = createMatch(
        {
          schemaVersion: 1,
          id: "quiet-front",
          width: 8,
          height: 6,
          layout: "odd-r",
          cells: Array.from({ length: 48 }, () => ({
            terrain: "open" as const,
          })),
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
          const kind =
            ownerId === "a" && [11, 12, 18].includes(cell)
              ? activeGun && cell === 11
                ? "siege"
                : "neuron"
              : [15, 14, 22].includes(cell)
                ? "tower"
                : "neuron";
          w.structures.push({
            id: w.nextEntityId++,
            cell: cellAt(cell),
            ownerId,
            kind,
            hp: STRUCTURES[kind].hp,
            connected: true,
          });
        }
      for (const p of w.players) {
        p.research = [
          "growth",
          "excitation",
          "conduction",
          "ballistics",
          "resonance",
        ];
        p.biomass = 1000000;
        p.insight = 1000000;
      }
      w.players[0]!.statistics.lost = 8;
      const engaged = w.structures.filter(
        (s) =>
          s.ownerId === "a" &&
          w.structures.some(
            (e) =>
              e.ownerId === "b" &&
              attackCells(w.map, s.cell, s.kind).has(e.cell),
          ),
      );
      assert.equal(engaged.length, activeGun ? 1 : 0);
      const before = encodeState(w),
        commands = aiCommands(w, "a");
      assert.deepEqual(
        commands.find((c) => c.action.type === "queueConstruction")?.action,
        { type: "queueConstruction", kind: "neuron", cell: cellAt(19) },
      );
      const next = step(w, commands);
      assert.equal(
        next.outcomes.some((o) => o.type === "rejected"),
        false,
      );
      assert.ok(
        next.outcomes.some(
          (o) =>
            o.type === "dispatched" &&
            o.playerId === "a" &&
            o.cell === cellAt(19),
        ),
      );
      assert.equal(
        hashState(next),
        hashState(step(decodeState(before), commands)),
      );
      assert.equal(encodeState(w), before);
      const reordered = decodeState(before);
      reordered.structures.reverse();
      assert.deepEqual(aiCommands(reordered, "a"), commands);
    });
