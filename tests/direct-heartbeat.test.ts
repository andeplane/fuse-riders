import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectHeartbeat, decodeHeartbeat, heartbeatInitiator, isHeartbeat, type Heartbeat, type HeartbeatBody, type HeartbeatContext } from '../src/online/direct-heartbeat.js';
import { packMessage } from '../src/online/action-replication.js';
import { DirectTickClock } from '../src/online/direct-clock.js';

const empty = (): HeartbeatBody => [[], [], null, null];
const request = (id = 1, acknowledgement = 0): Heartbeat => [1, 7, 10, id, acknowledgement, empty()];
const reply = (id = 1, acknowledgement = 1): Heartbeat => [1, 7, 11, id, acknowledgement, empty()];

function pair(clock = false) {
  let now = 0;
  const sent: { from: string; at: number; packet: Heartbeat }[] = [], queue: { from: string; bytes: Uint8Array }[] = [];
  const accepted: { by: string; context: HeartbeatContext }[] = [];
  let allow: (from: string, packet: Heartbeat) => 'send' | 'drop' | 'reject' = () => 'send';
  const sides = new Map<string, DirectHeartbeat>();
  for (const id of ['a', 'b']) sides.set(id, new DirectHeartbeat(7, id, id === 'a' ? 'b' : 'a', clock ? 'b' : 'c', {
    now: () => now,
    body: ({ kind, id: nonce, acknowledgement }) => [[], [], clock ? kind === 10 ? [1, 7, 'clock', nonce] : [1, 7, 'time', acknowledgement, now / 50] : null, null],
    accept: (_body, context) => { accepted.push({ by: id, context }); return true; },
    send: bytes => {
      const packet = decodeHeartbeat(bytes)!; sent.push({ from: id, at: now, packet });
      const action = allow(id, packet); if (action === 'send') queue.push({ from: id, bytes: new Uint8Array(bytes) });
      return action !== 'reject';
    },
  }));
  function deliver() { while (queue.length) { const packet = queue.shift()!; sides.get(packet.from === 'a' ? 'b' : 'a')!.receive(packet.bytes); } }
  function advance(ms: number, qualifying = false) {
    const end = now + ms;
    do { for (const side of sides.values()) side.pump(qualifying); deliver(); if (now === end) break; now += Math.min(10, end - now); } while (now <= end);
  }
  return { a: sides.get('a')!, b: sides.get('b')!, sent, accepted, advance, deliver, setTime: (at: number) => { now = at; }, allow: (fn: typeof allow) => { allow = fn; } };
}

test('each pair elects one initiator, with the follower initiating clock exchanges', () => {
  assert.equal(heartbeatInitiator('a', 'b', 'c'), true);
  assert.equal(heartbeatInitiator('b', 'a', 'c'), false);
  assert.equal(heartbeatInitiator('z', 'a', 'a'), true);
  assert.equal(heartbeatInitiator('a', 'z', 'a'), false);
});

test('quiet healthy pairs exchange one request/reply per second and confirm both directions', () => {
  for (const clock of [false, true]) {
    const p = pair(clock); p.advance(0);
    assert.equal(p.a.lastConfirmedAt, 0);
    assert.equal(p.b.lastConfirmedAt, undefined, 'a request alone does not prove the responder can send');
    p.advance(999); assert.equal(p.sent.length, 2);
    p.advance(1); assert.equal(p.sent.length, 4);
    assert.equal(p.b.lastConfirmedAt, 1000, 'the next request acknowledges the previous reply');
    p.advance(9000);
    assert.equal(p.sent.filter(s => s.from === 'a').length, 11);
    assert.equal(p.sent.filter(s => s.from === 'b').length, 11);
    assert.equal(p.a.lastConfirmedAt, 10000); assert.equal(p.b.lastConfirmedAt, 10000);
    assert.ok(p.a.pendingCount <= 1); assert.ok(p.b.pendingCount <= 1);
  }
});

test('lost replies and rejected enqueues retry with fresh IDs then return to the quiet cadence', () => {
  for (const failure of ['drop', 'reject'] as const) {
    const p = pair(true); let failed = false;
    p.allow((from) => { if (!failed && from === (failure === 'drop' ? 'b' : 'a')) { failed = true; return failure; } return 'send'; });
    p.advance(0); p.advance(249);
    assert.equal(p.sent.filter(s => s.from === 'a').length, 1);
    p.advance(1);
    const requests = p.sent.filter(s => s.from === 'a');
    assert.deepEqual(requests.map(s => [s.at, s.packet[3]]), [[0, 1], [250, 2]]);
    assert.equal(p.a.lastConfirmedAt, 250);
    p.advance(999); assert.equal(p.sent.filter(s => s.from === 'a').length, 2);
    p.advance(1); assert.equal(p.sent.filter(s => s.from === 'a').length, 3);
  }
});

test('one-sided loss cannot keep the responder healthy with fresh requests alone', () => {
  const p = pair(); p.advance(1000); const confirmed = p.b.lastConfirmedAt;
  p.allow(from => from === 'b' ? 'drop' : 'send'); p.advance(10000);
  assert.equal(p.a.lastConfirmedAt, 1000);
  // The first request after the blackhole can still ACK the last pre-loss reply.
  assert.equal(p.b.lastConfirmedAt, 2000); assert.ok(p.b.lastConfirmedAt! > confirmed!);
  assert.ok(p.a.pendingCount <= 8); assert.ok(p.b.pendingCount <= 8);
  assert.equal(p.b.receive(packMessage(p.sent.at(-2)!.packet)).acknowledged, false);
});

test('replayed or reordered heartbeat IDs cannot reinstall data or refresh acknowledgement time', () => {
  const p = pair(); p.advance(1000);
  const count = p.accepted.length;
  assert.equal(p.a.receive(packMessage(p.sent[1].packet)).status, 'stale');
  assert.equal(p.b.receive(packMessage(p.sent[0].packet)).status, 'stale');
  assert.equal(p.accepted.length, count);
  assert.equal(p.a.lastConfirmedAt, 1000); assert.equal(p.b.lastConfirmedAt, 1000);
  assert.equal(p.b.receive(packMessage(request(100, 100))).status, 'invalid');
});

test('late or unsolicited replies cannot qualify a clock or link', () => {
  const p = pair(true); p.allow(() => 'drop'); p.advance(0); p.setTime(501);
  const packet: Heartbeat = [1, 7, 11, 1, 1, [[], [], [1, 7, 'time', 1, 10], null]];
  assert.equal(p.a.receive(packMessage(packet)).status, 'stale');
  assert.equal(p.a.lastConfirmedAt, undefined);
  packet[4] = 99; packet[5][2]![3] = 99;
  assert.equal(p.a.receive(packMessage(packet)).status, 'stale');
});

test('shape, nested alias/nonce, role and byte checks precede application acceptance', () => {
  const bad: unknown[] = [null, [], [1, 7, 10, 0, 0, empty()], [1, 0, 10, 1, 0, empty()], [1, 7, 12, 1, 0, empty()], [1, 7, 11, 1, 0, empty()], [...request(), 0], [1, 7, 10, 1, 0, [[], [], null]],
    [1, 7, 10, 1, 0, [[[0, 10, 1], [0, 10, 1]], [], null, null]],
    [1, 7, 10, 1, 0, [[], [[5, 1]], null, null]],
    [1, 7, 10, 1, 0, [[], [], [1, 8, 'clock', 1], null]],
    [1, 7, 10, 1, 0, [[], [], [1, 7, 'clock', 2], null]],
    [1, 7, 10, 1, 0, [[], [], [1, 7, 'time', 1, 10], null]],
    [1, 7, 10, 1, 0, [[], [], null, [1, 8, 'final', 10, [], '0'.repeat(16)]]]];
  for (const value of bad) { assert.equal(isHeartbeat(value), false); assert.equal(decodeHeartbeat(packMessage(value)), undefined); }
  assert.equal(decodeHeartbeat(new Uint8Array(513)), undefined);
  assert.equal(decodeHeartbeat(new Uint8Array([0xc1])), undefined);
  const p = pair();
  assert.equal(p.a.receive(packMessage(request())).status, 'invalid');
  assert.equal(p.b.receive(packMessage(reply())).status, 'invalid');
  assert.equal(p.b.receive(packMessage([1, 8, 10, 1, 0, empty()])).status, 'invalid');
  assert.equal(p.b.receive(packMessage([1, 7, 10, 1, 0, [[], [], [1, 7, 'clock', 1], null]])).status, 'invalid');
  assert.equal(p.accepted.length, 0);
});

test('a rejected application candidate consumes no incoming identity or health evidence', () => {
  let accepted = false, replies = 0;
  const receiver = new DirectHeartbeat(7, 'b', 'a', 'c', { now: () => 0, body: empty, accept: () => accepted, send: () => { replies++; return true; } });
  assert.equal(receiver.receive(packMessage(request())).status, 'invalid'); assert.equal(replies, 0);
  accepted = true;
  assert.equal(receiver.receive(packMessage(request())).status, 'accepted'); assert.equal(replies, 1);
  assert.equal(receiver.lastConfirmedAt, undefined);
});

test('fast qualification is bounded, stop clears attempts, and sequence exhaustion never wraps', () => {
  const p = pair(); p.allow(() => 'drop'); p.advance(4000, true);
  assert.equal(p.sent.length, 41); assert.ok(p.a.pendingCount <= 8);
  p.a.stop(); p.advance(10000); assert.equal(p.sent.length, 41); assert.equal(p.a.pendingCount, 0);
  assert.equal(p.a.receive(packMessage(reply())).status, 'stale');
  const ports = { now: () => 0, body: empty, accept: () => true, send: () => { throw new Error('Wrapped ID was sent'); } };
  const exhausted = new DirectHeartbeat(7, 'a', 'b', 'c', ports, 0xffffffff);
  exhausted.pump(); assert.equal(exhausted.exhausted, true);
  assert.throws(() => new DirectHeartbeat(0, 'a', 'b', 'c', ports));
  assert.throws(() => new DirectHeartbeat(7, 'a', 'a', 'c', ports));
  assert.throws(() => new DirectHeartbeat(7, 'a', 'b', 'c', { ...ports, now: () => NaN }));
});

test('maximum integer cuts, receipts and certificate fit the complete fast packet budget', () => {
  const n = 0xffffffff;
  const packet: Heartbeat = [1, n, 11, n, n, [Array.from({ length: 5 }, (_, slot) => [slot, n, n]), Array.from({ length: 5 }, (_, slot) => [slot, n]), [1, n, 'time', n, n - .125], [1, n, 'final', n, Array.from({ length: 5 }, (_, slot) => [slot, n]), 'f'.repeat(16)]]];
  assert.ok(isHeartbeat(packet)); const bytes = packMessage(packet);
  assert.ok(bytes.byteLength <= 512); assert.deepEqual(decodeHeartbeat(bytes), packet);
});


test('non-clock pairs accept delayed liveness evidence only within its 2.5 second window', () => {
  for (const age of [501, 2500, 2501]) {
    const p = pair(); p.allow(() => 'drop'); p.advance(0); p.setTime(age);
    const result = p.a.receive(packMessage(reply()));
    assert.equal(result.status, age <= 2500 ? 'accepted' : 'stale');
    assert.equal(result.acknowledged, age <= 2500);
    assert.equal(p.a.lastConfirmedAt, age <= 2500 ? age : undefined);
  }
});

test('stopping a scope inside application callbacks prevents sends and acknowledgement installation', () => {
  let sends = 0;
  const sender = new DirectHeartbeat(7, 'a', 'b', 'c', {
    now: () => 0, body: () => { sender.stop(); return empty(); }, accept: () => true,
    send: () => { sends++; return true; },
  });
  sender.pump(); assert.equal(sends, 0); assert.equal(sender.pendingCount, 0);
  const receiver = new DirectHeartbeat(7, 'a', 'b', 'c', {
    now: () => 0, body: empty, accept: () => { receiver.stop(); return true; }, send: () => true,
  });
  receiver.pump();
  assert.deepEqual(receiver.receive(packMessage(reply())), { status: 'stale', acknowledged: false });
  assert.equal(receiver.lastConfirmedAt, undefined); assert.equal(receiver.pendingCount, 0);
});

test('synchronous request and reply delivery preserves pending correlation and quiet cadence', () => {
  let now = 0, sends = 0;
  const sides = new Map<string, DirectHeartbeat>();
  for (const id of ['a', 'b']) sides.set(id, new DirectHeartbeat(7, id, id === 'a' ? 'b' : 'a', 'c', {
    now: () => now, body: empty, accept: () => true,
    send: bytes => { sends++; assert.equal(sides.get(id === 'a' ? 'b' : 'a')!.receive(bytes).status, 'accepted'); return true; },
  }));
  const a = sides.get('a')!, b = sides.get('b')!;
  a.pump(); assert.equal(a.lastConfirmedAt, 0); assert.equal(b.lastConfirmedAt, undefined);
  assert.equal(a.pendingCount, 0); assert.equal(b.pendingCount, 1);
  now = 250; a.pump(); assert.equal(sends, 2);
  now = 1000; a.pump(); assert.equal(sends, 4);
  assert.equal(a.lastConfirmedAt, 1000); assert.equal(b.lastConfirmedAt, 1000);
  assert.equal(a.pendingCount, 0); assert.equal(b.pendingCount, 1);
});


test('a responder stopped while constructing or sending its reply cannot establish remote proof', () => {
  for (const boundary of ['body', 'send']) {
    let stopping = false, sends = 0;
    const responder = new DirectHeartbeat(7, 'b', 'a', 'c', {
      now: () => 0,
      body: () => { if (stopping && boundary === 'body') responder.stop(); return empty(); },
      accept: () => true,
      send: () => { sends++; if (stopping && boundary === 'send') responder.stop(); return true; },
    });
    responder.receive(packMessage(request()));
    stopping = true;
    assert.deepEqual(responder.receive(packMessage(request(2, 1))), { status: 'stale', acknowledged: false });
    assert.equal(responder.pendingCount, 0); assert.equal(responder.lastConfirmedAt, undefined);
    assert.equal(sends, boundary === 'body' ? 1 : 2);
  }
});


test('one-second exchanges carry real correlated clock samples without separate probes', () => {
  let now = 0, sends = 0;
  const leader = DirectTickClock.coordinator(7, 100, () => now, 0);
  const follower = DirectTickClock.follower(7, 100, () => now);
  const queue: { to: string; bytes: Uint8Array; at: number }[] = [];
  const endpoints = new Map<string, DirectHeartbeat>();
  for (const id of ['a', 'b']) endpoints.set(id, new DirectHeartbeat(7, id, id === 'a' ? 'b' : 'a', 'b', {
    now: () => now,
    body: context => [[], [], id === 'a' ? follower.request(context.id)! : leader.reply(context.incoming![2])!, null],
    accept: body => id === 'b' || follower.accept(body[2]) === 'accepted',
    send: bytes => { sends++; queue.push({ to: id === 'a' ? 'b' : 'a', bytes, at: now + 20 }); return true; },
  }));
  for (now = 0; now <= 10040; now += 10) {
    leader.read(); const reading = follower.read();
    if (now > 40) assert.equal(reading.canOriginate, true);
    endpoints.get('a')!.pump(!reading.canOriginate);
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= now) {
      const packet = queue.splice(i, 1)[0];
      assert.equal(endpoints.get(packet.to)!.receive(packet.bytes).status, 'accepted');
    }
  }
  assert.equal(sends, 22);
  assert.equal(follower.outstandingProbes, 0);
  assert.equal(follower.read().tick, leader.read().tick);
  assert.ok(follower.read().uncertaintyTicks < 1);
});
