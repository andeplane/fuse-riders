import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRuntime, type RuntimeEnvironment, type RuntimeTransport, type Callbacks } from '../src/online/runtime.js';
import type { TransportCallbacks } from '../src/online/peer-transport.js';
import { isPlan, isPreparation, type RoomPlan, type Preparation } from '../src/online/direct-room-state.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import type { ViewSnapshot } from '../src/client/snapshot-stream.js';
import type { GameEvent } from '../src/shared/protocol.js';
import { packMessage, unpackMessage } from '../src/online/action-replication.js';

function setup(shared = false) {
  let now = 0, nextId = 0;
  interface Member { runtime: RoomRuntime; callbacks: TransportCallbacks; tick?: () => void; view?: ViewSnapshot; notices: string[]; events: GameEvent[]; storage: Map<string, string>; transport: RuntimeTransport }
  const members = new Map<string, Member>(), connections = new Map<string, string>();
  const queue: { from: string; to: string; value: Uint8Array; fast: boolean }[] = [];
  const sends: { from: string; to: string; type: string; accepted: boolean }[] = [];
  let accept: (from: string, to: string, raw: unknown) => boolean = () => true;
  const silent = new Set<string>(), unscheduled = new Set<string>(), checkpointBlocked = new Set<string>();
  function add(id: string, display = false, storage = new Map<string, string>()) {
    connections.set(id, `connection-${++nextId}`);
    const notices: string[] = [], events: GameEvent[] = [];
    let callbacks: TransportCallbacks, tick: (() => void) | undefined, view: ViewSnapshot | undefined;
    const send = (to: string, raw: unknown, fast = false) => {
      const type = Array.isArray(raw) ? String(raw[2]) : raw && typeof raw === 'object' && 'type' in raw ? String(raw.type) : 'fast';
      const accepted = accept(id, to, raw); sends.push({ from: id, to, type, accepted });
      if (!accepted) return false;
      if (!silent.has(id) && !silent.has(to)) queue.push({ from: id, to, value: raw instanceof Uint8Array ? new Uint8Array(raw) : packMessage(raw), fast });
      return true;
    };
    const transport: RuntimeTransport = {
      id, hostId: 'p0', connectionId: connections.get(id)!, grant: { incarnation: 'room', epoch: 1, holder: connections.get('p0') ?? 'c0', grantId: 'g1', validFrom: 0, expiresAt: 100000 },
      sentBytes: 0, fastSentBytes: 0, binarySentBytes: 0,
      connectionOf: peer => connections.get(peer), members: () => [...connections.keys()], authorityPermitted: () => true,
      connect: () => { callbacks.welcome(id, 'p0'); for (const peer of connections.keys()) if (peer !== id) callbacks.peer(peer, true); }, close: () => {},
      send: (to, value) => send(to, value), sendCheckpoint: (to, value) => !checkpointBlocked.has(to) && send(to, value), sendFast: (to, bytes) => send(to, bytes, true), sendBound: (to, tuple) => send(to, tuple), bindFast: () => true, boundReady: () => true,
      stats: async () => ({ direct: connections.size - 1, relayed: 0, buffered: 0, authority: { reason: 'permitted' } }),
      diagnostics: async () => ({ links: [], ice: { servers: 0, source: 'test' }, socket: 'open' }),
    };
    const environment: RuntimeEnvironment = { now: () => now, hidden: () => false, display, randomId: () => `match-${++nextId}`, storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } },
      schedule: callback => { tick = callback; return () => { tick = undefined; }; }, transport: cb => { callbacks = cb; return transport; } };
    const output: Callbacks = { ready: () => { if (!display) runtime.command({ type: 'join', name: id }); }, state: v => { view = v; }, event: e => events.push(e), status: s => notices.push(s) };
    const runtime = new RoomRuntime('test-room', 'unused', { ...defaultRoomSettings(), mode: shared ? 'shared' : 'devices' }, output, environment);
    const member: Member = { runtime, callbacks: callbacks!, get tick() { return tick; }, get view() { return view; }, notices, events, storage, transport };
    members.set(id, member); return member;
  }
  function deliver() {
    let count = 0;
    while (queue.length) {
      assert.ok(++count < 10000, 'bounded delivery');
      const packet = queue.shift()!, peer = members.get(packet.to); if (!peer) continue;
      if (packet.fast) peer.callbacks.fast?.(packet.from, packet.value); else peer.callbacks.message(packet.from, unpackMessage(packet.value));
    }
  }
  function advance(ms: number) {
    const end = now + ms;
    while (now < end) { now += 10; for (const [id, member] of members) if (!unscheduled.has(id)) member.tick?.(); deliver(); }
  }
  const ids = shared ? ['p0', 'p1', 'tv'] : ['p0', 'p1', 'p2'];
  for (const id of ids) add(id, id === 'tv');
  for (const member of members.values()) member.runtime.start();
  advance(1800);
  return { members, sends, advance, silent, unscheduled, checkpointBlocked, add, remove: (id: string) => { members.get(id)?.runtime.stop(); members.delete(id); connections.delete(id); for (const member of members.values()) member.callbacks.peer(id, false); }, accept: (fn: typeof accept) => { accept = fn; }, now: () => now };
}

test('runtime activates direct simulators, starts a match and sends actions directly between guests', () => {
  const room = setup();
  for (const member of room.members.values()) { assert.equal(member.runtime.replicationDiagnostics.barrier, false); assert.equal(member.view?.players.length, 3); }
  room.members.get('p0')!.runtime.command({ type: 'action', action: 'start' }); room.advance(4300);
  assert.equal(room.members.get('p1')!.view?.phase, 'playing');
  assert.equal(room.members.get('p1')!.runtime.command({ type: 'input', seq: 1, left: true, right: false, bomb: false }), true);
  room.advance(100);
  assert.ok(room.sends.some(m => m.from === 'p1' && m.to === 'p2' && m.type === 'fast'));
  for (const member of room.members.values()) assert.equal(member.runtime.replicationDiagnostics.fault, undefined);
});

test('a failed first recovery enqueue is retried and replaces the paused segment', () => {
  const room = setup(); let failed = false;
  room.accept((from, _to, raw) => { if (!failed && from === 'p1' && raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directRecover') { failed = true; return false; } return true; });
  const guest = room.members.get('p1')!; const alias = guest.runtime.replicationDiagnostics.alias!;
  guest.callbacks.linkReset?.('p0'); room.advance(2000);
  assert.equal(failed, true); assert.ok(room.sends.filter(m => m.from === 'p1' && m.type === 'directRecover').length >= 2);
  assert.ok(guest.runtime.replicationDiagnostics.alias! > alias); assert.equal(guest.runtime.replicationDiagnostics.fault, undefined);
});

test('an unavailable recovery coordinator produces a bounded visible fresh-lobby state', () => {
  const room = setup(), guest = room.members.get('p1')!;
  room.silent.add('p0'); guest.callbacks.linkReset?.('p0'); room.advance(5200);
  assert.equal(guest.runtime.replicationDiagnostics.recoveryRequired, true);
  assert.ok(guest.notices.some(s => s.includes('Synchronization unavailable')));
});

test('a release without a usable tick freezes its gesture before a fresh clock can resume input', () => {
  const room = setup(), host = room.members.get('p0')!, guest = room.members.get('p1')!;
  host.runtime.command({ type: 'action', action: 'start' }); room.advance(4300);
  assert.equal(guest.runtime.command({ type: 'input', seq: 1, left: false, right: false, bomb: true, bombAction: 'press' }), true);
  room.advance(50); room.silent.add('p1'); room.unscheduled.add('p1'); room.advance(1100);
  assert.equal(guest.runtime.command({ type: 'input', seq: 2, left: false, right: false, bomb: false, bombAction: 'release' }), false);
  assert.equal(guest.runtime.replicationDiagnostics.fault, 'Segment replaced');
  room.silent.delete('p1'); room.unscheduled.delete('p1'); room.advance(2200);
  assert.ok(!guest.events.some(e => e.type === 'bombPlaced'));
  assert.ok(guest.runtime.replicationDiagnostics.alias! > 1);
});

test('a refreshed delegated TV without a simulation base pauses instead of creating a new match', () => {
  const room = setup(true), creator = room.members.get('p0')!;
  assert.equal(creator.runtime.replicationDiagnostics.simulator, false);
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(1600);
  assert.equal(room.members.get('tv')!.view?.phase, 'countdown');
  room.members.get('tv')!.runtime.stop(); const replacement = room.add('tv', true); replacement.runtime.start();
  for (const [id, member] of room.members) if (id !== 'tv') member.callbacks.peer('tv', true);
  room.advance(2000);
  assert.equal(replacement.runtime.replicationDiagnostics.simulator, false);
  assert.equal(creator.runtime.replicationDiagnostics.recoveryRequired, true);
  assert.ok(creator.notices.some(s => s.includes('fresh lobby') || s.includes('base is unavailable')), JSON.stringify(creator.notices));
});

test('creator refresh in a settled lobby preserves the checkpoint and can switch to shared TV mode', () => {
  const room = setup(); let creator = room.members.get('p0')!;
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(4300);
  creator.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), length: 2 } }); room.advance(1200);
  creator.runtime.command({ type: 'action', action: 'lobby' }); room.advance(2000);
  const tick = creator.view!.tick, hash = creator.runtime.replicationDiagnostics.finalizedHash; assert.ok(hash);
  const storage = creator.storage; creator.runtime.stop(); creator = room.add('p0', false, storage);
  for (const member of room.members.values()) { member.transport.grant = { ...member.transport.grant!, epoch: 2, holder: creator.transport.connectionId }; member.callbacks.authorityChanged?.(); }
  creator.runtime.start();
  for (const [id, member] of room.members) if (id !== 'p0') member.callbacks.welcome(id, 'p0');
  room.advance(2200);
  for (const [id, member] of room.members) {
    assert.equal(member.runtime.replicationDiagnostics.recoveryRequired, false, JSON.stringify({ id, diagnostics: member.runtime.replicationDiagnostics, notices: member.notices }));
    assert.equal(member.runtime.replicationDiagnostics.barrier, false); assert.equal(member.view!.tick, tick); assert.equal(member.runtime.replicationDiagnostics.finalizedHash, hash);
  }
  creator.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), mode: 'shared' } }); room.advance(1000);
  for (const member of room.members.values()) assert.equal(member.runtime.replicationDiagnostics.simulator, false);
});


test('a refreshed guest can rejoin with a fresh command sequence on its replacement connection', () => {
  const room = setup(); const old = room.members.get('p1')!;
  old.runtime.stop(); const guest = room.add('p1', false, old.storage);
  for (const [id, member] of room.members) if (id !== 'p1') member.callbacks.peer('p1', true);
  guest.runtime.start(); room.advance(2500);
  for (const member of room.members.values()) {
    assert.equal(member.view!.players.find(p => p.id === 'p1')?.connected, true);
    assert.equal(member.runtime.replicationDiagnostics.barrier, false);
  }
});


test('four healthy connection rebuilds do not consume the corrupt-state recovery budget', () => {
  const room = setup(), guest = room.members.get('p1')!;
  for (let i = 0; i < 4; i++) { guest.callbacks.linkReset?.('p0'); room.advance(1800); }
  assert.equal(guest.runtime.replicationDiagnostics.recoveryRequired, false);
  assert.equal(guest.runtime.replicationDiagnostics.fault, undefined);
  room.members.get('p0')!.runtime.command({ type: 'action', action: 'start' }); room.advance(4300);
  assert.equal(guest.view!.phase, 'playing');
});

test('a running recovery episode cannot reset its deadline through clock readiness without finality', () => {
  const room = setup(), host = room.members.get('p0')!;
  host.runtime.command({ type: 'action', action: 'start' }); room.advance(4300);
  // Keep reliable setup/clocks intact but drop every action/cut from one admitted origin.
  room.accept((from, _to, raw) => !(from === 'p1' && raw instanceof Uint8Array));
  host.callbacks.linkReset?.('p1'); room.advance(17000);
  assert.equal(host.runtime.replicationDiagnostics.recoveryRequired, true);
  assert.ok(host.notices.some(s => s.includes('could not restore play')));
});

test('a delegated coordinator stops retrying an unavailable creator after the plan-request deadline', () => {
  const room = setup(true), tv = room.members.get('tv')!;
  room.accept((from, to, raw) => !(from === 'tv' && to === 'p0' && raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directPlanRequest'));
  tv.callbacks.linkReset?.('p1'); room.advance(5500);
  assert.equal(tv.runtime.replicationDiagnostics.recoveryRequired, true);
  assert.ok(tv.notices.some(s => s.includes('creator could not confirm')));
  const count = room.sends.filter(m => m.type === 'directPlanRequest').length; room.advance(2000);
  assert.equal(room.sends.filter(m => m.type === 'directPlanRequest').length, count);
});


test('a delayed current-alias activation cannot resume a latched recovery timeout', () => {
  const room = setup(), guest = room.members.get('p1')!; let captured: unknown;
  room.accept((from, to, raw) => { if (from === 'p0' && to === 'p1' && raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directActivate') { captured = structuredClone(raw); return false; } return true; });
  guest.callbacks.linkReset?.('p0'); room.advance(17000);
  assert.equal(guest.runtime.replicationDiagnostics.recoveryRequired, true); assert.ok(captured);
  const before = structuredClone(guest.runtime.replicationDiagnostics), view = structuredClone(guest.view);
  guest.callbacks.message('p0', captured);
  assert.deepEqual(guest.runtime.replicationDiagnostics, before); assert.deepEqual(guest.view, view);
});


test('a guest returns after a service-observed departure and lobby seat removal', () => {
  const room = setup(); room.remove('p1'); room.advance(1200);
  assert.equal(room.members.get('p0')!.view!.players.some(p => p.id === 'p1'), false);
  const guest = room.add('p1'); for (const [id, member] of room.members) if (id !== 'p1') member.callbacks.peer('p1', true);
  guest.runtime.start(); room.advance(2000);
  for (const [id, member] of room.members) assert.equal(member.view?.players.find(p => p.id === 'p1')?.connected, true, JSON.stringify({id, notices: member.notices, metrics: member.runtime.replicationDiagnostics}));
});

test('invalid future actions do not consume the checkpoint and hash recovery budget', () => {
  const room = setup(), host = room.members.get('p0')!;
  for (let i = 0; i < 4; i++) {
    host.callbacks.fast?.('p1', packMessage([1, host.runtime.replicationDiagnostics.alias, 1, [[1, 1000, 0, 1]], null]));
    room.advance(1800);
    assert.equal(host.runtime.replicationDiagnostics.recoveryRequired, false);
    assert.equal(host.runtime.replicationDiagnostics.fault, undefined);
  }
  assert.ok(host.notices.some(s => s.includes('World invalid')));
});


test('conflicting metadata for an installed preparation charges one corrupt recovery attempt', () => {
  const room = setup(), guest = room.members.get('p1')!; let header: Record<string, unknown> | undefined;
  room.accept((from, to, raw) => { if (from === 'p0' && to === 'p1' && raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directPrepare') header = structuredClone(raw) as Record<string, unknown>; return true; });
  room.members.get('p0')!.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), length: 2 } }); room.advance(20);
  assert.ok(header); const conflicting = { ...header, hash: '0'.repeat(16) }; guest.callbacks.message('p0', conflicting); room.advance(10);
  assert.equal(guest.runtime.replicationDiagnostics.corruptRecoveryAttempts, 1);
  room.advance(2000); guest.callbacks.message('p0', conflicting); room.advance(10);
  assert.equal(guest.runtime.replicationDiagnostics.corruptRecoveryAttempts, 1);
});


test('checkpoint backpressure pauses preparation and resumes the same transfer after drain', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  room.checkpointBlocked.add('p1');
  const sentBefore = room.sends.filter(m => m.to === 'p1' && m.type === 'directChunk').length;
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(1000);
  assert.equal(room.sends.filter(m => m.to === 'p1' && m.type === 'directChunk').length, sentBefore);
  assert.equal(guest.view?.phase, 'lobby');
  assert.equal(guest.runtime.replicationDiagnostics.barrier, true);
  const alias = guest.runtime.replicationDiagnostics.alias;
  room.checkpointBlocked.delete('p1'); room.advance(1600);
  assert.ok(room.sends.filter(m => m.to === 'p1' && m.type === 'directChunk').length > sentBefore);
  assert.equal(guest.runtime.replicationDiagnostics.alias, alias);
  assert.equal(guest.runtime.replicationDiagnostics.barrier, false);
  assert.equal(guest.view?.phase, 'countdown');
  assert.equal(guest.runtime.replicationDiagnostics.recoveryRequired, false);
});

test('persistent checkpoint backpressure cannot extend the recovery deadline indefinitely', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  room.checkpointBlocked.add('p1');
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(22000);
  assert.equal(creator.runtime.replicationDiagnostics.recoveryRequired, true);
  assert.ok(creator.notices.some(s => s.includes('Synchronization could not restore play')));
  assert.equal(guest.view?.phase, 'lobby');
  assert.equal(guest.runtime.replicationDiagnostics.recoveryRequired, true);
  assert.ok(guest.notices.some(s => s.includes('Synchronization could not restore play')));
});


test('new creator plans cannot postpone an unfinished guest recovery episode indefinitely', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  let plan: RoomPlan | undefined, header: Preparation | undefined;
  room.accept((from, to, raw) => {
    if (from === 'p0' && to === 'p1') {
      if (isPlan(raw)) plan = structuredClone(raw);
      else if (plan && isPreparation(raw, plan)) header = structuredClone(raw);
    }
    return true;
  });
  room.checkpointBlocked.add('p1');
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(100);
  assert.ok(plan); assert.ok(header);
  room.accept((from, to) => !(from === 'p0' && to === 'p1'));
  // Each authenticated replacement arrives before the previous preparation's five-second
  // timeout. No candidate is ever installed, qualified or finalized.
  for (let i = 1; i <= 5; i++) {
    room.advance(4000);
    const revision = plan.revision + i;
    guest.callbacks.message('p0', { ...plan, revision });
    guest.callbacks.message('p0', { ...header, revision, alias: revision });
    room.advance(10);
  }
  assert.equal(guest.runtime.replicationDiagnostics.recoveryRequired, true);
  assert.ok(guest.notices.some(s => s.includes('Synchronization could not restore play')));
  assert.equal(guest.view?.phase, 'lobby');
});


test('an accepted plan without a preparation header times out visibly', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  room.accept((from, to, raw) => !(from === 'p0' && to === 'p1' && raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directPrepare'));
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(22000);
  assert.equal(guest.runtime.replicationDiagnostics.recoveryRequired, true);
  assert.ok(guest.notices.some(s => s.includes('Synchronization could not restore play')));
  assert.equal(guest.view?.phase, 'lobby');
});

test('new plans without any headers cannot restart the guest availability deadline', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  let plan: RoomPlan | undefined;
  room.accept((from, to, raw) => {
    if (from === 'p0' && to === 'p1') {
      if (isPlan(raw)) { plan = structuredClone(raw); return true; }
      return false;
    }
    return true;
  });
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(100);
  assert.ok(plan);
  room.accept((from, to) => !(from === 'p0' && to === 'p1'));
  for (let i = 1; i <= 5; i++) {
    room.advance(4000);
    guest.callbacks.message('p0', { ...plan, revision: plan.revision + i }); room.advance(10);
  }
  assert.equal(guest.runtime.replicationDiagnostics.recoveryRequired, true);
  assert.equal(guest.view?.phase, 'lobby');
});
