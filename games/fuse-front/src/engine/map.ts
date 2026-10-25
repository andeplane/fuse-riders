/**
 * Maps: the JSON a map file holds, and `loadMap`, which validates it and derives what the rules read — each tile's
 * terrain and sector, and every building site (the map's buildings, then its forts by seat) with its sector and
 * door. A map file never draws sector borders: each walkable tile belongs to the nearest flag by 8-direction walking
 * distance (no corner cutting), ties going to the lower flag index. The loaded map is frozen and holds no state, so a
 * peer rebuilds it identically and it stays out of the checkpoint.
 */
import { buildFlowField, UNREACHABLE } from "./flow.js";
import { clamp } from "./math.js";
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
  /** How the ground looks; the rules never read it. Desert when absent. */
  biome?: Biome;
  /** A lane map's lanes (see `Lane`). Optional until the wave rules (v3 M2) require them. */
  lanes?: Lane[];
  /** A lane map's neutral camp slots: exactly one in every jungle sector. */
  camps?: Tile[];
  /** The symmetry the map promises between seat 2k's ground and seat 2k + 1's, which `loadMap` then checks. */
  symmetry?: Symmetry;
}

export const LANE_NAMES = ["top", "mid", "bot"] as const;
export type LaneName = (typeof LANE_NAMES)[number];
export type Symmetry = "mirror" | "rotate";

/** One team's structure slots on a lane: `towers` front line first (outer, inner), then the `gate` turret by its base. */
export interface LaneSide {
  towers: Tile[];
  gate: Tile;
}

/**
 * A lane: `path` runs from team 0's base to team 1's, straight lines between waypoints that walk without cutting a
 * corner (`traceLine`); `sides` holds team 0's slots, then team 1's. Lane ground carries no flag: the sectors off it
 * are the jungle.
 */
export interface Lane {
  name: LaneName;
  path: Tile[];
  sides: LaneSide[];
}

/** How a sector plays: a fort's home, jungle (a lane map's sectors off the lanes) or open ground (older maps). */
export type SectorKind = "home" | "jungle" | "open";

export const BIOMES = ["desert", "arctic", "jungle", "volcanic"] as const;
export type Biome = (typeof BIOMES)[number];

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
  readonly biome: Biome;
  readonly width: number;
  readonly height: number;
  readonly terrain: readonly string[];
  /** Per tile (`y * width + x`): the sector's flag index, or -1 for a tile nothing walks on. */
  readonly sectorOf: readonly number[];
  readonly flags: readonly Readonly<Tile>[];
  readonly sites: readonly Readonly<Site>[];
  /** By sector. */
  readonly sectorKinds: readonly SectorKind[];
  /** Empty on a map without lanes. */
  readonly lanes: readonly Readonly<Lane>[];
  readonly camps: readonly Readonly<Tile>[];
}

export const MAP_MIN = 8;
export const MAP_MAX = 256;
export const MAX_FLAGS = 64;
export const MAX_SITES = 128;
export const MAX_WAYPOINTS = 32;
export const TOWERS_PER_SIDE = 2;
/** A lane's first and last waypoints lie this near (in tiles, either axis) a fort of the team whose base it leaves. */
export const LANE_BASE_REACH = 16;
/** A tower or gate slot lies this near its lane's path. */
export const LANE_SLOT_REACH = 4;
/** No jungle flag lies this near a lane's path: that ground is the lane's. */
export const LANE_CLEAR = 3;

const abs = (value: number) => (value < 0 ? -value : value);
const sign = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0);

/**
 * The tiles of the straight line from `a` to `b` (Bresenham, 8 directions), handed to `visit` with the step taken to
 * reach each one ([0, 0] for `a`); stops early, returning false, as soon as `visit` does.
 */
export function traceLine(
  a: Tile,
  b: Tile,
  visit: (x: number, y: number, dx: number, dy: number) => boolean,
): boolean {
  const dx = abs(b.x - a.x),
    dy = -abs(b.y - a.y);
  const sx = sign(b.x - a.x),
    sy = sign(b.y - a.y);
  let [x, y, err] = [a.x, a.y, dx + dy];
  if (!visit(x, y, 0, 0)) return false;
  while (x !== b.x || y !== b.y) {
    const twice = 2 * err;
    let [mx, my] = [0, 0];
    if (twice >= dy) [err, x, mx] = [err + dy, x + sx, sx];
    if (twice <= dx) [err, y, my] = [err + dx, y + sy, sy];
    if (!visit(x, y, mx, my)) return false;
  }
  return true;
}

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

/**
 * Each tile's nearest flag by walking distance (multi-source BFS, level by level, ties to the lower flag index). A
 * tile first reached on a level takes the lowest flag index among the tiles on the level before that reach it.
 */
function assignSectors(
  width: number,
  height: number,
  open: Uint8Array,
  flags: readonly Tile[],
): number[] {
  const tiles = width * height;
  const owner = new Int32Array(tiles).fill(-1);
  /** The BFS level a tile was reached on, or -1. */
  const depth = new Int32Array(tiles).fill(-1);
  let frontier = new Int32Array(tiles),
    nextLevel = new Int32Array(tiles);
  let count = 0;
  for (const [index, flag] of flags.entries()) {
    const at = flag.y * width + flag.x;
    owner[at] = index;
    depth[at] = 0;
    frontier[count++] = at;
  }
  for (let level = 1; count > 0; level++) {
    let reached = 0;
    for (let i = 0; i < count; i++) {
      const at = frontier[i]!;
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
        if (depth[to]! < 0) {
          depth[to] = level;
          owner[to] = owner[at]!;
          nextLevel[reached++] = to;
        } else if (depth[to] === level && owner[at]! < owner[to]!)
          owner[to] = owner[at]!;
      }
    }
    [frontier, nextLevel] = [nextLevel, frontier];
    count = reached;
  }
  return Array.from(owner);
}

const isInt = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= low &&
  value <= high;

const isList = (
  value: unknown,
  low: number,
  high: number,
): value is unknown[] =>
  Array.isArray(value) && value.length >= low && value.length <= high;

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
  const biome = raw.biome ?? "desert";
  if (!(BIOMES as readonly unknown[]).includes(biome))
    fail(`biome: one of ${BIOMES.join(", ")}`);
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
  const open = new Uint8Array(width * height);
  for (const [y, row] of rows.entries())
    for (let x = 0; x < width; x++)
      open[y * width + x] = row[x] === "." || row[x] === "=" ? 1 : 0;
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

  const map: GameMap & { lanes: Lane[]; camps: Tile[] } = {
    name: name as string,
    biome: biome as Biome,
    width,
    height,
    terrain: [...rows],
    sectorOf,
    flags: flagTiles,
    sites,
    sectorKinds: flagTiles.map((_, sector) =>
      homes.has(sector) ? "home" : raw.lanes === undefined ? "open" : "jungle",
    ),
    lanes: [],
    camps: [],
  };
  if (raw.lanes !== undefined) readLanes(map, raw, open, tile, claim, fail);
  else if (raw.camps !== undefined) fail("camps: only on a map with lanes");
  if (raw.symmetry !== undefined) checkSymmetry(map, raw.symmetry, fail);

  const deepFreeze = <T>(value: T): T => {
    if (typeof value === "object" && value !== null) {
      for (const each of Object.values(value)) deepFreeze(each);
      Object.freeze(value);
    }
    return value;
  };
  return deepFreeze(map);
}

/** Whether any tile of `mask` lies within `reach` tiles (either axis) of `spot`. */
function within(map: GameMap, mask: Uint8Array, spot: Tile, reach: number) {
  const top = clamp(spot.y - reach, 0, map.height - 1),
    bottom = clamp(spot.y + reach, 0, map.height - 1);
  const left = clamp(spot.x - reach, 0, map.width - 1),
    right = clamp(spot.x + reach, 0, map.width - 1);
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++)
      if (mask[y * map.width + x]) return true;
  return false;
}

/**
 * Validates a lane map's lanes and camps into `map` (see `Lane`). Order is measured with the engine's own flow fields
 * from the forts of seats 0 and 1: along a path each waypoint is further from team 0's fort and nearer team 1's, and a
 * side's slots run from the front line to its base, all nearer its own fort than the enemy's.
 */
function readLanes(
  map: GameMap & { lanes: Lane[]; camps: Tile[] },
  raw: Record<string, unknown>,
  open: Uint8Array,
  tile: (value: unknown, label: string) => Tile,
  claim: (spot: Tile, label: string) => void,
  fail: (message: string) => never,
): void {
  const { width } = map;
  const index = (spot: Tile) => spot.y * width + spot.x;
  const isOpen = (spot: Tile) => map.terrain[spot.y]![spot.x] === ".";
  const fields = [0, 1].map((seat) => {
    const fort = map.sites.find((s) => s.kind === "fort" && s.seat === seat)!;
    return buildFlowField(map, index(fort));
  });
  const cost = (team: number, spot: Tile) => fields[team]!.cost(index(spot));
  const nearBase = (spot: Tile, team: number) =>
    map.sites.some(
      (s) =>
        s.kind === "fort" &&
        s.seat % 2 === team &&
        abs(s.x - spot.x) <= LANE_BASE_REACH &&
        abs(s.y - spot.y) <= LANE_BASE_REACH,
    );
  const onLanes = new Uint8Array(open.length);
  // No slot or camp may stand on a factory's door.
  const doors = new Set(
    map.sites
      .filter((s) => s.kind.endsWith("Factory"))
      .map((s) => index(s.door)),
  );
  const blocksDoor = (spot: Tile, at: string) =>
    doors.has(index(spot)) &&
    fail(`${at}: (${spot.x}, ${spot.y}) is a factory's door`);
  const lanes = raw.lanes;
  if (!isList(lanes, 1, LANE_NAMES.length))
    return fail(`lanes: 1 to ${LANE_NAMES.length}`);
  for (const [number, value] of lanes.entries()) {
    const label = `lane ${number}`;
    if (
      !isRecord(value) ||
      !(LANE_NAMES as readonly unknown[]).includes(value.name)
    )
      return fail(`${label}: named ${LANE_NAMES.join(", ")}`);
    const name = value.name as LaneName;
    if (map.lanes.some((lane) => lane.name === name))
      fail(`${label}: a second ${name} lane`);
    if (!isList(value.path, 2, MAX_WAYPOINTS))
      return fail(`${label}: 2 to ${MAX_WAYPOINTS} waypoints`);
    const path = value.path.map((each, i) =>
      tile(each, `${label} waypoint ${i}`),
    );
    const mine = new Uint8Array(open.length);
    for (const [i, point] of path.entries()) {
      const at = `${label} waypoint ${i}`;
      if (!open[index(point)])
        fail(`${at}: (${point.x}, ${point.y}) is not walkable`);
      if (cost(0, point) === UNREACHABLE) fail(`${at}: no fort walks to it`);
      if (i === 0) continue;
      const from = path[i - 1]!;
      const walks = traceLine(from, point, (x, y, dx, dy) => {
        mine[y * width + x] = 1;
        return (
          open[y * width + x] === 1 &&
          (dx === 0 ||
            dy === 0 ||
            (open[y * width + x - dx] === 1 &&
              open[(y - dy) * width + x] === 1))
        );
      });
      if (!walks)
        fail(`${at}: the straight way from waypoint ${i - 1} is blocked`);
      if (cost(0, point) <= cost(0, from) || cost(1, point) >= cost(1, from))
        fail(
          `${at}: not further from team 0's fort and nearer team 1's than waypoint ${i - 1}`,
        );
    }
    if (!nearBase(path[0]!, 0) || !nearBase(path[path.length - 1]!, 1))
      fail(
        `${label}: runs from a team 0 fort to a team 1 fort, ${LANE_BASE_REACH} tiles from each`,
      );
    if (!isList(value.sides, 2, 2)) return fail(`${label}: a side per team`);
    const sides = value.sides.map((side, team): LaneSide => {
      const of = `${label} team ${team}`;
      if (
        !isRecord(side) ||
        !isList(side.towers, TOWERS_PER_SIDE, TOWERS_PER_SIDE)
      )
        return fail(`${of}: ${TOWERS_PER_SIDE} towers and a gate`);
      let before = UNREACHABLE;
      const slots = [...side.towers, side.gate].map((each, i) => {
        const at = i < TOWERS_PER_SIDE ? `${of} tower ${i}` : `${of} gate`;
        const spot = tile(each, at);
        if (!isOpen(spot))
          fail(`${at}: (${spot.x}, ${spot.y}) is not open ground`);
        if (!within(map, mine, spot, LANE_SLOT_REACH))
          fail(`${at}: more than ${LANE_SLOT_REACH} tiles from its lane`);
        if (cost(team, spot) >= cost(1 - team, spot))
          fail(`${at}: on the other team's side`);
        if (cost(team, spot) >= before)
          fail(`${at}: not nearer its base than the slot before`);
        if (i === TOWERS_PER_SIDE && !nearBase(spot, team))
          fail(
            `${at}: more than ${LANE_BASE_REACH} tiles from its team's forts`,
          );
        before = cost(team, spot);
        blocksDoor(spot, at);
        claim(spot, at);
        return spot;
      });
      return {
        towers: slots.slice(0, TOWERS_PER_SIDE),
        gate: slots[TOWERS_PER_SIDE]!,
      };
    });
    for (let at = 0; at < mine.length; at++) onLanes[at]! |= mine[at]!;
    map.lanes.push({ name, path, sides });
  }
  for (const [i, flag] of map.flags.entries())
    if (
      map.sectorKinds[i] === "jungle" &&
      within(map, onLanes, flag, LANE_CLEAR)
    )
      fail(`flag ${i}: (${flag.x}, ${flag.y}) is on lane ground`);
  if (!isList(raw.camps, 0, MAX_FLAGS))
    return fail(`camps: a list of at most ${MAX_FLAGS}`);
  const camps = new Array<number>(map.flags.length).fill(0);
  const factories = [...camps];
  for (const [i, value] of raw.camps.entries()) {
    const spot = tile(value, `camp ${i}`);
    if (!isOpen(spot))
      fail(`camp ${i}: (${spot.x}, ${spot.y}) is not open ground`);
    if (within(map, onLanes, spot, LANE_CLEAR))
      fail(`camp ${i}: (${spot.x}, ${spot.y}) is on lane ground`);
    blocksDoor(spot, `camp ${i}`);
    claim(spot, `camp ${i}`);
    const sector = map.sectorOf[index(spot)]!;
    if (map.sectorKinds[sector] !== "jungle")
      fail(`camp ${i}: not in a jungle sector`);
    camps[sector]!++;
    map.camps.push(spot);
  }
  for (const site of map.sites)
    if (site.kind === "robotFactory" || site.kind === "vehicleFactory")
      factories[site.sector]!++;
  for (const [sector, kind] of map.sectorKinds.entries())
    if (kind === "jungle" && (camps[sector] !== 1 || factories[sector] === 0))
      fail(`sector ${sector}: a jungle sector holds one camp and a factory`);
}

/** Checks the map is its own image under `symmetry`, seat 2k's fort and side matching seat 2k + 1's. */
function checkSymmetry(
  map: GameMap,
  symmetry: unknown,
  fail: (message: string) => never,
): void {
  if (symmetry !== "mirror" && symmetry !== "rotate")
    return fail("symmetry: mirror or rotate");
  const { width, height } = map;
  const image = (t: Tile): Tile =>
    symmetry === "mirror"
      ? { x: width - 1 - t.x, y: t.y }
      : { x: width - 1 - t.x, y: height - 1 - t.y };
  const key = (t: Tile) => t.y * width + t.x;
  const where = (t: Tile) => `(${t.x}, ${t.y})`;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const to = image({ x, y });
      if (map.terrain[y]![x] !== map.terrain[to.y]![to.x])
        fail(`symmetry: terrain at ${where({ x, y })} differs from its image`);
    }
  for (const [label, list] of [
    ["flag", map.flags],
    ["camp", map.camps],
  ] as const) {
    const keys = new Set(list.map(key));
    for (const t of list)
      if (!keys.has(key(image(t))))
        fail(`symmetry: the ${label} at ${where(t)} has no image`);
  }
  const sites = new Map(map.sites.map((s) => [key(s), s]));
  for (const site of map.sites) {
    const other = sites.get(key(image(site)));
    if (
      other?.kind !== site.kind ||
      (site.kind === "fort" && other.seat !== (site.seat ^ 1))
    )
      fail(`symmetry: the ${site.kind} at ${where(site)} has no image`);
  }
  const keysOf = (tiles: readonly Tile[]) => tiles.map(key).join();
  const slots = (side: LaneSide | undefined, turn: boolean) =>
    side === undefined
      ? ""
      : keysOf([...side.towers, side.gate].map(turn ? image : (t) => t));
  for (const lane of map.lanes) {
    const path = keysOf(lane.path.map(image).reverse());
    // A half turn swaps top and bot; a mirror keeps each lane's name.
    const name =
      symmetry === "mirror" || lane.name === "mid"
        ? lane.name
        : lane.name === "top"
          ? "bot"
          : "top";
    const twin = map.lanes.find((other) => keysOf(other.path) === path);
    if (
      twin?.name !== name ||
      [0, 1].some(
        (team) =>
          slots(lane.sides[team], true) !== slots(twin.sides[1 - team], false),
      )
    )
      fail(`symmetry: the ${lane.name} lane has no image`);
  }
}

/** The sector of a tile, or -1 off the map or on a tile nothing walks on. */
export function sectorAt(map: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1;
  return map.sectorOf[ty * map.width + tx]!;
}

/** The flag index on a tile, or -1. */
export function flagAt(map: GameMap, tx: number, ty: number): number {
  // A flag's own tile always lies in its sector, so the sector names the only flag that can stand there.
  const sector = sectorAt(map, tx, ty);
  const flag = map.flags[sector];
  return flag !== undefined && flag.x === tx && flag.y === ty ? sector : -1;
}
