import assert from "node:assert/strict";
import test from "node:test";
import { blastFrame } from "../src/client/blast-animation.js";
import { BLAST_VISIBLE_TICKS } from "../src/shared/game.js";

const blast = {
  bombId: 42,
  circle: { x: 400, y: 300, radius: 120 },
  expiresAtTick: 108,
};
const at = (age: number) =>
  blastFrame(blast, blast.expiresAtTick - BLAST_VISIBLE_TICKS * (1 - age));

test("blast bloom grows, separates and shrinks before clearing at authoritative expiry", () => {
  const pop = at(0),
    bloom = at(0.3),
    breaking = at(0.65),
    clear = at(0.92);
  assert.equal(pop.circles.length, 1, "the initial flash is a compact core");
  assert.equal(
    bloom.circles.length,
    10,
    "nine irregular lobes surround the core",
  );
  const outer = (frame: ReturnType<typeof at>) =>
    frame.circles.find((c) => c.tone === "outer")!;
  assert.ok(
    outer(breaking).radius < outer(bloom).radius,
    "lobes shrink rather than only fading",
  );
  const distance = (circle: ReturnType<typeof outer>) =>
    Math.hypot(circle.x - blast.circle.x, circle.y - blast.circle.y);
  assert.ok(
    distance(outer(breaking)) > distance(outer(bloom)),
    "lobes separate outwards",
  );
  assert.ok(
    !clear.circles.some((c) => c.tone === "core"),
    "core clears before embers",
  );
  assert.ok(
    clear.sparks.some((s) => s.alpha > 0),
    "last embers persist briefly",
  );
  for (const age of [-0.1, 1, 2]) {
    const frame = at(age);
    assert.deepEqual(frame.circles, []);
    assert.deepEqual(frame.sparks, []);
    assert.equal(frame.ring.alpha, 0);
    assert.equal(frame.footprintAlpha, 0);
  }
});

test("cosmetic offsets are stable across replay and vary between bombs without mutating snapshots", () => {
  const original = structuredClone(blast),
    bloom = at(0.3);
  at(0.9);
  at(0.01);
  assert.deepEqual(at(0.3), bloom, "no frame order or retained random state");
  assert.notDeepEqual(blastFrame({ ...blast, bombId: 43 }, 102.4), bloom);
  const volley = [42, 43, 44, 45, 46].map((bombId) =>
    JSON.stringify(blastFrame({ ...blast, bombId }, 102.4)),
  );
  assert.equal(
    new Set(volley).size,
    5,
    "five simultaneous bombs each have a distinct pattern",
  );
  assert.deepEqual(blast, original);
  assert.notDeepEqual(
    at(0.31),
    bloom,
    "fractional ticks animate between simulation steps",
  );
});

test("all blast lobes, sparks and shock rings stay inside the supplied radius throughout overshoot", () => {
  for (const radius of [8, 32, 90, 240])
    for (const bombId of [0, 1, 42, 9999]) {
      const source = { ...blast, bombId, circle: { ...blast.circle, radius } };
      for (let tick = 100; tick < 108; tick += 0.125) {
        const frame = blastFrame(source, tick);
        assert.ok(frame.circles.length <= 10 && frame.sparks.length <= 6);
        assert.ok(frame.ring.radius <= radius && frame.ring.radius >= 0);
        for (const circle of frame.circles) {
          assert.ok(
            circle.radius >= 0 && circle.alpha >= 0 && circle.alpha <= 1,
          );
          assert.ok(
            Math.hypot(circle.x - source.circle.x, circle.y - source.circle.y) +
              circle.radius <=
              radius + 1e-9,
          );
        }
        for (const spark of frame.sparks) {
          assert.ok(spark.alpha >= 0 && spark.alpha <= 1);
          assert.ok(
            Math.hypot(spark.x - source.circle.x, spark.y - source.circle.y) +
              spark.size * Math.SQRT1_2 <=
              radius + 1e-9,
          );
        }
      }
    }
});
