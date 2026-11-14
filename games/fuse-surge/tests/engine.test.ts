import test from "node:test";
import assert from "node:assert/strict";
import {
  DUCK,
  HIGH,
  JUMP,
  LOW,
  clears,
  cloneWorld,
  createWorld,
  DEFAULT_RULES,
  footholdX,
  gapAt,
  isHits,
  isInput,
  isPace,
  isPlayerCount,
  isSeconds,
  isTarget,
  limitOf,
  planInput,
  secondsLeft,
  slotsOf,
  speedAt,
  stepWorld,
  toView,
  winnersOf,
  type Pace,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import * as basics from "../src/basics.js";
import { footholds } from "../src/engine/view-kit.js";
import {
  A,
  B,
  fresh,
  playing,
  steps,
  surge,
  ticks,
  until,
} from "./fixtures/world.js";

test("the constants the service reads are the engine's", () => {
  assert.equal(basics.CAPACITY, T.CAPACITY);
  assert.equal(basics.MIN_RIDERS, T.MIN_RIDERS);
  assert.equal(basics.MAX_TARGET, T.MAX_TARGET);
  assert.equal(basics.MOST_DODGES, T.MOST_DODGES);
  assert.equal(basics.MOST_TAKEN, T.MOST_TAKEN);
});

test("a match takes two to five riders and settings within their bounds", () => {
  assert.throws(() => createWorld([A], DEFAULT_RULES, 1), /two to five/);
  assert.throws(
    () => createWorld(["1", "2", "3", "4", "5", "6"], DEFAULT_RULES, 1),
    /two to five/,
  );
  assert.ok(isPlayerCount(2) && isPlayerCount(5) && !isPlayerCount(2.5));
  assert.ok(
    isHits(1) && isHits(9) && !isHits(0) && !isHits(10) && !isHits("3"),
  );
  assert.ok(
    isSeconds(10) && isSeconds(300) && !isSeconds(9) && !isSeconds(60.5),
  );
  assert.ok(isTarget(1) && isTarget(5) && !isTarget(6));
  assert.ok(isPace(0) && isPace(2) && !isPace(3));
  assert.ok(
    isInput(JUMP | DUCK) && !isInput(4) && !isInput(-1) && !isInput(1.5),
  );
  // A zero seed still seeds the generator.
  assert.equal(createWorld([A, B], DEFAULT_RULES, 0).rng, 1);
});

test("a match opens on a three second countdown with everyone on the start line", () => {
  const world = fresh();
  assert.equal(world.phase, "ready");
  assert.deepEqual(
    world.riders.map((rider) => [rider.id, rider.x, rider.y, rider.hits]),
    [
      [A, T.START_X, 0, 0],
      [B, T.START_X, 0, 0],
    ],
  );
  steps(world, T.READY_STEPS - 1);
  assert.equal(world.phase, "ready");
  assert.equal(world.surges.length, 0, "nothing sweeps the deck yet");
  assert.equal(secondsLeft(toView(world).remaining), 1);
  steps(world, 1);
  assert.equal(world.phase, "play");
  assert.equal(toView(world).clock, limitOf(world.rules));
  assert.equal(secondsLeft(0), 0);
});

test("a held jump peaks near 145 px, a tap is a hop, and a press just before landing still jumps", () => {
  const world = fresh();
  let peak = 0;
  const flight = until(
    world,
    (w) => {
      peak = Math.max(peak, w.riders[0]!.y);
      return w.step > 0 && w.riders[0]!.y === 0;
    },
    200,
    JUMP,
  );
  assert.ok(peak > 140 * T.U && peak < 150 * T.U, `peak ${peak / T.U}`);
  assert.ok(flight > 80 && flight < 88, `flight ${flight}`);
  assert.equal(world.riders[1]!.y, 0, "the other rider stayed down");
  // Still held on landing: no second jump without a new press.
  steps(world, 3, JUMP);
  assert.equal(world.riders[0]!.y, 0);
  // A tap: jump held for one log tick, then let go.
  steps(world, 1, 0);
  steps(world, 6, JUMP);
  let hop = 0;
  until(world, (w) => {
    hop = Math.max(hop, w.riders[0]!.y);
    return w.riders[0]!.y === 0;
  });
  assert.ok(hop > T.LOW_TOP && hop < 90 * T.U, `hop ${hop / T.U}`);
  // Buffered: pressed in the air a few steps before the deck, it jumps on landing.
  steps(world, 1, JUMP);
  until(world, (w) => w.riders[0]!.vy < 0 && w.riders[0]!.y < 20 * T.U);
  steps(world, 1, 0);
  steps(world, 1, JUMP);
  const landed = until(world, (w) => w.riders[0]!.y === 0, 20, JUMP);
  assert.ok(landed >= 0);
  steps(world, 2, JUMP);
  assert.ok(world.riders[0]!.y > 0, "the buffered press took off again");
});

test("ducking is for the deck; in the air it is a dive that comes down hard", () => {
  const world = fresh();
  steps(world, 1, DUCK);
  assert.equal(world.riders[0]!.duck, true);
  steps(world, 1, 0);
  assert.equal(world.riders[0]!.duck, false);
  // Jump wins over duck on the deck.
  steps(world, 1, JUMP | DUCK);
  assert.ok(world.riders[0]!.y > 0 && !world.riders[0]!.duck);
  const twin = cloneWorld(world);
  steps(world, 20, JUMP);
  steps(twin, 20, JUMP);
  const floating = until(twin, (w) => w.riders[0]!.y === 0, 200, JUMP),
    diving = until(world, (w) => w.riders[0]!.y === 0, 200, DUCK);
  assert.ok(diving < floating / 2, `${diving} against ${floating}`);
  assert.equal(world.riders[0]!.duck, true, "it lands in the duck it held");
});

test("a low surge strikes feet on the deck and passes under a jump", () => {
  const world = playing();
  surge(world, LOW, 40);
  // A jumps in time; B stands.
  until(
    world,
    (w) => w.surges[0]!.hit !== 0 || w.surges[0]!.done === 3,
    400,
    JUMP,
  );
  const [a, b] = world.riders;
  assert.equal(a!.hits, 0);
  assert.equal(b!.hits, 1);
  assert.equal(world.surges[0]!.hit, 2);
  until(
    world,
    (w) => w.surges.length === 0 || w.surges[0]!.done === 3,
    400,
    JUMP,
  );
  assert.equal(a!.dodges, 1);
  assert.equal(a!.streak, 1);
  assert.equal(b!.dodges, 0);
  assert.equal(world.hitCounter, 1);
});

test("a high surge strikes anyone standing or jumping and passes over a duck", () => {
  const world = playing({}, [A, B, "rider-c"]);
  surge(world, HIGH, 40);
  until(world, (w) => w.surges[0]!.done === 7, 400, DUCK, 0, JUMP);
  assert.deepEqual(
    world.riders.map((rider) => rider.hits),
    [0, 1, 1],
  );
  const rider = world.riders[0]!;
  assert.ok(clears(rider, HIGH) && !clears(rider, LOW));
  assert.ok(!clears({ ...rider, duck: false }, HIGH));
});

test("a hit throws a rider one foothold back, safe while it reels and for a moment after", () => {
  const world = playing({ hits: 3 });
  surge(world, LOW, 30);
  until(world, (w) => w.riders[0]!.hits === 1);
  const rider = world.riders[0]!;
  assert.ok(rider.reel > 0);
  // A second surge right behind passes a reeling rider without a hit and without credit.
  surge(world, LOW, 10);
  until(world, (w) => w.riders[0]!.reel === 0, 400);
  assert.equal(rider.x, footholdX(1, 3));
  assert.ok(rider.x < T.START_X && rider.x > T.LAST_X);
  assert.equal(rider.grace, T.GRACE_STEPS);
  until(world, (w) => w.surges.every((each) => each.done === 3), 400);
  assert.equal(
    rider.hits,
    1,
    "the surge that crossed it while it reeled did not strike",
  );
  assert.equal(rider.dodges, 0, "nor did it count as a dodge");
  steps(world, T.GRACE_STEPS);
  assert.equal(rider.grace, 0);
  // What it holds while reeling does nothing.
  surge(world, HIGH, 30);
  until(world, (w) => w.riders[0]!.hits === 2);
  const y = rider.y;
  steps(world, 3, JUMP);
  assert.ok(rider.y <= y + 3 * T.POP_V, "no jump out of a reel");
  assert.equal(rider.x < footholdX(1, 3), true);
  assert.deepEqual(footholds(3), [600, 335, 70]);
  assert.deepEqual(footholds(1), [600]);
  assert.equal(footholdX(5, 3), T.OUT_X);
});

test("the last hit knocks a rider off the edge and into the pit", () => {
  const world = playing({ hits: 1 }, [A, B, "rider-c"]);
  surge(world, HIGH, 30);
  until(world, (w) => w.riders[1]!.out, 400, DUCK, 0, DUCK);
  const rider = world.riders[1]!;
  assert.equal(world.phase, "play", "two are still up");
  until(world, (w) => w.riders[1]!.y === -T.FALL_DEPTH, 2000, DUCK, JUMP, DUCK);
  assert.equal(rider.x, T.OUT_X);
  assert.equal(rider.vy, 0);
  const view = toView(world).riders[1]!;
  assert.ok(view.out && view.y < 0 && view.x < 0);
  // It lies where it fell, whatever it holds.
  steps(world, 5, 0, JUMP, 0);
  assert.equal(rider.y, -T.FALL_DEPTH);
});

test("five clean dodges in a row win a foothold back, unless the match turned that off", () => {
  for (const recover of [true, false]) {
    const world = playing({ hits: 3, recover });
    const rider = world.riders[0]!;
    rider.hits = 1;
    rider.x = footholdX(1, 3);
    for (let i = 0; i < T.STREAK_FOR_STEP; i++) {
      assert.equal(rider.hits, 1);
      surge(world, HIGH, -200);
      until(world, (w) => w.surges.length === 0, 2000, DUCK, DUCK);
    }
    assert.equal(rider.hits, recover ? 0 : 1);
    assert.equal(rider.streak, recover ? 0 : T.STREAK_FOR_STEP);
    if (!recover) continue;
    // It walks forward to the foothold it won, free to jump on the way.
    assert.ok(rider.x > footholdX(1, 3) && rider.x < T.START_X);
    until(world, (w) => w.riders[0]!.x === T.START_X, 2000);
    assert.equal(rider.x, T.START_X);
    // At the front there is nothing to win: the streak just stays full.
    for (let i = 0; i < T.STREAK_FOR_STEP + 1; i++) {
      surge(world, HIGH, 60);
      until(world, (w) => w.surges.length === 0, 2000, DUCK, DUCK);
    }
    assert.equal(rider.streak, T.STREAK_FOR_STEP);
    assert.equal(rider.hits, 0);
  }
});

test("a flipping surge changes height at the gate, before it reaches anyone", () => {
  const world = playing();
  const flipping = surge(world, LOW, 0, { x: T.SPAWN_X, flip: true });
  until(world, () => flipping.x <= T.GATE_X, 2000);
  assert.equal(flipping.kind, HIGH);
  assert.equal(flipping.flip, false);
  assert.ok(flipping.x > T.START_X + T.REACH);
  assert.equal(toView(world).surges[0]!.flips, false);
});

test("surges speed up and close up as a round goes on, by pace, up to a ceiling", () => {
  for (const pace of [0, 1, 2] as Pace[]) {
    assert.ok(speedAt(7200, pace) > speedAt(0, pace) * 1.8);
    assert.ok(gapAt(7200, pace) < gapAt(0, pace));
    assert.equal(gapAt(1_000_000, pace), T.GAP_MIN[pace]);
    assert.equal(speedAt(1_000_000, pace), T.SPEED_MAX);
  }
  assert.ok(speedAt(0, 2) > speedAt(0, 1) && speedAt(0, 1) > speedAt(0, 0));
  const world = fresh({ pace: 1 });
  steps(world, T.READY_STEPS);
  const early = toView(world);
  assert.equal(early.speed, early.speedStart);
  steps(world, 3000, DUCK | JUMP);
  assert.ok(toView(world).speed > early.speed);
});

test("the round's surges come from the match's seed: the same seed replays, another differs", () => {
  const run = (seed: number) => {
    const world = fresh({}, seed);
    const seen: string[] = [];
    let last = 0;
    for (let i = 0; i < 4000; i++) {
      stepWorld(world, []);
      const newest = world.surges.at(-1);
      if (newest && newest.id !== last) {
        last = newest.id;
        seen.push(`${world.step}:${newest.kind}:${newest.flip}`);
      }
    }
    return seen.join(" ");
  };
  assert.equal(run(7), run(7));
  assert.notEqual(run(7), run(8));
  // Never more than three of one height in a row, counting a flip as what it strikes as.
  const world = fresh({ seconds: 300 }, 99, [A, B]);
  const kinds: number[] = [];
  let last = 0;
  ticks(world, 3000, planInput, (w) => {
    const newest = w.surges.at(-1);
    if (newest && newest.id !== last) {
      last = newest.id;
      kinds.push(newest.flip ? 1 - newest.kind : newest.kind);
    }
    return w.phase !== "ready" && w.phase !== "play";
  });
  assert.ok(kinds.length > 100);
  for (let i = 3; i < kinds.length; i++)
    assert.ok(
      !(
        kinds[i] === kinds[i - 1] &&
        kinds[i] === kinds[i - 2] &&
        kinds[i] === kinds[i - 3]
      ),
      `four ${kinds[i]} in a row at ${i}`,
    );
  assert.ok(kinds.includes(LOW) && kinds.includes(HIGH));
});

test("the last rider standing takes the round, and the next one counts in with everyone back", () => {
  const world = playing({ hits: 1, target: 2 });
  surge(world, HIGH, 30);
  until(world, (w) => w.phase === "break", 400, DUCK, 0);
  assert.equal(world.lastReason, "last");
  assert.deepEqual(toView(world).lastWinners, [0]);
  assert.deepEqual(
    world.riders.map((rider) => rider.wins),
    [1, 0],
  );
  assert.equal(winnersOf(world), 0, "one round is not the match");
  const before = world.clock;
  steps(world, T.BREAK_STEPS - 1);
  assert.equal(world.clock, before, "the clock rests in the break");
  assert.equal(world.phase, "break");
  steps(world, 1);
  assert.equal(world.phase, "ready");
  assert.equal(world.round, 2);
  assert.equal(world.clock, 0);
  assert.equal(world.surges.length, 0);
  assert.deepEqual(
    world.riders.map((rider) => [rider.x, rider.y, rider.hits, rider.out]),
    [
      [T.START_X, 0, 0, false],
      [T.START_X, 0, 0, false],
    ],
  );
  assert.deepEqual(
    world.riders.map((rider) => rider.wins),
    [1, 0],
    "wins carry over",
  );
});

test("riders knocked off by the same surge draw the round and each take a win", () => {
  const world = playing({ hits: 1, target: 3 }, [A, B, "rider-c"]);
  surge(world, HIGH, 30);
  until(world, (w) => w.riders[2]!.out, 400, DUCK, DUCK, 0);
  assert.equal(world.phase, "play");
  until(world, (w) => w.surges.length === 0, 2000, DUCK, DUCK);
  surge(world, LOW, 30);
  until(world, (w) => w.phase === "break", 400);
  assert.equal(world.lastReason, "wipe");
  assert.deepEqual(slotsOf(world.lastWinners, 3), [0, 1]);
  assert.deepEqual(
    world.riders.map((rider) => rider.wins),
    [1, 1, 0],
  );
});

test("when the clock runs out everyone still standing draws the round", () => {
  const world = fresh({ seconds: 10, target: 1 }, 5, [A, B, "rider-c"]);
  // Two sound riders and one who never moves.
  ticks(
    world,
    4000,
    (w, slot) => (slot === 2 ? 0 : planInput(w, slot)),
    (w) => w.phase === "break",
  );
  assert.equal(world.lastReason, "time");
  assert.equal(world.clock, limitOf(world.rules));
  assert.equal(toView(world).clock, 0);
  assert.deepEqual(slotsOf(world.lastWinners, 3), [0, 1]);
  assert.equal(world.riders[2]!.out, true);
  steps(world, T.BREAK_STEPS);
  assert.equal(world.phase, "over");
  assert.deepEqual(
    toView(world).winners,
    [0, 1],
    "a drawn match has two winners",
  );
  assert.equal(winnersOf(world), 3);
  const frozen = JSON.stringify(world);
  steps(world, 50, JUMP, JUMP);
  assert.equal(
    JSON.stringify(world),
    frozen,
    "a finished match no longer moves",
  );
});

test("the match goes to whoever first has the target's wins", () => {
  const world = fresh({ hits: 2, target: 2, seconds: 30 }, 11);
  ticks(
    world,
    20000,
    (w, slot) => (slot === 0 ? planInput(w, slot) : 0),
    (w) => w.phase === "over",
  );
  assert.equal(world.phase, "over");
  assert.equal(world.round, 2);
  assert.deepEqual(
    world.riders.map((rider) => rider.wins),
    [2, 0],
  );
  assert.equal(world.winners, 1);
  assert.ok(world.riders[0]!.dodges > 0);
  assert.equal(world.riders[1]!.taken, 4);
});

test("sound play is never struck: every pattern the deck sends can be cleared, at every pace", () => {
  for (const pace of [0, 1, 2] as Pace[])
    for (let seed = 1; seed <= 8; seed++) {
      const world = fresh(
        { pace, seconds: 120, hits: 9, target: 1, recover: false },
        seed * 7919,
      );
      ticks(world, 4000, planInput, (w) => w.phase === "break");
      assert.equal(world.lastReason, "time", `pace ${pace} seed ${seed}`);
      assert.deepEqual(
        world.riders.map((rider) => rider.taken),
        [0, 0],
        `pace ${pace} seed ${seed}`,
      );
      assert.ok(world.riders[0]!.dodges > 60);
    }
});

test("the view is the world in pixels, and a clone shares nothing with it", () => {
  const world = playing({ hits: 4 });
  surge(world, HIGH, 100, { flip: false });
  steps(world, 10, JUMP, DUCK);
  const view = toView(world);
  assert.equal(view.riders[0]!.x, 600);
  assert.ok(view.riders[0]!.air && view.riders[0]!.y > 0);
  assert.ok(view.riders[1]!.duck && !view.riders[1]!.air);
  assert.equal(view.riders[1]!.foothold, 600);
  assert.equal(view.maxHits, 4);
  assert.equal(view.streakFor, T.STREAK_FOR_STEP);
  assert.equal(view.surges[0]!.kind, HIGH);
  assert.equal(view.limit, 60 * T.STEPS_PER_SECOND);
  const copy = cloneWorld(world);
  steps(copy, 30, JUMP, JUMP);
  assert.notDeepEqual(copy, world);
  assert.deepEqual(
    toView(world),
    view,
    "stepping the clone left the world alone",
  );
});
