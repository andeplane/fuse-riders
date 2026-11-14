import test from "node:test";
import assert from "node:assert/strict";
import {
  BTN,
  DOWN,
  LEFT,
  MAPS,
  RIGHT,
  botInput,
  decodeWorld,
  encodeWorld,
  gadgetFaults,
  mirrored,
  moverBoxAt,
  moverOffset,
  moverPlace,
  paceTick,
  stepWorld,
  type MapDef,
  type World,
} from "../src/engine/index.js";
import { SUB } from "../src/engine/math.js";
import {
  A,
  B,
  at,
  ballAt,
  fresh,
  held,
  place,
  playing,
  steps,
  until,
} from "./fixtures/world.js";

const RIDER = 9,
  BALL = 8;
const map = MAPS.stacktrace,
  /** The wide ledge in the middle of the stack, and the left lift. */
  ledge = map.ledges[1]!,
  lift = map.movers[0]!;
const mid = ledge.x + ledge.w / 2;

/** A world in play with both riders out of it, so only the arena acts on the ball. */
function empty(): World {
  const world = playing("stacktrace");
  for (const rider of world.riders) rider.zapped = true;
  return world;
}
/** Slot 0's rider alone, somewhere quiet, with the ball out of the way on the floor. */
function alone(x: number, y: number): World {
  const world = playing("stacktrace");
  world.riders[1].zapped = true;
  ballAt(world, 560, 300);
  place(world, 0, x, y);
  return world;
}

// ---- ledges ----

test("a rider jumps up through a ledge from below and lands on top of it", () => {
  const world = alone(mid, ledge.y + 40),
    rider = world.riders[0];
  rider.grounded = true;
  stepWorld(world, held(BTN));
  let above = false;
  const landed = until(world, () => {
    above ||= at(rider.y) < ledge.y - RIDER;
    return above && rider.grounded;
  });
  assert.ok(above, "it went up through the ledge");
  assert.ok(landed > 0, "and came down onto it");
  assert.equal(at(rider.y), ledge.y - RIDER);
  steps(world, 240);
  assert.equal(at(rider.y), ledge.y - RIDER, "it stays there");
  assert.ok(rider.grounded);
});

test("a rider standing on a ledge walks along it and off its end", () => {
  const world = alone(mid, ledge.y - RIDER),
    rider = world.riders[0];
  steps(world, 30);
  assert.ok(rider.grounded);
  steps(world, 40, held(RIGHT));
  assert.equal(at(rider.y), ledge.y - RIDER);
  assert.ok(at(rider.x) > mid + 10);
  assert.ok(until(world, () => at(rider.y) > ledge.y + 20, held(RIGHT)) > 0);
  assert.ok(at(rider.x) > ledge.x + ledge.w);
});

test("holding down drops a rider through a ledge, but a rider in a slide stays on it", () => {
  const world = alone(mid, ledge.y - RIDER),
    rider = world.riders[0];
  steps(world, 30);
  assert.ok(until(world, () => at(rider.y) > ledge.y + RIDER, held(DOWN)) > 0);

  const sliding = alone(ledge.x + 20, ledge.y - RIDER),
    slider = sliding.riders[0];
  steps(sliding, 30);
  stepWorld(sliding, held(DOWN | BTN | RIGHT));
  assert.ok(slider.slide > 0);
  steps(sliding, 20, held(DOWN | BTN | RIGHT));
  assert.ok(slider.slide > 0, "still sliding");
  assert.equal(at(slider.y), ledge.y - RIDER);
});

test("the ball lands on a ledge from above and comes to rest on it, and one sent up from below goes through", () => {
  const world = empty();
  ballAt(world, mid, ledge.y - 60);
  const bounces = world.ball.bounces;
  steps(world, 1200);
  assert.equal(at(world.ball.y), ledge.y - BALL);
  assert.equal(world.ball.vy, 0);
  assert.ok(world.ball.bounces !== bounces, "it bounced on the way");

  ballAt(world, mid, ledge.y + 30, 0, -1.5);
  let above = false;
  for (let step = 0; step < 40; step++) {
    stepWorld(world, new Map());
    above ||= at(world.ball.y) < ledge.y - BALL - 4;
  }
  assert.ok(above, "it came up through the ledge");
  steps(world, 1200);
  assert.equal(at(world.ball.y), ledge.y - BALL, "and landed on it");
});

test("a rider walking into a ball on a ledge rolls it along the ledge, not through it", () => {
  const world = alone(mid - 40, ledge.y - RIDER);
  ballAt(world, mid, ledge.y - BALL);
  for (let step = 0; step < 50; step++) {
    stepWorld(world, held(RIGHT));
    assert.ok(at(world.ball.y) <= ledge.y - BALL + 3, `step ${step}`);
  }
  assert.ok(at(world.ball.x) > mid + 10, "the ball was pushed along");
});

test("a rider stamping down hard on a ball lying on a ledge drives it through", () => {
  const world = alone(mid, ledge.y - 90);
  ballAt(world, mid, ledge.y - BALL);
  steps(world, 5);
  assert.ok(
    until(world, () => at(world.ball.y) > ledge.y + BALL, held(DOWN | BTN)) > 0,
  );
});

// ---- movers ----

test("a mover goes out and back once a period, a mirrored pair stay mirror images, and drawing agrees with the rules", () => {
  const [left, right] = map.movers as [
    MapDef["movers"][number],
    MapDef["movers"][number],
  ];
  assert.deepEqual(moverOffset(left, 0), { x: 0, y: 0 });
  // At the far end from the moment it gets there until half its period is up, and home for the wait after that.
  for (const step of [
    left.period / 2 - left.dwell,
    left.period / 2 - 1,
    left.period / 2,
  ])
    assert.deepEqual(moverOffset(left, step), {
      x: left.travel.x * SUB,
      y: left.travel.y * SUB,
    });
  assert.deepEqual(moverOffset(left, left.period - 1), { x: 0, y: 0 });
  assert.deepEqual(moverOffset(left, left.period), { x: 0, y: 0 });
  for (const step of [1, 77, 299, 301, 419, 421, 500, 719, 839, 100_000]) {
    const a = moverBoxAt(left, step),
      b = moverBoxAt(right, step);
    assert.equal(a.cx + b.cx, 640 * SUB);
    assert.equal(a.cy, b.cy);
    assert.deepEqual(
      moverOffset(left, step),
      moverOffset(left, step + left.period),
    );
    const drawn = moverPlace(left, step);
    assert.ok(Math.abs(drawn.x * SUB - (a.cx - a.hw)) < 1);
    assert.ok(Math.abs(drawn.y * SUB - (a.cy - a.hh)) < 1);
  }
  // A sideways pair mirrors too: equal and opposite, to the sub-unit.
  const east = {
      x: 100,
      y: 100,
      w: 60,
      h: 10,
      travel: { x: 70, y: 0 },
      period: 300,
      dwell: 30,
    },
    west = { ...east, x: 640 - 160, travel: { x: -70, y: 0 } };
  for (let step = 0; step < 300; step++)
    assert.equal(moverOffset(east, step).x + moverOffset(west, step).x, 0);
});

test("a rider standing on a lift rides it up and down a whole trip without leaving the ground", () => {
  const world = alone(lift.x + lift.w / 2, 120),
    rider = world.riders[0];
  assert.ok(until(world, () => rider.grounded) > 0);
  let highest = 999,
    lowest = 0;
  for (let step = 0; step < lift.period; step++) {
    stepWorld(world, new Map());
    assert.ok(rider.grounded, `grounded on step ${world.step}`);
    const top = moverBoxAt(lift, world.clock);
    assert.ok(
      Math.abs(rider.y + RIDER * SUB - (top.cy - top.hh)) <= SUB,
      "its feet are on the lift",
    );
    highest = Math.min(highest, at(rider.y));
    lowest = Math.max(lowest, at(rider.y));
  }
  assert.ok(lowest - highest > Math.abs(lift.travel.y) - 2);
  // And it can jump off it like any floor: a press is a jump, not an air-jump, so no bubble is left behind.
  stepWorld(world, held(BTN));
  assert.ok(rider.vy < 0);
  assert.equal(world.bubbles[0].active, false);
});

test("a ball lying on a lift is carried to the top, level with the goal's sill, and a nudge from there scores", () => {
  for (const team of [0, 1] as const) {
    const world = empty(),
      mover = map.movers[team === 1 ? 0 : 1]!,
      inward = team === 1 ? 1 : -1;
    ballAt(world, mover.x + mover.w / 2, 120);
    steps(world, 400);
    // Wait for the top of the ride.
    assert.ok(
      until(
        world,
        () => world.clock % mover.period === mover.period / 2 - mover.dwell,
      ) >= 0,
    );
    assert.equal(at(world.ball.y), mover.y + mover.travel.y - BALL);
    assert.equal(world.phase, "play");
    world.ball.vx = -inward * 2 * SUB;
    assert.ok(until(world, () => world.phase !== "play", new Map(), 240) > 0);
    assert.equal(world.lastScorer, team);
  }
});

test("a lift coming down on a rider standing under it pushes them aside or down, never through the floor", () => {
  const world = alone(lift.x + lift.w / 2, 339),
    rider = world.riders[0];
  for (let step = 0; step < 2 * lift.period; step++) {
    stepWorld(world, new Map());
    assert.ok(at(rider.y) <= 339 + 0.01);
    assert.ok(at(rider.x) >= 24 + RIDER - 0.01);
  }
});

test("where a mover is comes from the step count alone: a checkpoint taken mid-ride decodes and plays on the same", () => {
  const world = fresh("stacktrace");
  for (let tick = 0; tick < 400; tick++) {
    const inputs = held(
      botInput(world, world.riders[0]),
      botInput(world, world.riders[1]),
    );
    for (let left = paceTick(world); left > 0; left--) stepWorld(world, inputs);
  }
  const copy = decodeWorld(encodeWorld(world));
  assert.ok(copy);
  for (let tick = 0; tick < 400; tick++) {
    for (const each of [world, copy]) {
      const inputs = held(
        botInput(each, each.riders[0]),
        botInput(each, each.riders[1]),
      );
      for (let left = paceTick(each); left > 0; left--) stepWorld(each, inputs);
    }
    assert.deepEqual(encodeWorld(copy), encodeWorld(world), `tick ${tick}`);
  }
});

test("mirrored controls play out mirrored on Stack Trace, lifts and ledges included", () => {
  const world = fresh("stacktrace");
  const script = [
    RIGHT,
    RIGHT | BTN,
    BTN,
    LEFT,
    DOWN,
    LEFT | BTN,
    0,
    DOWN | BTN,
  ];
  for (let tick = 0; tick < 1200; tick++) {
    const bits = script[(tick >> 2) % script.length]!;
    const inputs = new Map([
      [A, bits],
      [B, mirrored(bits)],
    ]);
    for (let left = paceTick(world); left > 0; left--) stepWorld(world, inputs);
    assert.equal(world.riders[0].x + world.riders[1].x, 640 * SUB, `${tick}`);
    assert.equal(world.riders[0].y, world.riders[1].y);
    if (world.ball.live) assert.equal(world.ball.x, 320 * SUB);
  }
});

// ---- validity ----

test("the gadget check refuses a ledge or a mover that is lopsided, in a wall, off the field or able to crush", () => {
  const base = MAPS.stacktrace;
  assert.deepEqual(gadgetFaults(base), []);
  const withLedges = (ledges: MapDef["ledges"]) =>
    gadgetFaults({ ...base, ledges });
  const withMovers = (movers: MapDef["movers"]) =>
    gadgetFaults({ ...base, movers });
  const pair = (mover: MapDef["movers"][number]) => [
    mover,
    {
      ...mover,
      x: 640 - mover.x - mover.w,
      travel: { x: -mover.travel.x, y: mover.travel.y },
    },
  ];
  assert.ok(
    withLedges([{ x: 100, y: 200, w: 60, h: 6 }]).includes("ledge symmetry"),
  );
  assert.ok(
    withLedges([{ x: 290, y: 340, w: 60, h: 10 }]).includes("ledge in a solid"),
  );
  assert.ok(withLedges([{ x: 310, y: 200, w: 20, h: 6 }]).includes("ledge"));
  const good = {
    x: 100,
    y: 200,
    w: 60,
    h: 10,
    travel: { x: 0, y: -80 },
    period: 400,
    dwell: 20,
  };
  assert.deepEqual(withMovers(pair(good)), []);
  assert.ok(withMovers([good]).includes("mover symmetry"));
  // Down to within a rider's height of the floor: it would crush whoever stands there.
  assert.ok(withMovers(pair({ ...good, y: 320 })).includes("mover in a solid"));
  // Faster than a pixel a step, diagonal, or with no travel at all.
  assert.ok(withMovers(pair({ ...good, period: 100 })).includes("mover"));
  assert.ok(withMovers(pair({ ...good, dwell: 130 })).includes("mover"));
  assert.ok(
    withMovers(pair({ ...good, travel: { x: 40, y: -80 } })).includes("mover"),
  );
  assert.ok(
    withMovers(pair({ ...good, travel: { x: 0, y: 0 } })).includes("mover"),
  );
  // Through where a rider starts.
  assert.ok(
    withMovers(
      pair({ ...good, x: 170, y: 250, travel: { x: 0, y: 70 }, period: 400 }),
    ).some(
      (fault) => fault === "mover on a mark" || fault === "mover in a solid",
    ),
  );
});

test("the movers' clock stands still through the countdown and a goal's freeze, and every point starts it at zero", () => {
  const world = fresh("stacktrace");
  steps(world, 100);
  assert.equal(world.phase, "countdown");
  assert.equal(world.clock, 0);
  while (world.phase === "countdown") stepWorld(world, new Map());
  steps(world, 50);
  assert.equal(world.clock, 50);
  // A goal: the freeze holds the clock, the zap lets it run, and the next point starts it again.
  for (const rider of world.riders) rider.zapped = true;
  ballAt(world, 30, 120, -2, 0);
  assert.ok(until(world, () => world.phase === "zap") > 0);
  const scoredAt = world.clock;
  assert.ok(world.freeze > 0);
  while (world.freeze > 0) {
    stepWorld(world, new Map());
    assert.equal(world.clock, scoredAt);
  }
  steps(world, 10);
  assert.equal(world.clock, scoredAt + 10);
  assert.ok(
    until(world, () => world.phase === "countdown", new Map(), 5000) > 0,
  );
  assert.equal(world.clock, 0);
});

test("a checkpoint whose clock is ahead of its steps, running in a countdown, or not a whole number is refused", () => {
  const CLOCK = 15;
  const world = playing("stacktrace");
  steps(world, 40);
  const good = encodeWorld(world);
  assert.equal(good[CLOCK], 40);
  assert.ok(decodeWorld(good));
  for (const bad of [-1, 0.5, world.step + 1, "40", null]) {
    const fields = [...good];
    fields[CLOCK] = bad;
    assert.equal(decodeWorld(fields), undefined, `clock ${String(bad)}`);
  }
  assert.equal(decodeWorld(good.slice(0, CLOCK)), undefined);
  const waiting = encodeWorld(fresh("stacktrace"));
  waiting[CLOCK] = 1;
  assert.equal(decodeWorld(waiting), undefined);
});
