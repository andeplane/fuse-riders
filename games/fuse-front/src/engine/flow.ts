/**
 * Flow fields over the tile grid: for one goal tile, every tile's walking cost to it and the step to take. Moves go
 * in 8 directions (`STRAIGHT` across, `DIAGONAL` corner to corner) and a diagonal needs both tiles beside it open, so
 * no unit cuts a rock's corner. A field is a pure function of the map and its goal, so fields live in a bounded cache
 * beside the map, never in the world: they are not checkpointed or hashed, and an evicted field is rebuilt bit for bit.
 */
import type { GameMap } from "./map.js";
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

export interface FlowField {
  /** The goal's tile index (`y * width + x`). */
  readonly goal: number;
  /** Per tile: the walking cost to the goal, or `UNREACHABLE`. */
  readonly cost: Int32Array;
  /** Per tile: the `DIRS` index of the next step toward the goal; -1 at the goal and where it is unreachable. */
  readonly next: Int8Array;
}

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

/** A binary min-heap of whole numbers: entries pack (cost, tile) so equal costs pop the lower tile first. */
class Heap {
  private items: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(value: number): void {
    const items = this.items;
    let at = items.length;
    items.push(value);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (items[parent]! <= value) break;
      items[at] = items[parent]!;
      at = parent;
    }
    items[at] = value;
  }
  pop(): number {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      let at = 0;
      for (;;) {
        let child = 2 * at + 1;
        if (child >= items.length) break;
        if (child + 1 < items.length && items[child + 1]! < items[child]!)
          child++;
        if (items[child]! >= last) break;
        items[at] = items[child]!;
        at = child;
      }
      items[at] = last;
    }
    return top;
  }
}

/** Builds the field for `goal` (a tile index): Dijkstra outward from the goal, ties popping the lower tile first. */
export function buildFlowField(map: GameMap, goal: number): FlowField {
  const { width, height } = map;
  const tiles = width * height;
  const cost = new Int32Array(tiles).fill(UNREACHABLE);
  const next = new Int8Array(tiles).fill(-1);
  const gx = goal % width,
    gy = (goal - gx) / width;
  if (goal < 0 || goal >= tiles || !openTile(map, gx, gy))
    return { goal, cost, next };
  cost[goal] = 0;
  const heap = new Heap();
  heap.push(goal);
  const done = new Uint8Array(tiles);
  while (heap.size > 0) {
    const packed = heap.pop();
    const at = packed % tiles;
    if (done[at]) continue;
    done[at] = 1;
    const x = at % width,
      y = (at - x) / width;
    for (let dir = 0; dir < DIRS.length; dir++) {
      // Steps are symmetric, so walking out from the goal finds the costs of walking in.
      if (!canStep(map, x, y, dir)) continue;
      const to = at + DIRS[dir]![1] * width + DIRS[dir]![0];
      const through = cost[at]! + (dir < 4 ? STRAIGHT : DIAGONAL);
      if (through < cost[to]!) {
        cost[to] = through;
        heap.push(through * tiles + to);
      }
    }
  }
  for (let at = 0; at < tiles; at++) {
    if (at === goal || cost[at] === UNREACHABLE) continue;
    const x = at % width,
      y = (at - x) / width;
    let best = UNREACHABLE;
    for (let dir = 0; dir < DIRS.length; dir++) {
      if (!canStep(map, x, y, dir)) continue;
      const to = at + DIRS[dir]![1] * width + DIRS[dir]![0];
      const through = cost[to]! + (dir < 4 ? STRAIGHT : DIAGONAL);
      if (through < best) {
        best = through;
        next[at] = dir;
      }
    }
  }
  return { goal, cost, next };
}

/** Fields kept per map; more than the 64 flags and 6 forts a map can have, so a match never rebuilds one. */
export const FLOW_CACHE_SIZE = 96;

const caches = new WeakMap<GameMap, Map<number, FlowField>>();

/** The field toward `goal` on `map`, from the cache (least recently used goes first when it is full). */
export function flowField(map: GameMap, goal: number): FlowField {
  let cache = caches.get(map);
  if (cache === undefined) {
    cache = new Map();
    caches.set(map, cache);
  }
  const hit = cache.get(goal);
  if (hit !== undefined) {
    cache.delete(goal);
    cache.set(goal, hit);
    return hit;
  }
  const field = buildFlowField(map, goal);
  if (cache.size >= FLOW_CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(goal, field);
  return field;
}

/** Drops a map's cached fields; results never change, only the time to the next field. */
export function clearFlowCache(map: GameMap): void {
  caches.delete(map);
}

/** How many fields the cache holds for a map. */
export const cachedFlowFields = (map: GameMap): number =>
  caches.get(map)?.size ?? 0;
