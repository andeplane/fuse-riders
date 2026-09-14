import test from 'node:test';
import assert from 'node:assert/strict';
import { durationText } from '../src/client/duration-text.js';

test('durationText rounds whole seconds before splitting minutes so 59.95s never renders as "60s"', () => {
  assert.equal(durationText(1199), '1m 0s'); // 59.95s rounds up to a full minute, not "60s"
  assert.equal(durationText(2399), '2m 0s'); // 119.95s rounds up to 2 minutes flat, not "1m 60s"
  assert.equal(durationText(0), '0s');
  assert.equal(durationText(20), '1s');
  assert.equal(durationText(1180), '59s');
  assert.equal(durationText(1200), '1m 0s');
  assert.equal(durationText(1220), '1m 1s');
  assert.equal(durationText(7200), '6m 0s');
});
