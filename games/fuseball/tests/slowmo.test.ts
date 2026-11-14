import test from "node:test";
import assert from "node:assert/strict";
import {
  CLOUD_SPEED_CORE,
  CLOUD_SPEED_EDGE,
  GOAL_FREEZE_STEPS,
  GOAL_TICKS,
  MAPS,
  MAP_IDS,
  MIN_SPEED,
  RIGHT,
  SLOW_EASE_IN,
  SLOW_EASE_OUT,
  SLOW_HOLD_TICKS,
  SPEED_FULL,
  STEPS_PER_TICK,
  TICKS_PER_SECOND,
  ZAP_SPEED,
  ZAP_STEPS,
  decodeWorld,
  encodeWorld,
  paceTick,
  slowed,
  stepWorld,
  stepsPerTick,
  toView,
  type MapId,
  type World,
} from "../src/engine/index.js";
import { ballAt, fresh, held, place, playing } from "./fixtures/world.js";

/**
 * Slow motion: the arena's speed is state, eased once per log tick, and a tick's step count comes from it. These
 * hold the ball where the test wants it, so only the pace is under test.
 */
const seconds = (ticks: number): number => ticks / TICKS_PER_SECOND;

/** One log tick with the ball pinned at `(x, y)`: returns the steps it ran. */
function tickAt(world: World, x: number, y: number): number {
  ballAt(world, x, y);
  const count = paceTick(world);
  for (let left = count; left > 0; left--) {
    ballAt(world, x, y);
    stepWorld(world, new Map());
  }
  ballAt(world, x, y);
  return count;
}

/** A point clear of every cloud, goal and solid of the map, where a pinned ball slows nothing. */
const clearOf = (mapId: MapId) => MAPS[mapId].ballAnchor;

function scoreFor(world: World, team: 0 | 1): void {
  const goal = MAPS[world.mapId].goals.find((each) => each.team === team)!;
  if ("r" in goal) ballAt(world, goal.x, goal.y);
  else ballAt(world, goal.x + goal.w / 2, goal.y + goal.h / 2);
}

test("the tuning keeps every tick at one step or more, and inside the measured ranges", () => {
  assert.ok(MIN_SPEED * STEPS_PER_TICK >= SPEED_FULL);
  for (const speed of [CLOUD_SPEED_CORE, CLOUD_SPEED_EDGE, ZAP_SPEED])
    assert.ok(speed >= MIN_SPEED && speed < SPEED_FULL);
  assert.ok(CLOUD_SPEED_CORE / SPEED_FULL >= 0.35);
  assert.ok(CLOUD_SPEED_EDGE / SPEED_FULL <= 0.5);
  assert.ok(ZAP_SPEED / SPEED_FULL <= 0.25);
  assert.ok(Math.abs(seconds(SLOW_HOLD_TICKS) - 0.2) < 0.051);
});

test("at full speed a tick is six steps, in play and in the countdown, on every map", () => {
  for (const mapId of MAP_IDS) {
    const waiting = fresh(mapId);
    assert.equal(stepsPerTick(waiting), STEPS_PER_TICK);
    assert.equal(paceTick(waiting), STEPS_PER_TICK);
    const world = playing(mapId);
    assert.equal(world.speed, SPEED_FULL);
    assert.equal(stepsPerTick(world), STEPS_PER_TICK, "outside every cloud");
    assert.equal(toView(world).speed, 1);
    assert.ok(!toView(world).slow);
  }
});

test("the ball entering a cloud eases the arena down over 0.3 to 0.6 s, slower the deeper it is", () => {
  for (const mapId of MAP_IDS) {
    const cloud = MAPS[mapId].clouds[0]!;
    // At the centre: down to the core speed.
    const deep = playing(mapId),
      curve: number[] = [];
    let ticks = 0;
    while (deep.speed > CLOUD_SPEED_CORE && ticks < 100) {
      tickAt(deep, cloud.x, cloud.y);
      curve.push(deep.speed);
      ticks++;
    }
    assert.equal(deep.speed, CLOUD_SPEED_CORE, mapId);
    assert.ok(seconds(ticks) >= 0.3 && seconds(ticks) <= 0.6, `${ticks} ticks`);
    assert.equal(curve[0], SPEED_FULL - SLOW_EASE_IN, "it eases, not snaps");
    for (let i = 1; i < curve.length; i++)
      assert.ok(curve[i]! < curve[i - 1]!, "monotonically down");
    assert.ok(slowed(deep) && toView(deep).slow);
    assert.equal(toView(deep).speed, CLOUD_SPEED_CORE / SPEED_FULL);
    // It stays there for as long as the ball does.
    for (let i = 0; i < 40; i++) tickAt(deep, cloud.x, cloud.y);
    assert.equal(deep.speed, CLOUD_SPEED_CORE);

    // Just inside the rim: half speed, give or take the last pixel.
    const rim = playing(mapId);
    for (let i = 0; i < 40; i++) tickAt(rim, cloud.x + cloud.r - 1, cloud.y);
    assert.ok(
      rim.speed <= CLOUD_SPEED_EDGE && rim.speed >= CLOUD_SPEED_EDGE - 2,
    );
    // Half way in: between the two.
    const half = playing(mapId);
    for (let i = 0; i < 40; i++) tickAt(half, cloud.x + cloud.r / 2, cloud.y);
    assert.ok(half.speed > deep.speed && half.speed < rim.speed);
    // Just outside: nothing.
    const out = playing(mapId);
    for (let i = 0; i < 10; i++) tickAt(out, cloud.x + cloud.r + 1, cloud.y);
    assert.equal(out.speed, SPEED_FULL, `${mapId}: just outside the rim`);
  }
});

test("slow ticks run the speed's share of six steps, exactly, with the remainder carried", () => {
  const world = playing(),
    cloud = MAPS.gridlock.clouds[0]!;
  for (let i = 0; i < 40; i++) tickAt(world, cloud.x, cloud.y);
  const before = world.step;
  let most = 0,
    least = 9;
  for (let i = 0; i < SPEED_FULL; i++) {
    assert.equal(stepsPerTick(world), stepsPerTick(world), "reading is pure");
    const peek = stepsPerTick(world),
      count = tickAt(world, cloud.x, cloud.y);
    assert.equal(count, peek, "the fold runs what the room was told");
    most = Math.max(most, count);
    least = Math.min(least, count);
  }
  // 256 ticks at 90/256 of six steps a tick is exactly 540 steps.
  assert.equal(world.step - before, CLOUD_SPEED_CORE * STEPS_PER_TICK);
  assert.deepEqual([least, most], [2, 3]);
  assert.ok(world.budget >= 0 && world.budget < SPEED_FULL);
});

test("after the ball leaves a cloud the speed holds for 0.2 s, then eases back over 0.3 to 0.5 s", () => {
  const world = playing(),
    cloud = MAPS.gridlock.clouds[0]!,
    away = clearOf("gridlock");
  for (let i = 0; i < 40; i++) tickAt(world, cloud.x, cloud.y);
  const curve: number[] = [];
  while (world.speed < SPEED_FULL && curve.length < 100) {
    tickAt(world, away.x, away.y);
    curve.push(world.speed);
  }
  const held = curve.filter((speed) => speed === CLOUD_SPEED_CORE).length,
    ramp = curve.length - held;
  assert.equal(held, SLOW_HOLD_TICKS, "the hold");
  assert.equal(curve[held], CLOUD_SPEED_CORE + SLOW_EASE_OUT);
  assert.ok(seconds(ramp) >= 0.3 && seconds(ramp) <= 0.5, `${ramp} ticks up`);
  for (let i = held + 1; i < curve.length; i++)
    assert.ok(curve[i]! > curve[i - 1]!, "monotonically up");
  assert.equal(world.linger, 0);
  assert.equal(stepsPerTick(world), STEPS_PER_TICK);

  // Back in during the hold: the hold starts over, and the speed never rises.
  for (let i = 0; i < 40; i++) tickAt(world, cloud.x, cloud.y);
  tickAt(world, away.x, away.y);
  tickAt(world, away.x, away.y);
  tickAt(world, cloud.x, cloud.y);
  assert.equal(world.speed, CLOUD_SPEED_CORE);
  assert.equal(world.linger, SLOW_HOLD_TICKS);
});

test("only the ball slows the arena: not a rider in a cloud, a bubble, or the countdown", () => {
  const world = playing(),
    cloud = MAPS.gridlock.clouds[0]!;
  place(world, 0, cloud.x, cloud.y);
  world.bubbles[1] = {
    active: true,
    hard: false,
    x: cloud.x * 4096,
    y: cloud.y * 4096,
    seq: 1,
  };
  assert.equal(paceTick(world), STEPS_PER_TICK);
  assert.equal(world.speed, SPEED_FULL);

  const waiting = fresh();
  ballAt(waiting, cloud.x, cloud.y);
  assert.ok(!slowed(waiting));
  assert.equal(paceTick(waiting), STEPS_PER_TICK);
  assert.equal(waiting.speed, SPEED_FULL);
});

test("a goal freezes the arena for 1.3 s, then the zap runs at a quarter speed for 4.7 s", () => {
  const world = playing();
  place(world, 0, 200, 200);
  scoreFor(world, 0);
  const inputs = held(RIGHT);
  let count = paceTick(world);
  for (let left = count; left > 0; left--) stepWorld(world, inputs);
  assert.equal(world.phase, "zap");
  assert.equal(world.speed, 0);
  assert.ok(toView(world).frozen);
  assert.equal(toView(world).speed, 0);
  assert.ok(world.freeze > GOAL_FREEZE_STEPS - STEPS_PER_TICK);

  // The freeze: the clock runs, nothing moves.
  const frozen = { ...world.riders[0] },
    ball = { ...world.ball };
  let freezeTicks = 0;
  while (world.freeze > 0) {
    count = paceTick(world);
    assert.ok(count >= 1 && count <= STEPS_PER_TICK);
    for (let left = count; left > 0; left--) stepWorld(world, inputs);
    freezeTicks++;
    if (world.freeze > 0) assert.equal(world.speed, 0);
  }
  assert.equal(freezeTicks, 26);
  assert.ok(Math.abs(seconds(freezeTicks) - 1.3) < 0.01);
  assert.deepEqual(
    { ...world.riders[0], prev: 0 },
    { ...frozen, prev: 0 },
    "the scorer did not move",
  );
  assert.deepEqual(world.ball, ball);
  assert.equal(world.phaseSteps, ZAP_STEPS, "the zap has not begun");

  // The beam: a quarter speed, one or two steps a tick, and the scorer moves again.
  assert.equal(world.speed, ZAP_SPEED);
  assert.ok(!toView(world).frozen);
  let zapTicks = 0;
  const from = world.riders[0].x;
  while (world.phase === "zap") {
    count = paceTick(world);
    assert.equal(world.speed, ZAP_SPEED);
    assert.ok(count === 1 || count === 2, `${count} steps`);
    for (let left = count; left > 0; left--) stepWorld(world, inputs);
    zapTicks++;
  }
  assert.equal(zapTicks, 94);
  assert.ok(Math.abs(seconds(zapTicks) - 4.7) < 0.01);
  assert.equal(freezeTicks + zapTicks, GOAL_TICKS);
  assert.equal(world.phase, "countdown");
  assert.equal(world.speed, SPEED_FULL, "the countdown is at full speed");
  assert.equal(world.budget, 0);
  assert.notEqual(from, world.riders[0].x);
});

test("a goal scored out of slow motion drops the hold, and the next point starts at full speed", () => {
  const world = playing("gridlock"),
    cloud = MAPS.gridlock.clouds[0]!;
  for (let i = 0; i < 20; i++) tickAt(world, cloud.x, cloud.y);
  assert.ok(world.speed < SPEED_FULL && world.linger > 0);
  scoreFor(world, 1);
  for (let left = paceTick(world); left > 0; left--)
    stepWorld(world, new Map());
  assert.equal(world.phase, "zap");
  assert.deepEqual(
    [world.speed, world.budget, world.linger],
    [0, 0, 0],
    "frozen, nothing carried",
  );
  for (let tick = 0; tick < GOAL_TICKS; tick++)
    for (let left = paceTick(world); left > 0; left--)
      stepWorld(world, new Map());
  assert.equal(world.phase, "countdown");
  assert.equal(world.speed, SPEED_FULL);
});

/** Where the pace sits in an encoded world: `[speed, budget, linger, freeze]`, the last field. */
const PACE = 14,
  PHASE_STEPS = 4;

test("the pace is checkpointed: a world decoded at any point of a slow passage plays on step for step", () => {
  const world = playing("gridlock"),
    cloud = MAPS.gridlock.clouds[0]!,
    away = clearOf("gridlock"),
    copies: World[] = [];
  const check = (x: number, y: number) => {
    tickAt(world, x, y);
    const fields = encodeWorld(world),
      copy = decodeWorld(JSON.parse(JSON.stringify(fields)));
    assert.ok(copy, `speed ${world.speed}, budget ${world.budget}`);
    assert.deepEqual(copy, world);
    for (const each of copies) {
      tickAt(each, x, y);
      assert.deepEqual(each, world, "a restored world keeps the same pace");
    }
    if (copies.length < 12) copies.push(copy);
  };
  for (let i = 0; i < 15; i++) check(cloud.x, cloud.y);
  for (let i = 0; i < 15; i++) check(away.x, away.y);
  for (let i = 0; i < 6; i++) check(cloud.x + cloud.r - 2, cloud.y);

  // Through a goal: the freeze and the slow zap round-trip too.
  scoreFor(world, 0);
  for (let tick = 0; tick <= GOAL_TICKS; tick++) {
    for (let left = paceTick(world); left > 0; left--)
      stepWorld(world, new Map());
    const copy = decodeWorld(encodeWorld(world));
    assert.deepEqual(copy, world, `tick ${tick} after the goal`);
  }
  assert.equal(world.phase, "countdown");
});

test("decoding refuses a pace out of range, or one the phase cannot have", () => {
  const altered = (world: World, change: (fields: unknown[]) => void) => {
    const fields = structuredClone(encodeWorld(world));
    change(fields);
    return decodeWorld(fields);
  };
  const pace = (world: World, at: number, value: unknown, why: string) =>
    assert.equal(
      altered(world, (f) => ((f[PACE] as unknown[])[at] = value)),
      undefined,
      why,
    );
  const SPEED = 0,
    BUDGET = 1,
    LINGER = 2,
    FREEZE = 3;

  const play = playing(),
    cloud = MAPS.gridlock.clouds[0]!;
  for (let i = 0; i < 5; i++) tickAt(play, cloud.x, cloud.y);
  assert.ok(
    altered(play, () => {}),
    "the sample itself is good",
  );
  for (const bad of [-1, 0.5, SPEED_FULL + 1, "256", null, -0])
    pace(play, SPEED, bad, `speed ${String(bad)}`);
  pace(play, SPEED, 0, "stopped in play");
  pace(play, SPEED, MIN_SPEED - 1, "too slow for a tick to run a step");
  pace(play, SPEED, CLOUD_SPEED_CORE - 1, "slower than any cloud makes it");
  for (const bad of [-1, SPEED_FULL, 1.5, null])
    pace(play, BUDGET, bad, `budget ${String(bad)}`);
  for (const bad of [-1, SLOW_HOLD_TICKS + 1, 0.5])
    pace(play, LINGER, bad, `linger ${String(bad)}`);
  pace(play, FREEZE, 1, "a freeze with no goal");
  pace(play, FREEZE, GOAL_FREEZE_STEPS + 1, "too long a freeze");
  for (const raw of [null, [], [256, 0, 0], [256, 0, 0, 0, 0], 256])
    assert.equal(
      altered(play, (f) => (f[PACE] = raw)),
      undefined,
      "a pace that is not four fields",
    );

  const waiting = fresh();
  pace(waiting, SPEED, CLOUD_SPEED_EDGE, "a slow countdown");
  pace(waiting, BUDGET, 1, "a countdown owed part of a step");
  pace(waiting, LINGER, 1, "a hold outside play");

  const frozen = playing();
  scoreFor(frozen, 0);
  stepWorld(frozen, new Map());
  assert.ok(altered(frozen, () => {}));
  pace(frozen, SPEED, ZAP_SPEED, "moving during the freeze");
  pace(frozen, BUDGET, 3, "the freeze owed part of a step");
  assert.equal(
    altered(frozen, (f) => (f[PHASE_STEPS] = ZAP_STEPS - 1)),
    undefined,
    "the zap running under the freeze",
  );

  const zap = playing();
  scoreFor(zap, 0);
  for (let i = 0; i <= GOAL_FREEZE_STEPS + 3; i++) stepWorld(zap, new Map());
  assert.equal(zap.phase, "zap");
  assert.ok(altered(zap, () => {}));
  pace(zap, SPEED, SPEED_FULL, "a zap at full speed");
  pace(zap, SPEED, 0, "a zap stopped with no freeze left");
});
