import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectOrigin, type OriginInput, type OriginResult } from '../src/online/direct-origin.js';
import { DirectTickClock } from '../src/online/direct-clock.js';
import { decodeDirectPacket, DirectDelivery, DirectStream } from '../src/online/direct-stream.js';
import { packMessage, unpackMessage } from '../src/online/action-replication.js';
import { isDirectAction } from '../src/shared/direct-input.js';

const input = (revision: number, change: Partial<OriginInput> = {}): OriginInput => ({ revision, left: false, right: false, bomb: false, aim: null, ...change });
function accepted(result: OriginResult): Extract<OriginResult, { status: 'accepted' }> { assert.equal(result.status, 'accepted'); return result; }

test('held controls emit only edges, with independent wire and UI sequence numbering', () => {
  let origin = DirectOrigin.start(7, 0, 100);
  let update = accepted(origin.prepare(input(0, { left: true }), 100.2));
  assert.deepEqual(update.actions, [[1, 101, 0, 1]]); origin = update.origin;
  for (let revision = 1; revision < 100; revision++) {
    update = accepted(origin.prepare(input(revision, { left: true }), 100 + revision / 2));
    assert.deepEqual(update.actions, []); origin = update.origin;
  }
  update = accepted(origin.prepare(input(100), 150));
  assert.deepEqual(update.actions, [[2, 151, 0, 0]]);
  assert.equal(update.origin.prepare(input(100), 150).status, 'stale');
  assert.equal(update.origin.prepare(input(99, { left: true }), 150).status, 'stale');
});

test('a local change group is atomic until the caller installs the candidate', () => {
  const origin = DirectOrigin.start(7, 2, 100);
  const frame = input(0, { left: true, bomb: true, bombAction: 'press', aim: [-0, .5] });
  const first = accepted(origin.prepare(frame, 100.5));
  assert.deepEqual(first.actions, [[1, 101, 0, 1], [2, 101, 4, [0, .5]], [3, 101, 1, 1]]);
  // A rejected downstream candidate has emitted nothing and consumed no sequence/gesture.
  assert.deepEqual(accepted(origin.prepare(frame, 100.5)).actions, first.actions);
  const release = accepted(first.origin.prepare(input(1, { bombAction: 'release', aim: [.9, .8] }), 100.9));
  assert.deepEqual(release.actions, [[4, 101, 0, 0], [5, 101, 2, 1, [.9, .8]]]);
  const restored = unpackMessage(packMessage([...first.actions, ...release.actions]));
  assert.ok(Array.isArray(restored) && restored.every(isDirectAction));
  const stream = new DirectStream({ sequence: 0, tick: 100, gesture: 0 }).receive(restored, null, 101);
  assert.equal(stream.status, 'accepted');
});

test('all subscriber candidates admit a full group before bytes, and failed enqueue retains it for repair', () => {
  const queues = [new DirectDelivery(7, 0, 100), new DirectDelivery(7, 0, 100)];
  const origin = DirectOrigin.start(7, 0, 100);
  const group = accepted(origin.prepare(input(0, { left: true, bomb: true, bombAction: 'press', aim: [.2, .4] }), 100));
  const candidates = queues.map(q => q.prepare(group.actions));
  assert.ok(candidates.every(q => q !== undefined));
  assert.deepEqual(queues.map(q => q.retainedRecords), [0, 0]);
  const received: Uint8Array[] = [];
  candidates[0].publish(group.actions, 0, bytes => { received.push(bytes); return true; });
  candidates[1].publish(group.actions, 0, () => false);
  assert.deepEqual(decodeDirectPacket(received[0])?.[3], group.actions);
  assert.deepEqual(candidates.map(q => q.retainedRecords), [3, 3]);
  candidates[1].pump(49, bytes => { received.push(bytes); return true; }); assert.equal(received.length, 1);
  candidates[1].pump(50, bytes => { received.push(bytes); return true; });
  assert.deepEqual(decodeDirectPacket(received[1])?.[3], group.actions);
  assert.equal(candidates[0].prepare([[4, 101, 0, 0], [6, 101, 1, 2]]), undefined);
  assert.equal(candidates[0].retainedRecords, 3);
  assert.equal(candidates[0].prepare(Array(4).fill(group.actions[0])), undefined);
  // A caller cannot publish an unadmitted group or substitute content for an admitted sequence.
  candidates[0].publish([[4, 101, 0, 0]], 0, () => { throw new Error('Unadmitted send'); });
  candidates[0].publish([], 0, () => { throw new Error('Empty send'); });
});

test('press replacement, missing press, release and neutral cancellation preserve gesture semantics', () => {
  let origin = DirectOrigin.start(7, 0, 10);
  let update = accepted(origin.prepare(input(0, { bomb: true }), 10));
  assert.deepEqual(update.actions, []); origin = update.origin;
  update = accepted(origin.prepare(input(1, { bombAction: 'release' }), 10));
  assert.deepEqual(update.actions, []); origin = update.origin;
  update = accepted(origin.prepare(input(2, { bomb: true, bombAction: 'press' }), 10));
  assert.deepEqual(update.actions, [[1, 11, 1, 1]]); origin = update.origin;
  update = accepted(origin.prepare(input(3, { bomb: true, bombAction: 'press' }), 10));
  assert.deepEqual(update.actions, [[2, 11, 1, 2]]); origin = update.origin;
  update = accepted(origin.prepare(input(4), 10));
  assert.deepEqual(update.actions, [[3, 11, 3, 2]]); origin = update.origin;
  update = accepted(origin.prepare(input(5, { bomb: true, bombAction: 'press' }), 11)); origin = update.origin;
  update = accepted(origin.prepare(input(6, { bombAction: 'cancel' }), 11));
  assert.deepEqual(update.actions, [[5, 12, 3, 3]]);
});

test('origin exact cuts cannot cover future actions or permit a later action before the cut', () => {
  const first = accepted(DirectOrigin.start(7, 0, 10).prepare(input(0, { right: true }), 10));
  assert.deepEqual(first.origin.advanceWatermark(10)?.watermark, [10, 0]);
  let origin = first.origin.advanceWatermark(11)!;
  assert.deepEqual(origin.watermark, [11, 1]);
  let second = accepted(origin.prepare(input(1), 10.9));
  assert.deepEqual(second.actions, [[2, 12, 0, 0]]);
  origin = second.origin.advanceWatermark(14)!;
  assert.deepEqual(origin.watermark, [14, 2]);
  assert.equal(origin.prepare(input(2, { left: true }), 10).status, 'invalid');
  second = accepted(origin.prepare(input(2, { left: true }), 11));
  assert.deepEqual(second.actions, [[3, 15, 0, 1]]);
  assert.equal(origin.advanceWatermark(13), undefined);
  assert.equal(origin.advanceWatermark(Infinity), undefined);
  const copy = origin.watermark; copy[0] = 0; assert.deepEqual(origin.watermark, [14, 2]);
});

test('invalid local frames and exhausted ticks consume neither revisions nor actions', () => {
  const origin = DirectOrigin.start(7, 0, 10);
  for (const bad of [input(-1), input(0, { bombAction: 'press' }), input(0, { bomb: true, bombAction: 'release' }), input(0, { bomb: true, bombAction: 'cancel' }), input(0, { aim: [NaN, 0] }), input(0, { aim: [2, 0] })]) assert.equal(origin.prepare(bad, 10).status, 'invalid');
  for (const badTick of [NaN, Infinity, -1, 2 ** 32]) assert.equal(origin.prepare(input(0), badTick).status, 'invalid');
  assert.deepEqual(accepted(origin.prepare(input(0, { left: true }), 10)).actions, [[1, 11, 0, 1]]);
  assert.equal(DirectOrigin.start(7, 0, 0xffff_ffff).prepare(input(0), 0xffff_ffff).status, 'exhausted');
  for (const [segment, slot, tick] of [[0, 0, 0], [7, 5, 0], [7, 0, -1]]) assert.throws(() => DirectOrigin.start(segment, slot, tick));
});

test('future start requires coordinator confirmation, and both clocks advance without gameplay packets', () => {
  let now = 0;
  const leader = DirectTickClock.coordinator(7, 100, () => now, 200);
  const follower = DirectTickClock.follower(7, 100, () => now);
  assert.equal(follower.read().reason, 'sampling');
  assert.equal(leader.read().reason, 'waiting');
  const early = follower.request()!;
  assert.equal(follower.accept(unpackMessage(packMessage(leader.reply(early)))), 'accepted');
  now = 250;
  assert.equal(follower.read().canOriginate, false); // Extrapolation alone is not start confirmation.
  assert.equal(leader.read().tick, 101);
  assert.equal(follower.accept(leader.reply(follower.request()!)), 'accepted');
  assert.equal(follower.read().reason, 'ready');
  now = 500;
  assert.equal(follower.read().tick, 106); assert.equal(leader.read().tick, 106);
  assert.equal(follower.reply(early), undefined); assert.equal(leader.request(), undefined);
});

test('lowest RTT filtering tolerates valid asymmetric delay without a false four-tick fault', () => {
  let now = 0;
  const clock = DirectTickClock.follower(7, 100, () => now);
  let probe = clock.request()!;
  assert.equal(clock.accept([1, 7, 'time', probe[3], 100]), 'accepted');
  probe = clock.request()!;
  now = 480; // Almost all latency is on the reply: midpoint is 4.8 ticks behind true time.
  assert.equal(clock.accept([1, 7, 'time', probe[3], 100]), 'accepted');
  assert.equal(clock.read().fractionalTick, 109.6);
  now = 500;
  assert.equal(clock.read().fractionalTick, 110);
  probe = clock.request()!;
  now = 980; // Almost all latency is on request: opposite midpoint uncertainty.
  assert.equal(clock.accept([1, 7, 'time', probe[3], 119.6]), 'accepted');
  assert.equal(clock.read().reason, 'ready');
  assert.ok(Math.abs(clock.read().fractionalTick - 119.6) < 1e-10);
});

test('running clock slews in either direction at one tick per second and never moves backward', () => {
  for (const offset of [-3, 3]) {
    let now = 0;
    const clock = DirectTickClock.follower(7, 100, () => now);
    let probe = clock.request()!;
    assert.equal(clock.accept([1, 7, 'time', probe[3], 100]), 'accepted');
    now = 100; clock.read(); probe = clock.request()!;
    assert.equal(clock.accept([1, 7, 'time', probe[3], 102 + offset]), 'accepted');
    // Age-grown uncertainty now prefers the equally fast, newer sample.
    let previous = clock.read().fractionalTick;
    for (now = 200; now <= 1000; now += 100) {
      const next = clock.read().fractionalTick; assert.ok(Math.abs(next - (previous + 2 + Math.sign(offset) * .1)) < 1e-9); previous = next;
    }
    const before = previous;
    const next = clock.read().fractionalTick;
    assert.ok(Math.abs(next - (before + 2 + Math.sign(offset) * .1)) < 1e-9);
    assert.ok(next > previous);
  }
});

test('scope fences, expired and reordered replies cannot move time or refresh readiness', () => {
  let now = 0;
  const clock = DirectTickClock.follower(7, 100, () => now);
  const first = clock.request()!, second = clock.request()!;
  assert.equal(clock.accept([1, 8, 'time', second[3], 100]), 'invalid');
  assert.equal(clock.accept([1, 7, 'time', second[3], Infinity]), 'invalid');
  assert.equal(clock.accept([1, 7, 'time', 99, 100]), 'stale');
  assert.equal(clock.accept([1, 7, 'time', second[3], 100]), 'accepted');
  assert.equal(clock.accept([1, 7, 'time', first[3], 999]), 'stale');
  for (let i = 0; i < 20; i++) clock.request();
  assert.equal(clock.outstandingProbes, 8);
  const expired = clock.request()!;
  now = 501;
  assert.equal(clock.accept([1, 7, 'time', expired[3], 110]), 'stale');
  assert.equal(clock.outstandingProbes, 0);
  now = 1001; assert.equal(clock.read().reason, 'ready');
  now = 2001; assert.equal(clock.read().reason, 'ready');
  now = 2500; assert.equal(clock.read().reason, 'ready');
  now = 2501;
  assert.equal(clock.read().reason, 'stale'); assert.equal(clock.read().canAdvance, true);
  assert.equal(clock.read(true).canAdvance, false); assert.equal(clock.read().canOriginate, false);
});

test('discrepancy and monotonic-clock faults stay latched, including on the coordinator', () => {
  let now = 0;
  const clock = DirectTickClock.follower(7, 100, () => now);
  let probe = clock.request()!; assert.equal(clock.accept([1, 7, 'time', probe[3], 100]), 'accepted');
  probe = clock.request()!; assert.equal(clock.accept([1, 7, 'time', probe[3], 105]), 'fault');
  assert.equal(clock.read().reason, 'discrepancy'); assert.equal(clock.request(), undefined);
  assert.equal(clock.accept([1, 7, 'time', probe[3], 100]), 'fault');
  for (const jump of [-1, 1001, NaN]) {
    now = 0; const leader = DirectTickClock.coordinator(7, 100, () => now, 0); now = jump;
    assert.equal(leader.read().reason, 'clock-jump'); now = 1;
    assert.equal(leader.read().canAdvance, false); assert.equal(leader.reply([1, 7, 'clock', 1]), undefined);
  }
  now = 0;
  const last = DirectTickClock.coordinator(7, 0xffff_ffff, () => now, 0); now = 50;
  assert.equal(last.read().reason, 'exhausted');
  assert.throws(() => DirectTickClock.coordinator(7, 100, () => now, now + 1001));
  assert.throws(() => DirectTickClock.follower(0, 100, () => now));
});

test('stale baseline recovery remains conservative, and a failed release cannot revive after a fresh sample', () => {
  let now = 0;
  const clock = DirectTickClock.follower(7, 100, () => now);
  let probe = clock.request()!; clock.accept([1, 7, 'time', probe[3], 100]);
  let origin = accepted(DirectOrigin.start(7, 0, 100).prepare(input(0, { bomb: true, bombAction: 'press' }), clock.read().fractionalTick)).origin;
  now = 600; clock.read(); now = 1500; clock.read(); now = 2500; clock.read(); now = 2501;
  assert.equal(clock.read(true).canOriginate, false);
  origin = origin.suspend(); // Runtime invalidates this scope when the release cannot be timestamped.
  assert.equal(origin.advanceWatermark(150), undefined);
  probe = clock.request()!; assert.equal(clock.accept([1, 7, 'time', probe[3], 150.02]), 'accepted');
  assert.equal(clock.read().canOriginate, true);
  assert.equal(origin.prepare(input(1, { bombAction: 'release' }), clock.read().fractionalTick).status, 'suspended');
  const freshOrigin = DirectOrigin.start(8, 0, 121);
  assert.deepEqual(accepted(freshOrigin.prepare(input(2, { bombAction: 'release' }), 121)).actions, []);
  now = 3400; clock.read(); now = 4300; clock.read(); now = 5200; clock.read();
  probe = clock.request()!; assert.equal(clock.accept([1, 7, 'time', probe[3], 211]), 'fault');
});

test('origin bounds unpublished tick frontiers and publishing a cut restores capacity atomically', () => {
  let origin = DirectOrigin.start(7, 0, 0);
  for (let revision = 0; revision < 63; revision++) {
    const prepared = origin.prepare({ revision, left: revision % 2 === 0, right: false, bomb: false, aim: null }, revision);
    assert.equal(prepared.status, 'accepted'); if (prepared.status === 'accepted') origin = prepared.origin;
  }
  const frame = { revision: 63, left: false, right: false, bomb: false, aim: null };
  assert.equal(origin.prepare(frame, 63).status, 'exhausted'); assert.equal(origin.revision, 62);
  const progressed = origin.advanceWatermark(32)!;
  assert.deepEqual(progressed.watermark, [32, 32]);
  const accepted = progressed.prepare(frame, 63);
  assert.equal(accepted.status, 'accepted');
  if (accepted.status === 'accepted') assert.deepEqual(accepted.actions, [[64, 64, 0, 0]]);
  assert.deepEqual(origin.watermark, [0, 0]);
});

test('expiry cannot turn an uncertain idle clock into a qualified projection', () => {
  let now = 0; const clock = DirectTickClock.follower(7, 65, () => now);
  let probe = clock.request()!; now = 490;
  assert.equal(clock.accept([1, 7, 'time', probe[3], 65]), 'accepted'); assert.equal(clock.read().canOriginate, true);
  probe = clock.request()!; now = 970;
  assert.equal(clock.accept([1, 7, 'time', probe[3], 84.4]), 'accepted'); assert.equal(clock.read().reason, 'uncertain');
  now = 1500; assert.equal(clock.read().canAdvance, false);
  now = 1980; clock.read(); now = 2900; clock.read(); now = 3471; assert.equal(clock.read().reason, 'uncertain'); assert.equal(clock.read().canAdvance, false); assert.equal(clock.read().canOriginate, false);
  assert.ok(clock.read().uncertaintyTicks > 5);
});


test('uncertainty admission persists even when no read occurs before samples expire', () => {
  let now = 0; const clock = DirectTickClock.follower(7, 65, () => now);
  let probe = clock.request()!; now = 490;
  assert.equal(clock.accept([1, 7, 'time', probe[3], 65]), 'accepted');
  probe = clock.request()!; now = 970;
  assert.equal(clock.accept([1, 7, 'time', probe[3], 84.4]), 'accepted');
  now = 1500; clock.request(); now = 1980; clock.request(); now = 2900; clock.request(); now = 3471; clock.request();
  assert.equal(clock.read().reason, 'uncertain'); assert.equal(clock.read().canAdvance, false);
});


test('heartbeat nonces are unique, bounded and correlated with pending clock samples', () => {
  let now = 0; const clock = DirectTickClock.follower(7, 100, () => now);
  assert.deepEqual(clock.request(42), [1, 7, 'clock', 42]);
  for (const nonce of [42, 41, 0, -1, 2 ** 32, NaN]) assert.equal(clock.request(nonce), undefined);
  assert.equal(clock.outstandingProbes, 1);
  assert.equal(clock.accept([1, 7, 'time', 41, 100]), 'stale');
  now = 500; assert.equal(clock.accept([1, 7, 'time', 42, 100]), 'accepted');
  assert.equal(clock.read().reason, 'uncertain');
  // In-flight drift already exhausts a maximum-RTT sample's uncertainty margin.
  now = 501; assert.equal(clock.read().reason, 'uncertain');
  assert.ok(Math.abs(clock.read().uncertaintyTicks - 5.00501) < 1e-9);
  assert.deepEqual(clock.request(0xffff_ffff), [1, 7, 'clock', 0xffff_ffff]);
  assert.equal(clock.request(), undefined); assert.equal(clock.read().reason, 'exhausted');
});

test('quiet clock projection grows drift uncertainty and retains it after sample expiry', () => {
  let now = 0; const clock = DirectTickClock.follower(7, 100, () => now);
  const probe = clock.request(1)!;
  now = 100; assert.equal(clock.accept([1, 7, 'time', probe[3], 101]), 'accepted');
  for (now = 600; now <= 2600; now += 500) {
    const reading = clock.read(); assert.equal(reading.reason, 'ready');
    assert.ok(Math.abs(reading.uncertaintyTicks - (1 + now * .00001)) < 1e-9);
  }
  now = 2601; const stale = clock.read(); assert.equal(stale.reason, 'stale');
  assert.ok(stale.uncertaintyTicks > 1.026);
  now = 3101; assert.ok(clock.read().uncertaintyTicks > stale.uncertaintyTicks);
});


test('drift during an asymmetric clock exchange remains inside the reported interval', () => {
  let followerNow = 0;
  const clock = DirectTickClock.follower(7, 100, () => followerNow);
  const probe = clock.request()!;
  // Request arrives immediately; the reply is delayed 500 ms while the remote
  // oscillator advances 500 ppm faster than the observing follower's clock.
  const tickAtReply = 100;
  followerNow = 500;
  const actualRemoteTick = tickAtReply + followerNow * 1.0005 / 50;
  assert.equal(clock.accept([1, 7, 'time', probe[3], tickAtReply]), 'accepted');
  const reading = clock.read();
  assert.ok(Math.abs(actualRemoteTick - reading.fractionalTick) <= reading.uncertaintyTicks + 1e-10);
  assert.equal(reading.reason, 'uncertain'); assert.equal(reading.canOriginate, false);
});
