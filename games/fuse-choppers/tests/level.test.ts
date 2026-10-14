import test from "node:test";
import assert from "node:assert/strict";
import { SUB, isqrt, toward, wave } from "../src/engine/math.js";
import {
  CEILING_MIN,
  COL,
  COLUMNS,
  EXIT_X,
  FINALE_CLEAR,
  FLOOR_MAX,
  PICKUP_KINDS,
  SEG,
  START_CLEAR,
  ceilingAt,
  floorAt,
  progress,
  sawY,
  segment,
  segmentsNear,
  span,
  terrain,
} from "../src/engine/level.js";
import { hash, hashRange, next, seedOf } from "../src/engine/rng.js";

const SEEDS = [1, 2, 3, 7, 11, 42, 1234, 0xdeadbeef];
const SEGMENTS = Math.ceil(EXIT_X / SEG);

test("the cave always leaves room to fly, under the HUD and above the bottom edge", () => {
  for (const seed of SEEDS) {
    const { top, bottom } = terrain(seed);
    assert.equal(top.length, COLUMNS);
    for (let c = 0; c < COLUMNS; c++) {
      assert.ok(top[c]! >= CEILING_MIN, `seed ${seed} column ${c}: ceiling`);
      assert.ok(bottom[c]! <= FLOOR_MAX, `seed ${seed} column ${c}: floor`);
      assert.ok(bottom[c]! - top[c]! >= 186, `seed ${seed} column ${c}: gap`);
    }
  }
});

test("the cave narrows with depth, and is calm at the start and before the gate", () => {
  const gap = (seed: number, from: number, to: number) => {
    const { top, bottom } = terrain(seed);
    let sum = 0;
    for (let c = from; c < to; c++) sum += bottom[c]! - top[c]!;
    return sum / (to - from);
  };
  for (const seed of SEEDS) {
    const quarter = Math.floor(EXIT_X / COL / 4);
    assert.ok(
      gap(seed, quarter, 2 * quarter) >
        gap(seed, 3 * quarter, 4 * quarter) - 10,
    );
    const { top, bottom } = terrain(seed);
    for (let c = 0; c < 600 / COL; c++) {
      assert.ok(bottom[c]! - top[c]! >= 400, `seed ${seed}: an open start`);
    }
  }
  assert.equal(progress(0), 0);
  assert.equal(progress(EXIT_X * 2), 1000);
});

test("edges are linear between points, and span is exact over any stretch", () => {
  const seed = 42,
    { top, bottom } = terrain(seed);
  assert.equal(ceilingAt(seed, 5 * COL * SUB), top[5]! * SUB);
  assert.equal(
    floorAt(seed, 5 * COL * SUB + (COL * SUB) / 2),
    bottom[5]! * SUB +
      Math.trunc(((bottom[6]! - bottom[5]!) * (COL * SUB)) / 2 / COL),
  );
  for (let x0 = 1000 * SUB; x0 < 6000 * SUB; x0 += 777 * SUB) {
    const x1 = x0 + 45 * SUB,
      open = span(seed, x0, x1);
    let ceiling = -Infinity,
      floor = Infinity;
    for (let x = x0; x <= x1; x += SUB / 4) {
      ceiling = Math.max(ceiling, ceilingAt(seed, x));
      floor = Math.min(floor, floorAt(seed, x));
    }
    assert.ok(open.ceiling >= ceiling && open.ceiling - ceiling < SUB);
    assert.ok(open.floor <= floor && floor - open.floor < SUB);
  }
});

test("a floating platform leaves a corridor above and below it", () => {
  let platforms = 0;
  for (const seed of SEEDS)
    for (let s = 0; s < SEGMENTS; s++)
      for (const p of segment(seed, s).platforms) {
        platforms++;
        const open = span(seed, p.x * SUB, (p.x + p.w) * SUB);
        assert.ok(
          p.y * SUB - open.ceiling >= 108 * SUB - SUB,
          `seed ${seed}: room above`,
        );
        assert.ok(
          open.floor - (p.y + p.h) * SUB >= 108 * SUB - SUB,
          `seed ${seed}: room below`,
        );
        assert.ok(p.x >= s * SEG && p.x + p.w <= (s + 1) * SEG);
      }
  assert.ok(platforms > SEEDS.length * 3, "platforms are common");
});

test("a saw blade always leaves one side open wide enough to pass, at every point of its sweep", () => {
  let saws = 0;
  for (const seed of SEEDS)
    for (let s = 0; s < SEGMENTS; s++)
      for (const saw of segment(seed, s).saws) {
        saws++;
        const open = span(seed, (saw.x - saw.r) * SUB, (saw.x + saw.r) * SUB);
        for (let step = 0; step < saw.period; step += 7) {
          const y = sawY(saw, step) * SUB,
            above = y - saw.r * SUB - open.ceiling,
            below = open.floor - (y + saw.r * SUB);
          assert.ok(
            Math.max(above, below) >= 104 * SUB,
            `seed ${seed} segment ${s}: a way past`,
          );
        }
        assert.equal(saw.period % 4, 0);
      }
  assert.ok(saws > SEEDS.length * 2, "saws are common");
});

test("no hazards in the opening clearing or the finale; every pickup kind turns up", () => {
  const kinds = new Set<string>();
  for (const seed of SEEDS)
    for (let s = 0; s <= SEGMENTS; s++) {
      const part = segment(seed, s);
      const x0 = s * SEG;
      if (x0 < START_CLEAR || x0 + SEG > EXIT_X - FINALE_CLEAR)
        assert.deepEqual(part, { platforms: [], saws: [], spawns: [] });
      for (const spawn of part.spawns)
        if (spawn.kind !== "drone") kinds.add(spawn.kind);
    }
  assert.deepEqual([...kinds].sort(), [...PICKUP_KINDS].sort());
  assert.equal(segmentsNear(3, 0, SEG * 2).length, 3);
});

test("the integer helpers: square root, triangle wave and scaled direction", () => {
  for (const n of [
    0,
    1,
    2,
    3,
    4,
    15,
    16,
    17,
    99,
    10_000,
    123_456_789,
    2 ** 40 + 7,
  ])
    assert.equal(isqrt(n), Math.floor(Math.sqrt(n)), `isqrt(${n})`);
  assert.equal(isqrt(-5), 0);
  assert.equal(wave(0, 40), 0);
  assert.equal(wave(10, 40), 1000);
  assert.equal(wave(20, 40), 0);
  assert.equal(wave(30, 40), -1000);
  assert.equal(wave(-10, 40), -1000);
  assert.deepEqual(toward(3, 4, 500), { x: 300, y: 400 });
  assert.deepEqual(toward(0, 0, 7), { x: 7, y: 0 });
});

test("the random sources are fixed functions of their inputs", () => {
  assert.equal(hash(1, 2, 3), hash(1, 2, 3));
  assert.notEqual(hash(1, 2, 3), hash(1, 2, 4));
  for (let i = 0; i < 50; i++) {
    const value = hashRange(-3, 3, i);
    assert.ok(value >= -3 && value <= 3);
  }
  const a = next(99),
    b = next(99);
  assert.deepEqual(a, b);
  assert.notEqual(next(a.state).value, a.value);
  assert.equal(seedOf("match:1"), seedOf("match:1"));
  assert.notEqual(seedOf("match:1"), seedOf("match:2"));
});
