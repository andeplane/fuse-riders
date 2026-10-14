import { createMatch } from "../engine/index.js";
import type { MapDefinition, World } from "../engine/types.js";

/** Authored menu scenery, rendered once. This is never stepped or used as a playable session. */
export function createAttractScene(): World {
  const map: MapDefinition = {
    schemaVersion: 1,
    id: "menu-scenery",
    width: 14,
    height: 10,
    layout: "odd-r",
    cells: Array.from({ length: 140 }, () => ({ terrain: "open" })),
    spawns: [
      { slot: 0, cellIndex: 65 },
      { slot: 1, cellIndex: 106 },
    ],
  };
  for (const cell of [19, 20, 33, 46, 73, 87, 116, 129])
    map.cells[cell] = { terrain: "blocked" };
  for (const cell of [37, 51, 77, 94, 119])
    map.cells[cell] = {
      terrain: "deposit",
      resourceKind: cell % 2 ? "biomass" : "insight",
    };
  const scene = createMatch(map, {}, [
    { id: "blue", slot: 0 },
    { id: "coral", slot: 1 },
  ]);
  for (const [ownerId, cells] of [
    ["blue", [36, 50, 64, 66, 79, 80, 92]],
    ["coral", [105, 104, 90, 91, 107, 121]],
  ] as const) {
    for (const cell of cells)
      scene.structures.push({
        id: scene.nextEntityId++,
        cell,
        ownerId,
        kind: "neuron",
        hp: 60,
        connected: true,
      });
  }
  return scene;
}
