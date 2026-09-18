import assert from "node:assert/strict";
import test from "node:test";
import {
  gunFrame,
  gunRoots,
  gunPortalPulses,
} from "../src/client/phaser/gun-animation.js";
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

test("tracer glow collapses before the authoritative tracer expires", () => {
  assert.equal(gunFrame(tracer, 100).glow, 1);
  assert.equal(gunFrame(tracer, 100).alpha, 1);
  assert.equal(gunFrame(tracer, 101.5).glow, 0);
  assert.ok(gunFrame(tracer, 101.5).alpha > 0);
  assert.equal(gunFrame(tracer, 103).alpha, 0);
  assert.equal(gunFrame({ ...tracer, shell: undefined }, 100).alpha, 0);
});

test("portal pairs flash together only when matching resolved segments cross them", () => {
  const pair = {
    id: "gate",
    expiresAtTick: 200,
    gates: [
      { x: 600, y: 450, halfLength: 100 },
      { x: 1000, y: 350, halfLength: 100 },
    ] as const,
  };
  const incoming = { ...tracer, x: 594, y: 450 };
  const outgoing = {
    ...tracer,
    id: 3,
    launchX: 1007,
    launchY: 350,
    x: 1300,
    y: 350,
  };
  const state = { ...base, bombs: [incoming, outgoing], portalPairs: [pair] };
  const pulses = gunPortalPulses(state, 100);
  assert.equal(pulses.length, 1);
  assert.deepEqual(pulses[0]!.entry, { x: 594, y: 450 });
  assert.deepEqual(pulses[0]!.exit, { x: 1007, y: 350 });
  assert.ok(gunPortalPulses(state, 101)[0]!.strength < pulses[0]!.strength);
  assert.deepEqual(gunPortalPulses(state, 103), []);
  assert.deepEqual(gunPortalPulses({ ...state, bombs: [incoming] }, 100), []);
  assert.deepEqual(
    gunPortalPulses(
      { ...state, bombs: [incoming, { ...outgoing, ownerId: "other" }] },
      100,
    ),
    [],
  );
  assert.deepEqual(
    gunPortalPulses(
      { ...state, portalPairs: [{ ...pair, expiresAtTick: 100 }] },
      100,
    ),
    [],
  );
});
