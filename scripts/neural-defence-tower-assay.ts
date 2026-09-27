import {
  createMatch,
  step,
  type StructureKind,
} from "../games/neural-defence/src/engine/index.js";
import { STRUCTURES } from "../games/neural-defence/src/engine/catalog.js";

// Controlled equal-supply engagements at one and two hexes. These are not
// equal-cost matches: they isolate weapon reach and close-range counterplay.
// Both sides get redundant routes, equal research and the same particle profile.
for (const separation of [1, 2])
  for (const left of ["tower", "siege", "relay", "bastion"] as const) {
    for (const right of ["tower", "siege", "relay", "bastion"] as const) {
      const leftCell = separation === 1 ? 13 : 12;
      const rightCell = 35 - leftCell;
      let w = createMatch(
        {
          schemaVersion: 1,
          id: "tower-counterplay",
          width: 9,
          height: 4,
          layout: "odd-r",
          cells: Array.from({ length: 36 }, () => ({
            terrain: "open" as const,
          })),
          spawns: [
            { slot: 0, cellIndex: 9 },
            { slot: 1, cellIndex: 26 },
          ],
        },
        {},
        [
          { id: "a", slot: 0 },
          { id: "b", slot: 1 },
        ],
      );
      const ownCells = [0, 1, 2, 10, 11, 18, 19, 20, 27, 28, 29];
      if (separation === 1) ownCells.push(12);
      for (const [id, kind, towerCell, cells] of [
        ["a", left, leftCell, ownCells],
        ["b", right, rightCell, ownCells.map((cell) => 35 - cell)],
      ] as const) {
        const p = w.players.find((p) => p.id === id)!;
        p.research = [
          "growth",
          "excitation",
          "ballistics",
          "conduction",
          "resonance",
        ];
        p.priorities[towerCell] = 3;
        for (const cell of [...cells, towerCell]) {
          const structureKind: StructureKind =
            cell === towerCell ? kind : "neuron";
          w.structures.push({
            id: w.nextEntityId++,
            ownerId: id,
            cell,
            kind: structureKind,
            hp: STRUCTURES[structureKind].hp,
            connected: true,
          });
        }
        for (const particle of w.particles
          .filter((q) => q.ownerId === id)
          .slice(0, 32))
          Object.assign(particle, {
            cell: towerCell,
            from: towerCell,
            to: towerCell,
            destination: towerCell,
          });
      }
      let result = "unresolved";
      for (let tick = 0; tick < 1200; tick++) {
        w = step(w);
        const a = w.structures.some((s) => s.cell === leftCell),
          b = w.structures.some((s) => s.cell === rightCell);
        if (!a || !b) {
          result = a ? "left" : b ? "right" : "mutual";
          break;
        }
      }
      console.log(
        JSON.stringify({
          left,
          right,
          separation,
          seconds: w.tick / 20,
          result,
          damage: w.players.map((p) => p.statistics.damage),
        }),
      );
    }
  }
