import { inShape, apart } from "./collide.js";
import { drift, freshBarriers } from "./gadgets.js";
import {
  boxesOf,
  isCircle,
  isSeed,
  type MapDef,
  type Rect,
  type Goal,
} from "./maps.js";
import { SUB } from "./math.js";

const W = 640,
  H = 360,
  RIDER = 9,
  BALL = 8;
const squared = (n: number) => n * n;
/** Integer output, including for seed zero. No ambient or evolving gameplay randomness. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return (n ^ (n >>> 14)) >>> 0;
  };
}
const rect = (x: number, y: number, w: number, h: number): Rect => ({
  x,
  y,
  w,
  h,
});
const flip = (r: Rect): Rect => ({ ...r, x: W - r.x - r.w });

/** Original parameterised construction; it never copies a handmade arena. */
export function levelCandidate(seed: number): MapDef {
  const next = random(seed),
    pick = (n: number) => next() % n;
  const wrapX = pick(2) === 1,
    wrapY = pick(2) === 1,
    kind = pick(4);
  const solids: Rect[] = [],
    goals: Goal[] = [];
  const pair = (r: Rect) => solids.push(r, flip(r));
  const goalPair = (r: Rect) =>
    goals.push({ team: 1, ...r }, { team: 0, ...flip(r) });
  const mouth = 104 + pick(4) * 8,
    height = 88 + pick(4) * 8;
  // Side gaps are real recesses on closed axes, and traversable seams on wrapping axes.
  if (kind === 0 || wrapX) {
    const wall = wrapX ? 12 : 24;
    pair(rect(0, 0, wall, mouth));
    pair(rect(0, mouth + height, wall, H - mouth - height));
    if (!wrapX) pair(rect(0, mouth, 4, height));
    if (kind === 0)
      goalPair(rect(wrapX ? 0 : 4, mouth, wrapX ? 12 : 20, height));
  } else pair(rect(0, 0, 12, H));

  const pits = kind === 1 || kind === 2;
  const start = kind === 2 ? 12 : 72 + pick(3) * 8;
  const width = 64 + pick(4) * 8;
  const holes = pits || wrapY;
  const floor = wrapY ? 344 : pits ? 340 : 344;
  if (holes) {
    pair(rect(0, floor, start, H - floor));
    solids.push(rect(start + width, floor, W - 2 * (start + width), H - floor));
    if (wrapY) {
      pair(rect(0, 0, start, 16));
      solids.push(rect(start + width, 0, W - 2 * (start + width), 16));
    } else {
      solids.push(rect(0, 0, W, 12));
      pair(rect(start, 356, width, 4));
    }
    if (pits) {
      goalPair(rect(start, floor, width, (wrapY ? 360 : 356) - floor));
      if (wrapY) goalPair(rect(start, 0, width, 16));
    }
  } else solids.push(rect(0, 0, W, 12), rect(0, floor, W, H - floor));
  if (kind === 3) {
    const y = 100 + pick(4) * 16,
      r = 18 + pick(3) * 2;
    goals.push({ team: 1, x: 60, y, r }, { team: 0, x: 580, y, r });
  }
  const rows = pick(4);
  for (let row = 0; row < rows; row++) {
    const x = 100 + pick(4) * 16,
      w = 56 + pick(4) * 8;
    pair(rect(x, 160 + row * 64, w, 10));
  }
  if (pick(2)) solids.push(rect(264, pick(4) === 0 ? 96 : 192, 112, 12));
  if (pick(3) === 0) solids.push(rect(314, 272, 12, floor - 272));
  const cloudY = 216 + pick(3) * 16,
    radius = 28 + pick(4) * 4;
  return {
    id: "random",
    name: "Random",
    wrapX,
    wrapY,
    solids,
    goals,
    clouds: pick(2)
      ? [
          { x: 80, y: cloudY, r: radius },
          { x: 560, y: cloudY, r: radius },
        ]
      : [{ x: 320, y: 268, r: radius }],
    spawns: [
      { x: 220, y: floor - RIDER },
      { x: 420, y: floor - RIDER },
    ],
    ballAnchor: { x: 320, y: 100 },
    barriers: [],
    bumpers: [],
    portals: [],
    goo: [],
    streams: [],
  };
}

/** Squared pixel distance to a solid, measured across wrapping seams. */
function gapAt(map: MapDef, x: number, y: number, r: Rect): number {
  const d = apart(x, y, (r.x + r.w / 2) * SUB, (r.y + r.h / 2) * SUB, map);
  const dx = Math.max(0, Math.abs(d.dx) - (r.w * SUB) / 2),
    dy = Math.max(0, Math.abs(d.dy) - (r.h * SUB) / 2);
  return dx * dx + dy * dy;
}
const gap = (map: MapDef, x: number, y: number, r: Rect) =>
  gapAt(map, x * SUB, y * SUB, r);
const freeAt = (map: MapDef, x: number, y: number, radius: number): boolean =>
  (map.wrapX || (x >= radius && x <= W * SUB - radius)) &&
  (map.wrapY || (y >= radius && y <= H * SUB - radius)) &&
  map.solids.every((r) => gapAt(map, x, y, r) >= radius * radius);
export const levelFree = (
  map: MapDef,
  x: number,
  y: number,
  radius: number,
): boolean => freeAt(map, x * SUB, y * SUB, radius * SUB);

/** Flood the ball's free configuration space; infinite air-jumps also let riders use these corridors. */
function reachable(map: MapDef): boolean {
  const size = 8,
    cols = W / size,
    rows = H / size;
  const seen = new Set<number>(),
    queue: number[] = [];
  const add = (x: number, y: number) => {
    if (map.wrapX) x = (x + cols) % cols;
    if (map.wrapY) y = (y + rows) % rows;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const key = y * cols + x;
    if (seen.has(key) || !levelFree(map, x * size + 4, y * size + 4, BALL))
      return;
    seen.add(key);
    queue.push(key);
  };
  const ax = Math.floor(map.ballAnchor.x / size),
    ay = Math.floor(map.ballAnchor.y / size);
  // The anchor can touch a platform exactly; the nearest cell centre may be inside that platform.
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) add(ax + dx, ay + dy);
  for (let at = 0; at < queue.length; at++) {
    const key = queue[at]!,
      x = key % cols,
      y = Math.floor(key / cols);
    add(x - 1, y);
    add(x + 1, y);
    add(x, y - 1);
    add(x, y + 1);
  }
  return [...map.goals, ...map.spawns.map((p) => ({ ...p, r: 16 }))].every(
    (shape) =>
      queue.some((key) => {
        const x = (key % cols) * size + 4,
          y = Math.floor(key / cols) * size + 4;
        return inShape(x * SUB, y * SUB, shape, map);
      }),
  );
}

/** The same drop grid as handmade-map tests, using the engine's autonomous ball flight. */
function deadRest(map: MapDef): string | undefined {
  const boxes = boxesOf(map);
  for (let x = 10; x < W; x += 20)
    for (let y = 15; y < H; y += 30) {
      if (
        !levelFree(map, x, y, BALL) ||
        map.goals.some((g) => inShape(x * SUB, y * SUB, g, map))
      )
        continue;
      for (const vx of [0, 2, -2]) {
        const ball = { x: x * SUB, y: y * SUB, vx: vx * SUB, vy: 0 },
          barriers = freshBarriers(map);
        let still = 0,
          scored = false,
          lastX = -1,
          lastY = -1;
        for (let step = 0; step < 4920; step++) {
          const beforeX = ball.x,
            beforeY = ball.y;
          drift(ball, boxes, map, barriers);
          if (step === 4799) {
            lastX = ball.x;
            lastY = ball.y;
          }
          if (map.goals.some((g) => inShape(ball.x, ball.y, g, map))) {
            scored = true;
            break;
          }
          still = ball.x === beforeX && ball.y === beforeY ? still + 1 : 0;
          if (still >= 120) break;
        }
        if (scored) continue;
        if (still < 120 && (ball.x !== lastX || ball.y !== lastY)) {
          if (!map.wrapY)
            return `moving from ${x},${y} at ${ball.x / SUB},${ball.y / SUB}`;
          continue;
        }
        const bx = ball.x,
          by = ball.y,
          reach = (RIDER + BALL) * SUB;
        if (
          !freeAt(map, bx, by - reach, RIDER * SUB) &&
          !freeAt(map, bx - reach, by - SUB, RIDER * SUB) &&
          !freeAt(map, bx + reach, by - SUB, RIDER * SUB)
        )
          return `rest from ${x},${y} at ${bx},${by} sub-units`;
      }
    }
  return;
}

/** Shared acceptance checks for written and generated maps. Empty means playable. */
export function levelFaults(map: MapDef): string[] {
  const faults: string[] = [];
  const key = (r: Rect) =>
    `${map.wrapX ? (r.x + W) % W : r.x},${map.wrapY ? (r.y + H) % H : r.y},${r.w},${r.h}`;
  const solids = new Set(map.solids.map(key));
  for (const r of map.solids) {
    if (
      ![r.x, r.y, r.w, r.h].every((n) => Number.isInteger(n) && n % 2 === 0) ||
      r.x < 0 ||
      r.y < 0 ||
      r.x >= W ||
      r.y >= H ||
      r.w <= 0 ||
      r.h <= 0 ||
      r.x + r.w > (map.wrapX ? 2 * W : W) ||
      r.y + r.h > (map.wrapY ? 2 * H : H)
    )
      faults.push("solid");
    if (!solids.has(key(flip(r)))) faults.push("symmetry");
  }
  if (
    map.ballAnchor.x !== W / 2 ||
    map.spawns[0].x !== W - map.spawns[1].x ||
    map.spawns[0].y !== map.spawns[1].y ||
    Math.abs(map.spawns[0].x - map.spawns[1].x) <= 4 * RIDER
  )
    faults.push("fairness");
  if (!map.clouds.length) faults.push("clouds");
  for (const c of map.clouds) {
    if (
      ![c.x, c.y, c.r].every(Number.isInteger) ||
      c.r < 2 * BALL ||
      c.x < 0 ||
      c.x > W ||
      c.y < 0 ||
      c.y > H ||
      squared(c.x - map.ballAnchor.x) + squared(c.y - map.ballAnchor.y) <=
        squared(c.r)
    )
      faults.push("cloud");
    if (
      !map.clouds.some(
        (other) => other.x === W - c.x && other.y === c.y && other.r === c.r,
      )
    )
      faults.push("cloud symmetry");
  }
  for (const spawn of map.spawns)
    if (
      !levelFree(map, spawn.x, spawn.y, RIDER) ||
      !map.solids.some((r) => gap(map, spawn.x, spawn.y + RIDER + 1, r) === 0)
    )
      faults.push("spawn");
  if (!levelFree(map, map.ballAnchor.x, map.ballAnchor.y, BALL))
    faults.push("anchor");
  for (const g of map.goals) {
    const x = isCircle(g) ? g.x : g.x + g.w / 2,
      y = isCircle(g) ? g.y : g.y + g.h / 2;
    if (!levelFree(map, x, y, BALL)) faults.push("goal");
    if (
      x > W / 2 !== map.spawns[g.team].x < W / 2 ||
      squared(x - map.ballAnchor.x) + squared(y - map.ballAnchor.y) <= 100 * 100
    )
      faults.push("goal fairness");
    if (
      !map.goals.some(
        (other) =>
          other.team !== g.team &&
          (isCircle(g) && isCircle(other)
            ? other.x === W - g.x && other.y === g.y && other.r === g.r
            : !isCircle(g) && !isCircle(other) && key(other) === key(flip(g))),
      )
    )
      faults.push("goal symmetry");
  }
  if (![0, 1].every((team) => map.goals.some((g) => g.team === team)))
    faults.push("goals");
  const opening = (length: number, open: (at: number) => boolean) => {
    let best = 0,
      run = 0;
    for (let at = 0; at < length; at++) {
      run = open(at) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best;
  };
  const sides = opening(
    H,
    (y) => !map.solids.some((r) => gap(map, 0, y, r) === 0),
  );
  const ends = opening(
    W,
    (x) => !map.solids.some((r) => gap(map, x, 0, r) === 0),
  );
  if (map.wrapX ? sides <= RIDER * 2 + 8 : sides !== 0) faults.push("wrapX");
  if (map.wrapY ? ends <= RIDER * 2 + 8 : ends !== 0) faults.push("wrapY");
  if (!faults.length && !reachable(map)) faults.push("reachability");
  if (!faults.length) {
    const dead = deadRest(map);
    if (dead) faults.push(`dead rest: ${dead}`);
  }
  return faults;
}

/** Bounded work even for adversarial seeds. This original, open-corridor layout is independently tested. */
export const fallbackLevel = (): MapDef => {
  const level = levelCandidate(0);
  return { ...level, solids: level.solids.filter((r) => r.y !== 96) };
};
export function generateLevel(seed: number): MapDef {
  let attempt = isSeed(seed) ? seed : 0;
  for (let count = 0; count < 8; count++) {
    const level = levelCandidate(attempt);
    if (!levelFaults(level).length) return level;
    attempt = (attempt + 0x9e3779b9) >>> 0;
  }
  return fallbackLevel();
}
