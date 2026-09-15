import test from 'node:test';
import assert from 'node:assert/strict';
import { encode } from '@msgpack/msgpack';
import { decodeFast, encodeFast, hashText, packFast, unpackFast, FAST_MESSAGE_BYTES, MAX_STREAMS_PER_PACKET, type FastMessage } from '../src/online/wire.js';
import { MAX_ENTRIES_PER_TICK, type LogEntry } from '../src/shared/action-log.js';

const roundTrip = (message: FastMessage) => { const bytes = encodeFast({ id: 7, epoch: 3, incarnation: hashText('room'), data: packFast(message) })!; const envelope = decodeFast(bytes)!; assert.deepEqual([envelope.id, envelope.epoch, envelope.incarnation], [7, 3, hashText('room')]); return { bytes, message: unpackFast(envelope.data) }; };

test('stream packets and repair requests round-trip and stay small', () => {
  const entries: LogEntry[] = [[41, 1200, 0, 1], [42, 1207, 2, 3], [43, 1220, 3, 3, 0.5, 0.25]];
  const packet: FastMessage = { type: 'streams', tick: 1221.5, sentAt: 123456.75, echoSentAt: 120000, hash: null, streams: [{ member: hashText('guest'), lastSeq: 43, entries }] };
  const own = roundTrip(packet); assert.deepEqual(own.message, packet); assert.ok(own.bytes.byteLength <= 96, `${own.bytes.byteLength} bytes`);
  const idle: FastMessage = { type: 'streams', tick: 1221, sentAt: 1, echoSentAt: null, hash: null, streams: [{ member: 1, lastSeq: 43, entries: [] }] };
  assert.ok(roundTrip(idle).bytes.byteLength <= 24);
  const relay: FastMessage = { type: 'streams', tick: 30.25, sentAt: 9, echoSentAt: 8, hash: '0123456789abcdef', streams: [{ member: 1, lastSeq: 2, entries: [[1, 5, 10, 'guest', 'Guest', 1, null], [2, 6, 14, 'start', 'm']] }, { member: 2, lastSeq: 0, entries: [] }] };
  assert.deepEqual(roundTrip(relay).message, relay);
  const repair: FastMessage = { type: 'repair', member: 5, firstMissingSeq: 12 }; assert.deepEqual(roundTrip(repair).message, repair);
});
test('malformed and oversized packets are rejected before anything is applied', () => {
  assert.equal(decodeFast(new Uint8Array(FAST_MESSAGE_BYTES + 1)), undefined);
  assert.equal(decodeFast(encode('text')), undefined); assert.equal(decodeFast(encode([1, 2])), undefined); assert.equal(decodeFast(encode(['a', 1, 2, null])), undefined);
  assert.equal(decodeFast(new Uint8Array([0xc1, 0xc1])), undefined);
  for (const bad of [null, 7, [], [9], [6], [6, -1, 0, null, null, []], [6, 1, 1, null, 'zz', []], [6, 1, 1, null, null, [[1, 1, [[0, 0, 0, 1]]]]], [6, 1, 1, null, null, [[1, 1, [[1, 0, 0, 9]]]]], [6, 1, 1, null, null, [['x', 1, []]]], [6, 1, 1, null, null, Array.from({ length: 9 }, () => [1, 1, []])], [7, 1, 0], [7, 1]]) assert.equal(unpackFast(bad), undefined, JSON.stringify(bad));
  assert.equal(unpackFast([6, 1, 1, null, null, [[1, 1, Array.from({ length: MAX_ENTRIES_PER_TICK + 1 }, (_, i) => [i + 1, 1, 0, 1])]]]), undefined, 'too many entries');
});
test('a packet at the protocol maximum still fits the unreliable channel, and an oversized one is refused at the sender', () => {
  const entries: LogEntry[] = Array.from({ length: MAX_ENTRIES_PER_TICK }, (_, i) => [i + 1, 1200 + i, 3, 3, 0.5, 0.25]);
  const biggest: FastMessage = { type: 'streams', tick: 1221.5, sentAt: 123456.75, echoSentAt: 120000, hash: '0123456789abcdef', streams: Array.from({ length: MAX_STREAMS_PER_PACKET }, (_, i) => ({ member: hashText(`m${i}`), lastSeq: MAX_ENTRIES_PER_TICK, entries })) };
  const full = roundTrip(biggest);
  assert.ok(full.bytes.byteLength <= FAST_MESSAGE_BYTES, `${full.bytes.byteLength} bytes would be dropped by the receiver`);
  assert.deepEqual(full.message, biggest);
  // Management bodies carry member ids and names, so bytes and not entry counts are what the sender has to check.
  const joins: LogEntry[] = Array.from({ length: MAX_ENTRIES_PER_TICK }, (_, i) => [i + 1, 1200 + i, 10, 'm'.repeat(128), 'A name this long', 1, null]);
  const heavy: FastMessage = { ...biggest, streams: biggest.streams.map(s => ({ ...s, entries: joins })) };
  assert.equal(encodeFast({ id: 7, epoch: 3, incarnation: 1, data: packFast(heavy) }), undefined, 'the sender refuses what the receiver would drop');
});
