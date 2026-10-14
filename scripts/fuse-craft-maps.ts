/**
 * Generates the symmetric Fuse Craft maps that are not hand-drawn:
 *
 *   pnpm exec tsx scripts/fuse-craft-maps.ts [--write]
 *
 * Without --write it prints each map and its fairness report. Two-player maps
 * use point symmetry (cell i ↔ N−1−i, exact on odd-r grids with an even
 * height). Four- and six-player maps use both reflections, which are exact on
 * odd-r grids with an odd height once the unpaired last cell of each odd row
 * is rock. Every seat therefore sees the same board up to reflection, except
 * where a map deliberately mixes corner and edge seats.
 */
import { writeFileSync } from "node:fs";
import {
  loadMap,
  neighbors,
  type MapDefinition,
} from "../games/fuse-craft/src/engine/index.ts";

type Terrain = "open" | "blocked" | "biomass" | "insight";
interface Design {
  id: string;
  width: number;
  height: number;
  symmetry: "point" | "quad";
  /** Rock or open ground at a continuous board position; x in cells, y in rows. */
  terrain(x: number, y: number): "open" | "blocked";
  /**
   * Deposits as [row, column, kind], in the half (point) or quarter (quad)
   * that reading order meets first; symmetry places the rest.
   */
  deposits: [number, number, "biomass" | "insight"][];
  /** Spawn cells in one symmetry class, as [row, column]; mirrored for the rest. */
  spawns: [number, number][];
}

const ROW = Math.sqrt(3) / 2;
/** Distance from a point to a segment, in cell widths. */
function segment(
  x: number,
  y: number,
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
): number {
  const [px, py, qx, qy] = [x, y * ROW, ax, ay * ROW];
  const [dx, dy] = [bx - qx, by * ROW - qy];
  const t = Math.max(
    0,
    Math.min(1, ((px - qx) * dx + (py - qy) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(px - qx - t * dx, py - qy - t * dy);
}
const near = (x: number, y: number, cx: number, cy: number) =>
  Math.hypot(x - cx, (y - cy) * ROW);

const designs: Design[] = [
  {
    // Two hemispheres split by a deep fissure with three bridges; gyri fold
    // each half into lanes, and the richest deposits sit beside the bridges.
    id: "twin-hemispheres",
    deposits: [
      [3, 5, "biomass"],
      [5, 1, "biomass"],
      [8, 6, "insight"],
      [2, 10, "biomass"],
      [7, 11, "insight"],
      [9, 12, "biomass"],
      [4, 20, "insight"],
      [2, 24, "biomass"],
      [6, 18, "biomass"],
    ],
    width: 28,
    height: 20,
    symmetry: "point",
    terrain(x, y) {
      const cx = 13.75;
      const fissure = Math.abs(x - cx) < 1.1;
      const bridge = [3, 9.5, 16].some((b) => Math.abs(y - b) < 1.1);
      if (fissure && !bridge) return "blocked";
      const gyri: [[number, number], [number, number]][] = [
        [
          [3, 12],
          [8, 15],
        ],
        [
          [7, 2],
          [10, 6],
        ],
        [
          [18, 17],
          [21, 14],
        ],
      ];
      if (gyri.some(([a, b]) => segment(x, y, a, b) < 0.7)) return "blocked";
      return "open";
    },
    spawns: [[6, 3]],
  },
  {
    // Islands of cortex in a void; single-cell synapses join them. The rich
    // central islands are worth the long, fragile supply lines.
    id: "synapse-islands",
    deposits: [
      [2, 6, "insight"],
      [5, 1, "biomass"],
      [3, 12, "biomass"],
      [4, 14, "insight"],
      [8, 20, "biomass"],
      [10, 11, "biomass"],
      [10, 14, "insight"],
      [6, 21, "insight"],
      [7, 3, "biomass"],
    ],
    width: 26,
    height: 22,
    symmetry: "point",
    terrain(x, y) {
      const islands: [number, number, number][] = [
        [4, 4, 4.2],
        [12.5, 3.5, 3.2],
        [4.5, 14, 3.4],
        [12.75, 10.5, 3.6],
        [20, 8, 3],
      ];
      const bridges: [[number, number], [number, number]][] = [
        [
          [6, 5],
          [11, 4],
        ],
        [
          [4, 7],
          [4.5, 12],
        ],
        [
          [7, 12],
          [11, 11],
        ],
        [
          [14, 5],
          [13, 8],
        ],
        [
          [15, 9],
          [19, 8],
        ],
        [
          [15, 4],
          [19, 7],
        ],
      ];
      const land =
        islands.some(([cx, cy, rad]) => near(x, y, cx, cy) < rad) ||
        bridges.some(([a, b]) => segment(x, y, a, b) < 0.55);
      if (!land) return "blocked";
      return "open";
    },
    spawns: [[4, 4]],
  },
  {
    // Four brains in the corners around a walled central lobe. Its four gates
    // face the gaps between seats, so the centre is everyone's and nobody's.
    id: "cortex-crossing",
    deposits: [
      [2, 6, "biomass"],
      [5, 1, "biomass"],
      [1, 9, "insight"],
      [6, 8, "insight"],
      [9, 11, "biomass"],
      [11, 13, "insight"],
      [11, 11, "biomass"],
      [8, 14, "biomass"],
    ],
    width: 29,
    height: 23,
    symmetry: "quad",
    terrain(x, y) {
      const dx = Math.abs(x - 14),
        dy = Math.abs(y - 11);
      const ring = near(dx, dy, 0, 0);
      const gate = dx < 1.2 || dy < 1.2;
      if (ring > 4.6 && ring < 5.9 && !gate) return "blocked";
      if (segment(dx, dy, [9, 7], [11, 4.5]) < 0.6) return "blocked";
      return "open";
    },
    spawns: [[3, 3]],
  },
  {
    // A six-seat free-for-all: four corner brains and two on the flanks, all
    // circling a rich central lobe. Corner and flank seats differ in shape but
    // match in open ground and deposits within reach.
    id: "grand-cortex",
    deposits: [
      [2, 6, "biomass"],
      [6, 2, "biomass"],
      [1, 9, "insight"],
      [8, 7, "insight"],
      [4, 13, "biomass"],
      [10, 13, "biomass"],
      [13, 16, "insight"],
      [13, 14, "biomass"],
      [9, 16, "biomass"],
      [12, 4, "insight"],
      [11, 9, "biomass"],
    ],
    width: 35,
    height: 27,
    symmetry: "quad",
    terrain(x, y) {
      const dx = Math.abs(x - 17),
        dy = Math.abs(y - 13);
      const ring = near(dx, dy, 0, 0);
      if (ring > 5.2 && ring < 6.4 && dx > 1.3 && dy > 1.3) return "blocked";
      if (segment(dx, dy, [7, 11], [9, 8]) < 0.6) return "blocked";
      return "open";
    },
    spawns: [
      [3, 3],
      [13, 1],
    ],
  },
];

function build(d: Design): MapDefinition {
  const { width: W, height: H } = d;
  const N = W * H;
  if (d.symmetry === "point" && H % 2)
    throw new Error(`${d.id}: point needs even height`);
  if (d.symmetry === "quad" && !(H % 2))
    throw new Error(`${d.id}: quad needs odd height`);
  const terrain: Terrain[] = [];
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / W),
      c = i % W;
    terrain.push(d.terrain(c + 0.5 * (r & 1), r));
  }
  const at = (r: number, c: number) => r * W + c;
  for (const [r, c, kind] of d.deposits) {
    const representative =
      d.symmetry === "point"
        ? r < H / 2
        : r <= (H - 1) / 2 && c + 0.5 * (r & 1) <= (W - 1) / 2;
    if (!representative)
      throw new Error(`${d.id}: deposit ${r},${c} is mirrored`);
    terrain[at(r, c)] = kind;
  }
  const mirrorH = (r: number, c: number): [number, number] | null =>
    r & 1 ? (c === W - 1 ? null : [r, W - 2 - c]) : [r, W - 1 - c];
  const mirrorV = (r: number, c: number): [number, number] => [H - 1 - r, c];
  const orbit = (r: number, c: number): [number, number][] => {
    if (d.symmetry === "point")
      return [
        [r, c],
        [H - 1 - r, W - 1 - c],
      ];
    const h = mirrorH(r, c);
    const cells: [number, number][] = [[r, c], mirrorV(r, c)];
    if (h) cells.push(h, mirrorV(...h));
    return cells;
  };
  // Every orbit takes the terrain of its first member in reading order.
  const done = new Set<number>();
  for (let i = 0; i < N; i++) {
    if (done.has(i)) continue;
    const r = Math.floor(i / W),
      c = i % W;
    if (d.symmetry === "quad" && r & 1 && c === W - 1) {
      terrain[i] = "blocked";
      done.add(i);
      continue;
    }
    for (const [rr, cc] of orbit(r, c)) {
      terrain[at(rr, cc)] = terrain[i]!;
      done.add(at(rr, cc));
    }
  }
  const spawnCells: number[] = [];
  for (const [r, c] of d.spawns)
    for (const [rr, cc] of orbit(r, c))
      if (!spawnCells.includes(at(rr, cc))) spawnCells.push(at(rr, cc));
  // Seats alternate across the board so a two-player room faces off diagonally.
  const centre = [(H - 1) / 2, (W - 1) / 2] as const;
  const angle = (i: number) =>
    Math.atan2(Math.floor(i / W) - centre[0], (i % W) - centre[1]);
  const ordered =
    d.symmetry === "point"
      ? spawnCells
      : [...spawnCells].sort((a, b) => angle(a) - angle(b));
  const seats =
    d.symmetry === "point"
      ? ordered
      : ordered.length === 4
        ? [ordered[0]!, ordered[2]!, ordered[1]!, ordered[3]!]
        : [0, 3, 1, 4, 2, 5].map((k) => ordered[k]!);
  for (const cell of seats) {
    // Brains and their first ring are open ground.
    terrain[cell] = "open";
  }
  const raw = {
    schemaVersion: 1,
    id: d.id,
    width: W,
    height: H,
    layout: "odd-r",
    cells: terrain.map((t) =>
      t === "biomass" || t === "insight"
        ? { terrain: "deposit", resourceKind: t }
        : { terrain: t },
    ),
    spawns: seats.map((cellIndex, slot) => ({ slot, cellIndex })),
  };
  const map = loadMap(raw);
  for (const s of map.spawns)
    for (const n of neighbors(map, s.cellIndex))
      if (map.cells[n]!.terrain !== "open")
        throw new Error(`${d.id}: spawn ${s.slot} is crowded`);
  return map;
}

/** Steps from a cell to every cell over open ground (deposits are reached, not crossed). */
function distances(map: MapDefinition, from: number): Map<number, number> {
  const seen = new Map([[from, 0]]);
  const queue = [from];
  for (const cell of queue)
    for (const n of neighbors(map, cell)) {
      if (seen.has(n) || map.cells[n]!.terrain === "blocked") continue;
      seen.set(n, seen.get(cell)! + 1);
      if (map.cells[n]!.terrain === "open") queue.push(n);
    }
  return seen;
}

function report(map: MapDefinition): string[] {
  const lines = [
    `${map.id} ${map.width}×${map.height}, ${map.spawns.length} seats`,
  ];
  for (let r = 0; r < map.height; r++) {
    const row = map.cells
      .slice(r * map.width, (r + 1) * map.width)
      .map((cell, c) => {
        const i = r * map.width + c;
        const seat = map.spawns.find((s) => s.cellIndex === i);
        if (seat) return String(seat.slot);
        return cell.terrain === "blocked"
          ? "#"
          : cell.terrain === "deposit"
            ? cell.resourceKind === "insight"
              ? "i"
              : "o"
            : ".";
      });
    lines.push((r & 1 ? " " : "") + row.join(" "));
  }
  for (const s of map.spawns) {
    const d = distances(map, s.cellIndex);
    const deposits = [...d]
      .filter(([cell]) => map.cells[cell]!.terrain === "deposit")
      .map(([, steps]) => steps)
      .sort((a, b) => a - b);
    const rivals = map.spawns
      .filter((o) => o !== s)
      .map((o) => d.get(o.cellIndex) ?? -1)
      .sort((a, b) => a - b);
    lines.push(
      `seat ${s.slot}: deposits ${deposits.slice(0, 6).join(",")} · open within 6: ${[...d].filter(([c, n]) => n <= 6 && map.cells[c]!.terrain === "open").length} · rivals ${rivals.join(",")}`,
    );
  }
  return lines;
}

const write = process.argv.includes("--write");
for (const design of designs) {
  const map = build(design);
  console.log(report(map).join("\n") + "\n");
  if (write)
    writeFileSync(
      new URL(`../games/fuse-craft/maps/${map.id}.json`, import.meta.url),
      JSON.stringify(map, null, 2) + "\n",
    );
}
