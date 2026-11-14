import test from "node:test";
import assert from "node:assert/strict";
import {
  MAPS,
  MAP_IDS,
  isCircle,
  isMapId,
  moverBoxAt,
  stepWorld,
  type Circle,
  type MapDef,
  type Rect,
} from "../src/engine/index.js";
import { at, ballAt, playing } from "./fixtures/world.js";

const W = 640,
  H = 360,
  RIDER = 9,
  BALL = 8;
const maps = MAP_IDS.map((id) => MAPS[id]);
const mod = (value: number, size: number) => ((value % size) + size) % size;

/** The squared distance from a point to a rect, the short way round on axes that wrap. */
function gap(map: MapDef, x: number, y: number, rect: Rect): number {
  let dx = x - (rect.x + rect.w / 2),
    dy = y - (rect.y + rect.h / 2);
  if (map.wrapX) dx = mod(dx + W / 2, W) - W / 2;
  if (map.wrapY) dy = mod(dy + H / 2, H) - H / 2;
  const ex = Math.max(0, Math.abs(dx) - rect.w / 2),
    ey = Math.max(0, Math.abs(dy) - rect.h / 2);
  return ex * ex + ey * ey;
}
/** Whether a circle of radius `r` at the point is clear of every solid (touching counts as clear). */
const free = (map: MapDef, x: number, y: number, r: number) =>
  map.solids.every((solid) => gap(map, x, y, solid) >= r * r);
const solidAt = (map: MapDef, x: number, y: number) =>
  map.solids.some((solid) => gap(map, x, y, solid) === 0);

/** Whether a point (in pixels) is inside a goal. */
const inside = (goal: Rect | Circle, x: number, y: number) =>
  isCircle(goal)
    ? Math.hypot(x - goal.x, y - goal.y) < goal.r
    : x > goal.x && x < goal.x + goal.w && y > goal.y && y < goal.y + goal.h;

/** A rect as the cells it covers on the field, so two descriptions of the same wall across a seam compare equal. */
const flip = (rect: Rect): Rect => ({ ...rect, x: W - rect.x - rect.w });
function cells(map: MapDef, rects: readonly Rect[]): Set<string> {
  const covered = new Set<string>();
  for (const rect of rects)
    for (let x = rect.x; x < rect.x + rect.w; x += 2)
      for (let y = rect.y; y < rect.y + rect.h; y += 2)
        covered.add(
          `${map.wrapX ? mod(x, W) : x},${map.wrapY ? mod(y, H) : y}`,
        );
  return covered;
}
const flipCircle = (circle: Circle): Circle => ({
  x: W - circle.x,
  y: circle.y,
  r: circle.r,
});
const sorted = (circles: readonly Circle[]) =>
  circles
    .map(({ x, y, r }) => ({ x, y, r }))
    .sort((a, b) => a.x - b.x || a.y - b.y);

test("every map has its own id and name, and a new one is only ever added at the end", () => {
  // A checkpoint carries the map as its place in this list, so the order is part of the wire format.
  assert.deepEqual(
    [...MAP_IDS],
    [
      "gridlock",
      "downlink",
      "halo",
      "overflow",
      "firewall",
      "cornercase",
      "coredump",
      "bruteforce",
      "bouncerate",
      "portforward",
      "backdoor",
      "stacktrace",
    ],
  );
  for (const id of MAP_IDS) {
    assert.equal(MAPS[id].id, id);
    assert.ok(isMapId(id));
  }
  assert.equal(new Set(maps.map((map) => map.name)).size, MAP_IDS.length);
  assert.ok(!isMapId("arena"));
  assert.ok(!isMapId(0));
});

for (const map of maps) {
  test(`${map.id}: every shape sits on whole, even pixels inside the field`, () => {
    for (const solid of map.solids) {
      for (const value of [solid.x, solid.y, solid.w, solid.h])
        assert.ok(Number.isInteger(value) && value % 2 === 0);
      assert.ok(solid.x >= 0 && solid.x < W && solid.w > 0);
      assert.ok(solid.y >= 0 && solid.y < H && solid.h > 0);
      // Only a wrapping axis lets a rect run on past the edge.
      assert.ok(solid.x + solid.w <= (map.wrapX ? 2 * W : W));
      assert.ok(solid.y + solid.h <= (map.wrapY ? 2 * H : H));
    }
    for (const goal of map.goals) {
      if (isCircle(goal)) assert.ok(goal.r >= BALL);
      else {
        assert.ok(goal.x >= 0 && goal.x + goal.w <= W);
        assert.ok(goal.y >= 0 && goal.y + goal.h <= H);
      }
    }
  });

  test(`${map.id}: riders start standing on a solid, clear of everything, and the ball starts clear`, () => {
    for (const spawn of map.spawns) {
      assert.ok(free(map, spawn.x, spawn.y, RIDER));
      assert.ok(solidAt(map, spawn.x, spawn.y + RIDER + 1));
    }
    assert.ok(free(map, map.ballAnchor.x, map.ballAnchor.y, BALL));
    const [left, right] = map.spawns;
    assert.ok(Math.abs(left.x - right.x) > 4 * RIDER);
    for (const goal of map.goals) {
      const centre = isCircle(goal)
        ? goal
        : { x: goal.x + goal.w / 2, y: goal.y + goal.h / 2 };
      assert.ok(
        Math.hypot(centre.x - map.ballAnchor.x, centre.y - map.ballAnchor.y) >
          100,
        "the ball starts well away from every goal",
      );
    }
  });

  test(`${map.id}: the layout is its own mirror image, with the two sides' goals and spawns swapped`, () => {
    assert.deepEqual(cells(map, map.solids.map(flip)), cells(map, map.solids));
    assert.equal(map.ballAnchor.x, W / 2);
    assert.deepEqual(map.spawns[1], {
      x: W - map.spawns[0].x,
      y: map.spawns[0].y,
    });
    assert.deepEqual(sorted(map.clouds.map(flipCircle)), sorted(map.clouds));
    for (const team of [0, 1] as const) {
      const mine = map.goals.filter((goal) => goal.team === team),
        theirs = map.goals.filter((goal) => goal.team !== team);
      assert.ok(mine.length > 0);
      assert.deepEqual(
        sorted(mine.filter(isCircle).map(flipCircle)),
        sorted(theirs.filter(isCircle)),
      );
      const rects = (goals: typeof mine) =>
        goals.filter((goal): goal is typeof goal & Rect => !isCircle(goal));
      assert.deepEqual(
        cells(map, rects(mine).map(flip)),
        cells(map, rects(theirs)),
      );
    }
  });

  test(`${map.id}: each rider's goal is on the far side from their spawn`, () => {
    for (const team of [0, 1] as const)
      for (const goal of map.goals.filter((g) => g.team === team)) {
        const x = isCircle(goal) ? goal.x : goal.x + goal.w / 2;
        assert.equal(x > W / 2, map.spawns[team].x < W / 2);
      }
  });

  test(`${map.id}: the ball fits into every goal`, () => {
    for (const goal of map.goals) {
      const x = isCircle(goal) ? goal.x : goal.x + goal.w / 2,
        y = isCircle(goal) ? goal.y : goal.y + goal.h / 2;
      assert.ok(free(map, x, y, BALL), `goal at ${x},${y} is blocked`);
    }
  });

  test(`${map.id}: a wrapping edge has an opening a rider fits through, and any other edge is closed`, () => {
    /** The longest open run along an edge, in pixels. */
    const opening = (length: number, open: (at: number) => boolean) => {
      let best = 0,
        run = 0;
      for (let i = 0; i < length; i++) {
        run = open(i) ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return best;
    };
    const sides = opening(H, (y) => !solidAt(map, 0, y)),
      ends = opening(W, (x) => !solidAt(map, x, 0));
    if (map.wrapX) assert.ok(sides > 2 * RIDER + 8, `sides open ${sides}px`);
    else assert.equal(sides, 0);
    if (map.wrapY) assert.ok(ends > 2 * RIDER + 8, `ends open ${ends}px`);
    else assert.equal(ends, 0);
  });

  test(`${map.id}: clouds are on the field`, () => {
    assert.ok(map.clouds.length > 0);
    for (const cloud of map.clouds) {
      assert.ok(cloud.x >= 0 && cloud.x <= W && cloud.y >= 0 && cloud.y <= H);
      assert.ok(cloud.r >= 2 * BALL);
      assert.ok(
        Math.hypot(cloud.x - map.ballAnchor.x, cloud.y - map.ballAnchor.y) >
          cloud.r,
        "the ball does not start in slow motion",
      );
    }
  });

  test(`${map.id}: a ball left alone anywhere scores, keeps falling, or comes to rest where a rider can get at it`, () => {
    // Nobody on the field: both riders are out of it, as after a zap, so only the arena acts on the ball.
    const world = playing(map.id);
    for (const rider of world.riders) rider.zapped = true;
    let rested = 0;
    for (let x = 10; x < W; x += 20)
      for (let y = 15; y < H; y += 30) {
        if (!free(map, x, y, BALL)) continue;
        if (map.goals.some((goal) => inside(goal, x, y))) continue;
        for (const vx of [0, 2, -2]) {
          world.phase = "play";
          world.ball.live = true;
          ballAt(world, x, y, vx, 0);
          const run = (steps: number) => {
            for (let step = 0; step < steps && world.phase === "play"; step++)
              stepWorld(world, new Map());
          };
          run(4800);
          const was = { x: world.ball.x, y: world.ball.y };
          run(120);
          if (world.phase !== "play") continue;
          const { ball } = world;
          // Lying on a mover it goes where the mover goes, which is at rest: a rider can ride up beside it.
          const riding = map.movers.some((mover) => {
            const box = moverBoxAt(mover, world.clock);
            return (
              Math.abs(ball.x - box.cx) <= box.hw &&
              Math.abs(ball.y + BALL * 4096 - (box.cy - box.hh)) <= 4096
            );
          });
          if (riding) {
            rested++;
            continue;
          }
          if (ball.x !== was.x || ball.y !== was.y) {
            // Still on the move after forty seconds: only by falling, round and round an arena open top to bottom.
            assert.ok(
              map.wrapY,
              `from ${x},${y} the ball never settles (${at(ball.x)},${at(ball.y)})`,
            );
            continue;
          }
          rested++;
          const bx = at(ball.x),
            by = at(ball.y),
            reach = RIDER + BALL;
          assert.ok(
            free(map, bx, by - reach, RIDER) ||
              // A rider standing on the same surface is a pixel taller than the ball.
              free(map, bx - reach, by - 1, RIDER) ||
              free(map, bx + reach, by - 1, RIDER),
            `from ${x},${y} the ball rests at ${bx},${by} where no rider fits beside or over it`,
          );
        }
      }
    assert.ok(rested > 0, "somewhere in the arena the ball can lie still");
  });
}

test("the open floor of Overflow is nobody's goal: the ball dropped down a hole comes back in at the top", () => {
  const world = playing("overflow");
  for (const rider of world.riders) rider.zapped = true;
  ballAt(world, 186, 300);
  let wrapped = false;
  for (let step = 0; step < 240; step++) {
    const before = world.ball.y;
    stepWorld(world, new Map());
    if (world.ball.y < before - (H / 2) * 4096) wrapped = true;
  }
  assert.ok(wrapped, "it went out of the bottom and came in at the top");
  assert.equal(world.phase, "play");
  assert.deepEqual(world.score, [0, 0]);
  // It lands on the ledge under the hole's column, or on the floor: either way inside the field, at rest.
  assert.ok(at(world.ball.y) < 340);
});

test("Firewall has no floor: a ball beside the pads falls round and round, and a rider with it", () => {
  const world = playing("firewall");
  world.riders[1].zapped = true;
  ballAt(world, 150, 100);
  world.riders[0].x = 120 * 4096;
  world.riders[0].grounded = false;
  let ballLaps = 0,
    riderLaps = 0;
  for (let step = 0; step < 1200; step++) {
    const ball = world.ball.y,
      rider = world.riders[0].y;
    stepWorld(world, new Map());
    if (world.ball.y < ball) ballLaps++;
    if (world.riders[0].y < rider) riderLaps++;
  }
  assert.ok(ballLaps >= 3 && riderLaps >= 3);
  assert.equal(world.phase, "play");
  assert.deepEqual(world.score, [0, 0]);
});
