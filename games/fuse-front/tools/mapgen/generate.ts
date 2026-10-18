/**
 * The map generator: a pure function from a template (size, seats, biome, features, flag count) and a seed to a map
 * file that `loadMap` accepts. It draws the west half (x < width / 2) and copies it onto the east half as a mirror
 * image or a half turn, so every seat 2k has the same ground as seat 2k + 1: forts, flags, factories, turrets, rocks,
 * cliffs, lakes and the river's crossings alike. Randomness is the engine's integer mulberry32 stream, so a template
 * and seed always give the same bytes. Ground no fort can walk to is filled with rock, and the result is checked
 * with the engine's own loader and flow fields: every fort and flag must be reachable from fort 0.
 */
import {
  MAX_FLAGS,
  MAX_SITES,
  buildFlowField,
  loadMap,
  next,
  UNREACHABLE,
  type Biome,
  type GameMap,
  type MapFile,
  type Tile,
} from "../../src/engine/index.js";

export interface Template {
  name: string;
  seed: number;
  /** Even, so no tile lies on the axis. */
  width: number;
  height: number;
  /** Forts, half a side: 2, 4 or 6. */
  players: 2 | 4 | 6;
  biome: Biome;
  /** `mirror` flips east–west; `rotate` turns the west half about the centre. */
  symmetry: "mirror" | "rotate";
  /** Flags (sectors) in all, even: 30 to 50 for a big map. */
  flags: number;
  /** A river down the middle and how many bridges and fords cross it (placed in pairs about the middle row). */
  river?: { bridges: number; fords: number };
  /** Cliff-ringed plateaus per half, each with two ramps and a turret. */
  plateaus?: number;
  /** Lakes per half. */
  lakes?: number;
  /** Rock clusters per half. */
  rocks?: number;
  /** Percent of the neutral sectors that get a vehicle factory; most of the rest get a robot factory. */
  vehicles?: number;
}

/** A seeded integer stream (the engine's mulberry32). */
class Rand {
  constructor(private state: number) {}
  /** A whole number in [0, count). */
  int(count: number): number {
    const draw = next(this.state);
    this.state = draw.state;
    return draw.value % count;
  }
  range(low: number, high: number): number {
    return low + this.int(high - low + 1);
  }
}

type Building = MapFile["buildings"][number];

/** The tile a west-half tile maps to on the east half. */
export function imageOf(
  template: Pick<Template, "width" | "height" | "symmetry">,
  x: number,
  y: number,
): Tile {
  const { width, height, symmetry } = template;
  return symmetry === "mirror"
    ? { x: width - 1 - x, y }
    : { x: width - 1 - x, y: height - 1 - y };
}

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** One attempt at a map; undefined when the drawn ground cannot join every fort. */
function attempt(t: Template, rand: Rand): MapFile | undefined {
  const { width: W, height: H } = t;
  const half = W / 2;
  const grid: string[] = new Array<string>(W * H).fill(".");
  const get = (x: number, y: number) =>
    x < 0 || y < 0 || x >= W || y >= H ? "#" : grid[y * W + x]!;
  const set = (x: number, y: number, c: string) => {
    if (x > 0 && y > 0 && x < half && y < H - 1) grid[y * W + x] = c;
  };
  const sides = t.players / 2;
  const forts = Array.from({ length: sides }, (_, k) => ({
    x: 5,
    y: Math.floor((H * (2 * k + 1)) / (2 * sides)),
  }));
  /** Ground kept open: around each fort and its home flag. */
  const reserved = (x: number, y: number) =>
    forts.some((f) => Math.abs(x - f.x - 3) <= 8 && Math.abs(y - f.y) <= 7);
  const blob = (cx: number, cy: number, rx: number, ry: number, c: string) => {
    for (let y = cy - ry - 1; y <= cy + ry + 1; y++)
      for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
        const d =
          ((x - cx) * (x - cx) * 100) / (rx * rx) +
          ((y - cy) * (y - cy) * 100) / (ry * ry);
        if (d <= 70 + rand.int(50) && !reserved(x, y)) set(x, y, c);
      }
  };
  const spot = (margin: number, low = margin, high = half - margin): Tile => ({
    x: rand.range(low, high),
    y: rand.range(margin, H - 1 - margin),
  });

  // The river: a band along the axis whose west bank wanders, crossed by bridges and fords in pairs about the middle.
  const crossings: { y: number; bridge: boolean }[] = [];
  if (t.river) {
    let bank = rand.range(3, 5);
    const banks: number[] = [];
    for (let y = 0; y < H; y++) {
      bank = Math.max(
        2,
        Math.min(6, bank + rand.range(-1, 1) * (rand.int(3) === 0 ? 1 : 0)),
      );
      banks.push(bank);
      for (let x = half - bank; x < half; x++) set(x, y, "~");
    }
    const count = t.river.bridges + t.river.fords;
    for (let i = 0; i < count; i++) {
      // Spread over the top half; the middle row's own pair collapses to one crossing.
      const y = Math.floor(((i + 1) * H) / (2 * count + 1));
      crossings.push({ y, bridge: i < t.river.bridges });
      crossings.push({ y: H - 3 - y, bridge: i < t.river.bridges });
    }
    for (let y = 1; y < H - 1; y++) {
      const near = crossings.some((c) => y >= c.y - 4 && y <= c.y + 7);
      if (!near && rand.int(4) !== 0) set(half - banks[y]! - 1, y, "^");
    }
    for (const c of crossings)
      for (let y = c.y; y < c.y + 3; y++)
        for (let x = half - 8; x < half; x++)
          if (get(x, y) === "~" || get(x, y) === "^")
            set(x, y, c.bridge ? "=" : ".");
  }
  const riverEdge = t.river ? half - 9 : half - 2;

  // Lakes and rock clusters.
  for (let i = 0; i < (t.lakes ?? 0); i++) {
    const at = spot(8, 14, riverEdge - 6);
    blob(at.x, at.y, rand.range(3, 6), rand.range(3, 5), "~");
  }
  for (let i = 0; i < (t.rocks ?? 0); i++) {
    const at = spot(3, 12, riverEdge - 1);
    blob(at.x, at.y, rand.range(1, 3), rand.range(1, 2), "#");
  }
  // Plateaus: a ring of cliff with a ramp on two sides, a turret behind one.
  const turrets: Tile[] = [];
  const plateaus: Tile[] = [];
  for (let i = 0; i < (t.plateaus ?? 0); i++) {
    const at = spot(12, 20, riverEdge - 10);
    const rx = rand.range(5, 8),
      ry = rand.range(4, 6);
    for (let y = at.y - ry; y <= at.y + ry; y++)
      for (let x = at.x - rx; x <= at.x + rx; x++) {
        const edge =
          y === at.y - ry ||
          y === at.y + ry ||
          x === at.x - rx ||
          x === at.x + rx;
        const ramp =
          (Math.abs(x - at.x) <= 1 && y !== at.y) ||
          (Math.abs(y - at.y) <= 1 && x !== at.x);
        if (!reserved(x, y)) set(x, y, edge && !ramp ? "^" : ".");
      }
    plateaus.push(at);
    turrets.push({ x: at.x, y: at.y - ry + 2 });
  }
  for (const c of crossings) turrets.push({ x: riverEdge - 1, y: c.y + 4 });

  // The border, and the east half as the image of the west.
  for (let x = 0; x < W; x++) [grid[x], grid[(H - 1) * W + x]] = ["#", "#"];
  for (let y = 0; y < H; y++) [grid[y * W], grid[y * W + W - 1]] = ["#", "#"];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < half; x++) {
      const to = imageOf(t, x, y);
      grid[to.y * W + to.x] = grid[y * W + x]!;
    }

  // Keep only the ground fort 0 can walk to (8 directions, no corner cutting); every fort must be on it.
  const walk = (c: string) => c === "." || c === "=";
  const reached = new Uint8Array(W * H);
  const start = forts[0]!.y * W + forts[0]!.x;
  const queue = [start];
  reached[start] = 1;
  while (queue.length > 0) {
    const at = queue.pop()!;
    const x = at % W,
      y = (at - x) / W;
    for (const [dx, dy] of STEPS) {
      const to = (y + dy) * W + x + dx;
      if (reached[to] || !walk(get(x + dx, y + dy))) continue;
      if (
        dx !== 0 &&
        dy !== 0 &&
        (!walk(get(x + dx, y)) || !walk(get(x, y + dy)))
      )
        continue;
      reached[to] = 1;
      queue.push(to);
    }
  }
  for (const f of forts) {
    const image = imageOf(t, f.x, f.y);
    if (!reached[f.y * W + f.x] || !reached[image.y * W + image.x]) return;
  }
  for (let at = 0; at < W * H; at++)
    if (!reached[at] && walk(grid[at]!)) grid[at] = "#";

  // Placement: a west tile is free when it and its image are open and unclaimed.
  const claimed = new Set<number>();
  const open = (x: number, y: number) =>
    get(x, y) === "." && !claimed.has(y * W + x);
  const free = (x: number, y: number, door: boolean) => {
    const image = imageOf(t, x, y);
    if (x < 1 || x >= half || !open(x, y) || !open(image.x, image.y))
      return false;
    return !door || (open(x, y + 1) && open(image.x, image.y + 1));
  };
  const claim = (x: number, y: number, door: boolean) => {
    const image = imageOf(t, x, y);
    claimed.add(y * W + x).add(image.y * W + image.x);
    if (door) claimed.add((y + 1) * W + x).add((image.y + 1) * W + image.x);
  };
  /** The first free tile within `radius` of (x, y), nearest rings first, starting at a drawn offset. */
  const near = (
    x: number,
    y: number,
    radius: number,
    door: boolean,
  ): Tile | undefined => {
    for (let r = 1; r <= radius; r++) {
      const ring: Tile[] = [];
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r)
            ring.push({ x: x + dx, y: y + dy });
      const from = rand.int(ring.length);
      for (let i = 0; i < ring.length; i++) {
        const at = ring[(from + i) % ring.length]!;
        if (free(at.x, at.y, door)) return at;
      }
    }
    return undefined;
  };

  const flags: Tile[] = [];
  const buildings: Building[] = [];
  const fortTiles: MapFile["forts"] = [];
  const pair = <T extends Tile>(item: T, list: T[]) => {
    list.push(item, { ...item, ...imageOf(t, item.x, item.y) });
  };
  for (const [k, f] of forts.entries()) {
    claim(f.x, f.y, false);
    fortTiles.push(
      { seat: 2 * k, ...f },
      { seat: 2 * k + 1, ...imageOf(t, f.x, f.y) },
    );
    const home = { x: f.x + 5, y: f.y };
    if (!free(home.x, home.y, false)) return;
    claim(home.x, home.y, false);
    pair(home, flags);
    const factory = near(f.x + 3, f.y + 3, 3, true);
    if (factory === undefined) return;
    claim(factory.x, factory.y, true);
    pair<Building>({ kind: "robotFactory", ...factory }, buildings);
  }
  // The other flags: dart throwing with a shrinking spacing (Poisson-disc), at least 3 tiles from blocked ground.
  const clearAround = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        if (get(x + dx, y + dy) !== ".") return false;
    return true;
  };
  const want = Math.min(t.flags, MAX_FLAGS) / 2;
  let spacing = Math.floor(Math.sqrt((half * H) / want));
  for (let tries = 0; flags.length / 2 < want && spacing > 3; tries++) {
    if (tries === 400) [tries, spacing] = [0, spacing - 1];
    const at = spot(3);
    if (!clearAround(at.x, at.y) || !free(at.x, at.y, false)) continue;
    const far = (o: Tile) =>
      (o.x - at.x) ** 2 + (o.y - at.y) ** 2 >= spacing * spacing;
    if (
      !flags.every(far) ||
      !fortTiles.every(far) ||
      !far(imageOf(t, at.x, at.y))
    )
      continue;
    claim(at.x, at.y, false);
    pair(at, flags);
  }
  // A factory beside most neutral flags; turrets at the crossings and on the plateaus.
  const homes = forts.length * 2;
  for (let i = homes; i < flags.length; i += 2) {
    const roll = rand.int(100);
    const kind =
      roll < (t.vehicles ?? 30)
        ? "vehicleFactory"
        : roll < 85
          ? "robotFactory"
          : undefined;
    const at = kind && near(flags[i]!.x, flags[i]!.y, 3, true);
    if (!kind || !at || buildings.length + fortTiles.length + 2 > MAX_SITES)
      continue;
    claim(at.x, at.y, true);
    pair({ kind, ...at }, buildings);
  }
  for (const guard of turrets) {
    const at = near(guard.x, guard.y, 3, false);
    if (!at || buildings.length + fortTiles.length + 2 > MAX_SITES) continue;
    claim(at.x, at.y, false);
    pair<Building>({ kind: "turret", ...at }, buildings);
  }
  const terrain = Array.from({ length: H }, (_, y) =>
    grid.slice(y * W, y * W + W).join(""),
  );
  return {
    name: t.name,
    width: W,
    height: H,
    terrain,
    flags,
    buildings,
    forts: fortTiles,
    biome: t.biome,
  };
}

/** Why a map fails the generator's checks: a fort or flag fort 0 cannot walk to; undefined when it passes. */
export function connectivityFault(map: GameMap): string | undefined {
  const fort = map.sites.find(
    (site) => site.kind === "fort" && site.seat === 0,
  )!;
  const field = buildFlowField(map, fort.y * map.width + fort.x);
  for (const site of map.sites)
    if (
      site.kind === "fort" &&
      field.cost(site.y * map.width + site.x) === UNREACHABLE
    )
      return `fort ${site.seat} is cut off`;
  for (const [index, flag] of map.flags.entries())
    if (field.cost(flag.y * map.width + flag.x) === UNREACHABLE)
      return `flag ${index} is cut off`;
  return undefined;
}

/** Generates the template's map: the first of up to 32 attempts that loads and joins everything. */
export function generate(template: Template): MapFile {
  const { width, height, players, flags } = template;
  if (width % 2 !== 0) throw new Error("width: even");
  if (flags % 2 !== 0 || flags > MAX_FLAGS)
    throw new Error(`flags: even, at most ${MAX_FLAGS}`);
  if (![2, 4, 6].includes(players)) throw new Error("players: 2, 4 or 6");
  if (height < 16 * (players / 2))
    throw new Error("height: 16 rows per fort a side");
  const rand = new Rand(template.seed >>> 0);
  for (let tries = 0; tries < 32; tries++) {
    const file = attempt(template, rand);
    if (file === undefined) continue;
    try {
      if (connectivityFault(loadMap(file)) === undefined) return file;
    } catch {
      // A drawn map the loader refuses (two forts sharing a home sector, say): draw again.
    }
  }
  throw new Error(`${template.name}: no valid map in 32 attempts`);
}

/** The map file as JSON with one terrain row, flag, building or fort per line. */
export function formatMap(file: MapFile): string {
  const line = (value: unknown) =>
    JSON.stringify(value)
      .replace(/([{,])"/g, '$1 "')
      .replace(/:/g, ": ")
      .replace(/}$/, " }");
  const list = (items: readonly unknown[]) =>
    `[\n${items.map((item) => `    ${line(item)}`).join(",\n")}\n  ]`;
  const { terrain, flags, buildings, forts, ...rest } = file;
  const head = Object.entries(rest).map(
    ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
  );
  return `{\n${head.join(",\n")},\n  "terrain": [\n${terrain.map((row) => `    ${JSON.stringify(row)}`).join(",\n")}\n  ],\n  "flags": ${list(flags)},\n  "buildings": ${list(buildings)},\n  "forts": ${list(forts)}\n}\n`;
}
