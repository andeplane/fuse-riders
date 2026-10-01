import type { MapDefinition } from "../engine/types.js";
import { hexCenter, hexVertices } from "./projection.js";
import { terrainArt } from "./terrain-art.js";

type Point = readonly [number, number];
export interface RockRelief {
  cell: number;
  top: readonly Point[];
  edges: readonly { from: Point; to: Point; facing: number }[];
  height: number;
}
const key = (p: Point) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
const edgeKey = (a: Point, b: Point) => [key(a), key(b)].sort().join("/");

/** Static cosmetic relief. Only authoritative stone blockers become cliffs. */
export function rockRelief(map: MapDefinition): RockRelief[] {
  const cells = map.cells.flatMap((cell, index) => {
    const art = terrainArt(cell, index);
    if (
      cell.terrain !== "blocked" ||
      art === "blocker-water" ||
      art === "blocker-void"
    )
      return [];
    const vertices = hexVertices(map.width, index);
    return [{ cell: index, vertices }];
  });
  const counts = new Map<string, number>();
  for (const { vertices } of cells)
    for (let i = 0; i < 6; i++) {
      const edge = edgeKey(vertices[i]!, vertices[(i + 1) % 6]!);
      counts.set(edge, (counts.get(edge) ?? 0) + 1);
    }
  const corners = new Map<string, { x: number; y: number; count: number }>();
  for (const { cell, vertices } of cells) {
    const center = hexCenter(map.width, cell);
    for (const vertex of vertices) {
      const entry = corners.get(key(vertex)) ?? { x: 0, y: 0, count: 0 };
      entry.x += center.x;
      entry.y += center.y;
      entry.count++;
      corners.set(key(vertex), entry);
    }
  }
  const soften = (vertex: Point): Point => {
    const corner = corners.get(key(vertex))!;
    const amount = corner.count >= 3 ? 0 : 0.2;
    return [
      vertex[0] + (corner.x / corner.count - vertex[0]) * amount,
      vertex[1] + (corner.y / corner.count - vertex[1]) * amount,
    ];
  };
  return cells.map(({ cell, vertices }) => {
    const center = hexCenter(map.width, cell);
    const top: Point[] = [];
    const edges: { from: Point; to: Point; facing: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const a = vertices[i]!,
        b = vertices[(i + 1) % 6]!;
      const from = soften(a),
        to = soften(b);
      top.push(from);
      if (counts.get(edgeKey(a, b)) !== 1) continue;
      // Broken ledges stay inside the tile footprint. Shared edges remain
      // identical, so adjacent blockers form a continuous upper surface.
      const middle: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const inset = 0.08 + ((cell * 13 + i * 7) % 5) * 0.035;
      const notch: Point = [
        middle[0] + (center.x - middle[0]) * inset,
        middle[1] + (center.y - middle[1]) * inset,
      ];
      top.push(notch);
      if (i <= 2)
        edges.push(
          { from, to: notch, facing: i },
          { from: notch, to, facing: i },
        );
    }
    return { cell, top, edges, height: 12 };
  });
}

const points = (vertices: readonly Point[]) =>
  vertices.map((p) => p.join(",")).join(" ");
export function rockReliefMarkup(relief: RockRelief): string {
  const { top, height, edges } = relief;
  const upper = top.map(([x, y]) => [x, y - height] as const);
  const sides = edges
    .map(({ from: a, to: b, facing }) => {
      const wall: Point[] = [
        a,
        b,
        [b[0], b[1] - height],
        [a[0], a[1] - height],
      ];
      return `<polygon class="cliff-face" points="${points(wall)}" fill="url(#cliff-material)"/><polygon points="${points(wall)}" fill="#111c23" opacity="${[0.52, 0.4, 0.22][facing]}"/><path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" stroke="#111e23" stroke-width="2" opacity="0.55"/><path d="M${a[0]} ${a[1] - height}L${b[0]} ${b[1] - height}" stroke="#a0a79e" stroke-width="0.6" opacity="0.25"/>`;
    })
    .join("");
  return `<g class="rock-relief"><polygon class="cliff-top" points="${points(upper)}" fill="url(#cliff-material)"/>${sides}</g>`;
}
