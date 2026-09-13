import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer, catchUpSteps } from '../src/server/index.js';
import { eliminatePlayer } from '../src/shared/game.js';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol.js';

class Peer {
  messages: ServerMessage[] = [];
  waiters: (() => void)[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on('message', raw => { this.messages.push(JSON.parse(raw.toString()) as ServerMessage); this.waiters.splice(0).forEach(w => w()); });
  }
  send(message: ClientMessage) { this.socket.send(JSON.stringify(message)); }
  async take<T extends ServerMessage['type']>(type: T, predicate: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + 2000;
    while (true) {
      const index = this.messages.findIndex(m => m.type === type && predicate(m as Extract<ServerMessage, { type: T }>));
      if (index >= 0) return this.messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${type}: ${JSON.stringify(this.messages)}`);
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, 20); this.waiters.push(() => { clearTimeout(timer); resolve(); }); });
    }
  }
  async flush() { this.send({ type: 'hostAction', action: 'start' }); await this.take('error', x => x.code === 'unauthorized'); }
}

async function fixture() {
  let now = 0; let nonce = 0;
  const app = await createGameServer({ port: 0, hostname: '127.0.0.1', lanAddress: '127.0.0.1', manualTicks: true,
    dependencies: { now: () => now, token: () => (++nonce).toString(16).padStart(48, '0') } });
  const peers: Peer[] = [];
  async function connect() {
    const peer = new Peer(new WebSocket(`ws://127.0.0.1:${app.port}/ws`)); peers.push(peer);
    await once(peer.socket, 'open'); await peer.take('snapshot'); return peer;
  }
  async function join(name: string) {
    const peer = await connect(); peer.send({ type: 'join', name });
    const joined = await peer.take('joined'); return { peer, joined };
  }
  async function host() { const peer = await connect(); peer.send({ type: 'hostAuth', token: app.hostToken }); await peer.take('hostAuthenticated'); return peer; }
  return { app, connect, join, host, elapse: (ms: number) => { now += ms; }, async close() { peers.forEach(p => p.socket.terminate()); await app.close(); } };
}

test('five seats, sixth denial, full public snapshots and private host control', async () => {
  const f = await fixture();
  try {
    const host = await f.host();
    host.send({ type: 'hostAction', action: 'start' }); assert.equal((await host.take('error')).code, 'not_enough_players');
    const players = [];
    for (let i = 0; i < 5; i++) players.push(await f.join(`P${i}`));
    const sixth = await f.connect(); sixth.send({ type: 'join', name: 'P6' }); assert.equal((await sixth.take('error')).code, 'full');
    const badHost = await f.connect(); badHost.send({ type: 'hostAuth', token: 'f'.repeat(48) }); assert.equal((await badHost.take('error')).code, 'unauthorized');
    badHost.send({ type: 'input', seq: 0, left: true, right: false, bomb: false }); assert.equal((await badHost.take('error')).code, 'unauthorized');
    players[0].peer.send({ type: 'hostAuth', token: f.app.hostToken }); assert.equal((await players[0].peer.take('error')).code, 'unauthorized');
    host.send({ type: 'hostAction', action: 'start' });
    const countdown = await host.take('snapshot', m => m.state.phase === 'countdown');
    assert.equal(countdown.state.players.length, 5);
    const publicJson = JSON.stringify(countdown);
    assert.ok(!publicJson.includes(f.app.hostToken));
    for (const p of players) assert.ok(!publicJson.includes(p.joined.playerToken));
    const config = await (await fetch(`http://127.0.0.1:${f.app.port}/api/config`)).json() as { controllerUrl: string };
    assert.equal(config.controllerUrl, f.app.controllerUrl); assert.ok(!config.controllerUrl.includes('#'));
    assert.equal((await fetch(`http://127.0.0.1:${f.app.port}/missing-file`)).status, 404);
    host.send({ type: 'hostAction', action: 'start' }); assert.equal((await host.take('error')).code, 'invalid_phase');
    f.app.advance(60); assert.equal(f.app.game.phase, 'playing');
  } finally { await f.close(); }
});

test('reconnect replaces the same seat, sequences continue, stale input becomes neutral, rapid bomb taps survive', async () => {
  const f = await fixture();
  try {
    const host = await f.host(); const a = await f.join('Alice'); await f.join('Bob');
    host.send({ type: 'hostAction', action: 'start' }); await host.take('snapshot', s => s.state.phase === 'countdown'); f.app.advance(60);
    a.peer.send({ type: 'input', seq: 3, left: true, right: false, bomb: true });
    a.peer.send({ type: 'input', seq: 4, left: true, right: false, bomb: false }); await a.peer.flush();
    f.app.advance(); assert.equal(f.app.game.bombs.size, 1);
    a.peer.send({ type: 'input', seq: 4, left: false, right: false, bomb: true }); assert.equal((await a.peer.take('error')).code, 'stale');
    const player = f.app.game.players.get(a.joined.playerId)!;
    f.app.advance(10); const angle = player.angle; f.app.advance(); assert.equal(player.angle, angle);
    const oldClosed = once(a.peer.socket, 'close');
    const replacement = await f.connect(); replacement.send({ type: 'join', name: 'Alice', playerToken: a.joined.playerToken });
    const joined = await replacement.take('joined'); await oldClosed;
    assert.equal(joined.playerId, a.joined.playerId); assert.equal(joined.nextInputSeq, 5); assert.equal(f.app.game.players.size, 2);
    replacement.send({ type: 'input', seq: joined.nextInputSeq, left: false, right: true, bomb: false }); await replacement.flush();
    f.app.advance(); assert.notEqual(player.angle, angle);
    const closed = once(replacement.socket, 'close'); replacement.socket.close(); await closed;
    // The following handshake is ordered after the disconnect callback has run.
    const spectator = await f.connect(); spectator.send({ type: 'heartbeat' });
    f.app.advance(); const disconnectedAngle = player.angle; f.app.advance(); assert.equal(player.angle, disconnectedAngle); assert.equal(player.connected, false);
  } finally { await f.close(); }
});

test('admission rejects late/invalid joins, leave frees lobby seats and eliminates during play', async () => {
  const f = await fixture();
  try {
    const invalid = await f.connect(); invalid.send({ type: 'join', name: 'Wrong', playerToken: 'f'.repeat(48) }); assert.equal((await invalid.take('error')).code, 'unauthorized');
    invalid.socket.send('{'); assert.equal((await invalid.take('error')).code, 'invalid_message');
    const a = await f.join('A'); a.peer.send({ type: 'join', name: 'again' }); assert.equal((await a.peer.take('error')).code, 'unauthorized');
    a.peer.send({ type: 'leave' }); await a.peer.take('snapshot', s => s.state.players.length === 0); assert.equal(f.app.game.players.size, 0);
    const b = await f.join('B'); await f.join('C'); const host = await f.host();
    host.send({ type: 'hostAction', action: 'start' }); await host.take('snapshot', s => s.state.phase === 'countdown');
    const late = await f.connect(); late.send({ type: 'join', name: 'Late' }); assert.equal((await late.take('error')).code, 'invalid_phase');
    b.peer.send({ type: 'leave' }); await b.peer.take('snapshot', s => s.state.phase === 'countdown' && s.state.players.some(p => p.id === b.joined.playerId && !p.alive && !p.connected));
    f.app.advance(60); assert.equal(f.app.game.phase, 'roundOver');
    f.app.advance(60); assert.equal(f.app.game.players.size, 1); assert.equal(f.app.game.phase, 'roundOver');
  } finally { await f.close(); }
});

test('typed injected clock drives heartbeat timeout and rate window without sleeping', async () => {
  const f = await fixture();
  try {
    const a = await f.join('A'); const close = once(a.peer.socket, 'close'); f.elapse(6001); f.app.checkConnections(); await close;
    assert.equal(f.app.game.players.get(a.joined.playerId)!.connected, false);
    const peer = await f.connect();
    for (let i = 0; i < 41; i++) peer.send({ type: 'heartbeat' });
    assert.equal((await peer.take('error')).code, 'invalid_message');
    f.elapse(60_001); f.app.checkConnections();
  } finally { await f.close(); }
});

test('bounded catch-up discards sleep-sized backlogs', () => {
  assert.equal(catchUpSteps(0), 0); assert.equal(catchUpSteps(49), 0);
  assert.equal(catchUpSteps(50), 1); assert.equal(catchUpSteps(249), 4);
  assert.equal(catchUpSteps(900_000), 5); assert.equal(catchUpSteps(-10), 0);
});

test('a finished match can accept fresh phones after every original player leaves', async () => {
  const f = await fixture();
  try {
    const host = await f.host(); const a = await f.join('A'); const b = await f.join('B');
    host.send({ type: 'hostAction', action: 'start' }); await host.take('snapshot', s => s.state.phase === 'countdown'); f.app.advance(60);
    f.app.game.players.get(a.joined.playerId)!.roundWins = 4;
    eliminatePlayer(f.app.game, b.joined.playerId); f.app.advance(); assert.equal(f.app.game.phase, 'matchOver');
    a.peer.send({ type: 'leave' }); await a.peer.flush(); b.peer.send({ type: 'leave' }); await b.peer.flush();
    assert.equal(f.app.game.players.size, 0);
    await f.join('C'); await f.join('D');
    const oldMatch = f.app.game.matchId;
    host.send({ type: 'hostAction', action: 'rematch' });
    await host.take('snapshot', s => s.matchId !== oldMatch && s.state.phase === 'countdown');
    assert.equal(f.app.game.players.size, 2); assert.ok([...f.app.game.players.values()].every(p => p.roundWins === 0));
  } finally { await f.close(); }
});

test('injected scheduler advances fixed ticks, caps catch-up, discards excess and cancels on close', async () => {
  let now = 0; let cancelled = 0;
  const tasks = new Map<number, () => void>();
  const app = await createGameServer({ port: 0, hostname: '127.0.0.1', lanAddress: '127.0.0.1',
    dependencies: { now: () => now, schedule: (callback, interval) => { tasks.set(interval, callback); return () => { tasks.delete(interval); cancelled++; }; } } });
  try {
    const run = tasks.get(10)!;
    now = 49; run(); assert.equal(app.game.tick, 0);
    now = 51; run(); assert.equal(app.game.tick, 1);
    now = 5000; run(); assert.equal(app.game.tick, 6, 'sleep backlog capped to five');
    now = 5001; run(); assert.equal(app.game.tick, 6, 'discarded backlog never replays');
    now = 5050; run(); assert.equal(app.game.tick, 7, 'subsequent tick progresses normally');
    tasks.get(1000)!();
  } finally { await app.close(); }
  assert.equal(cancelled, 2); assert.equal(tasks.size, 0);
});
