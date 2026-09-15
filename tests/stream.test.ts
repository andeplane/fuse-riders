import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamSender, ENTRIES_PER_PACKET } from '../src/online/stream.js';
import { MAX_FUTURE_TICKS } from '../src/online/rollback.js';
import { MAX_ENTRIES_PER_TICK, ROLLBACK_WINDOW_TICKS, type LogEntry } from '../src/shared/action-log.js';

test('a sender numbers entries, keeps ticks monotonic, rotates every retained entry into packets and forgets the window', () => {
  const s = new StreamSender();
  const a = s.append(10, [0, 1]); const b = s.append(5, [0, 2]);
  assert.deepEqual([a[0], a[1], b[0], b[1]], [1, 10, 2, 10], 'ticks never decrease within a stream');
  for (let i = 3; i <= 14; i++) s.append(10 + i, [0, i % 4]);
  const seen = new Set<number>();
  for (let packet = 0; packet < 6; packet++) { const out = s.next(); assert.ok(out.length <= ENTRIES_PER_PACKET); assert.ok(out.every((e, i) => i === 0 || out[i - 1]![0] < e[0]), 'sorted'); assert.ok(out.some(e => e[0] === 14), 'the newest entry is in every packet'); for (const e of out) seen.add(e[0]); }
  assert.equal(seen.size, 14, 'every retained entry appears within a few packets');
  assert.deepEqual(s.since(13).map(e => e[0]), [13, 14]); assert.deepEqual(s.since(99), []);
  s.retain(24 + ROLLBACK_WINDOW_TICKS); assert.deepEqual(s.retained.map(e => e[0]), [14]);
  s.retain(1000); assert.deepEqual(s.next(), []);
});
test('adopting relayed entries deduplicates and keeps order', () => {
  const s = new StreamSender();
  assert.equal(s.adopt([3, 30, 0, 1]), true); assert.equal(s.adopt([1, 10, 0, 2]), true); assert.equal(s.adopt([3, 30, 0, 1]), false);
  assert.deepEqual(s.retained.map(e => e[0]), [1, 3]); assert.equal(s.lastSeq, 3); assert.equal(s.lastTick, 30);
  const own = s.append(20, [2, 1]); assert.deepEqual([own[0], own[1]], [4, 30]);
});
test('retaining drops by tick even when the adopted entries are out of tick order', () => {
  const s = new StreamSender();
  for (const e of [[1, 90, 0, 1], [2, 10, 0, 2], [3, 95, 0, 3]] as LogEntry[]) assert.equal(s.adopt(e), true);
  s.retain(50 + ROLLBACK_WINDOW_TICKS);
  assert.deepEqual(s.retained.map(e => e[0]), [1, 3], 'the stale entry behind a newer one is still dropped');
});
test('one absurd stamp cannot re-stamp the entries that follow it', () => {
  const s = new StreamSender();
  s.adopt([1, Number.MAX_SAFE_INTEGER, 0, 1]);
  const next = s.append(100, [0, 2]);
  assert.ok(next[1] <= 100 + MAX_FUTURE_TICKS, `a stale lastTick pulled the entry to ${next[1]}`);
  assert.ok(s.append(120, [0, 3])[1] <= 120 + MAX_FUTURE_TICKS, 'and it stays bounded as the stream goes on');
});
test('every retained entry is sent at least twice before the window evicts it', () => {
  const s = new StreamSender();
  const sends = new Map<number, number>(); const thin: number[] = [];
  for (let tick = 1; tick <= 300; tick++) {
    for (let i = 0; i < 4; i++) s.append(tick, [0, i % 4]);   // four edges a tick, the busiest a controller gets
    const out = s.next();
    assert.ok(out.length <= MAX_ENTRIES_PER_TICK, `${out.length} entries will not fit one packet`);
    for (const e of out) sends.set(e[0], (sends.get(e[0]) ?? 0) + 1);
    const before = s.retained.map(e => e[0]); s.retain(tick);
    const after = new Set(s.retained.map(e => e[0]));
    for (const seq of before) if (!after.has(seq) && (sends.get(seq) ?? 0) < 2) thin.push(seq);
  }
  assert.equal(thin.length, 0, `${thin.length} entries were evicted after fewer than two sends`);
});
