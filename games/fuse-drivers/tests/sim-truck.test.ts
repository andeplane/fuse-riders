import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, DT } from '../src/game/sim/config.js';
import { NEUTRAL_INPUT, type TruckInput } from '../src/game/sim/input.js';
import { createTruck, stepTruck, type Truck } from '../src/game/sim/truck.js';

const run = (t: Truck, input: Partial<TruckInput>, ticks: number, surface: 'dirt' | 'toxic' | 'boost' | 'mud' = 'dirt', from = 0) => {
  let rng = 1;
  for (let i = 0; i < ticks; i++) [t, rng] = stepTruck(t, { ...NEUTRAL_INPUT, ...input }, surface, from + i, rng);
  return t;
};

test('reaches top speed in 36 ticks', () => {
  const t = run(createTruck(0, 0, 0, 0), {}, 36);
  assert.ok(t.stats.topSpeed - t.speed < 1e-9);
  assert.ok(run(createTruck(0, 0, 0, 0), {}, 35).speed < t.stats.topSpeed);
});

test('turns 270 degrees in 30 ticks at rest', () => {
  let t = createTruck(0, 0, 0, 0);
  let total = 0;
  let rng = 1;
  for (let i = 0; i < 30; i++) {
    const [n, r] = stepTruck({ ...t, speed: 0 }, { ...NEUTRAL_INPUT, right: true }, 'dirt', i, rng);
    total += Math.atan2(Math.sin(n.heading - t.heading), Math.cos(n.heading - t.heading));
    t = n; rng = r;
  }
  assert.ok(Math.abs(total - (270 * Math.PI) / 180) < 1e-6);
});

test('drift enters on tick 5 of a held turn at speed and boosts after 8 ticks, not 7', () => {
  const fast = run(createTruck(0, 0, 0, 0), {}, 40);
  assert.equal(run(fast, { right: true }, 4, 'dirt', 40).driftDir, 0);
  assert.equal(run(fast, { right: true }, 5, 'dirt', 40).driftDir, 1);
  const entered = run(fast, { right: true }, 5, 'dirt', 40);
  const drifted7 = run(entered, { right: true }, 7, 'dirt', 45);
  assert.equal(run(drifted7, {}, 1, 'dirt', 52).boostUntilTick, 0);
  const drifted8 = run(entered, { right: true }, 8, 'dirt', 45);
  assert.equal(run(drifted8, {}, 1, 'dirt', 53).boostUntilTick, 53 + config.truck.boostTicks);
});

test('no drift in mud, and an active drift ends without boost on mud or at low speed', () => {
  const fast = run(createTruck(0, 0, 0, 0), {}, 40);
  assert.equal(run(fast, { right: true }, 10, 'mud', 40).driftDir, 0);
  const drifting = run(fast, { right: true }, 12, 'dirt', 40);
  assert.equal(drifting.driftDir, 1);
  const onMud = run(drifting, { right: true }, 1, 'mud', 52);
  assert.equal(onMud.driftDir, 0);
  assert.equal(run(onMud, {}, 1, 'mud', 53).boostUntilTick, 0);
  const slow = run(drifting, { right: true, brake: true }, 30, 'dirt', 52);
  assert.equal(slow.driftDir, 0);
});

test('oil offsets movement direction but never heading, and not while spun out', () => {
  const base = { ...run(createTruck(0, 0, 0, 0), {}, 40), x: 0, y: 0, heading: 0, oilUntilTick: 100 };
  const [t] = stepTruck(base, NEUTRAL_INPUT, 'dirt', 40, 1);
  assert.equal(t.heading, 0);
  assert.notEqual(t.y, 0);
  assert.ok(Math.abs(Math.atan2(t.y, t.x)) <= config.truck.oilNoise + 1e-9);
  const [spun] = stepTruck({ ...base, spinUntilTick: 100 }, NEUTRAL_INPUT, 'dirt', 40, 1);
  assert.equal(spun.y, 0);
});

test('heading never becomes -0', () => {
  const [t] = stepTruck({ ...createTruck(0, 0, 0, -0), airborneUntilTick: 5 }, NEUTRAL_INPUT, 'dirt', 0, 1);
  assert.ok(Object.is(t.heading, 0));
});

test('nitro consumes one charge on press, not while held or airborne', () => {
  const t = run(createTruck(0, 0, 0, 0), { nitro: true }, 5);
  assert.equal(t.nitros, 2);
  const air = { ...createTruck(0, 0, 0, 0), airborneUntilTick: 100 };
  assert.equal(run(air, { nitro: true }, 1).nitros, 3);
});

test('nitro on a boost pad yields x1.5, not x2.25', () => {
  const base = { ...run(createTruck(0, 0, 0, 0), {}, 40), x: 0, y: 0, heading: 0 };
  const plain = stepTruck(base, NEUTRAL_INPUT, 'dirt', 40, 1)[0].x;
  const both = stepTruck({ ...base, nitroUntilTick: 100, padUntilTick: 100 }, NEUTRAL_INPUT, 'dirt', 40, 1)[0].x;
  assert.ok(Math.abs(both / plain - 1.5) < 1e-9);
});

test('surface multiplies displacement instantly and nitro ignores it', () => {
  const base = { ...run(createTruck(0, 0, 0, 0), {}, 40), x: 0, y: 0, heading: 0 };
  const dirt = stepTruck(base, NEUTRAL_INPUT, 'dirt', 40, 1)[0].x;
  const toxic = stepTruck(base, NEUTRAL_INPUT, 'toxic', 40, 1)[0].x;
  assert.ok(Math.abs(toxic / dirt - 0.6) < 1e-9);
  const nitroToxic = stepTruck({ ...base, nitroUntilTick: 100 }, NEUTRAL_INPUT, 'toxic', 40, 1)[0].x;
  assert.ok(Math.abs(nitroToxic / dirt - 1.5) < 1e-9);
});

test('spin-out and airborne block steering; brake reverses from a stop', () => {
  const spun = { ...createTruck(0, 0, 0, 0), spinUntilTick: 10, speed: 100 };
  assert.equal(stepTruck(spun, { ...NEUTRAL_INPUT, right: true }, 'dirt', 0, 1)[0].heading, 0);
  const stopped = run(createTruck(0, 0, 0, 0), { brake: true }, 30);
  assert.equal(stopped.speed, -config.truck.reverseCap);
});

test('step is pure: input truck is not mutated', () => {
  const t = Object.freeze(createTruck(0, 0, 0, 0));
  stepTruck(t, { ...NEUTRAL_INPUT, right: true, nitro: true }, 'dirt', 0, 1);
  assert.equal(t.speed, 0);
  assert.equal(DT, 1 / 30);
});
