import test from "node:test";
import assert from "node:assert/strict";
import { durationText } from "../src/engine/duration-text.js";

test('durationText rounds whole seconds before splitting minutes so 59.95s never renders as "60s"', () => {
  assert.equal(durationText(1199), "1m 0s"); // 59.95s rounds up to a full minute, not "60s"
  assert.equal(durationText(2399), "2m 0s"); // 119.95s rounds up to 2 minutes flat, not "1m 60s"
  assert.equal(durationText(0), "0.0s");
  assert.equal(durationText(20), "1.0s");
  assert.equal(durationText(150), "7.5s"); // under ten seconds keeps a tenth, as before
  assert.equal(durationText(198), "9.9s");
  assert.equal(durationText(199), "10.0s"); // 9.95s rounds to one decimal within the short format
  assert.equal(durationText(200), "10s");
  assert.equal(durationText(1180), "59s");
  assert.equal(durationText(1200), "1m 0s");
  assert.equal(durationText(1220), "1m 1s");
  assert.equal(durationText(7200), "6m 0s");
});
