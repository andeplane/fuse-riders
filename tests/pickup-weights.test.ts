import assert from 'node:assert/strict';
import test from 'node:test';
import { pickupPacing } from '../src/shared/game.ts';
import { PICKUP_WEIGHTS, pickupTypeForRoll } from '../src/shared/pickup-weights.ts';
test('weighted table gives Five one third Triple probability with deterministic intervals', () => {
  const total = PICKUP_WEIGHTS.reduce((sum, row) => sum + row.weight, 0);
  const counts = new Map<string, number>();
  for (let index = 0; index < total; index += 1) {
    const type = pickupTypeForRoll((index + .5) / total);
    assert.equal(type, pickupTypeForRoll((index + .5) / total));
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  for (const row of PICKUP_WEIGHTS) assert.equal(counts.get(row.type), row.weight);
  assert.equal(counts.get('triple'), counts.get('five')! * 3);
  assert.equal(counts.get('target'), 2, 'Target Bomb now has twice its original spawn weight');
  assert.equal(pickupTypeForRoll(0), 'blast');
  assert.equal(pickupTypeForRoll(1 - Number.EPSILON), 'portal');
  for (const invalid of [-1, 1, NaN, Infinity]) assert.throws(() => pickupTypeForRoll(invalid));
});

test('Blast pickup probability is approximately tripled', () => {
  const total = PICKUP_WEIGHTS.reduce((sum, row) => sum + row.weight, 0);
  const multiplier = (PICKUP_WEIGHTS.find(row => row.type === 'blast')!.weight / total) / (3 / 28);
  assert.ok(multiplier >= 2.9 && multiplier <= 3.1);
});

test('powerup pacing ramps every twenty seconds and stays bounded in overtime', () => {
  assert.deepEqual(pickupPacing(0), { interval: 80, cap: 3 });
  assert.deepEqual(pickupPacing(399), { interval: 80, cap: 3 });
  assert.deepEqual(pickupPacing(400), { interval: 53, cap: 4 });
  assert.deepEqual(pickupPacing(800), { interval: 40, cap: 5 });
  assert.deepEqual(pickupPacing(1200), { interval: 27, cap: 6 });
  assert.deepEqual(pickupPacing(9999), { interval: 27, cap: 6 });
});
