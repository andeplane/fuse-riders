import test from "node:test";
import assert from "node:assert/strict";
import { createLatencyProbe, latencyText, spread } from "../src/app/latency.js";

test("percentiles are nearest-rank", () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.deepEqual(spread(values), {
    n: 100,
    p50: 50,
    p95: 95,
    p99: 99,
    max: 100,
  });
  assert.deepEqual(spread([7]), { n: 1, p50: 7, p95: 7, p99: 7, max: 7 });
  assert.deepEqual(spread([]), { n: 0, p50: 0, p95: 0, p99: 0, max: 0 });
});

test("a press is measured to its handler, the next frame and the end of that frame's drawing", () => {
  const probe = createLatencyProbe();
  probe.frameStart(1000, 1000.5);
  probe.frameEnd(1003);
  // Stamped at 1005, handled at 1006.5; the next frame starts at 1016.9 and is drawn by 1020.
  probe.press("key", 1005, 1006.5, true);
  probe.press("touch", 1010, 1010.2, true);
  probe.frameStart(1016.6, 1016.9);
  probe.frameEnd(1020);
  probe.frameStart(1033.3, 1033.4);
  probe.frameEnd(1035);
  const report = probe.report();
  assert.deepEqual(report.handlerMs.n, 2);
  assert.ok(Math.abs(report.handlerMs.max - 1.5) < 1e-9);
  assert.equal(report.frameMs.n, 2, "each press is counted against one frame");
  assert.ok(Math.abs(report.frameMs.max - 11.9) < 1e-9);
  assert.ok(Math.abs(report.drawnMs.max - 15) < 1e-9);
  assert.ok(Math.abs(report.drawnMs.p50 - 10) < 1e-9);
  assert.equal(report.frameIntervalMs.n, 2);
  assert.ok(Math.abs(report.frameIntervalMs.max - 16.7) < 1e-9);
  assert.ok(Math.abs(report.frameWorkMs.max - 3.1) < 1e-9);
  assert.ok(Math.abs(report.frameLagMs.max - 0.5) < 1e-9);
  assert.equal(report.keys, 1);
  assert.equal(report.touches, 1);
  assert.equal(report.unstamped, 0);
});

test("a press without a usable stamp is counted, not measured", () => {
  const probe = createLatencyProbe();
  probe.press("key", 0, 500, false);
  probe.frameStart(510, 510);
  probe.frameEnd(512);
  const report = probe.report();
  assert.equal(report.unstamped, 1);
  assert.equal(report.handlerMs.n, 0);
  assert.equal(report.frameMs.n, 0);
});

test("the audio clock's jitter is read from its readings", () => {
  const probe = createLatencyProbe();
  // Readings 2 ms and 0.5 ms from the smoothed mapping, and two on it.
  probe.clock(5.002, 5);
  probe.clock(4.9995, 5);
  probe.clock(5, 5);
  probe.clock(5, 5);
  const report = probe.report();
  assert.equal(report.clockJitterMs.n, 4);
  assert.ok(Math.abs(report.clockJitterMs.max - 2) < 1e-6);
  assert.equal(report.clockJitterMs.p50, 0);
  // Where the browser pairs the clocks, it is the pairs that carry a press's time.
  assert.equal(report.pairJitterMs.n, 0);
  probe.pair(-0.17);
  probe.pair(0.05);
  assert.deepEqual(
    [probe.report().pairJitterMs.n, probe.report().pairJitterMs.max],
    [2, 0.17],
  );
  probe.reset();
  assert.equal(probe.report().pairJitterMs.n, 0);
});

test("only the newest samples are kept, and reset forgets everything", () => {
  const probe = createLatencyProbe(4);
  for (let i = 1; i <= 10; i++) probe.press("key", 100, 100 + i, true);
  assert.deepEqual(probe.report().handlerMs, {
    n: 4,
    p50: 8,
    p95: 10,
    p99: 10,
    max: 10,
  });
  probe.reset();
  const report = probe.report();
  assert.equal(report.handlerMs.n, 0);
  assert.equal(report.keys, 0);
});

test("the overlay says what was measured and what cannot be", () => {
  const probe = createLatencyProbe();
  probe.press("key", 100, 101.25, true);
  probe.frameStart(110, 110);
  probe.frameEnd(112);
  const text = latencyText(probe.report(), {
    baseMs: 5.3,
    outputMs: undefined,
    driftMs: 0.4,
    audible: true,
    offsetMs: -6,
    hits: { biasMs: -17.6, spreadMs: 12.2, used: 80 },
  });
  assert.match(text, /press > handler\s+1\.3\s+1\.3\s+1\.3\s+1\.3 {2}n=1/);
  assert.match(text, /audio base latency {2}5\.3 ms/);
  assert.match(text, /audio output latency {2}not reported/);
  assert.match(
    text,
    /hit error: −17\.6 ±12\.2 ms over 80 steps \(input offset -6 ms\)/,
  );
  assert.match(text, /not measurable here/);
  assert.match(text, /frame interval\s+-/);
});
