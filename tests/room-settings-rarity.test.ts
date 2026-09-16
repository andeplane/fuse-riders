import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POWERUP_PRESETS, rarityOf, weightFor } from '../src/online/powerup-rarity.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';

const defaults = defaultRoomSettings().weights;

test('rarity chips scale each power-up around its default weight and round-trip', () => {
  const power = defaults.power!;
  assert.equal(weightFor('power', 'normal', defaults), power);
  assert.equal(weightFor('power', 'off', defaults), 0);
  assert.equal(weightFor('power', 'rare', defaults), Math.round(power / 3));
  assert.equal(weightFor('power', 'common', defaults), Math.min(10000, power * 3));
  for (const rarity of ['off', 'rare', 'normal', 'common'] as const) assert.equal(rarityOf('power', weightFor('power', rarity, defaults), defaults), rarity);
});

test('star has no default weight, so its rarities come from the median of the enabled defaults', () => {
  assert.equal(defaults.star ?? 0, 0);
  assert.ok(weightFor('star', 'normal', defaults) > 0);
  assert.equal(rarityOf('star', 0, defaults), 'off');
  assert.equal(rarityOf('star', weightFor('star', 'common', defaults), defaults), 'common');
});

test('a hand-typed weight lights the nearest chip', () => {
  const power = defaults.power!;
  assert.equal(rarityOf('power', Math.round(power * .95), defaults), 'normal');
  // Power's high default puts COMMON at the 10000 cap, so 20% above normal is already nearest to it.
  assert.equal(rarityOf('power', Math.round(power * 1.2), defaults), 'common');
  assert.equal(rarityOf('power', Math.round(power / 2.5), defaults), 'rare');
});

test('presets: classic restores defaults, chaos makes everything common, no power-ups zeroes all', () => {
  assert.equal(POWERUP_PRESETS['CLASSIC']!('power', defaults), defaults.power);
  assert.equal(POWERUP_PRESETS['CLASSIC']!('star', defaults), 0);
  assert.equal(POWERUP_PRESETS['CHAOS']!('star', defaults), weightFor('star', 'common', defaults));
  assert.equal(POWERUP_PRESETS['NO POWER-UPS']!('power', defaults), 0);
});
