import test from "node:test";
import assert from "node:assert/strict";
import {
  createRound,
  isLoaded,
  predictTrajectory,
  step,
  view,
} from "../src/engine/index.js";
import { clearSky, fingerprint, placeGate } from "./engine-helpers.js";

test("the prediction matches the real flight of a spread-free rocket exactly", () => {
  const s = createRound({
    seed: 31,
    playerCount: 3,
    tuning: { spreadDeg: 0, speedJitter: 0 },
  });
  clearSky(s);
  const c = s.castles[0];
  assert.ok(c);
  while (!isLoaded(c)) step(s);
  const predicted = predictTrajectory(view(s), 0);
  step(s, [true]);
  const rocket = s.rockets[0];
  assert.ok(rocket);
  const id = rocket.id;
  for (let k = 1; k < predicted.points.length - 1; k++) {
    const r = s.rockets.find((x) => x.id === id);
    assert.ok(
      r,
      `rocket gone at tick ${k}, predicted impact at ${predicted.impact.tick}`,
    );
    const p = predicted.points[k];
    assert.ok(p);
    assert.equal(r.x, p.x);
    assert.equal(r.y, p.y);
    step(s);
  }
  assert.equal(
    s.rockets.some((x) => x.id === id),
    false,
    "rocket ends where the prediction ends",
  );
  assert.notEqual(predicted.impact.kind, "timeout");
});

test("prediction does not mutate the state and defaults to the current angle", () => {
  const s = createRound({ seed: 32, playerCount: 4 });
  const before = fingerprint(s);
  const a = predictTrajectory(s, 1);
  const b = predictTrajectory(s, 1, s.castles[1]?.angle);
  assert.deepEqual(a, b);
  assert.equal(fingerprint(s), before);
  assert.throws(() => predictTrajectory(s, 9), RangeError);
});

test("prediction reports gates on the path and castle impacts", () => {
  const s = createRound({ seed: 33, playerCount: 2, tuning: { gravity: 0 } });
  clearSky(s);
  const shooter = s.castles[0];
  assert.ok(shooter);
  // Straight up with no gravity: place a gate right above the launcher.
  const gate = placeGate(s, shooter.x, 200, 3);
  const t = predictTrajectory(s, 0, Math.PI / 2);
  assert.deepEqual(
    t.gates.map((g) => [g.gateId, g.multiplier]),
    [[gate.id, 3]],
  );
  assert.equal(
    t.impact.kind,
    "timeout",
    "rockets above the top of the arena are still in play",
  );
  assert.equal(
    predictTrajectory(s, 0, Math.PI / 2, { stopAtGate: true }).points.length <
      t.points.length,
    true,
  );

  // Aim flat at the other castle across a flattened arena.
  s.terrain.surface.fill(800);
  for (const c of s.castles) c.y = 800;
  const other = s.castles[1];
  assert.ok(other);
  const hit = predictTrajectory(s, 0, 0);
  assert.equal(hit.impact.kind, "castle");
  assert.equal(hit.impact.castleId, other.id);
});
