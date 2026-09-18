import test from "node:test";
import assert from "node:assert/strict";
import {
  NetStats,
  STATS_WINDOW_MS,
  formatNetStats,
  verdict,
  type NetSummary,
} from "../src/online/net-stats.js";
import type { RuntimeMetrics } from "../src/online/room-runtime.js";

const clock = () => {
  let t = 0;
  return {
    now: () => t,
    tick: (ms: number) => {
      t += ms;
    },
  };
};
const metrics = (over: Partial<RuntimeMetrics> = {}): RuntimeMetrics => ({
  tick: 100,
  clockTick: 101.5,
  rollbacks: 0,
  rollbackTicks: 0,
  steps: 0,
  rtt: { a: 40, b: 60 },
  heard: { a: 30, b: 12 },
  clock: { offset: 0, samples: 0 },
  sentBytes: 0,
  snapshotRequest: false,
  mismatches: 0,
  hashChecks: 0,
  refused: [],
  stall: { tick: Infinity },
  streams: {
    a: {
      generation: 1,
      contiguous: 3,
      lastSeq: 3,
      through: 100,
      complete: 100,
      gap: false,
      base: 0,
      rejected: 0,
    },
  },
  ...over,
});

test("rates come from the deltas inside the window, percentiles from every peer link", () => {
  const c = clock(),
    stats = new NetStats(c.now);
  for (let i = 0; i < 20; i++) {
    stats.record(
      metrics({
        rollbacks: i,
        rollbackTicks: i * 3,
        rtt: { a: 40 + i, b: 60 + i },
      }),
    );
    c.tick(500);
  }
  const s = stats.summary();
  assert.equal(s.rttP50, 60);
  assert.equal(s.rttP95, 78);
  assert.equal(s.peers, 2);
  assert.equal(s.rollbacksPerMin, 19 / (STATS_WINDOW_MS / 60_000));
  assert.equal(s.rollbackAvgTicks, 3);
  assert.equal(s.gapShare, 0);
  assert.equal(s.silenceMs, 12, "the freshest peer");
  assert.equal(s.clockOffsetTicks, 1.5);
  assert.equal(s.waitingFor, undefined);
  stats.record(
    metrics({
      snapshotRequest: true,
      streams: {
        a: {
          generation: 1,
          contiguous: 1,
          lastSeq: 3,
          through: 100,
          complete: 90,
          gap: true,
          base: 0,
          rejected: 0,
        },
      },
      stall: { tick: 90, waitingFor: "Ada" },
    }),
  );
  const gap = stats.summary();
  assert.equal(gap.snapshotsPerMin, 6);
  assert.ok(gap.gapShare > 0);
  assert.equal(gap.waitingFor, "Ada");
  c.tick(STATS_WINDOW_MS + 1);
  stats.record(metrics({ rtt: {}, heard: {} }));
  const later = stats.summary();
  assert.equal(later.rttP50, undefined, "old samples fall out of the window");
  assert.equal(later.silenceMs, Infinity);
  assert.equal(later.rollbacksPerMin, 0);
  stats.reset();
  assert.equal(stats.summary().silenceMs, Infinity);
});
test("the verdict names the likely cause, worst first", () => {
  const base: NetSummary = {
    peers: 2,
    rollbacksPerMin: 0,
    rollbackAvgTicks: 0,
    gapShare: 0,
    snapshotsPerMin: 0,
    mismatches: 0,
    clockOffsetTicks: 0,
    silenceMs: 0,
  };
  assert.deepEqual(verdict({ ...base, rttP50: 30, rttP95: 60 }), {
    grade: "good",
    reason: "link is healthy",
  });
  assert.equal(
    verdict({ ...base, silenceMs: Infinity }).reason,
    "no packets from the riders yet",
  );
  assert.equal(
    verdict({ ...base, silenceMs: 1500 }).reason,
    "riders silent for 1.5 s",
  );
  assert.equal(
    verdict({ ...base, snapshotsPerMin: 12 }).reason,
    "simulation keeps re-syncing",
  );
  assert.equal(verdict({ ...base, rttP95: 400 }).grade, "bad");
  assert.equal(
    verdict({ ...base, waitingFor: "Ada" }).reason,
    "waiting for Ada",
  );
  assert.equal(verdict({ ...base, rttP95: 150 }).grade, "fair");
  assert.equal(verdict({ ...base, rollbackAvgTicks: 7 }).grade, "fair");
});
test("the overlay text is stable and complete", () => {
  const text = formatNetStats(
    {
      rttP50: 41.4,
      rttP95: 88,
      peers: 3,
      rollbacksPerMin: 4,
      rollbackAvgTicks: 2.5,
      gapShare: 0.02,
      snapshotsPerMin: 0,
      mismatches: 0,
      clockOffsetTicks: -0.4,
      silenceMs: 12,
    },
    "direct",
  );
  assert.equal(text.split("\n").length, 6);
  assert.match(
    text,
    /^link GOOD · link is healthy\npath direct · 3 peers · rtt 41 ms \/ p95 88 ms\nsilence 12 ms · gaps 2% of the window\n/,
  );
  assert.match(text, /clock -0\.4 ticks ahead of the fold$/);
  assert.match(
    formatNetStats(
      {
        peers: 0,
        rollbacksPerMin: 0,
        rollbackAvgTicks: 0,
        gapShare: 0,
        snapshotsPerMin: 0,
        mismatches: 0,
        clockOffsetTicks: 0,
        silenceMs: Infinity,
        waitingFor: "Ada",
      },
      "none",
    ),
    /rtt — \/ p95 —\nsilence — ·[\s\S]*stalled on Ada/,
  );
});
