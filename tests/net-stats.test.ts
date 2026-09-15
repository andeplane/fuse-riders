import test from 'node:test';
import assert from 'node:assert/strict';
import { NetStats, STATS_WINDOW_MS, formatNetStats, verdict } from '../src/online/net-stats.js';

const clock = () => { let t = 0; return { now: () => t, tick: (ms: number) => { t += ms; } }; };

test('rates, percentiles and silence come from the last window only', () => {
  const c = clock(), stats = new NetStats(c.now);
  for (let i = 0; i < 20; i++) { stats.record('packet', 40 + i); c.tick(50); }
  stats.record('gap'); stats.record('repair'); stats.record('rewind', 3); stats.record('rewind', 6); stats.clockOffsetTicks = 1.5;
  const s = stats.summary();
  assert.equal(s.rttP50, 50); assert.equal(s.rttP95, 59); assert.equal(s.packetsPerSec, 2);
  assert.equal(s.gapsPerMin, 6); assert.equal(s.repairsPerMin, 6); assert.equal(s.rewindsPerMin, 12); assert.equal(s.rewindMax, 6);
  assert.equal(s.silenceMs, 50, 'measured from the last packet'); assert.equal(s.clockOffsetTicks, 1.5);
  c.tick(STATS_WINDOW_MS + 1); stats.record('resync');
  const later = stats.summary();
  assert.equal(later.rttP50, undefined, 'old samples fall out of the window'); assert.equal(later.packetsPerSec, 0); assert.equal(later.resyncsPerMin, 6);
  assert.ok(later.silenceMs > STATS_WINDOW_MS, 'silence keeps counting from the last packet');
  stats.reset(); assert.equal(stats.summary().silenceMs, Infinity);
});
test('the verdict names the likely cause, worst first', () => {
  const base = { packetsPerSec: 20, repairsPerMin: 0, gapsPerMin: 0, rewindsPerMin: 0, rewindMax: 0, resyncsPerMin: 0, mismatches: 0, silenceMs: 0 };
  assert.deepEqual(verdict({ ...base, rttP50: 30, rttP95: 60 }), { grade: 'good', reason: 'link is healthy' });
  assert.equal(verdict({ ...base, silenceMs: Infinity }).reason, 'no packets from the host yet');
  assert.equal(verdict({ ...base, silenceMs: 1500 }).reason, 'host silent for 1.5 s');
  assert.equal(verdict({ ...base, resyncsPerMin: 12 }).reason, 'simulation keeps re-syncing');
  assert.equal(verdict({ ...base, rttP95: 400 }).grade, 'bad');
  assert.equal(verdict({ ...base, rttP95: 150 }).grade, 'fair');
  assert.equal(verdict({ ...base, rewindMax: 9 }).grade, 'fair');
});
test('the overlay text is stable and complete', () => {
  const text = formatNetStats({ rttP50: 41.4, rttP95: 88, packetsPerSec: 19.6, repairsPerMin: 2, gapsPerMin: 1, rewindsPerMin: 4, rewindMax: 3, resyncsPerMin: 0, mismatches: 0, clockOffsetTicks: -0.4, silenceMs: 12 }, 'direct');
  assert.equal(text.split('\n').length, 6);
  assert.match(text, /^link GOOD · link is healthy\npath direct · rtt 41 ms \/ p95 88 ms\npackets 19\.6\/s · silence 12 ms\n/);
  assert.match(text, /clock -0\.4 ticks$/);
  assert.match(formatNetStats({ packetsPerSec: 0, repairsPerMin: 0, gapsPerMin: 0, rewindsPerMin: 0, rewindMax: 0, resyncsPerMin: 0, mismatches: 0, silenceMs: Infinity }, 'none'), /rtt — \/ p95 —\npackets 0\.0\/s · silence —/);
});
