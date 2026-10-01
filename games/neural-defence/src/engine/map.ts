import { RULES } from "./types.js";
import type { MapDefinition } from "./types.ts";
/** Stable local ordering for symmetric choices, viewed from the home spawn. */
/**
 * Order cells as seen from a seat's home: rows away from its edge, then
 * columns away from its side. Every map's symmetry (point, or both mirrors
 * on four- and six-seat maps) maps one seat's order onto another's, so no
 * seat wins a tie another would lose. On two-seat maps this is the plain
 * cell order from the top home and its reverse from the bottom one.
 * Returns a comparator, so callers sorting many cells compute the home once.
 */
export function homeOrder(
  map: MapDefinition,
  slot: number,
): (a: number, b: number) => number {
  const home = map.spawns.find((spawn) => spawn.slot === slot)!.cellIndex;
  const { width: W, height: H } = map;
  const hr = Math.floor(home / W),
    hx = (home % W) + 0.5 * (hr & 1);
  const flipY = hr * 2 > H - 1,
    flipX = hx * 2 > W - 1;
  return (a, b) => {
    const ar = Math.floor(a / W),
      br = Math.floor(b / W);
    const ay = flipY ? H - 1 - ar : ar,
      by = flipY ? H - 1 - br : br;
    if (ay !== by) return ay - by;
    const ax = (a % W) + 0.5 * (ar & 1),
      bx = (b % W) + 0.5 * (br & 1);
    return flipX ? bx - ax : ax - bx;
  };
}
export function homeCellOrder(
  map: MapDefinition,
  slot: number,
  a: number,
  b: number,
): number {
  return homeOrder(map, slot)(a, b);
}
export function neighbors(
  map: Pick<MapDefinition, "width" | "height">,
  cell: number,
): number[] {
  const row = Math.floor(cell / map.width),
    col = cell % map.width,
    d = row % 2;
  return [
    [col - 1, row],
    [col + 1, row],
    [col - 1 + d, row - 1],
    [col + d, row - 1],
    [col - 1 + d, row + 1],
    [col + d, row + 1],
  ]
    .filter(([x, y]) => x! >= 0 && y! >= 0 && x! < map.width && y! < map.height)
    .map(([x, y]) => y! * map.width + x!);
}
/** Combat reach expands through open ground; blocked ground cannot relay a shot. */
export function weaponCells(
  map: MapDefinition,
  cell: number,
  range: number,
): Set<number> {
  const cells = new Set(range > 0 ? neighbors(map, cell) : []);
  for (let hop = 1; hop < range; hop++)
    for (const n of [...cells])
      if (map.cells[n]?.terrain === "open")
        for (const next of neighbors(map, n)) cells.add(next);
  return cells;
}

export function loadMap(raw: unknown): MapDefinition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("map: expected object");
  const m = raw as Record<string, unknown>;
  if (
    Object.keys(m).some(
      (k) =>
        ![
          "schemaVersion",
          "id",
          "width",
          "height",
          "layout",
          "cells",
          "spawns",
        ].includes(k),
    )
  )
    throw new Error("map: unknown field");
  if (
    m.schemaVersion !== 1 ||
    m.layout !== "odd-r" ||
    typeof m.id !== "string" ||
    !/^[a-z0-9-]{1,64}$/.test(m.id)
  )
    throw new Error("map: unsupported schema, layout or id");
  if (
    !Number.isInteger(m.width) ||
    !Number.isInteger(m.height) ||
    Number(m.width) < 1 ||
    Number(m.width) > 64 ||
    Number(m.height) < 1 ||
    Number(m.height) > 64
  )
    throw new Error("map: dimensions must be integers 1..64");
  if (
    !Array.isArray(m.cells) ||
    m.cells.length !== Number(m.width) * Number(m.height)
  )
    throw new Error("map.cells: wrong count");
  for (const [i, c] of m.cells.entries()) {
    if (
      !c ||
      typeof c !== "object" ||
      Array.isArray(c) ||
      !["open", "blocked", "deposit"].includes(c.terrain)
    )
      throw new Error(`map.cells[${i}]: invalid terrain`);
    const keys =
      c.terrain === "open"
        ? ["terrain", "towerSite", "variant"]
        : c.terrain === "deposit"
          ? ["terrain", "resourceKind", "variant"]
          : ["terrain", "variant"];
    if (
      Object.keys(c).some((k) => !keys.includes(k)) ||
      (c.variant !== undefined &&
        (typeof c.variant !== "string" || c.variant.length > 64)) ||
      (c.towerSite !== undefined && typeof c.towerSite !== "boolean") ||
      (c.terrain === "deposit" &&
        !["biomass", "insight"].includes(c.resourceKind))
    )
      throw new Error(`map.cells[${i}]: invalid fields`);
  }
  if (
    !Array.isArray(m.spawns) ||
    m.spawns.length < 1 ||
    m.spawns.length > RULES.maxPlayers
  )
    throw new Error(`map.spawns: expected 1..${RULES.maxPlayers} spawns`);
  const slots = new Set<number>(),
    cells = new Set<number>();
  for (const s of m.spawns) {
    if (
      !s ||
      typeof s !== "object" ||
      Object.keys(s).some((k) => !["slot", "cellIndex"].includes(k)) ||
      !Number.isInteger(s.slot) ||
      s.slot < 0 ||
      s.slot >= RULES.maxPlayers ||
      !Number.isInteger(s.cellIndex) ||
      s.cellIndex < 0 ||
      s.cellIndex >= m.cells.length ||
      m.cells[s.cellIndex].terrain !== "open" ||
      slots.has(s.slot) ||
      cells.has(s.cellIndex)
    )
      throw new Error("map.spawns: invalid or duplicate spawn");
    slots.add(s.slot);
    cells.add(s.cellIndex);
  }
  const map = structuredClone(raw) as MapDefinition;
  map.spawns.sort((a, b) => a.slot - b.slot);
  const open = map.cells.flatMap((c, i) => (c.terrain === "open" ? [i] : [])),
    reached = new Set<number>([open[0]!]),
    queue = [open[0]!];
  for (const cell of queue)
    for (const n of neighbors(map, cell))
      if (map.cells[n]!.terrain === "open" && !reached.has(n)) {
        reached.add(n);
        queue.push(n);
      }
  if (reached.size !== open.length)
    throw new Error("map: open terrain must be connected");
  for (const spawn of map.spawns)
    if (
      !neighbors(map, spawn.cellIndex).some(
        (n) => map.cells[n]!.terrain === "open",
      )
    )
      throw new Error("map: spawn has no expansion neighbor");
  return map;
}
