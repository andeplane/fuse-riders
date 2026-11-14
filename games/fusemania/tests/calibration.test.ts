import test from "node:test";
import assert from "node:assert/strict";
import { calibrate } from "../src/app/calibration.js";

const BEAT = 500;
/** A tap on every beat from the first, each off by the matching entry of `errors`. */
const tapping = (errors: readonly number[], beat = BEAT) =>
  errors.map((error, i) => i * beat + error);

test("a steady late tapper gets their offset", () => {
  const result = calibrate(
    tapping([30, 34, 26, 31, 29, 33, 27, 30, 32, 28]),
    BEAT,
  );
  assert.deepEqual(result, { offsetMs: 30, spreadMs: 2, used: 10, ok: true });
});

test("early taps give a negative offset, the first click included", () => {
  const result = calibrate(
    tapping([-22, -18, -20, -25, -15, -20, -19, -21]),
    BEAT,
  );
  assert.equal(result.offsetMs, -20);
  assert.equal(result.used, 8, "a tap just before the first click counts");
  assert.equal(result.ok, true);
});

test("perfectly even taps are all used", () => {
  const result = calibrate(tapping(Array<number>(12).fill(12.5)), BEAT);
  assert.deepEqual(result, { offsetMs: 12.5, spreadMs: 0, used: 12, ok: true });
});

test("taps between the clicks and stray taps are dropped", () => {
  const steady = tapping([10, 14, 6, 12, 8, 10, 11, 9, 13, 7]);
  const result = calibrate(
    [
      ...steady,
      // Half a beat off: not an attempt at either click.
      5 * BEAT + 250,
      3 * BEAT - 220,
      // Before the first click's reach.
      -300,
      // A slip: within reach of a click but far from the rest.
      6 * BEAT + 150,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ],
    BEAT,
  );
  assert.deepEqual(result, { offsetMs: 10, spreadMs: 2, used: 10, ok: true });
});

test("the reach is a share of the beat", () => {
  const errors = [150, 155, 145, 150, 152, 148, 150, 151];
  assert.equal(calibrate(tapping(errors), BEAT).offsetMs, 150);
  assert.equal(
    calibrate(tapping(errors, 300), 300).used,
    0,
    "150 ms is half of a 300 ms beat",
  );
  assert.equal(calibrate(tapping(errors, 1000), 1000).offsetMs, 150);
});

test("too few taps are measured but not trusted", () => {
  const result = calibrate(tapping([20, 22, 18, 20, 21, 19, 20]), BEAT);
  assert.deepEqual([result.offsetMs, result.used, result.ok], [20, 7, false]);
  const cut = calibrate(tapping([20, 22, 18, 20, 21, 19, 20, 180]), BEAT);
  assert.deepEqual([cut.used, cut.ok], [7, false], "an outlier does not count");
});

test("scattered taps are not trusted", () => {
  const result = calibrate(
    tapping([-120, 90, -60, 130, 10, -150, 160, -90, 70, -10, 120, -130]),
    BEAT,
  );
  assert.ok(result.spreadMs >= 40, `spread ${result.spreadMs}`);
  assert.equal(result.ok, false);
});

test("no taps, or no beat, is no result", () => {
  const none = { offsetMs: 0, spreadMs: 0, used: 0, ok: false };
  assert.deepEqual(calibrate([], BEAT), none);
  assert.deepEqual(calibrate([250, 750], BEAT), none);
  assert.deepEqual(calibrate([10, 510], 0), none);
  assert.deepEqual(calibrate([10, 510], Number.NaN), none);
});
