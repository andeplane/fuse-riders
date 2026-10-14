import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  createMatch,
  decodeState,
  encodeState,
  hashState,
} from "../src/engine/index.js";

test("map preparation is resumable, strictly tick-bounded and never resets work across retries", () => {
  let retried = false;
  for (let seed = 1; seed <= 30; seed++) {
    const s = createMatch(
      "budget",
      seed,
      Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Bird ${i}` })),
    );
    while (s.phase === "preparing") {
      const before = s.preparation.work;
      advance(s);
      assert.ok(s.preparation.work >= before);
      assert.ok(s.preparation.work - before <= 2200);
      if (s.preparation.attempt > 0) retried = true;
    }
    assert.equal(s.phase, "aiming");
    assert.ok(s.preparation.work <= 1_000_000);
  }
  assert.equal(
    retried,
    true,
    "seed corpus must exercise retry, not just successful first maps",
  );
});
test("a checkpoint near its generation budget uses the reserved fallback and has a bounded fault path", () => {
  const s = createMatch("budget", 9, [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ]);
  s.preparation.work = 800_000;
  const checkpoint = decodeState(encodeState(s));
  assert.ok(checkpoint);
  while (s.phase === "preparing") {
    advance(s);
    advance(checkpoint);
  }
  assert.equal(s.phase, "aiming");
  assert.equal(s.preparation.attempt, 4);
  assert.equal(hashState(s), hashState(checkpoint));
  const exhausted = createMatch("exhausted", 1, [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ]);
  exhausted.preparation.attempt = 4;
  exhausted.preparation.work = 1_000_000;
  const terrain = exhausted.terrain.bits.slice();
  advance(exhausted);
  assert.equal(exhausted.phase, "fault");
  assert.deepEqual(exhausted.terrain.bits, terrain);
  assert.ok(decodeState(encodeState(exhausted)));
});
