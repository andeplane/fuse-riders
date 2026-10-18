/**
 * Flow fields over the tile grid: for one goal tile, every tile's walking cost to it and the step to take. Moves go
 * in 8 directions (`STRAIGHT` across, `DIAGONAL` corner to corner) and a diagonal needs both tiles beside it open, so
 * no unit cuts a rock's corner. A field is a pure function of the map and its goal, so fields live in a bounded cache
 * beside the map, never in the world: they are not checkpointed or hashed, and an evicted field is rebuilt bit for bit.
 *
 * A field is built lazily: Dijkstra outward from the goal, settling tiles in cost order only until the tile asked
 * about is settled (or nothing is left), and resuming on the next question. A settled tile's cost is final, and its
 * step is the first `DIRS` direction to a cheapest neighbour; every such neighbour is cheaper, so already settled, and
 * any neighbour still waiting costs more. So a tile's answer never depends on how far the field had grown, and a
 * follower asking about the few tiles around its hero settles only those. Costs and steps live in typed arrays
 * (`Int32Array`, `Int8Array`: 5 bytes a tile), and the roaming cache is sized to the map so it stays near
 * `ROAMING_FLOW_BYTES`.
 */
import type { GameMap } from "./map.js";
import { div } from "./math.js";
import { DIAGONAL, STRAIGHT } from "./tuning.js";

/** The cost of a tile no path reaches the goal from. */
export const UNREACHABLE = 0x7fff_ffff;

/** Straight steps first, so a tie between equal paths takes the straight step. */
export const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/** Whether a tile can be walked on: everything walkable has a sector (`loadMap` refuses a map where it does not). */
export const openTile = (map: GameMap, tx: number, ty: number): boolean =>
  tx >= 0 &&
  ty >= 0 &&
  tx < map.width &&
  ty < map.height &&
  map.sectorOf[ty * map.width + tx]! >= 0;

/** Whether one step from (x, y) in direction `dir` lands on open ground without cutting a corner. */
function canStep(map: GameMap, x: number, y: number, dir: number): boolean {
  const [dx, dy] = DIRS[dir]!;
  if (!openTile(map, x + dx, y + dy)) return false;
  return (
    dx === 0 ||
    dy === 0 ||
    (openTile(map, x + dx, y) && openTile(map, x, y + dy))
  );
}

/** Per tile, a bit per `DIRS` direction it can step in; built once per map. */
const stepMasks = new WeakMap<GameMap, Uint8Array>();
function stepsOf(map: GameMap): Uint8Array {
  let masks = stepMasks.get(map);
  if (masks !== undefined) return masks;
  masks = new Uint8Array(map.width * map.height);
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      if (!openTile(map, x, y)) continue;
      let mask = 0;
      for (let dir = 0; dir < DIRS.length; dir++)
        if (canStep(map, x, y, dir)) mask |= 1 << dir;
      masks[y * map.width + x] = mask;
    }
  stepMasks.set(map, masks);
  return masks;
}

/** Buckets in a field's queue: more than the heaviest step, so waiting costs never share one. */
const BUCKETS = 16;
if (DIAGONAL >= BUCKETS || STRAIGHT >= BUCKETS)
  throw new Error("flow: a step outweighs the bucket queue");

/** A tile's step before it is settled. */
const PENDING = -2;

/** The walking costs and steps toward one goal, settled on demand (see the file comment). */
export class FlowField {
  /** The goal's tile index (`y * width + x`). */
  readonly goal: number;
  private readonly costs: Int32Array;
  private readonly steps: Int8Array;
  private readonly masks: Uint8Array;
  private readonly offsets: Int32Array;
  /**
   * A bucket queue: tiles waiting at cost c sit in `buckets[c % BUCKETS]`. Every waiting cost lies within a step's
   * weight of `level`, the cost being settled, so the buckets never mix two costs. Undefined once exhausted.
   */
  private buckets: number[][] | undefined;
  private level = 0;
  private queued = 0;

  constructor(map: GameMap, goal: number) {
    const { width, height } = map;
    const tiles = width * height;
    this.goal = goal;
    this.costs = new Int32Array(tiles).fill(UNREACHABLE);
    this.steps = new Int8Array(tiles).fill(PENDING);
    this.masks = stepsOf(map);
    this.offsets = Int32Array.from(DIRS, ([dx, dy]) => dy * width + dx);
    if (goal < 0 || goal >= tiles || this.masks[goal] === 0) {
      // Off the map or on blocked ground: nothing reaches it (a walkable tile with no step out is shut in).
      this.steps.fill(-1);
      if (
        goal >= 0 &&
        goal < tiles &&
        openTile(map, goal % width, div(goal, width))
      )
        [this.costs[goal], this.steps[goal]] = [0, -1];
      return;
    }
    this.costs[goal] = 0;
    this.buckets = Array.from({ length: BUCKETS }, () => []);
    this.buckets[0]!.push(goal);
    this.queued = 1;
  }

  /** The walking cost from `tile` to the goal, or `UNREACHABLE`. */
  cost(tile: number): number {
    this.settle(tile);
    return this.costs[tile]!;
  }

  /** The `DIRS` index of the next step from `tile` toward the goal; -1 at the goal and where it is unreachable. */
  next(tile: number): number {
    this.settle(tile);
    return this.steps[tile]!;
  }

  /** Every tile's cost and step, the field settled in full (for tests and tools). */
  snapshot(): { cost: Int32Array; next: Int8Array } {
    this.settle(-1);
    return { cost: this.costs.slice(), next: this.steps.slice() };
  }

  /** Settles tiles in cost order until `tile` is settled, or all of them when it is -1 or never reached. */
  private settle(tile: number): void {
    const { costs, steps, masks, offsets, buckets } = this;
    if (buckets === undefined) return;
    while (this.queued > 0 && (tile < 0 || steps[tile] === PENDING)) {
      let bucket = buckets[this.level % BUCKETS]!;
      while (bucket.length === 0) bucket = buckets[++this.level % BUCKETS]!;
      const at = bucket.pop()!;
      this.queued--;
      // A tile queued again at a lower cost leaves its old entry behind.
      if (steps[at] !== PENDING || costs[at] !== this.level) continue;
      const here = this.level,
        mask = masks[at]!;
      // Its step: the first direction to a cheapest neighbour, all of them settled already.
      let best = UNREACHABLE,
        step = -1;
      for (let dir = 0; dir < 8; dir++) {
        if ((mask & (1 << dir)) === 0) continue;
        const to = at + offsets[dir]!;
        const weight = dir < 4 ? STRAIGHT : DIAGONAL;
        if (steps[to] !== PENDING) {
          if (costs[to]! + weight < best) {
            best = costs[to]! + weight;
            step = dir;
          }
          continue;
        }
        // Steps are symmetric, so walking out from the goal finds the costs of walking in.
        if (here + weight < costs[to]!) {
          costs[to] = here + weight;
          buckets[(here + weight) % BUCKETS]!.push(to);
          this.queued++;
        }
      }
      steps[at] = at === this.goal ? -1 : step;
    }
    if (this.queued === 0) {
      // Exhausted: whatever is still pending is unreachable.
      for (let at = 0; at < steps.length; at++)
        if (steps[at] === PENDING) steps[at] = -1;
      this.buckets = undefined;
    }
  }
}

/** A fresh field for `goal` (a tile index), outside any cache. */
export function buildFlowField(map: GameMap, goal: number): FlowField {
  return new FlowField(map, goal);
}

/**
 * Fields kept per map in two bounded LRU caches. The fixed one serves the goals a map and its stances produce: at most
 * its 64 flags and 6 forts. The roaming one serves tiles a player steers: each hero's `move` goal and the tile FOLLOW
 * units walk to (`FOLLOW_HERO`). Keeping them apart means a player who sends a `move` to a new tile every tick can
 * only churn the roaming cache, never evict the flag and fort fields every unit's stance uses. The roaming cache
 * holds `ROAMING_FLOW_CACHE_SIZE` fields on a small map and fewer on a big one (`flowCacheSize`), never below
 * `ROAMING_FLOW_CACHE_MIN`.
 */
export const FLOW_CACHE_SIZE = 96;
export const ROAMING_FLOW_CACHE_SIZE = 24;
export const ROAMING_FLOW_CACHE_MIN = 12;
export const ROAMING_FLOW_BYTES = 4 << 20;
/** The bytes one field holds: a cost and a step per tile. */
export const flowFieldBytes = (map: GameMap): number =>
  map.width * map.height * 5;

/** How many fields each cache keeps for `map`. */
export function flowCacheSize(map: GameMap): {
  fixed: number;
  roaming: number;
} {
  const fit = div(ROAMING_FLOW_BYTES, flowFieldBytes(map));
  const roaming =
    fit > ROAMING_FLOW_CACHE_SIZE
      ? ROAMING_FLOW_CACHE_SIZE
      : fit < ROAMING_FLOW_CACHE_MIN
        ? ROAMING_FLOW_CACHE_MIN
        : fit;
  return { fixed: FLOW_CACHE_SIZE, roaming };
}

interface Caches {
  fixed: Map<number, FlowField>;
  roaming: Map<number, FlowField>;
  size: { fixed: number; roaming: number };
}
const caches = new WeakMap<GameMap, Caches>();

/** The field toward `goal` on `map`, from its cache (least recently used goes first when it is full). */
export function flowField(
  map: GameMap,
  goal: number,
  roaming = false,
): FlowField {
  let both = caches.get(map);
  if (both === undefined) {
    both = { fixed: new Map(), roaming: new Map(), size: flowCacheSize(map) };
    caches.set(map, both);
  }
  const cache = roaming ? both.roaming : both.fixed;
  const hit = cache.get(goal);
  if (hit !== undefined) {
    cache.delete(goal);
    cache.set(goal, hit);
    return hit;
  }
  const field = new FlowField(map, goal);
  const size = roaming ? both.size.roaming : both.size.fixed;
  if (cache.size >= size) cache.delete(cache.keys().next().value!);
  cache.set(goal, field);
  return field;
}

/** Drops a map's cached fields; results never change, only the time to the next field. */
export function clearFlowCache(map: GameMap): void {
  caches.delete(map);
}

/** How many fields the caches hold for a map. */
export const cachedFlowFields = (map: GameMap): number => {
  const both = caches.get(map);
  return both === undefined ? 0 : both.fixed.size + both.roaming.size;
};
