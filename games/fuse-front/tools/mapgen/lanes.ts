/**
 * Lane maps (design v3): a square map with team 0's base in the south-west corner and team 1's in the north-east, the
 * east half the west half turned about the centre. One mid lane runs corner to corner, or three lanes: top up the
 * west edge and along the north, bot (top's image) along the south and up the east edge. A river runs the other
 * diagonal, bridged where top and bot cross it, forded at mid and once in each half's jungle. The ground between the
 * lanes is jungle: rock clumps thrown Poisson-disc style, and sectors whose flags each get a robot or vehicle factory
 * and a neutral camp slot. Each lane side gets two towers and a gate turret slot. Like `generate`, it is a pure
 * function of the template, checked by the engine's loader (lanes, slots and symmetry) and flow fields.
 */
import {
  STEPS_PER_SECOND,
  STRAIGHT,
  TILE,
  UNITS,
  DIRS,
  buildFlowField,
  loadMap,
  traceLine,
  type Biome,
  type GameMap,
  type Lane,
  type LaneSide,
  type MapFile,
  type Tile,
} from "../../src/engine/index.js";
import { Rand, connectivityFault, imageOf } from "./generate.js";

export interface LaneTemplate {
  name: string;
  seed: number;
  /** The square's side, even. */
  size: number;
  /** Forts, half a side: 2, 4 or 6. */
  players: 2 | 4 | 6;
  biome: Biome;
  /** 1: mid alone; 3: top, mid and bot. */
  lanes: 1 | 3;
  /** Jungle sectors in all, even. */
  jungle: number;
  /** Percent of the jungle factories that build vehicles. */
  vehicles: number;
}

/** A base corner's distance from the map's edges, and the half-size of the open square about it. */
const INSET = 12;
const BASE = 11;
/** A lane is carved this many tiles either side of its path: five tiles wide. */
const HALF_WIDTH = 2;
/** Where a side's outer tower, inner tower and gate stand, as a fraction of its lane's length from its own base. */
const SLOTS = [0.4, 0.22, 0] as const;

/**
 * Turns the walkable ground (`.` and `=`) that tile `from` cannot walk to (8 directions, no corner cutting) into rock,
 * returning per tile whether it was reached. The grid's border must be rock.
 */
function keepReachable(
  grid: string[],
  width: number,
  from: number,
): Uint8Array {
  const walk = (at: number) => grid[at] === "." || grid[at] === "=";
  const reached = new Uint8Array(grid.length);
  const queue = [from];
  reached[from] = 1;
  while (queue.length > 0) {
    const at = queue.pop()!;
    for (const [dx, dy] of DIRS) {
      const to = at + dy * width + dx;
      if (reached[to] || !walk(to)) continue;
      if (dx !== 0 && dy !== 0 && (!walk(at + dx) || !walk(at + dy * width)))
        continue;
      reached[to] = 1;
      queue.push(to);
    }
  }
  for (let at = 0; at < grid.length; at++)
    if (!reached[at] && walk(at)) grid[at] = "#";
  return reached;
}

/** One attempt; undefined when the draw cannot place everything. */
function attempt(t: LaneTemplate, rand: Rand): MapFile | undefined {
  const N = t.size;
  const shape = { width: N, height: N, symmetry: "rotate" as const };
  const image = (p: Tile) => imageOf(shape, p.x, p.y);
  const grid = new Array<string>(N * N).fill(".");
  const get = (x: number, y: number) =>
    x < 1 || y < 1 || x >= N - 1 || y >= N - 1 ? "#" : grid[y * N + x]!;
  /** Sets a tile and its image; the border stays rock. */
  const set = (x: number, y: number, c: string) => {
    if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) return;
    const to = image({ x, y });
    grid[y * N + x] = grid[to.y * N + to.x] = c;
  };
  const c0 = { x: INSET, y: N - 1 - INSET },
    c1 = image(c0);
  const at = (p: Tile, dx: number, dy: number) => ({
    x: p.x + dx,
    y: p.y + dy,
  });
  // The forts stand in a row across the base corner, each with its home flag at (+2, -2).
  const count = t.players / 2;
  const homes = Array.from({ length: count }, (_, k) => {
    const d = ((2 * k - count + 1) * (count === 2 ? 6 : 5)) / 2;
    return at(c0, d - 3, d + 3);
  });
  const mid = [at(c0, 8, -8), image(at(c0, 8, -8))];
  const top = [
    at(c0, 0, -12),
    { x: INSET, y: INSET + 12 },
    { x: INSET + 12, y: INSET },
    at(c1, -12, 0),
  ];
  const paths: [Lane["name"], Tile[]][] =
    t.lanes === 1
      ? [["mid", mid]]
      : [
          ["top", top],
          ["mid", mid],
          ["bot", top.map(image).reverse()],
        ];
  /** Each lane's traced tiles from team 0's base, and every tile's distance (either axis) to the nearest, up to 9. */
  const traced = paths.map(([, path]) => {
    const tiles: Tile[] = [];
    for (let i = 1; i < path.length; i++)
      // Each leg after the first starts on the tile the one before ended on.
      traceLine(path[i - 1]!, path[i]!, (x, y, dx, dy) =>
        i > 1 && dx === 0 && dy === 0 ? true : tiles.push({ x, y }) > 0,
      );
    return tiles;
  });
  const distance = new Uint8Array(N * N).fill(9);
  for (const p of traced.flat())
    for (let dy = -8; dy <= 8; dy++)
      for (let dx = -8; dx <= 8; dx++) {
        const [x, y] = [p.x + dx, p.y + dy];
        if (x >= 0 && y >= 0 && x < N && y < N)
          distance[y * N + x] = Math.min(
            distance[y * N + x]!,
            Math.max(Math.abs(dx), Math.abs(dy)),
          );
      }
  const laneNear = (p: Tile, reach: number) =>
    distance[p.y * N + p.x]! <= reach;
  const nearBase = (p: Tile, reach: number) =>
    [c0, c1].some(
      (c) => Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) <= reach,
    );

  // The river along the other diagonal, then jungle rocks clear of the lanes, the bases and the river's fords.
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) if (Math.abs(x - y) <= 2) set(x, y, "~");
  const ford = Math.round(N * 0.3);
  const clumps: Tile[] = [];
  for (let tries = 0; tries < 900; tries++) {
    const p = { x: rand.range(2, N / 2 - 1), y: rand.range(2, N - 3) };
    const far = (o: Tile) => (o.x - p.x) ** 2 + (o.y - p.y) ** 2 >= 49;
    if (!clumps.every(far) || !clumps.map(image).every(far)) continue;
    if (laneNear(p, HALF_WIDTH + 4) || nearBase(p, BASE + 4)) continue;
    clumps.push(p);
    const [rx, ry] = [rand.range(1, 3), rand.range(1, 3)];
    for (let y = p.y - ry; y <= p.y + ry; y++)
      for (let x = p.x - rx; x <= p.x + rx; x++) {
        const d =
          ((x - p.x) ** 2 * 100) / (rx * rx) +
          ((y - p.y) ** 2 * 100) / (ry * ry);
        if (
          d <= 70 + rand.int(50) &&
          get(x, y) === "." &&
          !laneNear({ x, y }, HALF_WIDTH + 1)
        )
          set(x, y, "#");
      }
  }
  for (let y = ford - 2; y <= ford + 2; y++)
    for (let x = ford - 2; x <= ford + 2; x++) set(x, y, ".");
  for (const [index, [name]] of paths.entries())
    for (const p of traced[index]!)
      for (let y = p.y - HALF_WIDTH; y <= p.y + HALF_WIDTH; y++)
        for (let x = p.x - HALF_WIDTH; x <= p.x + HALF_WIDTH; x++)
          // Top and bot bridge the river (each other's image, so a bridge already laid stays one); mid fords it.
          set(x, y, "~=".includes(get(x, y)) && name !== "mid" ? "=" : ".");
  for (let y = c0.y - BASE; y <= c0.y + BASE; y++)
    for (let x = c0.x - BASE; x <= c0.x + BASE; x++) set(x, y, ".");
  for (let i = 0; i < N; i++)
    grid[i] = grid[(N - 1) * N + i] = grid[i * N] = grid[i * N + N - 1] = "#";

  // Keep only the ground the first fort walks to; the other base must be on it.
  if (!keepReachable(grid, N, homes[0]!.y * N + homes[0]!.x)[c1.y * N + c1.x])
    return;

  // Placement: a tile is free when it and its image are open and unclaimed (and their doors, for a factory).
  const claimed = new Set<number>();
  const open = (x: number, y: number) =>
    get(x, y) === "." && !claimed.has(y * N + x);
  const free = (p: Tile, door: boolean) => {
    const q = image(p);
    return (
      open(p.x, p.y) &&
      open(q.x, q.y) &&
      (!door || (open(p.x, p.y + 1) && open(q.x, q.y + 1)))
    );
  };
  const claim = (p: Tile, door: boolean) => {
    for (const q of [p, image(p)]) {
      claimed.add(q.y * N + q.x);
      if (door) claimed.add((q.y + 1) * N + q.x);
    }
  };
  /** The first free tile within `radius` of `p`, nearest rings first, each ring from a drawn offset. */
  const near = (p: Tile, radius: number, door: boolean): Tile | undefined => {
    for (let r = 1; r <= radius; r++) {
      const ring: Tile[] = [];
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r)
            ring.push(at(p, dx, dy));
      const from = rand.int(ring.length);
      for (let i = 0; i < ring.length; i++) {
        const q = ring[(from + i) % ring.length]!;
        if (free(q, door)) return q;
      }
    }
    return undefined;
  };
  const flags: Tile[] = [],
    camps: Tile[] = [];
  const buildings: MapFile["buildings"] = [];
  const forts: MapFile["forts"] = [];
  for (const [k, fort] of homes.entries()) {
    const home = at(fort, 2, -2);
    if (!free(fort, false) || !free(home, false)) return;
    claim(fort, false);
    claim(home, false);
    forts.push({ seat: 2 * k, ...fort }, { seat: 2 * k + 1, ...image(fort) });
    flags.push(home, image(home));
  }
  // Each lane side's slots: team 0's drawn beside its lane, team 1's the image of team 0's on the image lane.
  const sides = traced.map((tiles, lane) =>
    SLOTS.map((fraction, i) => {
      const index = Math.round(fraction * (tiles.length - 1));
      const p = tiles[index]!,
        q = tiles[Math.min(index + 1, tiles.length - 1)]!;
      // Beside the path, across its direction, towers alternating sides.
      const sign = (lane + i) % 2 === 0 ? 1 : -1;
      const beside = at(
        p,
        -Math.sign(q.y - p.y) * 2 * sign,
        Math.sign(q.x - p.x) * 2 * sign,
      );
      const slot = near(beside, 2, false);
      if (slot !== undefined) claim(slot, false);
      return slot;
    }),
  );
  if (sides.some((slots) => slots.includes(undefined))) return;
  const sideOf = ([outer, inner, gate]: Tile[]): LaneSide => ({
    towers: [outer!, inner!],
    gate: gate!,
  });
  const lanes: Lane[] = paths.map(([name, path], lane) => {
    const twin = sides[paths.length - 1 - lane] as Tile[];
    return {
      name,
      path,
      sides: [sideOf(sides[lane] as Tile[]), sideOf(twin.map(image))],
    };
  });

  // Jungle flags: darts with a shrinking spacing (Poisson-disc) inside the lane ring, clear of lanes, bases, rocks and water.
  const clearAround = (p: Tile) => {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        if (get(p.x + dx, p.y + dy) !== ".") return false;
    return true;
  };
  const want = t.jungle / 2;
  let spacing = Math.floor(Math.sqrt((N * N) / 2 / want));
  const jungle: Tile[] = [];
  for (let tries = 0; jungle.length < want && spacing > 6; tries++) {
    if (tries === 400) [tries, spacing] = [0, spacing - 1];
    const p = {
      x: rand.range(INSET + 1, N / 2 - 1),
      y: rand.range(INSET + 1, N - 2 - INSET),
    };
    const far = (o: Tile) =>
      (o.x - p.x) ** 2 + (o.y - p.y) ** 2 >= spacing * spacing;
    if (
      !free(p, false) ||
      !clearAround(p) ||
      laneNear(p, HALF_WIDTH + 4) ||
      nearBase(p, BASE + 8)
    )
      continue;
    if (!jungle.every(far) || !jungle.map(image).every(far) || !far(image(p)))
      continue;
    claim(p, false);
    jungle.push(p);
  }
  if (jungle.length < want) return;
  for (const flag of jungle) {
    const kind = rand.int(100) < t.vehicles ? "vehicleFactory" : "robotFactory";
    const factory = near(flag, 3, true);
    if (factory === undefined) return;
    claim(factory, true);
    const camp = near(flag, 4, false);
    if (camp === undefined) return;
    claim(camp, false);
    flags.push(flag, image(flag));
    buildings.push({ kind, ...factory }, { kind, ...image(factory) });
    camps.push(camp, image(camp));
  }
  return {
    name: t.name,
    width: N,
    height: N,
    biome: t.biome,
    symmetry: "rotate",
    terrain: Array.from({ length: N }, (_, y) =>
      grid.slice(y * N, y * N + N).join(""),
    ),
    flags,
    buildings,
    forts,
    lanes,
    camps,
  };
}

/** Generates the template's lane map: the first of up to 32 attempts the loader accepts and that joins everything. */
export function generateLanes(template: LaneTemplate): MapFile {
  const { size, players, jungle } = template;
  if (size % 2 !== 0 || size < 96) throw new Error("size: even, at least 96");
  if (jungle % 2 !== 0 || jungle < 2)
    throw new Error("jungle: even, at least 2");
  if (![2, 4, 6].includes(players)) throw new Error("players: 2, 4 or 6");
  const rand = new Rand(template.seed >>> 0);
  for (let tries = 0; tries < 32; tries++) {
    const file = attempt(template, rand);
    if (file === undefined) continue;
    try {
      if (connectivityFault(loadMap(file)) === undefined) return file;
    } catch {
      // A draw the loader refuses (a camp that fell in the next sector, say): draw again.
    }
  }
  throw new Error(`${template.name}: no valid lane map in 32 attempts`);
}

/** Seconds a grunt takes to walk a lane end to end, waypoint to waypoint along the engine's flow fields. */
export function laneWalkSeconds(map: GameMap, lane: Readonly<Lane>): number {
  let cost = 0;
  for (let i = 1; i < lane.path.length; i++) {
    const [a, b] = [lane.path[i - 1]!, lane.path[i]!];
    cost += buildFlowField(map, b.y * map.width + b.x).cost(
      a.y * map.width + a.x,
    );
  }
  return (cost * TILE) / STRAIGHT / UNITS.grunt.speed / STEPS_PER_SECOND;
}
