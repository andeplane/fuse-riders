import test from "node:test";
import assert from "node:assert/strict";
import {
  FX,
  LEFT,
  RIGHT,
  createWorld,
  decodeWorld,
  encodeWorld,
  places,
  roundDone,
  speedOf,
  stepWorld,
  wagons,
  type World,
} from "../src/engine/index.js";
import { BOUNDS, DOCKS, FLOOR, dockAt, starts } from "../src/engine/arena.js";
import {
  DIRS,
  cos,
  dist2,
  headingOf,
  isqrt,
  px,
  sin,
  turnBetween,
} from "../src/engine/math.js";
import { next } from "../src/engine/rng.js";
import { looseTarget } from "../src/engine/cargo.js";
import * as T from "../src/engine/tuning.js";
import {
  EAST,
  NORTH,
  SOUTH,
  WEST,
  at,
  cart,
  held,
  place,
  playing,
  steps,
  train,
} from "./fixtures/world.js";

const fxOf = (world: World, kind: number) =>
  world.fx.filter((fx) => fx.kind === kind);

test("headings: the sine table is exact at the quarters, and every heading survives a round trip", () => {
  assert.equal(sin(0), 0);
  assert.equal(sin(DIRS / 4), 4096);
  assert.equal(cos(DIRS / 2), -4096);
  assert.equal(sin((DIRS * 3) / 4), -4096);
  for (let dir = 0; dir < DIRS; dir++) {
    const back = headingOf(cos(dir) * 50, sin(dir) * 50);
    assert.ok(
      Math.abs(turnBetween(dir, back)) <= 1,
      `heading ${dir} came back as ${back}`,
    );
    // Unit vectors stay unit-length within a part in a thousand.
    const length = isqrt(cos(dir) * cos(dir) + sin(dir) * sin(dir));
    assert.ok(Math.abs(length - 4096) <= 4, `heading ${dir}: ${length}`);
  }
  assert.equal(headingOf(0, 0), 0);
  assert.equal(turnBetween(1000, 10), 34);
  assert.equal(turnBetween(10, 1000), -34);
});

test("a train drives itself, steers left and right relative to its heading, and slows as it grows", () => {
  const world = playing(1);
  const t = place(world, "t0", 400, 300, EAST);
  steps(world, 10);
  assert.equal(t.dir, EAST);
  assert.ok(at(t.x) > 425 && at(t.y) === 300, "straight on with nothing held");
  steps(world, 5, held({ t0: RIGHT }));
  assert.equal(t.dir, 5 * T.TURN, "right turns clockwise on screen, toward +y");
  steps(world, 10, held({ t0: LEFT }));
  assert.equal(t.dir, DIRS - 5 * T.TURN);
  steps(world, 5, held({ t0: LEFT | RIGHT }));
  assert.equal(t.dir, DIRS - 5 * T.TURN, "both held is straight on");
  const empty = speedOf(t);
  t.cargo = [0, 0, 0, 0];
  assert.equal(speedOf(t), empty - 4 * T.SPEED_LOSS);
});

/** Distance from a point to the nearest segment of a polyline, in sub-units. */
function fromPath(path: readonly [number, number][], x: number, y: number) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1]!,
      [bx, by] = path[i]!,
      dx = bx - ax,
      dy = by - ay,
      length = dx * dx + dy * dy;
    const u = length
      ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length))
      : 0;
    best = Math.min(best, Math.hypot(ax + u * dx - x, ay + u * dy - y));
  }
  return best;
}

test("wagons follow the locomotive's own path through a U-turn and an S-bend, a fixed distance apart along it", () => {
  const world = playing(1);
  const t = place(world, "t0", 250, 200, EAST, 6);
  // Where the locomotive has been: the straight line it was placed on, then every step.
  const path: [number, number][] = [
    [t.x - px(400), t.y],
    [t.x, t.y],
  ];
  const drive = (count: number, bits: number) => {
    for (let i = 0; i < count; i++) {
      stepWorld(world, held({ t0: bits }));
      path.push([t.x, t.y]);
    }
  };
  drive(40, 0);
  drive(43, RIGHT); // about half a turn
  drive(30, 0);
  drive(30, LEFT);
  drive(10, 0);
  const points = wagons(t);
  assert.equal(points.length, 6);
  for (const [index, [x, y]] of points.entries())
    assert.ok(
      fromPath(path, x, y) <= px(1),
      `wagon ${index} is ${at(fromPath(path, x, y)).toFixed(2)} px off the path`,
    );
  // Along the path the gaps are exact, so across a bend the straight-line gap can only be shorter.
  let previous: [number, number] = [t.x, t.y];
  for (const [index, [x, y]] of points.entries()) {
    const gap = Math.sqrt(dist2(previous[0], previous[1], x, y)),
      expected = index === 0 ? T.FIRST_GAP : T.GAP;
    assert.ok(
      gap <= expected + px(1) && gap >= expected * 0.85,
      `gap ${index}: ${at(gap)}`,
    );
    previous = [x, y];
  }
  // The bends really are behind it: the train spans them, its tail still round the half turn.
  assert.ok(
    at(Math.abs(points.at(-1)![1] - t.y)) > 40,
    "the tail is on another leg",
  );
});

test("driving over a loose cart couples it at the tail; a full train passes over carts", () => {
  const world = playing(1);
  const t = place(world, "t0", 300, 300, EAST, 1);
  const loose = cart(world, 345, 300, 2);
  steps(world, 6);
  assert.equal(world.carts.length, 0, "the cart left the floor");
  assert.deepEqual(t.cargo, [0, 2], "coupled at the back, cargo and all");
  assert.equal(t.collected, 1);
  const [pickup] = fxOf(world, FX.collect);
  assert.ok(pickup && pickup.slot === 0 && pickup.data === 2);
  assert.equal(pickup.x, loose.x);
  // The new wagon sits a wagon's gap behind the one in front of it, on the path.
  const [, tail] = wagons(t);
  assert.ok(Math.abs(at(t.x - tail![0]) - at(T.FIRST_GAP + T.GAP)) < 1);

  const full = playing(1);
  const big = place(full, "t0", 300, 300, EAST, T.MAX_WAGONS);
  cart(full, 345, 300);
  steps(full, 30);
  assert.equal(big.cargo.length, T.MAX_WAGONS);
  assert.equal(
    full.carts.length,
    1,
    "a full train leaves the cart where it is",
  );
});

test("two noses on one cart: the nearer takes it, and on an exact tie the lower slot does", () => {
  const world = playing(2);
  place(world, "t0", 300, 300, EAST);
  place(world, "t1", 380, 306, WEST);
  // Both noses reach the cart on the same step; t1's is nearer.
  cart(world, 340, 304);
  steps(world, 5);
  assert.equal(train(world, "t1").cargo.length, 1);
  assert.equal(train(world, "t0").cargo.length, 0);

  const tie = playing(2);
  place(tie, "t0", 300, 300, EAST);
  place(tie, "t1", 380, 300, WEST);
  cart(tie, 340, 300);
  steps(tie, 5);
  // The two locomotives bump right after, but the cart went to slot 0 first.
  assert.equal(train(tie, "t0").cargo.length, 1);
  assert.equal(train(tie, "t1").cargo.length, 0);
});

test("a cart cooling down cannot be collected, even under a nose; then it can", () => {
  const world = playing(1);
  const t = place(world, "t0", 300, 300, EAST);
  cart(world, 330, 300, 0, 10);
  steps(world, 9);
  assert.equal(t.cargo.length, 0, "still cooling");
  steps(world, 3);
  assert.equal(t.cargo.length, 1, "collected once cool");
});

test("a nose on a rival wagon cuts it and everything behind it loose; the front section drives on", () => {
  const world = playing(2);
  const victim = place(world, "t1", 400, 300, EAST, 4);
  const thief = place(world, "t0", 326, 280, SOUTH);
  const before = wagons(victim);
  steps(world, 1);
  assert.equal(
    victim.cargo.length,
    1,
    "wagon 1 was hit: wagons 1, 2 and 3 are gone",
  );
  assert.equal(world.carts.length, 3);
  assert.ok(world.carts.every((c) => c.cool === T.CUT_COOL));
  assert.deepEqual(
    world.carts.map((c) => c.kind),
    [1, 2, 3],
    "the carts keep their cargo",
  );
  // Each cart starts where its wagon was.
  world.carts.forEach((c, i) => {
    const [x, y] = before[i + 1]!;
    assert.ok(Math.sqrt(dist2(c.x, c.y, x, y)) < px(4));
  });
  assert.equal(thief.stolen, 3);
  assert.equal(victim.lost, 3);
  assert.equal(victim.guard, T.CUT_GUARD - 1);
  const [cut] = fxOf(world, FX.cut);
  assert.ok(cut && cut.slot === 0 && cut.other === 1 && cut.data === 3);
  // The rival keeps its locomotive and front wagon, at full speed on its heading.
  const x = victim.x;
  steps(world, 5);
  assert.equal(victim.dir, EAST);
  assert.ok(victim.x > x);
  assert.equal(victim.cargo.length, 1);
});

test("the thief cannot pick its own cut straight back up: the cooldown outlasts the pass", () => {
  const world = playing(2);
  const victim = place(world, "t1", 400, 300, EAST, 3);
  // The thief follows the victim's line from behind, its nose just on the last wagon.
  const thief = place(world, "t0", 268, 300, EAST);
  let reached = false;
  for (let step = 0; step < T.CUT_COOL - 2; step++) {
    steps(world, 1);
    const nose = [thief.x + px(9), thief.y] as const;
    reached ||= world.carts.some(
      (c) =>
        c.cool > 0 &&
        dist2(nose[0], nose[1], c.x, c.y) < (T.NOSE_R + T.CART_R) ** 2,
    );
  }
  assert.equal(victim.cargo.length, 2, "the last wagon was cut");
  assert.ok(reached, "the thief's nose was over the cut cart while it cooled");
  assert.equal(thief.cargo.length, 0, "and still could not couple it");
});

test("simultaneous cuts: two thieves on one tail, the lower wagon wins; on one wagon, the lower slot is credited", () => {
  const world = playing(3);
  const victim = place(world, "t2", 400, 300, EAST, 4);
  place(world, "t0", 292, 280, SOUTH); // on wagon 2
  place(world, "t1", 326, 320, NORTH); // on wagon 1
  steps(world, 1);
  assert.equal(
    victim.cargo.length,
    1,
    "cut at wagon 1, which takes wagon 2 with it",
  );
  assert.equal(train(world, "t1").stolen, 3);
  assert.equal(train(world, "t0").stolen, 0);
  assert.equal(fxOf(world, FX.cut).length, 1, "one cut, not two");

  const same = playing(3);
  const rival = place(same, "t2", 400, 300, EAST, 4);
  place(same, "t0", 326, 280, SOUTH);
  place(same, "t1", 326, 320, NORTH);
  steps(same, 1);
  assert.equal(rival.cargo.length, 1);
  assert.equal(train(same, "t0").stolen, 3, "slot 0 is credited on a tie");
  assert.equal(train(same, "t1").stolen, 0);
});

test("two trains cutting each other on the same step both lose their tails, whatever order they are listed in", () => {
  const run = (slots: [number, number]) => {
    const world = createWorld(
      7,
      [
        { id: "a", slot: slots[0] },
        { id: "b", slot: slots[1] },
      ],
      { seconds: 75 },
    );
    while (world.phase === "countdown") stepWorld(world, new Map());
    world.carts = [];
    world.spawnAt = 0xffff_ffff;
    place(world, "a", 300, 300, EAST, 2);
    place(world, "b", 260, 314, WEST, 2);
    steps(world, 1);
    const a = train(world, "a"),
      b = train(world, "b");
    return {
      a: [a.cargo.length, a.stolen, a.lost, a.x, a.y],
      b: [b.cargo.length, b.stolen, b.lost, b.x, b.y],
      carts: world.carts.map((c) => [c.kind, c.x, c.y]).sort(),
    };
  };
  const first = run([0, 1]),
    swapped = run([1, 0]);
  assert.deepEqual(first.a, [0, 2, 2, first.a[3], first.a[4]]);
  assert.deepEqual(first.b, [0, 2, 2, first.b[3], first.b[4]]);
  assert.deepEqual(first, swapped);
});

test("a cut train is guarded for a moment, and a locomotive never cuts its own wagons", () => {
  const world = playing(2);
  const victim = place(world, "t1", 400, 300, EAST, 3);
  victim.guard = 5;
  place(world, "t0", 326, 280, SOUTH);
  steps(world, 1);
  assert.equal(victim.cargo.length, 3, "guarded");

  const own = playing(1);
  const t = place(own, "t0", 400, 300, EAST, 5);
  // A tight turn brings its nose round across its own wagons.
  steps(own, 120, held({ t0: RIGHT }));
  assert.equal(t.cargo.length, 5);
  assert.equal(t.lost, 0);
});

test("a locomotive in a dock banks every wagon it pulls, once; an empty train banks nothing", () => {
  const world = playing(1);
  const dock = DOCKS[0]!,
    y = at((dock.top + dock.bottom) / 2);
  const t = place(world, "t0", at(dock.right) + 4, y, WEST, 3);
  steps(world, 3);
  assert.equal(dockAt(t.x, t.y), 0);
  assert.equal(t.score, 3);
  assert.deepEqual(t.cargo, []);
  assert.equal(t.deliveries, 1);
  const [delivered] = fxOf(world, FX.deliver);
  assert.ok(delivered && delivered.data === 3 && delivered.other === 0);
  // Round the dock and out again: nothing more to bank.
  steps(world, 40, held({ t0: RIGHT }));
  assert.equal(t.score, 3);
  assert.equal(t.deliveries, 1);
});

test("a wagon cut on the step its train reaches a dock is not delivered: cuts come first", () => {
  const world = playing(2);
  const dock = DOCKS[0]!,
    y = at((dock.top + dock.bottom) / 2);
  const runner = place(world, "t0", at(dock.right) + 2, y, WEST, 3);
  // The thief's nose lands on wagon 1 on the same step.
  place(world, "t1", at(dock.right) + 2 - 2.6 + 74, y - 20, SOUTH);
  steps(world, 1);
  assert.equal(runner.score, 1, "only the front wagon was banked");
  assert.equal(world.carts.length, 2);
  assert.equal(train(world, "t1").stolen, 2);
});

test("walls mirror a train's heading and keep it on the floor", () => {
  const world = playing(1);
  const t = place(world, "t0", 75, 200, WEST);
  steps(world, 4);
  assert.equal(t.dir, EAST);
  assert.ok(t.x >= BOUNDS.left);
  assert.equal(fxOf(world, FX.wall).length, 1);
  // Into a corner: both walls, and it comes out heading back into the floor.
  const corner = playing(1);
  const c = place(corner, "t0", 90, 95, WEST + 128);
  steps(corner, 20);
  assert.ok(cos(c.dir) > 0 && sin(c.dir) > 0, `heading ${c.dir}`);
  assert.ok(c.x >= BOUNDS.left && c.y >= BOUNDS.top);
});

test("locomotives bump instead of passing through: head-on both turn back, a rear-ender only the chaser", () => {
  const world = playing(2);
  const a = place(world, "t0", 300, 300, EAST),
    b = place(world, "t1", 340, 300, WEST);
  steps(world, 2);
  assert.ok(cos(a.dir) < 0 && cos(b.dir) > 0, "both mirrored off the contact");
  assert.ok(Math.sqrt(dist2(a.x, a.y, b.x, b.y)) >= 2 * T.LOCO_R);
  assert.equal(fxOf(world, FX.bump).length, 1);
  for (let i = 0; i < 30; i++) {
    steps(world, 1);
    assert.ok(Math.sqrt(dist2(a.x, a.y, b.x, b.y)) >= 2 * T.LOCO_R - px(3));
  }

  const chase = playing(2);
  const back = place(chase, "t0", 300, 300, EAST),
    front = place(chase, "t1", 330, 300, EAST);
  steps(chase, 1);
  assert.equal(front.dir, EAST, "the one in front drives on");
  assert.ok(cos(back.dir) < 0, "the chaser bounced");
});

test("start places are fair: evenly round the middle, on the floor, apart, each with a cart the same distance ahead", () => {
  for (let count = 1; count <= T.CAPACITY; count++)
    for (let seed = 1; seed <= 25; seed++) {
      const places = starts(seed, count);
      assert.equal(places.length, count);
      for (const place of places) {
        assert.ok(
          place.x > BOUNDS.left + px(60) && place.x < BOUNDS.right - px(60),
        );
        assert.ok(
          place.y > BOUNDS.top + px(40) && place.y < BOUNDS.bottom - px(40),
        );
        assert.equal(dockAt(place.cartX, place.cartY, px(20)), -1);
        assert.ok(
          place.cartX > FLOOR.left + T.CART_R &&
            place.cartY < FLOOR.bottom - T.CART_R,
        );
        const ahead = Math.sqrt(
          dist2(place.x, place.y, place.cartX, place.cartY),
        );
        assert.ok(Math.abs(ahead - T.START_CART) < px(1));
      }
      for (let i = 0; i < count; i++)
        for (let j = i + 1; j < count; j++)
          assert.ok(
            dist2(places[i]!.x, places[i]!.y, places[j]!.x, places[j]!.y) >
              px(130) ** 2,
            `seed ${seed}, ${count} trains: ${i} and ${j} too close`,
          );
    }
  assert.notDeepEqual(starts(1, 3), starts(2, 3), "the seed turns the places");
});

test("a round is its length of play between a countdown and the whistle, then holds for the outro", () => {
  const world = createWorld(3, [{ id: "a", slot: 0 }], { seconds: 60 });
  let play = 0;
  while (!roundDone(world)) {
    stepWorld(world, new Map());
    if (world.phase === "play") play++;
  }
  assert.equal(play, 60 * T.STEPS_PER_SECOND);
  assert.equal(
    world.step,
    T.COUNTDOWN_STEPS + 60 * T.STEPS_PER_SECOND + T.OUTRO_STEPS,
  );
  // After the whistle nothing moves or scores.
  const frozen = createWorld(3, [{ id: "a", slot: 0 }], { seconds: 60 });
  while (frozen.phase !== "outro") stepWorld(frozen, new Map());
  const { x, y } = frozen.trains[0]!;
  steps(frozen, 30, held({ a: LEFT }));
  assert.equal(frozen.trains[0]!.x, x);
  assert.equal(frozen.trains[0]!.y, y);
});

test("places: equal scores share a place, and the next one skips", () => {
  assert.deepEqual(places([5, 7, 5, 0]), [2, 1, 2, 4]);
  assert.deepEqual(places([0, 0]), [1, 1]);
  assert.deepEqual(places([]), []);
});

test("new carts arrive from the seed, off the docks and clear of the trains, up to the depot's target", () => {
  const a = createWorld(
      11,
      [0, 1, 2].map((slot) => ({ id: `t${slot}`, slot })),
      { seconds: 60 },
    ),
    b = createWorld(
      11,
      [0, 1, 2].map((slot) => ({ id: `t${slot}`, slot })),
      { seconds: 60 },
    );
  assert.deepEqual(
    encodeWorld(a),
    encodeWorld(b),
    "the same seed makes the same depot",
  );
  assert.ok(
    a.carts.length >= 3 + 3,
    "a start cart for each train and some more",
  );
  let spawned = 0;
  for (let i = 0; i < 1500; i++) {
    stepWorld(a, new Map());
    stepWorld(b, new Map());
    for (const fx of a.fx)
      if (fx.kind === FX.spawn && fx.at === a.step) {
        spawned++;
        assert.equal(dockAt(fx.x, fx.y), -1);
        for (const t of a.trains)
          assert.ok(
            dist2(t.x, t.y, fx.x, fx.y) > px(80) ** 2,
            "not under a train",
          );
      }
    // The spawner stops at its target; only cuts can take the floor past it.
    if (a.fx.some((fx) => fx.kind === FX.spawn && fx.at === a.step))
      assert.ok(a.carts.length <= looseTarget(a));
  }
  assert.ok(spawned > 0);
  assert.deepEqual(encodeWorld(a), encodeWorld(b));
});

/** A seeded stream of random held bits for fuzzing. */
function randomBits(seed: number) {
  let state = seed;
  return () => {
    const step = next(state);
    state = step.state;
    return step.value % 4;
  };
}

test("anything held for thousands of steps keeps every train, crumb and cart on the floor and every bound kept", () => {
  for (let seed = 1; seed <= 8; seed++) {
    const world = createWorld(
      seed,
      [0, 1, 2, 3, 4].map((slot) => ({ id: `t${slot}`, slot })),
      {
        seconds: 90,
      },
    );
    const roll = randomBits(seed * 97);
    let inputs = new Map<string, number>();
    for (let step = 0; step < 5000 && !roundDone(world); step++) {
      if (step % 20 === 0)
        inputs = new Map(world.trains.map((t) => [t.id, roll()]));
      stepWorld(world, inputs);
      for (const t of world.trains) {
        assert.ok(
          t.x >= BOUNDS.left &&
            t.x <= BOUNDS.right &&
            t.y >= BOUNDS.top &&
            t.y <= BOUNDS.bottom,
        );
        assert.ok(t.cargo.length <= T.MAX_WAGONS);
        assert.equal(t.trail.length, T.TRAIL * 2);
      }
      assert.ok(world.carts.length <= T.MAX_LOOSE);
      if (step % 250 === 0)
        assert.ok(
          decodeWorld(encodeWorld(world)),
          `seed ${seed}, step ${step}`,
        );
    }
  }
});

test("a round replays to the same world, and a checkpoint taken halfway plays on identically", () => {
  const run = (checkpointAt: number) => {
    let world = createWorld(
      99,
      [0, 1, 2].map((slot) => ({ id: `t${slot}`, slot })),
      { seconds: 60 },
    );
    const roll = randomBits(5);
    let inputs = new Map<string, number>();
    for (let step = 0; step < 3000; step++) {
      if (step === checkpointAt)
        world = decodeWorld(structuredClone(encodeWorld(world)))!;
      if (step % 15 === 0)
        inputs = new Map(world.trains.map((t) => [t.id, roll()]));
      stepWorld(world, inputs);
    }
    return JSON.stringify(encodeWorld(world));
  };
  const straight = run(-1);
  assert.equal(run(-1), straight);
  assert.equal(run(1400), straight);
});

test("at the loose-cart limit a cut wagon that has no room is scrapped, and the floor never passes the limit", () => {
  const world = playing(2);
  const victim = place(world, "t1", 400, 300, EAST, 8);
  place(world, "t0", 326, 280, SOUTH);
  for (let i = 0; i < T.MAX_LOOSE - 2; i++)
    cart(world, 100 + (i % 10) * 60, 120 + Math.floor(i / 10) * 30, 0, 5);
  steps(world, 1);
  assert.equal(victim.cargo.length, 1);
  assert.equal(world.carts.length, T.MAX_LOOSE);
  assert.equal(fxOf(world, FX.scrap).length, 5, "seven cut, two found room");
  assert.equal(victim.lost, 7, "scrapped wagons were still lost");
  assert.ok(decodeWorld(encodeWorld(world)));
});
