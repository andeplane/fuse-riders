import test from "node:test";
import assert from "node:assert/strict";
import {
  BTN,
  CAPACITY,
  DOWN,
  LEFT,
  MAP_IDS,
  RIGHT,
  TARGET,
  UP,
  isInput,
  mirrored,
  stepWorld,
  type World,
} from "../src/engine/index.js";
import { SUB, delta, isqrt, toward, wrap } from "../src/engine/math.js";
import * as basics from "../src/basics.js";
import {
  A,
  at,
  ballAt,
  fresh,
  held,
  place,
  playing,
  scripted,
  steps,
  until,
} from "./fixtures/world.js";

const W = 640 * SUB,
  FLOOR = 335;

/** Taps the button: one step held, one released. */
function tap(world: World, bits = 0): void {
  stepWorld(world, held(bits | BTN));
  stepWorld(world, held(bits));
}

test("the integer helpers are exact, odd and wrap the short way round", () => {
  for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 99, 1e6, 2 ** 40 + 7])
    assert.equal(isqrt(n), Math.floor(Math.sqrt(n)));
  assert.deepEqual(toward(3, 4, 500), { x: 300, y: 400 });
  assert.deepEqual(toward(-3, -4, 500), { x: -300, y: -400 });
  assert.deepEqual(toward(0, 0, 500), { x: 0, y: -500 });
  assert.equal(wrap(-1, 10), 9);
  assert.equal(wrap(10, 10), 0);
  assert.equal(delta(9, 10), -1);
  assert.equal(delta(-9, 10), 1);
  assert.equal(delta(3, 10), 3);
});

test("an input is held bits a stick can make", () => {
  for (const bits of [0, UP, DOWN | LEFT, RIGHT | BTN, UP | RIGHT | BTN])
    assert.ok(isInput(bits));
  for (const bits of [LEFT | RIGHT, UP | DOWN, 32, -1, 1.5, "1", null])
    assert.ok(!isInput(bits));
  assert.equal(mirrored(LEFT | BTN), RIGHT | BTN);
  assert.equal(mirrored(UP | RIGHT), UP | LEFT);
  assert.equal(mirrored(DOWN), DOWN);
});

test("the service's constants match the engine's", () => {
  assert.equal(basics.CAPACITY, CAPACITY);
  assert.equal(basics.TARGET, TARGET);
});

test("a rider runs the way the stick points, and stops when it is let go", () => {
  const world = playing(),
    rider = world.riders[0],
    start = rider.x;
  steps(world, 60, held(RIGHT));
  assert.ok(at(rider.x - start) > 60, "half a second of running covers ground");
  assert.equal(rider.facing, 1);
  assert.ok(rider.grounded);
  assert.equal(at(rider.y), FLOOR, "it stays on the floor");
  const speed = rider.vx;
  steps(world, 30);
  assert.ok(rider.vx < speed / 4, "it skids to a stop");
  assert.notEqual(
    until(world, () => rider.vx === 0),
    -1,
  );
  const rest = rider.x;
  steps(world, 30);
  assert.equal(rider.x, rest);
});

test("reversing the stick turns a rider at once", () => {
  const world = playing(),
    rider = world.riders[0];
  steps(world, 60, held(RIGHT));
  stepWorld(world, held(LEFT));
  assert.ok(rider.vx < 0);
  assert.equal(rider.facing, -1);
});

test("the button on the ground is a jump, and holding it does not jump again", () => {
  const world = playing(),
    rider = world.riders[0];
  stepWorld(world, held(BTN));
  assert.ok(rider.vy < 0);
  assert.ok(!rider.grounded);
  assert.equal(rider.jumps, 1);
  let top = rider.y;
  const landed = until(
    world,
    () => {
      top = Math.min(top, rider.y);
      return rider.grounded;
    },
    held(BTN),
  );
  assert.ok(landed > 60, "a jump lasts most of a second");
  assert.ok(FLOOR - at(top) > 40 && FLOOR - at(top) < 80, "about 56 px high");
  steps(world, 30, held(BTN));
  assert.ok(rider.grounded, "the held button is not a new press");
  assert.equal(rider.jumps, 1);
});

test("the button in the air jumps again, as often as it is pressed", () => {
  const world = playing(),
    rider = world.riders[0];
  place(world, 0, 215, 300);
  for (let i = 0; i < 12; i++) {
    tap(world);
    steps(world, 14);
  }
  assert.ok(at(rider.y) < 120, "flapping climbs well above one jump");
  assert.equal(rider.jumps, 12);
});

test("down and the button in the air is a quick drop", () => {
  const world = playing(),
    plain = playing();
  place(world, 0, 130, 100);
  place(plain, 0, 130, 100);
  stepWorld(world, held(DOWN | BTN));
  stepWorld(plain, held(0));
  assert.ok(world.riders[0].vy > 3000, "it is thrown downward");
  const fast = until(world, () => world.riders[0].grounded, held(DOWN)),
    slow = until(plain, () => plain.riders[0].grounded);
  assert.ok(fast > 0 && fast < slow - 20, `${fast} against ${slow}`);
});

test("a grounded jump lifts a ball that is close, with some of the rider's run", () => {
  const world = playing(),
    rider = world.riders[0];
  steps(world, 40, held(RIGHT));
  ballAt(world, at(rider.x) + 30, FLOOR + 1);
  stepWorld(world, held(RIGHT | BTN));
  assert.ok(world.ball.vy < -SUB, "the ball pops up with the jump");
  assert.ok(world.ball.vx > 0, "and goes the rider's way");
  assert.equal(world.ball.touch, 0);

  for (const [dx, y] of [
    [60, FLOOR + 1],
    [0, FLOOR - 30],
  ] as const) {
    const far = playing();
    ballAt(far, at(far.riders[0].x) + dx, y);
    const before = far.ball.vy;
    stepWorld(far, held(BTN));
    assert.ok(far.ball.vy >= before, "out of reach, the ball is left alone");
    assert.equal(far.ball.touch, -1);
  }
});

test("an air-jump lifts nothing", () => {
  const world = playing();
  place(world, 0, 130, 200);
  ballAt(world, 150, 205);
  const before = world.ball.vy;
  stepWorld(world, held(BTN));
  assert.ok(world.ball.vy >= before);
});

test("down and the button on the ground is a power slide: faster than a run, then a hop", () => {
  const sliding = playing(),
    running = playing(),
    rider = sliding.riders[0];
  let slid = 0;
  stepWorld(sliding, held(RIGHT | DOWN | BTN));
  assert.equal(rider.slide > 0, true);
  while (rider.slide > 0) {
    stepWorld(sliding, held(DOWN | BTN));
    slid++;
    assert.ok(slid < 200);
  }
  assert.ok(slid >= 70 && slid <= 80, `a slide lasts ${slid} steps`);
  assert.ok(rider.vy < 0 && !rider.grounded, "it ends with a hop");
  steps(running, slid + 1, held(RIGHT));
  assert.ok(
    rider.x - sliding.riders[1].x > running.riders[0].x - running.riders[1].x,
  );
  assert.ok(at(rider.x) - 130 > 1.3 * (at(running.riders[0].x) - 130));
  assert.notEqual(
    until(sliding, () => rider.grounded, held(DOWN | BTN)),
    -1,
  );
  steps(sliding, 20, held(DOWN | BTN));
  assert.equal(rider.slide, 0, "the held button does not slide again");
});

test("a slide goes the way the rider faces, or the stick points", () => {
  const world = playing(),
    rider = world.riders[0];
  stepWorld(world, held(LEFT | DOWN | BTN));
  steps(world, 10, held(DOWN | BTN));
  assert.ok(rider.vx < -3 * SUB);
  assert.equal(rider.facing, -1);
  const facing = playing();
  stepWorld(facing, held(DOWN | BTN));
  steps(facing, 10, held(DOWN | BTN));
  assert.ok(facing.riders[0].vx > 3 * SUB, "slot 0 starts facing right");
});

test("letting go of the button ends a slide early, with the hop", () => {
  const world = playing(),
    rider = world.riders[0];
  stepWorld(world, held(DOWN | BTN));
  steps(world, 20, held(DOWN | BTN));
  assert.ok(rider.slide > 0 && rider.grounded);
  stepWorld(world, held(DOWN));
  assert.equal(rider.slide, 0);
  assert.ok(rider.vy < 0 && !rider.grounded);
});

test("sliding off an edge ends the slide with the hop", () => {
  const world = playing(),
    rider = world.riders[0];
  // The left ledge is 80–180 px wide at y 256; start near its right end.
  place(world, 0, 150, 247);
  assert.notEqual(
    until(world, () => rider.grounded),
    -1,
  );
  stepWorld(world, held(RIGHT | DOWN | BTN));
  let hopped = -1;
  for (let i = 0; i < 40 && hopped < 0; i++) {
    stepWorld(world, held(DOWN | BTN));
    if (rider.slide === 0) hopped = i;
  }
  assert.ok(hopped >= 0 && hopped < 30, "well before the slide's time is up");
  assert.ok(at(rider.x) > 180, "it left the ledge");
  assert.ok(rider.vy < 0);
});

test("solids stop riders: floor, ceiling, walls and ledges", () => {
  const world = playing(),
    rider = world.riders[0];
  // Up into the ceiling, which is 16 px thick.
  place(world, 0, 130, 60);
  for (let i = 0; i < 40; i++) tap(world);
  assert.ok(at(rider.y) >= 16 + 9 - 0.01);
  // Down onto the left ledge.
  place(world, 0, 130, 200);
  assert.notEqual(
    until(world, () => rider.grounded),
    -1,
  );
  assert.ok(Math.abs(at(rider.y) - 247) < 0.01, "standing on the ledge top");
  // Along the floor into the wall below the goal gap.
  place(world, 0, 60, FLOOR);
  steps(world, 200, held(LEFT));
  assert.ok(Math.abs(at(rider.x) - (12 + 9)) < 0.01, "held by the wall");
});

test("riders bump: neither passes through the other, and each is pushed the same", () => {
  const world = playing(),
    [a, b] = world.riders;
  place(world, 0, 300, FLOOR);
  place(world, 1, 340, FLOOR);
  for (let i = 0; i < 120; i++) {
    stepWorld(world, held(RIGHT, LEFT));
    assert.ok(a.x < b.x);
    assert.equal(a.x + b.x, 640 * SUB, "the pair stays centred");
  }
  assert.ok(at(b.x - a.x) > 17.9, "they end up touching, not overlapping");
});

test("the ball falls, bounces lower each time and comes to rest on the floor", () => {
  const world = playing(),
    ball = world.ball;
  ballAt(world, 400, 200);
  const peaks: number[] = [];
  let rising = false,
    top = ball.y;
  for (let i = 0; i < 1500; i++) {
    stepWorld(world, new Map());
    assert.ok(at(ball.y) <= 344 - 8 + 0.01, "never through the floor");
    if (ball.vy < 0) {
      rising = true;
      top = ball.y;
    } else if (rising) {
      rising = false;
      peaks.push(at(top));
    }
  }
  assert.ok(peaks.length >= 3);
  assert.ok(
    336 - peaks[0]! > 50,
    "the first bounce comes most of the way back",
  );
  assert.ok(336 - peaks[0]! < 136, "but not all of it");
  assert.ok(peaks[1]! > peaks[0]! && peaks[2]! > peaks[1]!);
  assert.ok(Math.abs(at(ball.y) - 336) < 0.1, "at rest on the floor");
  assert.ok(
    ball.bounces >= 3 && ball.bounces < 40,
    "tiny bounces do not count",
  );
});

test("the ball bounces off walls and a rolling ball stops", () => {
  const world = playing(),
    ball = world.ball;
  ballAt(world, 100, 300, -3, 0);
  assert.notEqual(
    until(world, () => ball.vx > 0),
    -1,
  );
  assert.ok(at(ball.x) >= 12 + 8 - 0.01);
  steps(world, 1500);
  assert.equal(ball.vx, 0);
});

test("a rider running into the ball kicks it ahead and is not slowed by it", () => {
  const world = playing(),
    lone = playing(),
    rider = world.riders[0];
  ballAt(world, 170, 336);
  ballAt(lone, 400, 336);
  let lead = 0;
  for (let i = 0; i < 90; i++) {
    stepWorld(world, held(RIGHT));
    stepWorld(lone, held(RIGHT));
    const gap = at(world.ball.x - rider.x);
    assert.ok(gap > 16.9, "the ball is never inside the rider");
    lead = Math.max(lead, world.ball.vx - rider.vx);
  }
  assert.equal(rider.x, lone.riders[0].x, "the ball does not push back");
  assert.ok(lead > SUB / 4, "the ball leaves faster than the rider");
  assert.ok(at(world.ball.x - rider.x) > 25, "and stays ahead");
  assert.equal(world.ball.touch, 0);
});

test("a rider flies through the goal gap and comes out on the other side; the ball there would have scored", () => {
  const world = playing(),
    rider = world.riders[0];
  ballAt(world, 320, 336);
  place(world, 0, 40, 170);
  rider.vx = -3 * SUB;
  let wrapped = false;
  for (let i = 0; i < 40 && !wrapped; i++) {
    stepWorld(world, held(LEFT));
    wrapped = at(rider.x) > 320;
  }
  assert.ok(wrapped, "leaving on the left arrives on the right");
  assert.ok(at(rider.x) < 640);
  assert.deepEqual(world.score, [0, 0]);
  assert.equal(world.phase, "play");
});

test("on a map that wraps top to bottom, what falls through a shaft comes back from above", () => {
  const world = playing("downlink"),
    rider = world.riders[0];
  place(world, 0, 160, 320);
  let seen = false;
  for (let i = 0; i < 80 && !seen; i++) {
    stepWorld(world, new Map());
    seen = at(rider.y) < 100;
  }
  assert.ok(seen, "the rider reappears at the top");
  assert.ok(rider.y >= 0);
});

test("on a map that does not wrap sideways, the walls hold everything in", () => {
  const world = playing("downlink");
  ballAt(world, 30, 300, -3.5, 0);
  place(world, 1, 600, 300);
  for (let i = 0; i < 300; i++) {
    stepWorld(world, held(0, RIGHT));
    assert.ok(at(world.ball.x) >= 12 + 8 - 0.01);
    assert.ok(at(world.riders[1].x) <= 628 - 9 + 0.01);
  }
});

test("unknown or impossible inputs count as nothing held", () => {
  const world = playing(),
    still = playing();
  steps(
    world,
    30,
    new Map([
      [A, LEFT | RIGHT | BTN],
      ["stranger", RIGHT],
    ]),
  );
  steps(still, 30);
  assert.deepEqual(world, still);
});

test("the same inputs replay to the same world, on every map", () => {
  for (const mapId of MAP_IDS) {
    const run = () => {
      const world = fresh(mapId),
        next = scripted(99);
      const keys = [0, LEFT, RIGHT, BTN, DOWN | BTN, RIGHT | BTN, LEFT | BTN];
      let inputs = held(0, 0);
      for (let i = 0; i < 3000; i++) {
        if (i % 6 === 0)
          inputs = held(
            keys[next() % keys.length]!,
            keys[next() % keys.length]!,
          );
        stepWorld(world, inputs);
      }
      return world;
    };
    assert.deepEqual(run(), run());
  }
});

test("mirrored inputs play out mirrored: neither slot has an advantage", () => {
  const keys = [
    0,
    LEFT,
    RIGHT,
    RIGHT,
    BTN,
    RIGHT | BTN,
    RIGHT | BTN,
    LEFT | BTN,
    DOWN | BTN,
    RIGHT | DOWN | BTN,
    UP | RIGHT,
  ];
  for (const mapId of MAP_IDS)
    for (const seed of [1, 2, 3]) {
      const world = fresh(mapId),
        next = scripted(seed),
        [a, b] = world.riders;
      let bits = 0;
      for (let i = 0; i < 6000; i++) {
        if (i % 6 === 0) bits = keys[next() % keys.length]!;
        stepWorld(world, held(bits, mirrored(bits)));
        const where = `${mapId} seed ${seed} step ${i}`;
        assert.equal(wrap(W - a.x, W), b.x, where);
        assert.equal(a.y, b.y, where);
        assert.equal(a.vx + b.vx, 0, where);
        assert.equal(a.vy, b.vy, where);
        assert.equal(a.grounded, b.grounded, where);
        assert.equal(world.ball.x, W / 2, where);
        assert.equal(world.ball.vx, 0, where);
      }
      assert.deepEqual(world.score, [0, 0]);
      assert.equal(a.jumps, b.jumps);
      assert.ok(a.jumps > 20, "the script really flies the riders about");
    }
});

test("two riders reaching the ball in the same step from either side leave it in the middle", () => {
  const world = playing(),
    [a, b] = world.riders;
  ballAt(world, 320, 336);
  place(world, 0, 280, FLOOR);
  place(world, 1, 360, FLOOR);
  let touched = false;
  for (let i = 0; i < 240; i++) {
    stepWorld(world, held(RIGHT, LEFT));
    assert.equal(world.ball.x, W / 2);
    assert.equal(a.x + b.x, W);
    touched ||= world.ball.bounces > 0;
  }
  assert.ok(touched, "both did reach it");
  assert.equal(world.ball.touch, -1, "and it is nobody's ball");
});
