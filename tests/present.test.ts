import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TICKS_AHEAD,
  TICK_MS,
  createCorrectionSmoother,
  createLeadClock,
  ticksAhead,
} from "fuse-netcode";

const frame = (tick: number, logTick: number) => ({ tick, logTick });

test("ticksAhead is how far the clock has run past the newest frame, in log ticks", () => {
  // The runtime presents one log tick behind the clock: `tick` between the frames, `lead` up to 1 past it.
  // Clock 10.4, newest world at log tick 10 (game tick 60, six steps a tick): presentation at 9.4.
  assert.ok(
    Math.abs(
      ticksAhead({
        older: frame(54, 9),
        newer: frame(60, 10),
        tick: 54 + 0.4 * 6,
        lead: 1,
      }) - 0.4,
    ) < 1e-9,
  );
  // The fold is late: the clock is 1.2 past the newest world, and the runtime's timing stops at a whole tick.
  assert.equal(
    ticksAhead({
      older: frame(54, 9),
      newer: frame(60, 10),
      tick: 60,
      lead: 1,
    }),
    1,
  );
  // A slow-motion tick ran two steps: the fraction is of the log tick, not of the steps.
  assert.ok(
    Math.abs(
      ticksAhead({
        older: frame(58, 9),
        newer: frame(60, 10),
        tick: 59,
        lead: 1,
      }) - 0.5,
    ) < 1e-9,
  );
  // One frame only (a fresh world): the lead is all there is.
  assert.equal(ticksAhead({ newer: frame(0, 0), tick: 0, lead: 0.25 }), 0.25);
  assert.equal(
    ticksAhead({
      older: frame(54, 9),
      newer: frame(60, 10),
      tick: 54,
      lead: 0.5,
    }),
    0,
    "never negative",
  );
});

test("the lead clock carries on by wall time while the fold is late, and hands back when it lands", () => {
  const lead = createLeadClock();
  assert.equal(lead(0.4, 10, 1000), 0.4);
  assert.equal(lead(0.9, 10, 1025), 0.9);
  // Pinned at a whole tick: the wall clock carries the count on from the last unpinned frame.
  assert.ok(Math.abs(lead(1, 10, 1035) - 1.1) < 1e-9);
  assert.ok(Math.abs(lead(1, 10, 1045) - 1.3) < 1e-9);
  assert.equal(lead(1, 10, 5000), MAX_TICKS_AHEAD, "bounded");
  // The next tick folded: the runtime's timing is used as it is again.
  assert.equal(lead(0.35, 11, 1047), 0.35);
  // Pinned from the first frame it sees: nothing to carry on from but that frame.
  const cold = createLeadClock();
  assert.equal(cold(1, 3, 0), 1);
  assert.ok(Math.abs(cold(1, 3, TICK_MS / 2) - 1.5) < 1e-9);
});

test("a correction is absorbed where it happens and decays; steady motion and teleports are shown as they are", () => {
  const smoother = createCorrectionSmoother({ decayMs: 45, teleport: 100 });
  let now = 0;
  const draw = (x: number, absorb: boolean) => {
    now += 10;
    smoother.begin(now);
    return smoother.place("ball", { x, y: 0 }, absorb);
  };
  // Moving 2 px a frame: absorbing on every frame changes nothing while the motion is what was expected.
  for (let x = 0; x <= 20; x += 2) assert.equal(draw(x, true).x, x);
  // The picture jumps 30 px ahead of where it was going (22): the body is drawn where it was expected.
  assert.ok(Math.abs(draw(52, true).x - 22) < 1e-9);
  // It then closes the gap without overshooting, and is back on the picture within half a second.
  let previous = 22,
    x = 52;
  for (let i = 0; i < 40; i++) {
    x += 2;
    const drawn = draw(x, false).x;
    assert.ok(
      drawn > previous && drawn <= x,
      `${drawn} between ${previous} and ${x}`,
    );
    previous = drawn;
  }
  assert.equal(previous, x, "the offset is gone");
  // Without `absorb` a jump is shown as it is.
  assert.equal(draw(x + 40, false).x, x + 40);
  // A jump larger than the teleport distance is never dragged.
  assert.equal(draw(x + 500, true).x, x + 500);
  // A body that was not drawn for a frame starts afresh.
  now += 10;
  smoother.begin(now);
  assert.equal(draw(0, true).x, 0);
  smoother.reset();
  assert.equal(draw(7, true).x, 7);
});
