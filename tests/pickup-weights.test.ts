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
  assert.equal(pickupTypeForRoll(0), 'power');
  assert.equal(pickupTypeForRoll(1 - Number.EPSILON), 'portal');
  for (const invalid of [-1, 1, NaN, Infinity]) assert.throws(() => pickupTypeForRoll(invalid));
});

test('Power is abundant while special drops remain optional', () => {
  const total = PICKUP_WEIGHTS.reduce((sum, row) => sum + row.weight, 0);
  const power = PICKUP_WEIGHTS.find(row => row.type === 'power')!.weight;
  assert.ok(power / total > .75 && power / total < .85);
  assert.equal(PICKUP_WEIGHTS.some(row => row.type === 'star'), false);
});

test('pickup pacing scales with living riders and stays bounded', () => {
  assert.deepEqual(pickupPacing(0), { interval: 40, cap: 0 });
  assert.deepEqual(pickupPacing(1), { interval: 40, cap: 4 });
  assert.deepEqual(pickupPacing(2), { interval: 20, cap: 8 });
  assert.deepEqual(pickupPacing(3), { interval: 13, cap: 12 });
  assert.deepEqual(pickupPacing(4), { interval: 10, cap: 16 });
  assert.deepEqual(pickupPacing(5), { interval: 8, cap: 20 });
});
