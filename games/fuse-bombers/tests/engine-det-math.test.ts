import test from "node:test";
import assert from "node:assert/strict";
import { atan2, cos, exp, hypot, log2, sin } from "../src/engine/det-math.js";

// The engine's deterministic math agrees with the platform's `Math` to within a few units in the last place, so
// swapping it in barely moves gameplay, and its bits are pinned so an edit that changes them is a deliberate one.

const PI = Math.PI;

function sweep(from: number, to: number, count: number): number[] {
  return Array.from(
    { length: count + 1 },
    (_, i) => from + ((to - from) * i) / count,
  );
}

function assertClose(
  actual: number,
  expected: number,
  tolerance: number,
  label: string,
): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} vs ${expected} (off by ${Math.abs(actual - expected)})`,
  );
}

/** Every argument the engine's trigonometry sees: launcher and split angles, gate and crate bob phases over a
 * three-minute round, terrain waves across the arena, and far beyond. */
const ANGLES = [
  ...sweep(-10, 10, 20_000),
  ...sweep(-2_000, 2_000, 40_001),
  ...sweep(1e5, 1.5e6, 5_003),
];

const SPECIAL_ANGLES = [
  0,
  PI / 6,
  PI / 4,
  PI / 2,
  PI,
  (3 * PI) / 2,
  2 * PI,
  4 * PI,
  -2 * PI,
  100 * PI,
  1000 * 2 * PI,
  7.450580596923828e-9,
  1e-300,
  Number.MIN_VALUE,
];

test("sin and cos agree with Math to 1e-15 over the engine's arguments", () => {
  for (const x of [
    ...ANGLES,
    ...SPECIAL_ANGLES,
    ...SPECIAL_ANGLES.map((a) => -a),
  ]) {
    assertClose(sin(x), Math.sin(x), 1e-15, `sin(${x})`);
    assertClose(cos(x), Math.cos(x), 1e-15, `cos(${x})`);
  }
});

test("sin and cos at zero, π and the multiples of 2π", () => {
  assert.ok(Object.is(sin(0), 0));
  assert.ok(Object.is(sin(-0), -0));
  assert.equal(cos(0), 1);
  assert.equal(cos(-0), 1);
  assert.equal(sin(PI / 2), 1);
  assert.equal(cos(PI), -1);
  assert.equal(sin(-PI / 2), -1);
  // Math.PI is not π, so sin(Math.PI) is the gap between them, as Math.sin has it.
  assert.equal(sin(PI), 1.2246467991473532e-16);
  assert.equal(sin(-PI), -1.2246467991473532e-16);
  for (let k = -50; k <= 50; k++) {
    assertClose(sin(2 * PI * k), 0, 1e-13, `sin(2π·${k})`);
    assertClose(cos(2 * PI * k), 1, 1e-15, `cos(2π·${k})`);
  }
  assert.equal(sin(1e-300), 1e-300);
  assert.equal(sin(Number.MIN_VALUE), Number.MIN_VALUE);
});

test("sin is odd and cos is even, bit for bit", () => {
  for (const x of [...ANGLES, ...SPECIAL_ANGLES]) {
    assert.ok(Object.is(sin(-x), -sin(x)), `sin(-${x})`);
    assert.ok(Object.is(cos(-x), cos(x)), `cos(-${x})`);
  }
});

test("sin and cos of a non-finite argument are NaN", () => {
  for (const x of [NaN, Infinity, -Infinity]) {
    assert.ok(Number.isNaN(sin(x)));
    assert.ok(Number.isNaN(cos(x)));
  }
});

test("atan2 agrees with Math in every quadrant and on the axes", () => {
  const coords = [
    ...sweep(-40, 40, 160),
    0,
    -0,
    1e-12,
    -1e-12,
    1e12,
    -1e12,
    1e-300,
    -1e300,
  ];
  for (const y of coords)
    for (const x of coords) {
      const expected = Math.atan2(y, x);
      const actual = atan2(y, x);
      if (expected === 0)
        assert.ok(Object.is(actual, expected), `atan2(${y}, ${x})`);
      else assertClose(actual, expected, 1e-15, `atan2(${y}, ${x})`);
    }
});

test("atan2's signed zeros, axes and infinities", () => {
  assert.ok(Object.is(atan2(0, 0), 0));
  assert.ok(Object.is(atan2(-0, 0), -0));
  assert.equal(atan2(0, -0), PI);
  assert.equal(atan2(-0, -0), -PI);
  assert.equal(atan2(0, -1), PI);
  assert.equal(atan2(-0, -1), -PI);
  assert.equal(atan2(1, 0), PI / 2);
  assert.equal(atan2(-1, -0), -PI / 2);
  assert.equal(atan2(1, 1), PI / 4);
  assert.equal(atan2(1, -1), (3 * PI) / 4);
  assert.equal(atan2(-1, -1), (-3 * PI) / 4);
  assert.equal(atan2(Infinity, Infinity), PI / 4);
  assert.equal(atan2(-Infinity, -Infinity), Math.atan2(-Infinity, -Infinity));
  assert.equal(atan2(Infinity, 5), PI / 2);
  assert.ok(Object.is(atan2(-5, Infinity), -0));
  assert.equal(atan2(5, -Infinity), PI);
  assert.ok(Number.isNaN(atan2(NaN, 1)));
  assert.ok(Number.isNaN(atan2(1, NaN)));
});

test("atan2 is odd in y and inverts sin and cos", () => {
  for (const y of sweep(-30, 30, 121))
    for (const x of sweep(-30, 30, 97))
      assert.ok(Object.is(atan2(-y, x), -atan2(y, x)), `atan2(±${y}, ${x})`);
  for (const a of sweep(-PI + 1e-9, PI, 10_000))
    assertClose(atan2(sin(a), cos(a)), a, 1e-15, `atan2 of angle ${a}`);
});

test("hypot is one rounded square root of the sum of squares", () => {
  assert.equal(hypot(3, 4), 5);
  assert.ok(Object.is(hypot(0, 0), 0));
  assert.equal(hypot(-5, 12), 13);
  for (const x of sweep(-900, 900, 301))
    for (const y of sweep(-700, 700, 211)) {
      const expected = Math.hypot(x, y);
      assertClose(
        hypot(x, y),
        expected,
        4.5e-16 * expected,
        `hypot(${x}, ${y})`,
      );
    }
});

test("exp agrees with Math to a relative 1e-15, down to the subnormals", () => {
  for (const x of [...sweep(-745, 709.7, 200_000), ...sweep(-1, 1, 2_001)]) {
    const expected = Math.exp(x);
    // A subnormal result has fewer significant bits, so near the bottom a few of the smallest steps are allowed.
    assertClose(
      exp(x),
      expected,
      Math.max(1e-15 * expected, 4 * Number.MIN_VALUE),
      `exp(${x})`,
    );
  }
  assert.equal(exp(0), 1);
  assert.equal(exp(-0), 1);
  assert.equal(exp(-Infinity), 0);
  assert.equal(exp(-800), 0);
  assert.equal(exp(Infinity), Infinity);
  assert.equal(exp(710), Infinity);
  assert.ok(Number.isNaN(exp(NaN)));
  assertClose(exp(1), Math.E, 4.5e-16, "exp(1)");
});

test("log2 is exact on powers of two and agrees with Math elsewhere", () => {
  let power = Number.MIN_VALUE;
  for (let k = -1074; k <= 1023; k++, power *= 2)
    assert.equal(log2(power), k, `log2(2^${k})`);
  for (const x of [
    ...sweep(1, 64, 63_000),
    ...sweep(1e-6, 1e6, 99_991),
    1e-310,
    1e300,
  ])
    assertClose(
      log2(x),
      Math.log2(x),
      4e-16 * Math.max(1, Math.abs(Math.log2(x))),
      `log2(${x})`,
    );
  assert.equal(log2(0), -Infinity);
  assert.equal(log2(Infinity), Infinity);
  assert.ok(Number.isNaN(log2(-1)));
  assert.ok(Number.isNaN(log2(NaN)));
});

/** FNV-1a over the bytes of each double, so one changed last bit changes the hash. */
function bitsHash(values: readonly number[]): string {
  const view = new DataView(new ArrayBuffer(8));
  let hash = 0x811c9dc5;
  for (const value of values) {
    view.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++)
      hash = Math.imul(hash ^ view.getUint8(i), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

test("the helpers' bits are pinned: every browser must compute exactly these", () => {
  const xs = sweep(-3000, 3000, 9_973);
  const out = [
    ...xs.map(sin),
    ...xs.map(cos),
    ...xs.map((x) => atan2(x, 1000 - x)),
    ...xs.map((x) => hypot(x, x / 3 + 1)),
    ...xs.map((x) => exp(x / 5)),
    ...xs.map((x) => log2(Math.abs(x) + 1e-3)),
  ];
  assert.equal(bitsHash(out), "7a33cc25");
});
