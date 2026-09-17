import test from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_WINDOW_MS,
  SNAP_TICKS,
  TickClock,
} from "../src/online/clock.js";

function fixture() {
  let now = 1000;
  const clock = new TickClock(() => now);
  return {
    clock,
    advance: (ms: number) => {
      now += ms;
    },
    at: () => now,
  };
}

test("authority clock runs 20 ticks per second from start and never steps backwards", () => {
  const f = fixture();
  assert.equal(f.clock.started, false);
  assert.equal(f.clock.tick(), 0);
  f.clock.start();
  assert.equal(f.clock.tick(), 0);
  f.advance(1000);
  assert.equal(f.clock.tick(), 20);
  f.advance(25);
  assert.equal(f.clock.tick(), 20.5);
  f.clock.start(100);
  assert.equal(f.clock.tick(), 100);
  f.advance(50);
  assert.equal(f.clock.tick(), 101);
});

test("followers snap on the first sample, keep the lowest-RTT sample and slew at most one tick per second", () => {
  const f = fixture();
  f.clock.sample(500, 100);
  assert.equal(f.clock.tick(), 501, "half the round trip ahead");
  f.advance(500);
  f.clock.sample(520, 40);
  f.advance(0);
  const before = f.clock.tick();
  assert.ok(
    Math.abs(before - 511.5) < 1e-9,
    `half a second of slew budget applies at once: ${before}`,
  );
  f.advance(1000);
  const after = f.clock.tick();
  assert.ok(
    Math.abs(after - before - 21) < 1e-9,
    `slewed exactly one tick in one second: ${after - before}`,
  );
  f.advance(10_000);
  assert.ok(
    Math.abs(f.clock.tick() - (731 + 9.4)) < 1e-9,
    `the offset settles on the low-RTT sample: ${f.clock.tick()}`,
  );
  f.clock.sample(800, 20);
  f.advance(100);
  assert.ok(
    f.clock.tick() < 760,
    "a fifty-tick jump slews instead of snapping",
  );
  const g = fixture();
  g.clock.sample(10, 0);
  g.advance(100);
  g.clock.sample(10 + SNAP_TICKS + 100, 0);
  assert.ok(g.clock.tick() > SNAP_TICKS, "a hopeless offset snaps");
  assert.deepEqual(Object.keys(g.clock.diagnostics()).sort(), [
    "bestRttMs",
    "offset",
    "samples",
  ]);
});

test("slewing backwards never rewinds the reported tick and old samples age out of the window", () => {
  const f = fixture();
  f.clock.sample(100, 0);
  f.advance(500);
  f.clock.sample(105, 0); // authority is 5 ticks behind our estimate
  let previous = f.clock.tick();
  for (let step = 0; step < 100; step++) {
    f.advance(16);
    const tick = f.clock.tick();
    assert.ok(tick >= previous);
    previous = tick;
  }
  assert.ok(
    previous < 100 + (500 + 1600) / 50,
    "the clock ran slower than real time while slewing back",
  );
  assert.equal(f.clock.freeRunning(), false);
  f.advance(SAMPLE_WINDOW_MS + 1);
  assert.equal(f.clock.freeRunning(), true);
  f.clock.sample(NaN, 0);
  f.clock.sample(1, -1);
  assert.equal(f.clock.diagnostics().samples, 1);
});

test("pausing while hidden removes the paused time on resume", () => {
  const f = fixture();
  f.clock.start();
  f.advance(1000);
  assert.equal(f.clock.tick(), 20);
  f.clock.pause();
  f.clock.pause();
  assert.equal(f.clock.paused, true);
  f.advance(5000);
  assert.equal(f.clock.tick(), 20);
  f.clock.resume();
  assert.equal(f.clock.paused, false);
  assert.equal(f.clock.tick(), 20);
  f.advance(50);
  assert.equal(f.clock.tick(), 21);
  const idle = new TickClock(() => 0);
  idle.pause();
  idle.resume();
  assert.equal(idle.tick(), 0);
});

test("a rate change keeps the ticks already counted and scales only what follows", () => {
  const f = fixture();
  f.clock.start();
  f.advance(1000);
  assert.equal(f.clock.tick(), 20);
  f.clock.rate = 3;
  assert.equal(f.clock.tick(), 20, "no jump at the change");
  f.advance(1000);
  assert.equal(f.clock.tick(), 80);
  f.clock.pause();
  f.advance(500);
  f.clock.rate = 1;
  f.clock.resume();
  assert.equal(f.clock.tick(), 80, "paused time stays out");
  f.advance(50);
  assert.equal(f.clock.tick(), 81);
  f.clock.rate = 0;
  f.clock.rate = Number.NaN;
  assert.equal(f.clock.rate, 1, "nonsense rates are ignored");
  const g = fixture();
  g.clock.rate = 3;
  g.clock.sample(500, 100);
  assert.equal(
    g.clock.tick(),
    503,
    "half a round trip is three times as many ticks",
  );
});
