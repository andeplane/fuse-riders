import test from "node:test";
import assert from "node:assert/strict";
import {
  addHit,
  driftY,
  TALLY_GAP,
  TALLY_RISE,
  type TallyState,
} from "../src/render/effects/tally.js";

test("hits within the gap add up on one tally; a later hit starts a new one", () => {
  const first = addHit(undefined, 0, 3.2);
  assert.equal(first.fresh, true);
  assert.equal(first.shown, 3);
  assert.equal(first.changed, true);

  const second = addHit(first.tally, 200, 2);
  assert.equal(second.fresh, false);
  assert.equal(second.tally, first.tally);
  assert.equal(second.shown, 5);
  assert.equal(second.changed, true);

  const tiny = addHit(second.tally, 300, 0.1);
  assert.equal(tiny.shown, 5);
  assert.equal(tiny.changed, false);

  const later = addHit(tiny.tally, 300 + TALLY_GAP + 1, 4);
  assert.equal(later.fresh, true);
  assert.equal(later.shown, 4);
});

test("a tally under sustained fire stays on its anchor, then rises once the hits stop", () => {
  const anchor = 500;
  const dt = 16;
  let tally: TallyState | undefined;
  let age = 0;
  let fresh = 0;
  let highest = anchor;
  // Ten seconds of hits every third frame, driven the way Effects drives its label.
  for (let frame = 0; frame * dt < 10_000; frame++) {
    const now = frame * dt;
    age += dt;
    if (frame % 3 === 0) {
      const hit = addHit(tally, now, 2);
      tally = hit.tally;
      if (hit.fresh) fresh++;
      age = 0;
    }
    highest = Math.min(highest, driftY(anchor, -TALLY_RISE, age));
  }
  assert.equal(fresh, 1);
  assert.ok(tally && tally.total > 400);
  // Between hits it may drift at most one frame gap's worth.
  assert.ok(anchor - highest <= (TALLY_RISE * 3 * dt) / 1000);
  // Once the hits stop it rises freely.
  assert.equal(driftY(anchor, -TALLY_RISE, 1000), anchor - TALLY_RISE);
});
