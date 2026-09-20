import test from "node:test";
import assert from "node:assert/strict";
import {
  RECONNECT_BASE_MS,
  RECONNECT_CAP_MS,
  RECONNECT_REFUSED_CAP_MS,
  ReconnectBackoff,
} from "../src/reconnect-backoff.js";

const take = (backoff: ReconnectBackoff, count: number, refused = false) =>
  Array.from({ length: count }, () => backoff.next(refused));

test("the wait doubles from 1.5 s and stops at 30 s", () => {
  assert.deepEqual(
    take(new ReconnectBackoff(() => 0), 8),
    [1500, 3000, 6000, 12_000, 24_000, 30_000, 30_000, 30_000],
  );
  assert.equal(RECONNECT_BASE_MS, 1500);
  assert.equal(RECONNECT_CAP_MS, 30_000);
});

test("jitter only ever shortens a step, by at most a quarter", () => {
  assert.deepEqual(
    take(new ReconnectBackoff(() => 0.999_999), 7),
    [1125, 2250, 4500, 9000, 18_000, 22_500, 22_500],
  );
  const samples = [0, 0.5, 0.2, 0.9, 0.1];
  let index = 0;
  const backoff = new ReconnectBackoff(
    () => samples[index++ % samples.length]!,
  );
  assert.deepEqual(take(backoff, 5), [1500, 2625, 5700, 9300, 23_400]);
});

test("a welcome resets the ladder", () => {
  const backoff = new ReconnectBackoff(() => 0);
  take(backoff, 6);
  assert.equal(backoff.attempts, 6);
  backoff.reset();
  assert.equal(backoff.attempts, 0);
  assert.deepEqual(take(backoff, 2), [1500, 3000]);
});

test("a page refused for a whole hour cannot spend its address's 30 failures by itself", () => {
  for (const random of [() => 0, () => 0.5, () => 0.999_999]) {
    const backoff = new ReconnectBackoff(random);
    // The first attempt is at once; each later one follows the wait before it.
    let attempts = 1,
      elapsed = 0;
    for (;;) {
      elapsed += backoff.next(true);
      if (elapsed >= 3_600_000) break;
      attempts++;
    }
    assert.ok(attempts <= 24, `${attempts} attempts in the hour`);
  }
  assert.equal(
    take(new ReconnectBackoff(() => 0), 10, true).at(-1),
    RECONNECT_REFUSED_CAP_MS,
  );
  // Without the longer ladder the same page would spend the budget in under a quarter of an hour.
  const plain = new ReconnectBackoff(() => 0);
  assert.ok(take(plain, 30).reduce((sum, wait) => sum + wait, 0) < 900_000);
});

test("a refusal after drops continues the same ladder instead of starting over", () => {
  const backoff = new ReconnectBackoff(() => 0);
  assert.deepEqual(
    take(backoff, 6),
    [1500, 3000, 6000, 12_000, 24_000, 30_000],
  );
  assert.equal(backoff.next(true), 96_000);
  assert.equal(backoff.next(false), 30_000);
});

test("a very long outage neither overflows nor leaves the cap", () => {
  const backoff = new ReconnectBackoff(() => 0);
  const waits = take(backoff, 5000);
  assert.equal(waits.at(-1), RECONNECT_CAP_MS);
  assert.ok(waits.every((wait) => Number.isSafeInteger(wait) && wait > 0));
});
