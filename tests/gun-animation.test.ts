import assert from "node:assert/strict";
import test from "node:test";
import { gunFrame, gunRoots } from "../src/client/gun-animation.js";
import { visualFixture } from "../src/client/phaser/benchmark-fixture.js";

const base = visualFixture(100);
const tracer = {
  ...base.bombs[0]!,
  id: 1,
  launchedTick: 100,
  explodeAtTick: 103,
  shell: { gun: true, vx: 1, vy: 0 },
};

test("muzzle roots exclude continuation legs but retain volley directions and other shooters", () => {
  const continuation = { ...tracer, id: 9, launchX: 600 };
  const fan = { ...tracer, id: 2, shell: { gun: true, vx: 0.9, vy: 0.1 } };
  const other = { ...tracer, id: 3, ownerId: "other" };
  const shell = { ...tracer, id: 4, shell: { vx: 1, vy: 0 } };
  assert.deepEqual(gunRoots([continuation, fan, other, tracer, shell]), [
    tracer,
    fan,
    other,
  ]);
});

test("flash and decorative recoil sample fractional time, end cleanly and replay identically", () => {
  assert.equal(gunFrame(tracer, 100).flash, 1);
  assert.equal(gunFrame(tracer, 100.5).flash, 0.5);
  assert.equal(gunFrame(tracer, 101).flash, 0);
  assert.equal(gunFrame(tracer, 101).recoil, 5);
  for (const tick of [99, 103, 500]) {
    assert.equal(gunFrame(tracer, tick).flash, 0);
    assert.equal(gunFrame(tracer, tick).recoil, 0);
  }
  const before = structuredClone(tracer);
  const first = gunFrame(tracer, 100.5);
  gunFrame(tracer, 102);
  assert.deepEqual(gunFrame(tracer, 100.5), first);
  assert.deepEqual(tracer, before);
});
