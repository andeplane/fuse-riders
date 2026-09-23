import test from "node:test";
import assert from "node:assert/strict";
import { traverse } from "./fixtures/traversal.js";
import { overlaps } from "../src/engine/collision.js";
import { decodeWorld } from "../src/engine/codec.js";
import { S } from "../src/engine/world.js";
test("ordinary inputs traverse the belfry, recover off-edge and reset without terrain penetration", () => {
  const seen: string[] = [];
  const world = traverse((w, mark) => {
    assert.equal(
      overlaps(w.x, w.feet),
      false,
      `terrain penetration at tick ${w.tick}`,
    );
    if (!mark) return;
    seen.push(mark);
    assert.deepEqual(decodeWorld(w), w, `checkpoint at ${mark}`);
    const ledge = {
      "low ledge": 670,
      "central gap": 610,
      "release and land": 480,
      "recovery landing": 480,
      reset: 810,
    }[mark];
    if (ledge) {
      assert.equal(w.grounded, true, mark);
      assert.ok(Math.abs(w.feet / S - ledge) < 0.01, mark);
    }
    if (mark === "high anchor" || mark === "recovery pull") {
      assert.equal(w.hook.phase, "attached");
      assert.equal(w.hook.platform, 6);
    }
    if (mark === "off edge") assert.equal(w.grounded, false);
    if (mark === "recovery landing") assert.equal(w.deaths, 0);
    if (mark === "fall") assert.ok(w.deaths > 0);
  });
  assert.deepEqual(seen, [
    "low ledge",
    "central gap",
    "high anchor",
    "release and land",
    "off edge",
    "recovery pull",
    "recovery landing",
    "fall",
    "reset",
  ]);
  assert.equal(world.x, 310 * S);
  assert.equal(world.hook.phase, "ready");
  assert.deepEqual(traverse(), world);
});
