import test from "node:test";
import assert from "node:assert/strict";
import {
  BRAKE,
  CAPACITY,
  COUNTDOWN,
  DEAD,
  FINISHED,
  GAS,
  LEVELS,
  LEVEL_COUNT,
  RACE_GRACE,
  RACE_LIMIT,
  RESTART,
  RIDING,
  RULES,
  TURN,
  VOLT_LEFT,
  VOLT_RIGHT,
  compile,
  createWorld,
  decodeWorld,
  encodeWorld,
  inAir,
  levelProblem,
  ranking,
  resetBike,
  stepBike,
  stepWorld,
  toView,
  type Level,
  type World,
} from "../src/engine/index.js";
import { cos, sin } from "../src/engine/math.js";
import * as basics from "../src/basics.js";
import { RECORDED, rideBits } from "./fixtures/rides.js";

const flat: Level = {
  id: "flat",
  name: "Flat",
  polygons: [
    [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 12 },
      { x: 0, y: 12 },
    ],
  ],
  start: { x: 4, y: 0.42 },
  objects: [
    { kind: "apple", x: 12, y: 0.8 },
    { kind: "apple", x: 30, y: 6, gravity: 1 },
    { kind: "killer", x: 50, y: 0.6 },
    { kind: "flower", x: 20, y: 0.9 },
  ],
};
const ride = (level: Level, bits: number, steps: number) => {
  const prepared = compile(level),
    bike = resetBike(prepared);
  let taken = 0,
    flags = 0;
  for (let step = 0; step < steps && !flags; step++) {
    const outcome = stepBike(
      prepared,
      bike,
      bits,
      step === 0 ? bits : 0,
      taken,
    );
    taken = outcome.taken;
    flags = outcome.flags;
  }
  return { bike, taken, flags };
};

test("the service's constants are the engine's", () => {
  assert.equal(basics.CAPACITY, CAPACITY);
  assert.equal(basics.LEVEL_COUNT, LEVEL_COUNT);
  assert.equal(LEVELS.length, 12);
  assert.match(RULES, /^elasto-fuse-\d+$/);
});

test("the engine's sine and cosine agree with the library's to a part in a million million", () => {
  for (let x = -40; x <= 40; x += 0.0137) {
    assert.ok(Math.abs(sin(x) - Math.sin(x)) < 1e-11, `sin ${x}`);
    assert.ok(Math.abs(cos(x) - Math.cos(x)) < 1e-11, `cos ${x}`);
  }
});

test("every level is playable: valid, a start and objects in the air, unique ids", () => {
  const ids = new Set<string>();
  for (const level of LEVELS) {
    assert.equal(levelProblem(level), undefined, level.id);
    assert.ok(inAir(level, level.start.x, level.start.y), `${level.id} start`);
    for (const object of level.objects)
      assert.ok(
        inAir(level, object.x, object.y),
        `${level.id} ${object.kind} at ${object.x}`,
      );
    assert.ok(!ids.has(level.id));
    ids.add(level.id);
    // The bike rests where it starts: a second of nothing held leaves it upright, alive and where it was.
    const { bike, flags } = ride(level, 0, 80);
    assert.equal(flags, 0, `${level.id} rests`);
    assert.ok(Math.abs(bike.frot) < 0.2, `${level.id} upright`);
    assert.ok(Math.abs(bike.lx - level.start.x) < 0.3, `${level.id} stays`);
  }
});

test("gas drives the bike the way it faces, a turn reverses that, the brake stops it", () => {
  const forward = ride(flat, GAS, 160).bike;
  assert.ok(forward.fx > 4.85 + 1.5 && forward.fvx > 3);
  const prepared = compile(flat),
    bike = resetBike(prepared);
  stepBike(prepared, bike, TURN | GAS, TURN | GAS, 0);
  for (let step = 0; step < 100; step++) stepBike(prepared, bike, GAS, 0, 0);
  assert.equal(bike.flipped, 0);
  assert.ok(bike.fvx < -2, "facing left it drives left");
  for (let step = 0; step < 240; step++) stepBike(prepared, bike, BRAKE, 0, 0);
  assert.ok(Math.abs(bike.fvx) < 1.5, "braked to a crawl");
});

test("a volt turns the bike in the air, one way each, and waits before the next", () => {
  const prepared = compile({ ...flat, start: { x: 30, y: 8 } });
  const spin = (bits: number) => {
    const bike = resetBike(prepared);
    for (let step = 0; step < 30; step++) stepBike(prepared, bike, bits, 0, 0);
    return bike.frot;
  };
  assert.ok(spin(VOLT_LEFT) > 0.5, "left is counter-clockwise");
  assert.ok(spin(VOLT_RIGHT) < -0.5, "right is clockwise");
  const bike = resetBike(prepared);
  stepBike(prepared, bike, VOLT_LEFT, 0, 0);
  const first = bike.lastVolt;
  for (let step = 0; step < 40; step++)
    stepBike(prepared, bike, VOLT_LEFT, 0, 0);
  assert.equal(bike.lastVolt, first, "held, it does not volt again at once");
});

test("apples are eaten, the flower waits for all of them, a killer and the head on the ground kill", () => {
  const some = ride(flat, GAS, 400);
  assert.equal(some.taken, 1, "the apple on the way, not the one in the sky");
  assert.equal(some.flags, 0, "the flower lets it by");
  const onward = ride(flat, GAS, 2000);
  assert.equal(onward.flags, 1, "and the killer further on does not");
  const one: Level = { ...flat, objects: [flat.objects[0]!, flat.objects[3]!] };
  const home = ride(one, GAS, 600);
  assert.equal(home.flags, 2);
  assert.equal(home.taken, 1);
  // Upside down in the air, the head lands first.
  const prepared = compile(flat),
    bike = resetBike(prepared);
  Object.assign(bike, { frot: Math.PI });
  let flags = 0;
  for (let step = 0; step < 200 && !flags; step++)
    flags = stepBike(prepared, bike, 0, 0, 0).flags;
  assert.equal(flags, 1);
});

test("a gravity apple turns gravity for the rider that ate it", () => {
  const up: Level = {
    ...flat,
    objects: [{ kind: "apple", x: 5.7, y: 0.8, gravity: 1 }, flat.objects[3]!],
  };
  const { bike, taken } = ride(up, 0, 120);
  assert.equal(taken, 1);
  assert.equal(bike.gravity, 0);
  assert.ok(bike.fvy > 0 || bike.fy > 2, "it falls upwards");
});

test("the recorded rides finish every level on the recorded step", () => {
  assert.equal(RECORDED.rules, RULES, "re-record the rides with the rules");
  for (const [index, level] of LEVELS.entries()) {
    const world = createWorld(["solver"], index, 0);
    let steps = 0;
    for (const bits of rideBits(level.id)) {
      stepWorld(world, [bits], [true]);
      steps++;
      if (world.riders[0]!.status === FINISHED) break;
    }
    assert.equal(world.riders[0]!.status, FINISHED, level.id);
    assert.equal(steps, RECORDED.rides[level.id]!.steps, level.id);
    assert.equal(world.phase, "over");
  }
});

const race = (ids: string[], countdown = 0): World =>
  createWorld(ids, 0, countdown);
const steps = (
  world: World,
  count: number,
  inputs: number[],
  present = inputs.map(() => true),
) => {
  for (let i = 0; i < count; i++) stepWorld(world, inputs, present);
};

test("a race counts down, then every rider rides its own run", () => {
  const world = race(["a", "b"], COUNTDOWN);
  steps(world, COUNTDOWN - 1, [GAS, 0]);
  assert.equal(world.phase, "countdown");
  assert.equal(world.riders[0]!.bike.fvx, 0, "nobody moves before the start");
  steps(world, 1, [GAS, 0]);
  assert.equal(world.phase, "racing");
  steps(world, 400, [GAS, 0]);
  const [a, b] = world.riders;
  assert.ok(a!.bike.fx > b!.bike.fx + 3);
  assert.equal(a!.taken, 1, "a ate its first apple");
  assert.equal(b!.taken, 0, "which is still there for b");
  assert.deepEqual(ranking(world), [0, 1], "more apples ranks first");
});

test("a restart puts the rider back with its apples, and counts; held through, it restarts once", () => {
  const world = race(["a"]);
  steps(world, 400, [GAS]);
  assert.equal(world.riders[0]!.taken, 1);
  steps(world, 5, [RESTART]);
  const rider = world.riders[0]!;
  assert.equal(rider.taken, 0);
  assert.equal(rider.deaths, 1);
  assert.equal(rider.run, 4);
  assert.equal(world.step, 405, "the race clock runs on");
});

test("a crash waits, then restarts by itself; the first home wins and the race closes after the grace", () => {
  const world = race(["a", "b"]);
  const bits = rideBits(LEVELS[0]!.id);
  // b rides into the ground on its head; a rides the recorded ride home.
  Object.assign(world.riders[1]!.bike, { frot: Math.PI });
  let crashed = 0;
  for (const held of bits) {
    stepWorld(world, [held, 0], [true, true]);
    if (world.riders[1]!.status === DEAD) crashed++;
    if (world.riders[0]!.status === FINISHED) break;
  }
  assert.ok(crashed > 0, "b crashed");
  assert.equal(world.riders[1]!.deaths, 1);
  assert.equal(world.riders[1]!.status, RIDING, "and was put back");
  assert.equal(world.phase, "racing", "the race waits for b");
  const finish = world.riders[0]!.finish;
  assert.equal(world.close, finish + RACE_GRACE);
  assert.deepEqual(ranking(world), [0, 1]);
  assert.equal(toView(world).riders[0]!.place, 1);
  steps(world, RACE_GRACE - 1, [0, 0]);
  assert.equal(world.phase, "racing");
  steps(world, 1, [0, 0]);
  assert.equal(world.phase, "over");
  const before = JSON.stringify(world);
  steps(world, 10, [GAS, GAS]);
  assert.equal(JSON.stringify(world), before, "a closed race does not move");
});

test("the race does not wait for a rider nobody is steering, and closes at the limit regardless", () => {
  const world = race(["a", "b"]);
  for (const held of rideBits(LEVELS[0]!.id)) {
    stepWorld(world, [held, 0], [true, false]);
    if (world.phase === "over") break;
  }
  assert.equal(world.phase, "over");
  assert.equal(world.riders[1]!.status, RIDING);
  const idle = race(["a"]);
  idle.step = RACE_LIMIT - 1;
  steps(idle, 1, [0]);
  assert.equal(idle.phase, "over");
});

test("a world survives its checkpoint exactly and plays on identically; a bad one is refused", () => {
  const world = race(["a", "b"], COUNTDOWN);
  const bits = rideBits(LEVELS[0]!.id);
  for (let step = 0; step < 500; step++) {
    stepWorld(world, [bits[step]!, GAS | VOLT_LEFT], [true, true]);
    if (step % 97 !== 0) continue;
    const copy = decodeWorld(
      JSON.parse(JSON.stringify(encodeWorld(world))) as unknown,
    );
    // A checkpoint carries no negative zero, so compare what a checkpoint can tell apart.
    assert.equal(JSON.stringify(copy), JSON.stringify(world));
  }
  const copy = decodeWorld(encodeWorld(world))!;
  steps(world, 200, [GAS, BRAKE]);
  steps(copy, 200, [GAS, BRAKE]);
  assert.equal(JSON.stringify(copy), JSON.stringify(world));
  const fields = encodeWorld(world);
  const broken = (change: (fields: unknown[]) => void) => {
    const list = JSON.parse(JSON.stringify(fields)) as unknown[];
    change(list);
    return decodeWorld(list);
  };
  assert.ok(broken(() => {}));
  assert.equal(
    broken((f) => (f[0] = 2)),
    undefined,
    "version",
  );
  assert.equal(
    broken((f) => (f[1] = 99)),
    undefined,
    "level",
  );
  assert.equal(
    broken((f) => f.push(f[6])),
    undefined,
    "a rider twice",
  );
  assert.equal(
    broken((f) => ((f[6] as unknown[])[1] = FINISHED)),
    undefined,
    "finished without a finish",
  );
  assert.equal(
    broken((f) => (((f[6] as unknown[])[8] as unknown[])[0] = null)),
    undefined,
    "a bike that is not numbers",
  );
  assert.equal(
    broken((f) => (((f[6] as unknown[])[8] as unknown[])[0] = 1e9)),
    undefined,
    "a bike out of the world",
  );
  assert.equal(decodeWorld(null), undefined);
});

test("a bike flung out of the world dies and waits at the start, in a state a checkpoint holds", () => {
  const world = createWorld(["a"], 0, 0);
  const bike = world.riders[0]!.bike;
  bike.fy = bike.ly = bike.ry = 1999.99;
  bike.fvy = bike.lvy = bike.rvy = 500;
  stepWorld(world, [0], [true]);
  assert.equal(world.riders[0]!.status, DEAD);
  assert.deepEqual(world.riders[0]!.bike, resetBike(compile(LEVELS[0]!)));
  assert.ok(decodeWorld(JSON.parse(JSON.stringify(encodeWorld(world)))));
});
