import { inShape, apart } from "./collide.js";
import { drift, freshBarriers } from "./gadgets.js";
import { isCircle, isSeed, type MapDef, type Rect, type Goal } from "./maps.js";
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
    ledges: [],
    movers: [],
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
          const by = drift(ball, map, barriers, step + 1);
          if (step === 4799) {
            lastX = ball.x;
            lastY = ball.y;
          }
          if (map.goals.some((g) => inShape(ball.x, ball.y, g, map))) {
            scored = true;
            break;
          }
          // Lying on a mover is at rest too: it has gone only as far as the mover took it.
          still =
            ball.x === beforeX + by.x && ball.y === beforeY + by.y
              ? still + 1
              : 0;
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

const overlap = (a: Rect, b: Rect, margin = 0): boolean =>
  a.x < b.x + b.w + margin &&
  b.x < a.x + a.w + margin &&
  a.y < b.y + b.h + margin &&
  b.y < a.y + a.h + margin;
const around = (x: number, y: number, r: number): Rect =>
  rect(x - r, y - r, 2 * r, 2 * r);
const even = (r: Rect): boolean =>
  [r.x, r.y, r.w, r.h].every((n) => Number.isInteger(n) && n % 2 === 0) &&
  r.w > 0 &&
  r.h > 0;
const inField = (r: Rect): boolean =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
/** Everything a mover passes over, end to end. */
export const sweepOf = (mover: MapDef["movers"][number]): Rect =>
  rect(
    Math.min(mover.x, mover.x + mover.travel.x),
    Math.min(mover.y, mover.y + mover.travel.y),
    mover.w + Math.abs(mover.travel.x),
    mover.h + Math.abs(mover.travel.y),
  );
/** Room for a rider between a mover at the end of its travel and whatever is past it, so nothing is crushed. */
const CRUSH = 2 * RIDER + 4;

/**
 * What is wrong with a map's gadgets: each kind on whole even pixels inside the field, clear of the solids and of
 * each other by enough that the ball is never wedged, and its own mirror image left to right.
 */
export function gadgetFaults(map: MapDef): string[] {
  const faults: string[] = [];
  const mirrored = (
    rects: readonly Rect[],
    same: (a: Rect, b: Rect) => boolean,
  ) => rects.every((r) => rects.some((other) => same(flip(r), other)));
  const sameRect = (a: Rect, b: Rect) =>
    a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

  for (const kind of ["field", "gate"] as const) {
    const barriers = map.barriers.filter((b) => b.kind === kind);
    if (!mirrored(barriers, sameRect)) faults.push("barrier symmetry");
  }
  for (const barrier of map.barriers) {
    if (!even(barrier) || !inField(barrier)) faults.push("barrier");
    if (barrier.kind === "field" && !(barrier.hits >= 2 && barrier.hits <= 9))
      faults.push("field hits");
    if (map.solids.some((solid) => overlap(barrier, solid)))
      faults.push("barrier in a solid");
  }

  for (const bumper of map.bumpers) {
    const box = around(bumper.x, bumper.y, bumper.r);
    if (
      ![bumper.x, bumper.y, bumper.r].every(Number.isInteger) ||
      bumper.r < BALL ||
      !inField(box)
    )
      faults.push("bumper");
    if (
      !map.bumpers.some(
        (o) => o.x === W - bumper.x && o.y === bumper.y && o.r === bumper.r,
      )
    )
      faults.push("bumper symmetry");
    // Clear of every solid by more than the ball, so the ball is never wedged between the two.
    if (
      [...map.solids, ...map.ledges, ...map.movers.map(sweepOf)].some((solid) =>
        overlap(box, solid, 2 * BALL + 2),
      )
    )
      faults.push("bumper near a solid");
    if (
      map.goals.some((goal) =>
        overlap(box, isCircle(goal) ? around(goal.x, goal.y, goal.r) : goal),
      )
    )
      faults.push("bumper in a goal");
    if (
      map.bumpers.some(
        (o) =>
          o !== bumper &&
          squared(o.x - bumper.x) + squared(o.y - bumper.y) <=
            squared(o.r + bumper.r + 2 * BALL),
      )
    )
      faults.push("bumpers too close");
    if (
      squared(bumper.x - map.ballAnchor.x) +
        squared(bumper.y - map.ballAnchor.y) <=
        squared(bumper.r + BALL) ||
      map.spawns.some(
        (spawn) =>
          squared(bumper.x - spawn.x) + squared(bumper.y - spawn.y) <=
          squared(bumper.r + 2 * BALL + RIDER),
      )
    )
      faults.push("bumper on a mark");
  }

  const ends = map.portals.flatMap((portal) =>
    [portal.a, portal.b].map((end) => ({ ...end, r: portal.r })),
  );
  const pairKey = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    [`${a.x},${a.y}`, `${b.x},${b.y}`].sort().join(">");
  const pairs = new Set(map.portals.map((p) => pairKey(p.a, p.b)));
  for (const portal of map.portals) {
    if (
      !pairs.has(
        pairKey(
          { x: W - portal.a.x, y: portal.a.y },
          { x: W - portal.b.x, y: portal.b.y },
        ),
      )
    )
      faults.push("portal symmetry");
    if (portal.hue !== 0 && portal.hue !== 1) faults.push("portal");
  }
  for (const end of ends) {
    const box = around(end.x, end.y, BALL);
    if (
      ![end.x, end.y, end.r].every(Number.isInteger) ||
      end.r < BALL + 4 ||
      !inField(around(end.x, end.y, end.r))
    )
      faults.push("portal");
    // A ball arriving at an end's centre is not inside a solid, a goal, a gadget or another portal.
    if (
      [
        ...map.solids,
        ...map.ledges,
        ...map.barriers,
        ...map.movers.map(sweepOf),
      ].some((solid) => overlap(box, solid))
    )
      faults.push("portal in a solid");
    if (
      map.goals.some((goal) =>
        overlap(
          around(end.x, end.y, end.r),
          isCircle(goal) ? around(goal.x, goal.y, goal.r) : goal,
        ),
      )
    )
      faults.push("portal in a goal");
    if (
      ends.some(
        (o) =>
          o !== end &&
          squared(o.x - end.x) + squared(o.y - end.y) <= squared(o.r + end.r),
      ) ||
      map.bumpers.some(
        (o) =>
          squared(o.x - end.x) + squared(o.y - end.y) <=
          squared(o.r + end.r + BALL),
      )
    )
      faults.push("portal too close");
  }

  if (!mirrored(map.ledges, sameRect)) faults.push("ledge symmetry");
  for (const ledge of map.ledges) {
    if (!even(ledge) || !inField(ledge) || ledge.w < 2 * RIDER + 6)
      faults.push("ledge");
    if (
      [...map.solids, ...map.barriers].some((solid) => overlap(ledge, solid)) ||
      map.ledges.some((o) => o !== ledge && overlap(ledge, o, 2 * BALL))
    )
      faults.push("ledge in a solid");
    if (
      map.goals.some((goal) =>
        overlap(ledge, isCircle(goal) ? around(goal.x, goal.y, goal.r) : goal),
      )
    )
      faults.push("ledge in a goal");
  }

  for (const mover of map.movers) {
    const { travel, period, dwell } = mover,
      sweep = sweepOf(mover),
      far = Math.abs(travel.x) + Math.abs(travel.y);
    if (
      !even(mover) ||
      ![travel.x, travel.y, period, dwell].every(
        (n) => Number.isInteger(n) && n % 2 === 0,
      ) ||
      dwell < 0 ||
      (travel.x !== 0) === (travel.y !== 0) ||
      // No faster than a pixel a step, and never so slow a ride is a wait.
      period < 2 * (far + dwell) ||
      period > 1800 ||
      !inField(sweep) ||
      mover.w < 2 * RIDER + 6
    )
      faults.push("mover");
    if (
      !map.movers.some(
        (o) =>
          sameRect(o, flip(mover)) &&
          o.travel.x === -travel.x &&
          o.travel.y === travel.y &&
          o.period === period &&
          o.dwell === dwell,
      )
    )
      faults.push("mover symmetry");
    // Past either end of its travel there is room for a rider, so nothing is crushed against a solid.
    const reach = rect(
      sweep.x - (travel.x ? CRUSH : 0),
      sweep.y - (travel.y ? CRUSH : 0),
      sweep.w + (travel.x ? 2 * CRUSH : 0),
      sweep.h + (travel.y ? 2 * CRUSH : 0),
    );
    if (
      [...map.solids, ...map.ledges, ...map.barriers].some((solid) =>
        overlap(reach, solid),
      ) ||
      map.movers.some((o) => o !== mover && overlap(reach, sweepOf(o)))
    )
      faults.push("mover in a solid");
    if (
      map.goals.some((goal) =>
        overlap(sweep, isCircle(goal) ? around(goal.x, goal.y, goal.r) : goal),
      )
    )
      faults.push("mover in a goal");
    if (
      overlap(sweep, around(map.ballAnchor.x, map.ballAnchor.y, BALL)) ||
      map.spawns.some((spawn) =>
        overlap(sweep, around(spawn.x, spawn.y, RIDER)),
      )
    )
      faults.push("mover on a mark");
  }
  return faults;
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
  faults.push(...gadgetFaults(map));
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
