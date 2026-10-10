import test from "node:test";
import assert from "node:assert/strict";
import {
  createRound,
  predictTrajectory,
  step,
  view,
  type ImpactKind,
} from "../src/engine/index.js";
import { fillRect } from "../src/engine/grid.js";
import {
  clearSky,
  fingerprint,
  openWorld,
  placeGate,
} from "./engine-helpers.js";

test("the prediction matches the real flight of a spread-free rocket exactly, at any angle", () => {
  const kinds = new Set<ImpactKind>();
  for (const [i, angle] of [0.3, 1.2, 2, 3, 4.2, 4.71, 5.2].entries()) {
    const s = createRound({
      seed: 31 + i,
      playerCount: 3,
      tuning: { spreadDeg: 0, speedJitter: 0 },
    });
    clearSky(s);
    const c = s.castles[0];
    assert.ok(c);
    c.reloadTicks = 0;
    c.angle = angle;
    const predicted = predictTrajectory(view(s), 0);
    kinds.add(predicted.impact.kind);
    step(s, [true]);
    const rocket = s.rockets[0];
    assert.ok(rocket);
    const id = rocket.id;
    for (let k = 1; k < predicted.points.length - 1; k++) {
      const r = s.rockets.find((x) => x.id === id);
      assert.ok(r, `angle ${angle}: rocket gone at tick ${k}`);
      const p = predicted.points[k];
      assert.ok(p);
      assert.equal(r.x, p.x);
      assert.equal(r.y, p.y);
      step(s);
    }
    assert.equal(
      s.rockets.some((x) => x.id === id),
      false,
      `angle ${angle}: the rocket ends where the prediction ends`,
    );
    assert.notEqual(predicted.impact.kind, "timeout");
  }
  assert.ok(kinds.has("terrain"), [...kinds].join());
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

test("prediction reports gates on the path, castle and shield impacts, and stops at rock", () => {
  const s = createRound({ seed: 33, playerCount: 2, tuning: { gravity: 0 } });
  clearSky(s);
  openWorld(s);
  const [shooter, other] = s.castles;
  assert.ok(shooter && other);
  // Straight up with no gravity: place a gate right above the launcher.
  const gate = placeGate(s, shooter.x, shooter.y - 150, 3);
  const t = predictTrajectory(s, 0, Math.PI / 2);
  assert.deepEqual(
    t.gates.map((g) => [g.gateId, g.multiplier]),
    [[gate.id, 3]],
  );
  assert.equal(
    t.impact.kind,
    "timeout",
    "rockets above the top of the world are still in play",
  );
  assert.equal(
    predictTrajectory(s, 0, Math.PI / 2, { stopAtGate: true }).points.length <
      t.points.length,
    true,
  );

  // Aim flat at the other castle, level with it.
  s.gates = [];
  other.x = shooter.x + 600;
  other.y = shooter.y - s.tuning.launcherOffset;
  const hit = predictTrajectory(s, 0, 0);
  assert.deepEqual([hit.impact.kind, hit.impact.castleId], ["castle", 1]);
  other.shieldHp = 10;
  const shield = predictTrajectory(s, 0, 0);
  assert.deepEqual([shield.impact.kind, shield.impact.castleId], ["shield", 1]);
  // A wall in between stops it at the wall's face.
  fillRect(
    s.terrain,
    shooter.x + 300,
    other.y - 100,
    shooter.x + 320,
    other.y + 100,
  );
  const wall = predictTrajectory(s, 0, 0);
  assert.equal(wall.impact.kind, "terrain");
  assert.ok(Math.abs(wall.impact.x - (shooter.x + 300)) < 4);
});
