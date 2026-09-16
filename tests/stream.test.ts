import test from 'node:test';
import assert from 'node:assert/strict';
import { BUFFERED_ENTRIES, FUTURE_TICKS, PACKET_ENTRIES, RETAINED_ENTRIES, ROLLBACK_TICKS, StreamLog } from '../src/online/stream.js';
import { AIM, PRESS, RELEASE, STEER, type Entry } from '../src/shared/input-log.js';

const e = (seq: number, tick: number, ...body: unknown[]): Entry => [seq, tick, ...body] as Entry;

test('own stream appends contiguous entries with increasing gestures and rejects order violations', () => {
  const own = new StreamLog(1);
  assert.deepEqual(own.append(5, [STEER, 1]), [1, 5, STEER, 1]); own.append(5, [PRESS, 1]); own.append(7, [RELEASE, 1]);
  assert.equal(own.lastSeq, 3); assert.equal(own.contiguous, 3); assert.equal(own.latestTick(), 7); assert.equal(own.latestGesture(), 1);
  assert.throws(() => own.append(6, [STEER, 0]), /Invalid own entry/); assert.throws(() => own.append(7, [PRESS, 1]), /Reused gesture/); assert.throws(() => own.append(7, [STEER, 9]), /Invalid own entry/);
  assert.deepEqual(own.entriesAt(5).map(entry => entry[0]), [1, 2]); assert.equal(own.gap, false); assert.equal(own.firstMissing(), undefined);
});

test('remote stream applies in seq order, buffers gaps, reports the first missing seq and rolls back to a late tick', () => {
  const remote = new StreamLog(1);
  assert.deepEqual(remote.receive([e(2, 12, STEER, 2)], 2, 12, 20, 20), { status: 'accepted', added: [] });
  assert.equal(remote.firstMissing(), 1); assert.equal(remote.gap, true); assert.deepEqual(remote.entriesAt(12), []); assert.equal(remote.completeThrough(), 11, 'a gap caps completeness before the first waiting entry');
  const repaired = remote.receive([e(1, 10, STEER, 1)], 2, 12, 20, 20);
  assert.deepEqual(repaired, { status: 'accepted', added: [e(1, 10, STEER, 1), e(2, 12, STEER, 2)], rollbackTo: 10 });
  assert.equal(remote.gap, false); assert.equal(remote.through, 12); assert.deepEqual(remote.entriesAt(12), [e(2, 12, STEER, 2)]);
  assert.deepEqual(remote.receive([e(3, 25, STEER, 0)], 3, 24, 20, 20), { status: 'accepted', added: [e(3, 25, STEER, 0)] }, 'a future entry needs no rollback');
  assert.deepEqual(remote.receive([e(3, 25, STEER, 0)], 3, 30, 20, 20).added, [], 'duplicates are harmless');
  assert.equal(remote.through, 30);
  assert.deepEqual(remote.receive([e(1, 10, STEER, 1)], 3, 30, 20, 25), { status: 'accepted', added: [] }, 'a resend of a pruned or applied entry is ignored');
});

test('a whole packet is rejected on any invalid entry and nothing changes', () => {
  const remote = new StreamLog(1); remote.receive([e(1, 10, STEER, 1), e(2, 11, PRESS, 3)], 2, 11, 12, 12);
  const before = JSON.stringify([...remote.entries]);
  const bad: [unknown[], number, number][] = [
    [[e(3, 12, STEER, 0), e(4, 12, STEER, 5)], 4, 12], [[e(3, 9, STEER, 0)], 3, 12], [[e(5, 12, STEER, 0)], 4, 12], [[e(3, 12 + FUTURE_TICKS + 1, STEER, 0)], 3, 12],
    [[e(3, 12, PRESS, 3)], 3, 12], [[e(3, 12, PRESS, 2)], 3, 12], [[e(1, 10, STEER, 3)], 3, 12], [[e(4, 12, STEER, 0), e(3, 13, STEER, 0)], 4, 13], [[e(3, 13, PRESS, 5), e(4, 14, PRESS, 4)], 4, 14],
    [['nope'], 3, 12], [[e(3, 12, STEER, 0)], -1, 12], [[e(3, 12, STEER, 0)], 3, 1.5], [Array.from({ length: PACKET_ENTRIES + 1 }, (_, i) => e(3 + i, 12, STEER, 0)), 20, 12],
  ];
  for (const [entries, lastSeq, through] of bad) { assert.equal(remote.receive(entries, lastSeq, through, 12, 12).status, 'invalid', JSON.stringify(entries)); assert.equal(JSON.stringify([...remote.entries]), before); }
  assert.equal(remote.receive(e(3, 12, STEER, 0) as unknown as unknown[], 3, 12, 12, 12).status, 'invalid');
  const flood = new StreamLog(1); let seq = 2, status = 'accepted';
  while (status === 'accepted' && seq < BUFFERED_ENTRIES + 10) status = flood.receive([e(seq, 5, STEER, 0)], seq, 5, 5, 5).status, seq++;
  assert.equal(status, 'invalid'); assert.ok(flood.entries.size <= BUFFERED_ENTRIES);
});

test('entries behind the rollback window or the snapshot base are unrepairable and leave the stream waiting for a snapshot', () => {
  const remote = new StreamLog(1);
  assert.equal(remote.receive([e(1, 5, STEER, 1)], 1, 5, 100, 100).status, 'unrepairable');
  const based = new StreamLog(3, { seq: 4, tick: 50, gesture: 2 });
  assert.equal(based.receive([e(5, 49, STEER, 1)], 5, 50, 60, 60).status, 'unrepairable', 'below the base tick');
  assert.equal(based.receive([e(5, 50, STEER, 1)], 5, 50, 60, 60).status, 'unrepairable', 'at the base tick is already folded in');
  assert.equal(based.receive([e(6, 51, STEER, 0)], 6, 51, 60, 60).status, 'accepted');
  assert.equal(based.gap, true, 'the stale entry is not committed; only a fresh snapshot resolves it'); assert.equal(based.firstMissing(), 5);
  const fresh = new StreamLog(3, { seq: 4, tick: 50, gesture: 2 });
  assert.equal(fresh.receive([e(5, 51, PRESS, 2)], 5, 51, 60, 60).status, 'invalid', 'gesture below the base gesture');
  assert.deepEqual(fresh.receive([e(5, 51, PRESS, 3)], 5, 51, 60, 60), { status: 'accepted', added: [e(5, 51, PRESS, 3)], rollbackTo: 51 });
  assert.equal(fresh.latestGesture(), 3); assert.equal(new StreamLog(3, { seq: 4, tick: 50 }).entriesAfter(4, 50).length, 0);
});

test('retention keeps the newest 64 or two seconds, rotates every entry through packets and answers nacks', () => {
  const own = new StreamLog(1);
  for (let seq = 1; seq <= 100; seq++) own.append(seq, [STEER, seq % 4]);
  own.through = 100;
  assert.equal(own.retained().length, ROLLBACK_TICKS, 'two seconds of ticks');
  for (let seq = 101; seq <= 200; seq++) own.append(100, [AIM, seq, seq]);
  assert.equal(own.retained().length, RETAINED_ENTRIES);
  const seen = new Set<number>();
  for (let packets = 0; packets < 30; packets++) { const entries = own.packetEntries(); assert.equal(entries.length, PACKET_ENTRIES); assert.ok(entries.some(entry => entry[0] === 200)); for (const entry of entries) seen.add(entry[0]); }
  assert.equal(seen.size, RETAINED_ENTRIES, 'every retained entry recurs within a few packets');
  assert.deepEqual(own.repairEntries(150).map(entry => entry[0]), [150, 151, 152, 153, 154, 155]);
  assert.deepEqual(own.repairEntries(199).map(entry => entry[0]), [199, 200]); assert.deepEqual(own.repairEntries(10), [], 'older than the window cannot be repaired');
  own.prune(100); assert.equal(own.entries.size, 0);
  const small = new StreamLog(1); small.append(1, [STEER, 1]); small.append(2, [STEER, 0]); assert.deepEqual(small.packetEntries().map(entry => entry[0]), [1, 2]);
});

test('snapshot bases exclude entries after the snapshot tick and replay everything after the base', () => {
  const remote = new StreamLog(2);
  remote.receive([e(1, 10, PRESS, 1), e(2, 12, RELEASE, 1), e(3, 14, PRESS, 2), e(5, 16, STEER, 1)], 5, 16, 20, 20);
  assert.deepEqual(remote.baseAt(13), { seq: 2, tick: 13, gesture: 1 });
  assert.deepEqual(remote.entriesAfter(2).map(entry => entry[0]), [3, 5]);
  remote.prune(12); assert.deepEqual(remote.baseAt(13), { seq: 2, tick: 13, gesture: 1 });
  assert.deepEqual(remote.baseAt(20), { seq: 5, tick: 20, gesture: 2 }, 'a base past the gap folds the waiting entry by absence: the served world never applied seq 4 or 5');
});

test('a snapshot base at an earlier tick excludes presses appended for later ticks, and pruned presses raise it', () => {
  const own = new StreamLog(1); own.append(60, [STEER, 1]); own.append(76, [PRESS, 1]); own.append(77, [RELEASE, 1]);
  assert.deepEqual(own.baseAt(64), { seq: 1, tick: 64, gesture: 0 }, 'the press at 76 is after the base');
  assert.equal(own.baseAt(76).gesture, 1);
  const replica = new StreamLog(1, own.baseAt(64));
  assert.equal(replica.receive(own.entriesAfter(1, 64), 3, 80, 80, 64).status, 'accepted', 'the replayed press is not a reused gesture');
  own.through = 80; own.prune(76); assert.equal(own.baseAt(78).gesture, 1, 'a pruned press still counts for later bases');
});

test('confirmed completeness stops at the last contiguous entry when a gap hides where the missing entry belongs', () => {
  const remote = new StreamLog(1); assert.equal(remote.receive([e(1, 50, STEER, 1)], 1, 60, 60, 60).status, 'accepted');
  assert.equal(remote.receive([e(3, 80, STEER, 0)], 3, 90, 90, 90).status, 'accepted');
  assert.equal(remote.completeThrough(), 79, 'the stall rule may still run up to the buffered entry');
  assert.equal(remote.confirmedThrough(), 50, 'but nothing past the last contiguous entry is final: seq 2 may sit anywhere from 50 to 80');
  assert.equal(remote.receive([e(2, 70, STEER, 2)], 3, 90, 90, 90).status, 'accepted'); assert.equal(remote.confirmedThrough(), 90);
});
