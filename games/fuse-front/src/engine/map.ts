/**
 * Maps: the JSON a map file holds, and `loadMap`, which validates it and derives what the rules read — each tile's
 * terrain and sector, and every building site (the map's buildings, then its forts by seat) with its sector and
 * door. A map file never draws sector borders: each walkable tile belongs to the nearest flag by 8-direction walking
 * distance (no corner cutting), ties going to the lower flag index. The loaded map is frozen and holds no state, so a
 * peer rebuilds it identically and it stays out of the checkpoint.
 */
import { BUILDING_KINDS, MAX_SEATS, type BuildingKind } from "./tuning.js";

export const TERRAIN = {
  ".": "open",
  "#": "rock",
  "~": "water",
  "=": "bridge",
  "^": "cliff",
} as const;
export type Terrain = (typeof TERRAIN)[keyof typeof TERRAIN];

export interface Tile {
  x: number;
  y: number;
}

/** The file format. Coordinates are tiles, (0, 0) at the top left; `terrain` is one string per row. */
export interface MapFile {
  name: string;
  width: number;
  height: number;
  terrain: string[];
  flags: Tile[];
  buildings: { kind: Exclude<BuildingKind, "fort">; x: number; y: number }[];
  forts: { seat: number; x: number; y: number }[];
}

export interface Site {
  /** Its index in `GameMap.sites`, and the id of the building standing on it. */
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  sector: number;
  /** The fort's seat; -1 for every other building. */
  seat: number;
  /** The tile a factory's units step out onto, below the building. */
  door: Tile;
}

export interface GameMap {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly terrain: readonly string[];
  /** Per tile (`y * width + x`): the sector's flag index, or -1 for a tile nothing walks on. */
  readonly sectorOf: readonly number[];
  readonly flags: readonly Readonly<Tile>[];
  readonly sites: readonly Readonly<Site>[];
}

export const MAP_MIN = 8;
export const MAP_MAX = 256;
export const MAX_FLAGS = 64;
export const MAX_SITES = 128;

export class MapError extends Error {}

export const terrainAt = (map: GameMap, x: number, y: number): Terrain =>
  TERRAIN[map.terrain[y]![x] as keyof typeof TERRAIN];

export const walkable = (terrain: Terrain): boolean =>
  terrain === "open" || terrain === "bridge";

const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Each tile's nearest flag by walking distance (multi-source BFS, level by level, ties to the lower flag index). */
function assignSectors(
  width: number,
  height: number,
  open: readonly boolean[],
  flags: readonly Tile[],
): number[] {
  const owner = new Array<number>(width * height).fill(-1);
  let frontier: number[] = [];
  for (const [index, flag] of flags.entries()) {
    const at = flag.y * width + flag.x;
    owner[at] = index;
    frontier.push(at);
  }
  const reached = owner.map((value) => value >= 0);
  while (frontier.length > 0) {
    const nextLevel: number[] = [];
    const level = new Set<number>();
    for (const at of frontier) {
      const x = at % width,
        y = (at - x) / width;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!open[ny * width + nx]) continue;
        // A diagonal needs both tiles beside it open: no cutting a rock's corner.
        if (dx !== 0 && dy !== 0)
          if (!open[y * width + nx] || !open[ny * width + x]) continue;
        const to = ny * width + nx;
        if (!reached[to]) {
          reached[to] = true;
          owner[to] = owner[at]!;
          level.add(to);
          nextLevel.push(to);
        } else if (level.has(to) && owner[at]! < owner[to]!)
          owner[to] = owner[at]!;
      }
    }
    frontier = nextLevel;
  }
  return owner;
}

const isInt = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= low &&
  value <= high;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates a parsed map file and derives its sectors and sites, or throws a `MapError` naming the first fault. */
export function loadMap(raw: unknown): GameMap {
  const fail = (message: string): never => {
    throw new MapError(message);
  };
  if (!isRecord(raw)) return fail("a map is a JSON object");
  const { name, width, height, terrain, flags, buildings, forts } = raw;
  if (typeof name !== "string" || name.length < 1 || name.length > 40)
    fail("name: 1 to 40 characters");
  if (!isInt(width, MAP_MIN, MAP_MAX) || !isInt(height, MAP_MIN, MAP_MAX))
    return fail(`width and height: whole numbers ${MAP_MIN} to ${MAP_MAX}`);
  if (!Array.isArray(terrain) || terrain.length !== height)
    return fail(`terrain: ${height} rows`);
  for (const [y, row] of terrain.entries()) {
    if (typeof row !== "string" || row.length !== width)
      fail(`terrain row ${y}: ${width} characters`);
    for (const char of row as string)
      if (!(char in TERRAIN))
        fail(`terrain row ${y}: unknown terrain '${char}'`);
  }
  const rows = terrain as string[];
  const at = (x: number, y: number): Terrain =>
    TERRAIN[rows[y]![x] as keyof typeof TERRAIN];
  const open = rows.flatMap((row) =>
    [...row].map((char) => walkable(TERRAIN[char as keyof typeof TERRAIN])),
  );
  const taken = new Map<number, string>();
  const tile = (value: unknown, label: string): Tile => {
    if (!isRecord(value)) return fail(`${label}: an object with x and y`);
    const { x, y } = value;
    if (!isInt(x, 0, width - 1) || !isInt(y, 0, height - 1))
      return fail(`${label}: (${String(x)}, ${String(y)}) is off the map`);
    return { x, y };
  };
  const claim = (spot: Tile, label: string): void => {
    const key = spot.y * width + spot.x;
    const other = taken.get(key);
    if (other !== undefined)
      fail(`${label}: (${spot.x}, ${spot.y}) is already ${other}`);
    taken.set(key, label);
  };

  if (!Array.isArray(flags) || flags.length < 1 || flags.length > MAX_FLAGS)
    return fail(`flags: 1 to ${MAX_FLAGS}`);
  const flagTiles = flags.map((value: unknown, index) => {
    const spot = tile(value, `flag ${index}`);
    if (!walkable(at(spot.x, spot.y)))
      fail(`flag ${index}: (${spot.x}, ${spot.y}) is not walkable`);
    claim(spot, `flag ${index}`);
    return spot;
  });
  const sectorOf = assignSectors(width, height, open, flagTiles);
  for (const [index, sector] of sectorOf.entries())
    if (open[index] && sector < 0)
      fail(
        `terrain: (${index % width}, ${(index - (index % width)) / width}) is walkable but no flag reaches it`,
      );

  if (!Array.isArray(buildings) || !Array.isArray(forts))
    return fail("buildings and forts: arrays");
  if (buildings.length + forts.length > MAX_SITES)
    fail(`buildings and forts: at most ${MAX_SITES}`);
  const sites: Site[] = [];
  const place = (
    value: unknown,
    kind: BuildingKind,
    seat: number,
    label: string,
  ): void => {
    const spot = tile(value, label);
    if (at(spot.x, spot.y) !== "open")
      fail(`${label}: (${spot.x}, ${spot.y}) is not open ground`);
    claim(spot, label);
    const door = { x: spot.x, y: spot.y + 1 };
    if (kind === "robotFactory" || kind === "vehicleFactory") {
      if (door.y >= height || !walkable(at(door.x, door.y)))
        fail(`${label}: its door (${door.x}, ${door.y}) is not walkable`);
    }
    sites.push({
      id: sites.length,
      kind,
      x: spot.x,
      y: spot.y,
      sector: sectorOf[spot.y * width + spot.x]!,
      seat,
      door,
    });
  };
  for (const [index, value] of buildings.entries()) {
    const kind = isRecord(value) ? value.kind : undefined;
    if (
      typeof kind !== "string" ||
      kind === "fort" ||
      !(BUILDING_KINDS as readonly string[]).includes(kind)
    )
      fail(`building ${index}: unknown kind ${String(kind)}`);
    place(value, kind as BuildingKind, -1, `building ${index}`);
  }
  const seats = new Set<number>();
  const homes = new Map<number, number>();
  const ordered = [...(forts as unknown[])].sort(
    (a, b) =>
      (isRecord(a) && isInt(a.seat, 0, MAX_SEATS) ? a.seat : MAX_SEATS) -
      (isRecord(b) && isInt(b.seat, 0, MAX_SEATS) ? b.seat : MAX_SEATS),
  );
  for (const value of ordered) {
    const seat = isRecord(value) ? value.seat : undefined;
    if (!isInt(seat, 0, MAX_SEATS - 1))
      return fail(`fort: seat ${String(seat)} is not 0 to ${MAX_SEATS - 1}`);
    if (seats.has(seat)) fail(`fort: seat ${seat} has two forts`);
    seats.add(seat);
    place(value, "fort", seat, `fort ${seat}`);
    const home = sites[sites.length - 1]!.sector;
    const other = homes.get(home);
    if (other !== undefined)
      fail(`fort ${seat}: shares home sector ${home} with fort ${other}`);
    homes.set(home, seat);
  }
  if (!seats.has(0) || !seats.has(1))
    fail("forts: seats 0 and 1 need one each, so a duel can be played");
  // Doors last, once every site is placed: no door may open into another building.
  for (const site of sites)
    if (site.kind === "robotFactory" || site.kind === "vehicleFactory") {
      const other = taken.get(site.door.y * width + site.door.x);
      if (other !== undefined && !other.startsWith("flag"))
        fail(`${site.kind} at (${site.x}, ${site.y}): its door is ${other}`);
    }

  const deepFreeze = <T>(value: T): T => {
    if (typeof value === "object" && value !== null) {
      for (const each of Object.values(value)) deepFreeze(each);
      Object.freeze(value);
    }
    return value;
  };
  return deepFreeze({
    name: name as string,
    width,
    height,
    terrain: [...rows],
    sectorOf,
    flags: flagTiles,
    sites,
  });
}

/** The sector of a tile, or -1 off the map or on a tile nothing walks on. */
export function sectorAt(map: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1;
  return map.sectorOf[ty * map.width + tx]!;
}

/** The flag index on a tile, or -1. */
export function flagAt(map: GameMap, tx: number, ty: number): number {
  return map.flags.findIndex((flag) => flag.x === tx && flag.y === ty);
}
