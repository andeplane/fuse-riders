import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer, catchUpSteps, controllerSnapshot } from '../src/server/index.js';
import { eliminatePlayer } from '../src/shared/game.js';
import type { ClientMessage, MatchPlayerStats, ServerMessage } from '../src/shared/protocol.js';

test('controller snapshots strip the full match statistics table', () => {
  const matchStats: MatchPlayerStats = {
    playerId: 'p0', name: 'Private recap', slot: 0, color: '#fff', roundsPlayed: 5, roundWins: 5,
    roundsDrawn: 0, matchPlacement: 1, survivalTicks: 100, longestSurvivalTicks: 25,
    distanceUnits: 750, bombsPlaced: 9, bombsExploded: 8, eliminations: 4,
    deathsByCause: { wall: 0, trail: 0, explosion: 0, rider: 0 }, pickupsCollected: 3,
    blastPickups: 2, starPickups: 1, beerPickups: 0, inkPickups: 0, triplePickups: 0, fivePickups: 0, targetPickups: 0,
    shieldPickups: 0, portalPickups: 0, portalTransits: 0, invulnerableTicks: 10, wallBounces: 2, earlyExits: 0,
  };
  const compact = controllerSnapshot({
    phase: 'matchOver', width: 1600, height: 900, boundaryInset: 20,
    players: [], bombs: [], blasts: [], pickups: [], leaderboard: [], roundPlacements: [], matchStats: [matchStats],
  });
  assert.deepEqual(compact.matchStats, []);
  assert.equal(JSON.stringify(compact).includes('Private recap'), false);
});

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
    a.peer.send({ type: 'input', seq: 3, left: true, right: false, bomb: true, bombAction: 'press' });
    a.peer.send({ type: 'input', seq: 4, left: true, right: false, bomb: false, bombAction: 'release' }); await a.peer.flush();
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
    const late = await f.join('Late');
    assert.equal(f.app.game.players.get(late.joined.playerId)!.alive, false);
    late.peer.send({ type: 'leave' }); await late.peer.take('snapshot', s => s.state.players.some(p => p.id === late.joined.playerId && !p.connected));
    b.peer.send({ type: 'leave' }); await b.peer.take('snapshot', s => s.state.phase === 'countdown' && s.state.players.some(p => p.id === b.joined.playerId && !p.alive && !p.connected));
    f.app.advance(60); assert.equal(f.app.game.phase, 'roundOver');
    f.app.advance(60); assert.equal(f.app.game.players.size, 1); assert.equal(f.app.game.phase, 'roundOver');
  } finally { await f.close(); }
});

test('charge holds use authoritative ticks and launch only on explicit release', async () => {
  const f = await fixture();
  try {
    const host = await f.host(); const a = await f.join('A'); await f.join('B');
    host.send({ type: 'hostAction', action: 'start' });
    await host.take('snapshot', message => message.state.phase === 'countdown'); f.app.advance(60);
    let seq = 0;
    a.peer.send({ type: 'input', seq: seq++, left: false, right: false, bomb: true, bombAction: 'press' });
    await a.peer.flush(); f.app.advance();
    const player = f.app.game.players.get(a.joined.playerId)!;
    assert.equal(player.bombChargeStartedTick, f.app.game.tick);
    assert.equal(f.app.game.bombs.size, 0);
    for (let index = 0; index < 3; index++) {
      a.peer.send({ type: 'input', seq: seq++, left: false, right: false, bomb: true });
      await a.peer.flush(); f.app.advance(8);
    }
    // Set a safe horizontal release direction: the charge remains authoritative.
    player.x = 600; player.y = 450; player.angle = 0; player.trail = [];
    a.peer.send({ type: 'input', seq: seq++, left: false, right: false, bomb: false, bombAction: 'release' });
    await a.peer.flush(); f.app.advance();
    const bomb = [...f.app.game.bombs.values()][0]!;
    assert.ok(bomb);
    assert.equal(player.bombChargeStartedTick, undefined);
    assert.equal(bomb.explodeAtTick - f.app.game.tick, 40);
    assert.equal(bomb.landsAtTick - f.app.game.tick, 6);
    assert.ok(Math.abs(bomb.x - bomb.launchX - 400) < 0.001);
    assert.equal(bomb.y, bomb.launchY);
  } finally { await f.close(); }
});

test('cancel, stale input, and socket replacement discard charges and queued releases', async () => {
  const f = await fixture();
  try {
    const host = await f.host(); const a = await f.join('A'); await f.join('B');
    host.send({ type: 'hostAction', action: 'start' });
    await host.take('snapshot', message => message.state.phase === 'countdown'); f.app.advance(60);
    const player = f.app.game.players.get(a.joined.playerId)!;
    a.peer.send({ type: 'input', seq: 0, left: false, right: false, bomb: true, bombAction: 'press' });
    a.peer.send({ type: 'input', seq: 1, left: false, right: false, bomb: false, bombAction: 'release' });
    a.peer.send({ type: 'input', seq: 2, left: false, right: false, bomb: false, bombAction: 'cancel' });
    await a.peer.flush(); f.app.advance();
    assert.equal(f.app.game.bombs.size, 0, 'cancel discards an unprocessed quick tap');
    a.peer.send({ type: 'input', seq: 3, left: false, right: false, bomb: true, bombAction: 'press' });
    await a.peer.flush(); f.app.advance();
    assert.notEqual(player.bombChargeStartedTick, undefined);
    f.app.advance(10);
    assert.equal(player.bombChargeStartedTick, undefined, 'watchdog cancels held charge');
    a.peer.send({ type: 'input', seq: 4, left: false, right: false, bomb: false, bombAction: 'release' });
    a.peer.send({ type: 'input', seq: 5, left: false, right: false, bomb: true, bombAction: 'press' });
    await a.peer.flush(); f.app.advance();
    assert.notEqual(player.bombChargeStartedTick, undefined);
    const replaced = await f.connect();
    replaced.send({ type: 'join', name: 'A', playerToken: a.joined.playerToken });
    const joined = await replaced.take('joined');
    replaced.send({ type: 'input', seq: joined.nextInputSeq, left: false, right: false, bomb: false, bombAction: 'release' });
    await replaced.flush(); f.app.advance();
    assert.equal(player.bombChargeStartedTick, undefined);
    assert.equal(f.app.game.bombs.size, 0, 'reconnect never releases an old charge');
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
    f.app.game.players.get(a.joined.playerId)!.roundWins = 2;
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

test('display receives 20Hz world state while phones receive compact 10Hz updates and measured input acknowledgments', async () => {
  const f = await fixture();
  try {
    const host = await f.host(); const a = await f.join('A'); await f.join('B');
    a.peer.send({ type: 'ping', id: 7, sentAt: 12.5 });
    assert.deepEqual(await a.peer.take('pong'), { type: 'pong', id: 7, sentAt: 12.5 });
    host.send({ type: 'hostAction', action: 'start' }); await host.take('snapshot', s => s.state.phase === 'countdown');
    f.app.advance(60); await host.take('snapshot', s => s.state.phase === 'playing'); await a.peer.flush();
    host.messages.length = 0; a.peer.messages.length = 0;
    f.app.advance();
    const odd = await host.take('snapshot', s => s.tick === 61);
    assert.ok(odd.state.players.some(p => p.trail.length > 0));
    await a.peer.flush(); assert.equal(a.peer.messages.some(m => m.type === 'snapshot' && m.tick === 61), false);
    a.peer.send({ type: 'input', seq: 10, left: true, right: false, bomb: false }); await a.peer.flush();
    f.app.advance();
    const compact = await a.peer.take('snapshot', s => s.tick === 62);
    assert.ok(compact.state.players.every(p => p.trail.length === 0));
    assert.deepEqual(compact.state.bombs, []); assert.deepEqual(compact.state.blasts, []); assert.deepEqual(compact.state.pickups, []);
    assert.deepEqual(await a.peer.take('inputAck'), { type: 'inputAck', seq: 10, appliedTick: 62 });
  } finally { await f.close(); }
});

for (const phase of ['countdown', 'playing'] as const) test(`late ${phase} joins wait safely, reconnect and enter next round automatically`, async () => {
  const f = await fixture();
  try {
    const a = await f.join('A'); const b = await f.join('B'); const host = await f.host();
    host.send({ type: 'hostAction', action: 'start' }); await host.take('snapshot', s => s.state.phase === 'countdown');
    if (phase === 'playing') f.app.advance(60);
    const late = await f.join('Late'); const id = late.joined.playerId;
    const waiting = await late.peer.take('snapshot', s => s.state.players.some(p => p.id === id && p.waitingForNextRound));
    assert.equal(waiting.state.players.find(p => p.id === id)!.alive, false);
    assert.equal(f.app.game.roundParticipants.has(id), false);
    const resumed = await f.connect(); resumed.send({ type: 'join', name: 'Late', playerToken: late.joined.playerToken }); await resumed.take('joined');
    resumed.send({ type: 'input', seq: 1, left: true, right: false, bomb: true, bombAction: 'press' });
    resumed.send({ type: 'input', seq: 2, left: false, right: false, bomb: false, bombAction: 'release' });
    await resumed.flush();
    if (phase === 'countdown') f.app.advance(60); else f.app.advance(1);
    assert.equal(f.app.game.players.get(id)!.alive, false);
    assert.equal(f.app.game.bombs.size, 0);
    eliminatePlayer(f.app.game, b.joined.playerId); f.app.advance(1);
    assert.equal(f.app.game.phase, 'roundOver');
    assert.equal(f.app.game.roundPlacements.some(p => p.playerId === id), false);
    assert.equal(f.app.game.leaderboard.get(id)!.roundsPlayed, 0);
    assert.equal(f.app.game.players.get(a.joined.playerId)!.roundWins, 1);
    f.app.advance(60);
    assert.equal(f.app.game.phase, 'countdown');
    assert.equal(f.app.game.players.get(id)!.alive, true);
    assert.equal(f.app.game.roundParticipants.has(id), true);
    const entered = await resumed.take('snapshot', s => s.round === 2 && s.state.players.some(p => p.id === id && p.alive));
    assert.equal(entered.state.players.find(p => p.id === id)!.waitingForNextRound, false);
  } finally { await f.close(); }
});

test('target release aim survives newer input packets through real socket transport', async () => {
  const f = await fixture();
  try {
    const host = await f.host(); const a = await f.join('A'); await f.join('B');
    host.send({ type: 'hostAction', action: 'start' }); await host.take('snapshot', m => m.state.phase === 'countdown'); f.app.advance(60);
    const player = f.app.game.players.get(a.joined.playerId)!; player.targetBombArmed = true;
    a.peer.send({ type: 'input', seq: 0, left: false, right: false, bomb: true, bombAction: 'press', aim: { x: .1, y: .1 } });
    a.peer.send({ type: 'input', seq: 1, left: false, right: false, bomb: false, bombAction: 'release', aim: { x: .2, y: .3 } });
    a.peer.send({ type: 'input', seq: 2, left: false, right: false, bomb: true, bombAction: 'press', aim: { x: .9, y: .9 } });
    await a.peer.flush(); f.app.advance();
    const bomb = [...f.app.game.bombs.values()][0]!; assert.equal(bomb.x, f.app.game.width * .2); assert.equal(bomb.y, f.app.game.height * .3);
    assert.equal(bomb.landsAtTick, f.app.game.tick); assert.equal(player.targetBombArmed, false);
  } finally { await f.close(); }
});

test('host can abort to lobby without losing phone seats or replaying buffered bomb releases', async () => {
  const f = await fixture();
  try {
    const host = await f.host(); const a = await f.join('A'); const b = await f.join('B');
    host.send({ type: 'hostAction', action: 'start' }); await host.take('snapshot', m => m.state.phase === 'countdown'); f.app.advance(60);
    a.peer.send({ type: 'hostAction', action: 'lobby' }); assert.equal((await a.peer.take('error')).code, 'unauthorized'); assert.equal(f.app.game.phase, 'playing');
    a.peer.send({ type: 'input', seq: 0, left: false, right: false, bomb: true, bombAction: 'press' });
    a.peer.send({ type: 'input', seq: 1, left: false, right: false, bomb: false, bombAction: 'release' }); await a.peer.flush();
    const scope = f.app.game.matchId; host.send({ type: 'hostAction', action: 'lobby' }); await host.take('snapshot', m => m.state.phase === 'lobby' && m.matchId !== scope);
    assert.deepEqual([...f.app.game.players.keys()], [a.joined.playerId, b.joined.playerId]);
    host.send({ type: 'hostAction', action: 'start' }); await host.take('snapshot', m => m.state.phase === 'countdown'); f.app.advance(62); assert.equal(f.app.game.bombs.size, 0);
    const close = once(b.peer.socket, 'close'); b.peer.socket.terminate(); await close; await host.take('snapshot', m => m.state.players.some(p => p.id === b.joined.playerId && !p.connected));
    host.send({ type: 'hostAction', action: 'lobby' }); await host.take('snapshot', m => m.state.phase === 'lobby' && m.state.players.length === 1);
    assert.equal(f.app.game.players.has(a.joined.playerId), true);
  } finally { await f.close(); }
});

test('serialized avatar joins assign an allowed head and reconnect preserves server identity', async () => {
  const f = await fixture();
  try {
    const peer = await f.connect(); peer.send({ type: 'join', name: 'Dragon', avatarId: 'dragon' });
    const joined = await peer.take('joined');
    const assigned = await peer.take('snapshot', message => message.state.players.some(player => player.id === joined.playerId));
    assert.equal(assigned.state.players.find(player => player.id === joined.playerId)!.avatarId, 'dragon');
    const replacement = await f.connect();
    replacement.send({ type: 'join', name: 'Changed', avatarId: 'cat', playerToken: joined.playerToken });
    await replacement.take('joined');
    const recovered = await replacement.take('snapshot', message => message.state.players.some(player => player.id === joined.playerId));
    assert.equal(recovered.state.players.find(player => player.id === joined.playerId)!.avatarId, 'dragon');
    const invalid = await f.connect(); invalid.socket.send(JSON.stringify({ type: 'join', name: 'No', avatarId: 'bad' }));
    await invalid.take('error', message => message.code === 'invalid_message'); assert.equal(f.app.game.players.size, 1);
  } finally { await f.close(); }
});

test('a joined controller can change only its own avatar during play without altering gameplay', async () => {
  const f = await fixture();
  try {
    const outsider = await f.connect(); outsider.send({ type: 'setAvatar', avatarId: 'slime' }); assert.equal((await outsider.take('error')).code, 'unauthorized');
    const a = await f.join('A'); const b = await f.join('B'); const host = await f.host();
    host.send({ type: 'hostAction', action: 'start' }); await host.take('snapshot', s => s.state.phase === 'countdown'); f.app.advance(60);
    const before = structuredClone(f.app.game.players.get(a.joined.playerId)!);
    a.peer.send({ type: 'setAvatar', avatarId: 'slime' });
    await host.take('snapshot', s => s.state.players.some(p => p.id === a.joined.playerId && p.avatarId === 'slime'));
    assert.deepEqual(f.app.game.players.get(a.joined.playerId), { ...before, avatarId: 'slime' });
    assert.equal(f.app.game.players.get(b.joined.playerId)!.avatarId, 'robot');
    assert.equal(f.app.game.phase, 'playing');
    const reconnect = await f.connect(); reconnect.send({ type: 'join', name: 'A', playerToken: a.joined.playerToken }); await reconnect.take('joined');
    const state = await reconnect.take('snapshot', s => s.state.players.some(p => p.id === a.joined.playerId));
    assert.equal(state.state.players.find(p => p.id === a.joined.playerId)!.avatarId, 'slime');
  } finally { await f.close(); }
});
