import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRUNK_DURATION_TICKS, DRUNK_KNOT_INTERVAL_TICKS, DRUNK_MAX_ANGULAR_VELOCITY,
  drunkAngularVelocity,
} from '../src/shared/drunk.ts';

test('uses the accepted duration, interval, and bound', () => {
  assert.equal(DRUNK_DURATION_TICKS, 80);
  assert.equal(DRUNK_KNOT_INTERVAL_TICKS, 8);
  assert.equal(DRUNK_MAX_ANGULAR_VELOCITY, 5);
  for (let tick = 0; tick < 500; tick += 1) {
    assert.ok(Math.abs(drunkAngularVelocity(42, 'p1', tick)) <= DRUNK_MAX_ANGULAR_VELOCITY);
  }
});

test('is deterministic, smooth between knots, and independent per player', () => {
  const first = Array.from({ length: 80 }, (_, tick) => drunkAngularVelocity(123, 'alice', tick));
  assert.deepEqual(first, Array.from({ length: 80 }, (_, tick) => drunkAngularVelocity(123, 'alice', tick)));
  assert.notDeepEqual(first, Array.from({ length: 80 }, (_, tick) => drunkAngularVelocity(123, 'bob', tick)));
  for (let tick = 1; tick < first.length; tick += 1) assert.ok(Math.abs(first[tick]! - first[tick - 1]!) <= 1.875);
});

test('changes with seed and does not mutate inputs', () => {
  const id = 'player-ø';
  const before = id.slice();
  assert.notEqual(drunkAngularVelocity(1, id, 17), drunkAngularVelocity(2, id, 17));
  assert.equal(id, before);
});

test('four-second trajectories wind substantially more than the original Beer Worms', () => {
  // Baselines measured using ADR009's original 2 rad/s, 10-tick implementation.
  const baselines = [
    { seed: 1, turning: 4.100479761761725, displacement: Math.hypot(462.43775465204146, 303.08478344215706) },
    { seed: 42, turning: 3.8532260821809117, displacement: Math.hypot(192.07349835147951, -454.3485031859066) },
    { seed: 123, turning: 3.9907394044957005, displacement: Math.hypot(-35.48819948696864, -493.0557184472399) },
    { seed: 999, turning: 3.240144007107277, displacement: Math.hypot(374.22004416261996, -402.52564650297495) },
  ];
  for (const baseline of baselines) {
    let angle = 0; let turning = 0; let x = 0; let y = 0;
    for (let tick = 0; tick < DRUNK_DURATION_TICKS; tick += 1) {
      const delta = drunkAngularVelocity(baseline.seed, 'alice', tick) * .05;
      angle += delta; turning += Math.abs(delta);
      x += 7.5 * Math.cos(angle); y += 7.5 * Math.sin(angle);
    }
    assert.ok(turning > baseline.turning * 2.3, `seed ${baseline.seed}: much more winding`);
    assert.ok(Math.hypot(x, y) < baseline.displacement * .7, `seed ${baseline.seed}: less straight progress`);
  }
});
