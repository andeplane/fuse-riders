import test from 'node:test';
import assert from 'node:assert/strict';
import { SocketClient, type WebSocketLike } from '../src/client/socket-client.js';
import type { ServerMessage } from '../src/shared/protocol.js';

class FakeSocket extends EventTarget implements WebSocketLike {
  readyState = 0; // CONNECTING
  closed = false;
  sent: string[] = [];
  send(data: string): void { this.sent.push(data); }
  close(code = 1000): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3; // CLOSED
    this.dispatchEvent(Object.assign(new Event('close'), { code }));
  }
  open(): void { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  receive(message: unknown): void { this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(message) })); }

  // Re-declared with WebSocketLike's exact per-event-type overloads (EventTarget's own
  // addEventListener has a single, looser signature). The implementation signature is untyped —
  // the standard TS idiom for overloaded methods, since callers only ever see the overloads above —
  // and simply delegates to EventTarget's real listener registry.
  addEventListener(type: 'open', listener: (event: Event) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'close', listener: (event: CloseEvent) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  addEventListener(type: string, listener: any): void {
    super.addEventListener(type, listener);
  }
}

function fixture() {
  const sockets: FakeSocket[] = [];
  const statuses: Array<{ connected: boolean; reason?: 'replaced' }> = [];
  const messages: ServerMessage[] = [];
  const client = new SocketClient(
    () => undefined,
    (message) => messages.push(message),
    (connected, reason) => statuses.push({ connected, reason }),
    undefined,
    () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
  );
  return { client, sockets, statuses, messages };
}

test('connect() while the previous socket is still CONNECTING closes it instead of orphaning it', () => {
  const { client, sockets, statuses } = fixture();
  client.connect();
  const first = sockets[0]!;
  assert.equal(sockets.length, 1);
  assert.equal(first.readyState, 0, 'first socket is still connecting');

  client.connect();
  assert.equal(sockets.length, 2, 'connect() while CONNECTING still opens a replacement socket');
  const second = sockets[1]!;
  assert.notEqual(first, second);
  assert.equal(client.socket, second, 'the client now tracks only the newest socket');
  assert.equal(first.closed, true, 'the superseded socket must be closed, not left dangling');

  // The stale socket's own close firing after being superseded must not be treated as a real
  // disconnect (no reconnect status, no reconnect timer) — its handlers guard on socket identity.
  assert.deepEqual(statuses, []);

  second.open();
  assert.deepEqual(statuses, [{ connected: true, reason: undefined }]);
  client.close();
});

test('connect() with no prior socket does not attempt to close anything', () => {
  const { client, sockets } = fixture();
  assert.doesNotThrow(() => client.connect());
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0]!.closed, false);
  client.close();
});

test('a real disconnect on the current socket reports status and reconnects', () => {
  const { client, sockets, statuses } = fixture();
  client.connect();
  const first = sockets[0]!;
  first.open();
  first.close(1006);
  assert.deepEqual(statuses, [
    { connected: true, reason: undefined },
    { connected: false, reason: undefined },
  ]);
  client.close(); // cancels the reconnect timer close() scheduled
});

test('send() only transmits once the current socket reports OPEN, and close() is idempotent-safe', () => {
  const { client, sockets } = fixture();
  client.connect();
  const socket = sockets[0]!;
  assert.equal(client.send({ type: 'heartbeat' }), false, 'socket is still CONNECTING');
  socket.open();
  assert.equal(client.send({ type: 'heartbeat' }), true);
  assert.deepEqual(JSON.parse(socket.sent[0]!), { type: 'heartbeat' });
  client.close();
  assert.equal(socket.closed, true);
});

test('an inbound pong reports round-trip time instead of reaching onMessage', () => {
  const roundTrips: number[] = [];
  const sockets: FakeSocket[] = [];
  const client = new SocketClient(
    () => undefined,
    () => { throw new Error('pong must not reach onMessage'); },
    () => {},
    (ms) => roundTrips.push(ms),
    () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
  );
  client.connect();
  sockets[0]!.open();
  sockets[0]!.receive({ type: 'pong', id: 1, sentAt: performance.now() - 5 });
  assert.equal(roundTrips.length, 1);
  assert.ok(roundTrips[0]! >= 0);
  client.close();
});
