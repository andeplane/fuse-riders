import {
  DIAGONAL,
  DIRS,
  STRAIGHT,
  UNREACHABLE,
  openTile,
  type GameMap,
} from "../../src/engine/index.js";

/**
 * The flow field as the engine built it before E4 (eager Dijkstra on a binary heap, then each tile's step from the
 * finished costs), kept as the reference the lazy typed-array field must match tile for tile.
 */
export function referenceField(
  map: GameMap,
  goal: number,
): { cost: Int32Array; next: Int8Array } {
  const { width, height } = map;
  const tiles = width * height;
  const cost = new Int32Array(tiles).fill(UNREACHABLE);
  const next = new Int8Array(tiles).fill(-1);
  const canStep = (x: number, y: number, dir: number): boolean => {
    const [dx, dy] = DIRS[dir]!;
    if (!openTile(map, x + dx, y + dy)) return false;
    return (
      dx === 0 ||
      dy === 0 ||
      (openTile(map, x + dx, y) && openTile(map, x, y + dy))
    );
  };
  const gx = goal % width;
  if (goal < 0 || goal >= tiles || !openTile(map, gx, (goal - gx) / width))
    return { cost, next };
  cost[goal] = 0;
  const heap: number[] = [goal];
  const push = (value: number) => {
    let at = heap.push(value) - 1;
    while (at > 0 && heap[(at - 1) >> 1]! > value) {
      heap[at] = heap[(at - 1) >> 1]!;
      at = (at - 1) >> 1;
    }
    heap[at] = value;
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length === 0) return top;
    let at = 0;
    for (let child = 1; child < heap.length; child = 2 * at + 1) {
      if (child + 1 < heap.length && heap[child + 1]! < heap[child]!) child++;
      if (heap[child]! >= last) break;
      heap[at] = heap[child]!;
      at = child;
    }
    heap[at] = last;
    return top;
  };
  const done = new Uint8Array(tiles);
  while (heap.length > 0) {
    const at = pop() % tiles;
    if (done[at]) continue;
    done[at] = 1;
    const x = at % width,
      y = (at - x) / width;
    for (let dir = 0; dir < DIRS.length; dir++) {
      if (!canStep(x, y, dir)) continue;
      const to = at + DIRS[dir]![1] * width + DIRS[dir]![0];
      const through = cost[at]! + (dir < 4 ? STRAIGHT : DIAGONAL);
      if (through < cost[to]!) {
        cost[to] = through;
        push(through * tiles + to);
      }
    }
  }
  for (let at = 0; at < tiles; at++) {
    if (at === goal || cost[at] === UNREACHABLE) continue;
    const x = at % width,
      y = (at - x) / width;
    let best = UNREACHABLE;
    for (let dir = 0; dir < DIRS.length; dir++) {
      if (!canStep(x, y, dir)) continue;
      const to = at + DIRS[dir]![1] * width + DIRS[dir]![0];
      const through = cost[to]! + (dir < 4 ? STRAIGHT : DIAGONAL);
      if (through < best) [best, next[at]] = [through, dir];
    }
  }
  return { cost, next };
}
