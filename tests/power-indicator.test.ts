import assert from 'node:assert/strict';
import test from 'node:test';
import { displayPowerLevel, powerRingProgress, POWER_RING_RADIUS } from '../src/client/power-indicator.js';
import { RELOAD_RING_RADIUS } from '../src/client/reload-ring.js';
import { POWER_TUNING, powerBlastRadius, powerReloadTicks } from '../src/shared/power-progression.js';

test('visible levels start at one without granting a weapon upgrade', () => {
  assert.equal(displayPowerLevel(0), 1);
  assert.equal(powerBlastRadius(0), POWER_TUNING.baseBlastRadius);
  assert.equal(powerReloadTicks(0), POWER_TUNING.baseReloadTicks);
});

test('public progress fills per pickup and resets when the next visible level starts', () => {
  const n = POWER_TUNING.pickupsPerLevel;
  assert.equal(powerRingProgress(0), 0);
  for (let i = 1; i < n; i++) {
    assert.ok(powerRingProgress(i) > powerRingProgress(i - 1));
    assert.ok(powerRingProgress(i) < 1);
    assert.equal(displayPowerLevel(i), 1);
  }
  assert.equal(displayPowerLevel(n), 2);
  assert.equal(powerRingProgress(n), 0);
  assert.equal(displayPowerLevel(n + 1), 2);
  assert.equal(powerRingProgress(n + 1), powerRingProgress(1));
  assert.ok(POWER_RING_RADIUS + 2 < RELOAD_RING_RADIUS, 'inner progress and outer cooldown strokes stay separate');
});
