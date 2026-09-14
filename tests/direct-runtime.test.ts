import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECT_RULES } from '../src/shared/direct-input.js';
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
  let activate: (from: string, to: string, alias: number) => boolean = () => true;
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
      send: (to, value) => send(to, value), sendCheckpoint: (to, value) => !checkpointBlocked.has(to) && send(to, value), sendFast: (to, bytes) => send(to, bytes, true), sendPulse: (to, bytes) => send(to, bytes, true), activatePulse: (to, alias) => { const accepted = activate(id, to, alias); sends.push({from:id,to,type:`activate:${alias}`,accepted});return accepted;}, deactivatePulse: (to, alias) => { sends.push({from:id,to,type:`deactivate:${alias}`,accepted:true});}, sendBound: (to, tuple) => send(to, tuple), bindFast: () => true, boundReady: () => true,
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
  return { jumpClock: (ms: number) => { now += ms; }, activation: (fn: typeof activate) => { activate = fn; }, members, sends, advance, silent, unscheduled, checkpointBlocked, add, remove: (id: string) => { members.get(id)?.runtime.stop(); members.delete(id); connections.delete(id); for (const member of members.values()) member.callbacks.peer(id, false); }, accept: (fn: typeof accept) => { accept = fn; }, now: () => now };
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


test('recreated links during creator-refresh preparation do not restart recovery or lose queued TV settings', () => {
  const room = setup(), oldCreator = room.members.get('p0')!, guest = room.members.get('p1')!;
  oldCreator.runtime.stop(); const creator = room.add('p0', false, oldCreator.storage);
  for (const member of room.members.values()) {
    member.transport.grant = { ...member.transport.grant!, epoch: 2, holder: creator.transport.connectionId };
    member.callbacks.authorityChanged?.();
  }
  room.activation(from => from !== 'p1');
  creator.runtime.start();
  for (const [id, member] of room.members) if (id !== 'p0') member.callbacks.welcome(id, 'p0');
  room.advance(200);
  assert.equal(guest.runtime.replicationDiagnostics.barrier, true);
  const alias = guest.runtime.replicationDiagnostics.alias;
  assert.ok(alias);
  // Native RTC creates guest-to-guest links asynchronously after receiving the new plan.
  guest.callbacks.linkReset?.('p2');
  assert.equal(creator.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), mode: 'shared' } }), true);
  room.advance(20);
  assert.equal(room.sends.some(send => send.from === 'p1' && send.type === 'directRecover'), false);
  assert.equal(guest.runtime.replicationDiagnostics.alias, alias);
  room.activation(() => true); room.advance(2000);
  for (const member of room.members.values()) {
    assert.equal(member.runtime.replicationDiagnostics.recoveryRequired, false);
    assert.equal(member.runtime.replicationDiagnostics.barrier, false);
    assert.equal(member.runtime.replicationDiagnostics.simulator, false);
    assert.equal(member.view?.players.length, 3);
  }
});

test('a retained old-epoch world cannot pause replacement-epoch bindings with a reused alias', () => {
  const room = setup(), oldCreator = room.members.get('p0')!;
  const oldAlias = oldCreator.runtime.replicationDiagnostics.alias!;
  oldCreator.runtime.stop(); const creator = room.add('p0', false, oldCreator.storage);
  const boundary = room.sends.length;
  for (const member of room.members.values()) {
    member.transport.grant = { ...member.transport.grant!, epoch: 2, holder: creator.transport.connectionId };
    member.callbacks.authorityChanged?.();
  }
  room.activation(() => false); creator.runtime.start();
  for (const [id, member] of room.members) if (id !== 'p0') member.callbacks.welcome(id, 'p0');
  room.advance(200);
  while (creator.runtime.replicationDiagnostics.alias! < oldAlias) {
    room.members.get('p1')!.transport.send('p0', { type: 'directRecover', revision: creator.runtime.replicationDiagnostics.alias });
    room.advance(600);
  }
  assert.equal(creator.runtime.replicationDiagnostics.alias, oldAlias);
  // These callbacks stop retained worlds, but have no authority to pause new RTC bindings.
  assert.deepEqual(room.sends.slice(boundary).filter(send => send.type.startsWith('deactivate:')), []);
  room.activation(() => true); room.advance(2000);
  for (const member of room.members.values()) {
    assert.equal(member.runtime.replicationDiagnostics.recoveryRequired, false);
    assert.equal(member.runtime.replicationDiagnostics.barrier, false);
  }
});

test('freezing after one connection replacement still pauses unchanged peer associations', () => {
  const room = setup(), creator = room.members.get('p0')!, oldGuest = room.members.get('p1')!;
  oldGuest.runtime.stop(); const guest = room.add('p1', false, oldGuest.storage);
  const boundary = room.sends.length;
  creator.callbacks.peer('p1', true); room.advance(20);
  const pauses = room.sends.slice(boundary).filter(send => send.from === 'p0' && send.type.startsWith('deactivate:'));
  assert.ok(pauses.some(send => send.to === 'p2'));
  assert.equal(pauses.some(send => send.to === 'p1'), false);
  guest.runtime.start(); room.advance(2500);
  for (const member of room.members.values()) assert.equal(member.runtime.replicationDiagnostics.recoveryRequired, false);
});

test('creator refresh can retry initial preparation before the coordinator installs its first world', () => {
  const room = setup(), oldCreator = room.members.get('p0')!, guest = room.members.get('p1')!;
  oldCreator.runtime.stop(); const creator = room.add('p0', false, oldCreator.storage);
  for (const member of room.members.values()) {
    member.transport.grant = { ...member.transport.grant!, epoch: 2, holder: creator.transport.connectionId };
    member.callbacks.authorityChanged?.();
  }
  room.activation(from => from !== 'p0'); creator.runtime.start();
  for (const [id, member] of room.members) if (id !== 'p0') member.callbacks.welcome(id, 'p0');
  room.advance(200);
  assert.equal(creator.runtime.replicationDiagnostics.simulator, false);
  assert.equal(creator.runtime.replicationDiagnostics.barrier, true);
  assert.equal(guest.runtime.replicationDiagnostics.barrier, false);
  const firstAlias = creator.runtime.replicationDiagnostics.alias!;
  // An already activated follower needs a fresh plan while the creator still awaits its bindings.
  guest.callbacks.linkReset?.('p2'); room.advance(30);
  assert.ok(creator.runtime.replicationDiagnostics.alias! > firstAlias);
  assert.equal(creator.runtime.replicationDiagnostics.recoveryRequired, false);
  room.activation(() => true); room.advance(2000);
  for (const member of room.members.values()) {
    assert.equal(member.runtime.replicationDiagnostics.recoveryRequired, false);
    assert.equal(member.runtime.replicationDiagnostics.barrier, false);
    assert.equal(member.view?.phase, 'lobby');
    assert.equal(member.view?.players.length, 3);
    assert.equal(member.runtime.replicationDiagnostics.finalizedHash, creator.runtime.replicationDiagnostics.finalizedHash);
  }
});

test('an initial shared-TV retry keeps the unactivated creator as its lobby source', () => {
  const room = setup(true), oldCreator = room.members.get('p0')!;
  oldCreator.runtime.stop(); const creator = room.add('p0', false, oldCreator.storage);
  for (const member of room.members.values()) {
    member.transport.grant = { ...member.transport.grant!, epoch: 2, holder: creator.transport.connectionId };
    member.callbacks.authorityChanged?.();
  }
  const plans: RoomPlan[] = [];
  room.accept((from, _to, raw) => { if (from === 'p0' && isPlan(raw)) plans.push(structuredClone(raw)); return true; });
  room.activation(() => false); creator.runtime.start();
  for (const [id, member] of room.members) if (id !== 'p0') member.callbacks.welcome(id, 'p0');
  room.advance(200);
  assert.equal(creator.runtime.replicationDiagnostics.simulator, false);
  assert.equal(creator.runtime.replicationDiagnostics.barrier, true);
  room.members.get('tv')!.transport.send('p0', { type: 'directPlanRequest', request: 1, settings: { ...defaultRoomSettings(), mode: 'shared' } });
  room.advance(20);
  assert.equal(plans.at(-1)?.initialize, true);
  assert.equal(plans.at(-1)?.source, 'p0');
  assert.equal(plans.at(-1)?.coordinator, 'tv');
  room.activation(() => true); room.advance(2000);
  for (const [id, member] of room.members) {
    assert.equal(member.runtime.replicationDiagnostics.recoveryRequired, false);
    assert.equal(member.runtime.replicationDiagnostics.barrier, false);
    assert.equal(member.runtime.replicationDiagnostics.simulator, id === 'tv');
    assert.equal(member.view?.players.length, 2);
  }
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
  guest.callbacks.authorityChanged?.(); // Retain the fence, but require transfer after authority-scope invalidation.
  room.checkpointBlocked.add('p1');
  const sentBefore = room.sends.filter(m => m.to === 'p1' && m.type === 'directChunk').length;
  const headersBefore=room.sends.filter(m=>m.to==='p1'&&m.type==='directPrepare').length;
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(1000);
  assert.equal(room.sends.filter(m => m.to === 'p1' && m.type === 'directChunk').length, sentBefore);
  assert.equal(guest.view?.phase, 'lobby');
  assert.equal(guest.runtime.replicationDiagnostics.barrier, true);
  assert.equal(room.sends.filter(m=>m.to==='p1'&&m.type==='directPrepare').length,headersBefore+1,'acknowledged header must not repeat while chunks wait for backpressure');
  const alias = guest.runtime.replicationDiagnostics.alias;
  room.checkpointBlocked.delete('p1'); room.advance(1600);
  assert.ok(room.sends.filter(m => m.to === 'p1' && m.type === 'directChunk').length > sentBefore);
  assert.equal(guest.runtime.replicationDiagnostics.alias, alias);
  assert.equal(guest.runtime.replicationDiagnostics.barrier, false);
  assert.equal(guest.view?.phase, 'countdown');
  assert.equal(guest.runtime.replicationDiagnostics.recoveryRequired, false);
});

test('header and header-ACK enqueue failures retry delivery without substituting for readiness',()=>{
 const room=setup(),creator=room.members.get('p0')!,guest=room.members.get('p1')!;
  guest.callbacks.authorityChanged?.(); // Retain the fence, but require transfer after authority-scope invalidation.
 let headerFailed=false,ackFailed=false;
 room.accept((from,to,raw)=>{
  if(raw&&typeof raw==='object'&&'type' in raw){
   if(from==='p0'&&to==='p1'&&raw.type==='directPrepare'&&!headerFailed){headerFailed=true;return false;}
   if(from==='p1'&&to==='p0'&&raw.type==='directHeader'&&!ackFailed){ackFailed=true;return false;}
  }
  return true;
 });
 room.checkpointBlocked.add('p1');creator.runtime.command({type:'action',action:'start'});room.advance(1000);
 assert.ok(headerFailed&&ackFailed);assert.equal(guest.runtime.replicationDiagnostics.barrier,true);assert.equal(guest.view?.phase,'lobby');
 const headers=room.sends.filter(m=>m.to==='p1'&&m.type==='directPrepare').length;room.advance(1000);
 assert.equal(room.sends.filter(m=>m.to==='p1'&&m.type==='directPrepare').length,headers);
 room.checkpointBlocked.delete('p1');room.advance(1600);assert.equal(guest.runtime.replicationDiagnostics.barrier,false);assert.equal(guest.view?.phase,'countdown');
});

test('header retries distinguish failed enqueue from a queued header awaiting acknowledgement', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  guest.callbacks.authorityChanged?.();
  const attempts: number[] = [];
  let acknowledge = false;
  room.accept((from, to, raw) => {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return true;
    if (from === 'p0' && to === 'p1' && raw.type === 'directPrepare') {
      attempts.push(room.now());
      return attempts.length > 1;
    }
    return !(from === 'p1' && to === 'p0' && raw.type === 'directHeader' && !acknowledge);
  });
  room.checkpointBlocked.add('p1');
  creator.runtime.command({ type: 'action', action: 'start' });
  for (let elapsed = 0; elapsed < 200 && attempts.length === 0; elapsed += 10) room.advance(10);
  assert.equal(attempts.length, 1);
  room.advance(90);
  assert.equal(attempts.length, 1, 'failed enqueue waits 100 ms');
  room.advance(10);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1] - attempts[0], 100);
  room.advance(490);
  assert.equal(attempts.length, 2, 'queued metadata must not flood a delayed acknowledgement');
  room.advance(10);
  assert.equal(attempts.length, 3);
  assert.equal(attempts[2] - attempts[1], 500);
  acknowledge = true;
  room.advance(500);
  assert.equal(attempts.length, 4);
  assert.equal(attempts[3] - attempts[2], 500);
  room.advance(600);
  assert.equal(attempts.length, 4, 'validated acknowledgement ends header retries');
  assert.equal(guest.runtime.replicationDiagnostics.barrier, true, 'delivery is not readiness');
  assert.equal(guest.view?.phase, 'lobby');
  room.checkpointBlocked.delete('p1');
  room.advance(1600);
  assert.equal(guest.runtime.replicationDiagnostics.barrier, false);
  assert.equal(guest.view?.phase, 'countdown');
});

test('stale or malformed header acknowledgements cannot stop preparation delivery',()=>{
 const room=setup(),creator=room.members.get('p0')!,guest=room.members.get('p1')!;
  guest.callbacks.authorityChanged?.(); // Retain the fence, but require transfer after authority-scope invalidation.
 room.accept((from,_to,raw)=>!(from==='p1'&&raw&&typeof raw==='object'&&'type' in raw&&raw.type==='directHeader'));
 room.checkpointBlocked.add('p1');creator.runtime.command({type:'action',action:'start'});room.advance(200);
 const revision=guest.runtime.replicationDiagnostics.alias!;
 const headers=()=>room.sends.filter(m=>m.to==='p1'&&m.type==='directPrepare').length;
 creator.callbacks.message('p1',{type:'directHeader',revision:revision-1});creator.callbacks.message('p1',{type:'directHeader',revision,extra:true});
 const before=headers();room.advance(500);assert.ok(headers()>before);
 creator.callbacks.message('p1',{type:'directHeader',revision,needsPayload:true});const acknowledged=headers();room.advance(600);assert.equal(headers(),acknowledged);
 assert.equal(guest.runtime.replicationDiagnostics.barrier,true);
});

test('checkpoint chunks alternate eligible recipients with one successful enqueue per scheduler tick',()=>{
 const room=setup(),creator=room.members.get('p0')!;
 for (const id of ['p1', 'p2']) room.members.get(id)!.callbacks.authorityChanged?.();
 const chunks:{to:string;at:number;offset:number;bytes:number}[]=[];
 room.accept((from,to,raw)=>{
  if(from==='p0'&&raw&&typeof raw==='object'&&'type' in raw&&raw.type==='directChunk'&&'offset' in raw&&typeof raw.offset==='number'&&'data' in raw&&raw.data instanceof Uint8Array)chunks.push({to,at:room.now(),offset:raw.offset,bytes:raw.data.byteLength});
  return true;
 });
 creator.runtime.command({type:'action',action:'start'});room.advance(1200);
 assert.ok(chunks.length>=4);assert.deepEqual(chunks.slice(0,2).map(c=>c.to).sort(),['p1','p2']);assert.equal(new Set(chunks.map(c=>c.at)).size,chunks.length);
 for(const to of ['p1','p2']){let offset=0,at=-Infinity;for(const chunk of chunks.filter(c=>c.to===to)){assert.equal(chunk.offset,offset);assert.ok(chunk.bytes<=2000);assert.ok(chunk.at-at>=50);offset+=chunk.bytes;at=chunk.at;}}
 assert.ok([...room.members.values()].every(m=>!m.runtime.replicationDiagnostics.barrier));
});

test('synchronous authority replacement during a chunk send retires the old transfer immediately',()=>{
 const room=setup(),creator=room.members.get('p0')!;let chunks=0;
 for (const id of ['p1', 'p2']) room.members.get(id)!.callbacks.authorityChanged?.();
 room.accept((from,_to,raw)=>{
  if(from==='p0'&&raw&&typeof raw==='object'&&'type' in raw&&raw.type==='directChunk'){chunks++;creator.callbacks.authorityChanged?.();}
  return true;
 });
 creator.runtime.command({type:'action',action:'start'});room.advance(300);
 assert.equal(chunks,1);assert.equal(creator.runtime.replicationDiagnostics.alias,undefined);assert.equal(creator.runtime.replicationDiagnostics.barrier,false);
});

test('synchronous end during a header send stops other recipient sends in the same tick',()=>{
 const room=setup(),creator=room.members.get('p0')!;let headers=0,sentAfterEnd=0;
 room.accept((from,_to,raw)=>{
  if(from==='p0'){
   if(headers)sentAfterEnd++;
   if(raw&&typeof raw==='object'&&'type' in raw&&raw.type==='directPrepare'){headers++;creator.callbacks.ended?.();}
  }
  return true;
 });
 creator.runtime.command({type:'action',action:'start'});room.advance(300);
 assert.equal(headers,1);assert.equal(sentAfterEnd,0);assert.equal(creator.tick,undefined);assert.equal(creator.view?.phase,'lobby');
});

test('persistent checkpoint backpressure cannot extend the recovery deadline indefinitely', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  guest.callbacks.authorityChanged?.(); // Retain the fence, but require transfer after authority-scope invalidation.
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
  guest.callbacks.authorityChanged?.(); // Retain the fence, but require transfer after authority-scope invalidation.
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


test('settled room metadata stops repeating until a lifecycle change', () => {
  const room = setup(); room.sends.length = 0; room.advance(1200);
  assert.equal(room.sends.filter(m => m.type === 'directHello' || m.type === 'directPlan').length, 0);
  room.members.get('p0')!.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), length: 2 } });
  room.advance(1800);
  assert.ok(room.sends.some(m => m.type === 'directPlan'));
  room.sends.length = 0; room.advance(1200);
  assert.equal(room.sends.filter(m => m.type === 'directHello' || m.type === 'directPlan').length, 0);
});

test('a rejected plan enqueue and missing acknowledgement retry without reinstalling the plan', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  let planRejected = false, ackRejected = false;
  room.accept((from, to, raw) => {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return true;
    if (from === 'p0' && to === 'p1' && raw.type === 'directPlan' && !planRejected) { planRejected = true; return false; }
    if (from === 'p1' && to === 'p0' && raw.type === 'directPlanAck' && !ackRejected) { ackRejected = true; return false; }
    return true;
  });
  const before = guest.runtime.replicationDiagnostics.alias!;
  creator.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), length: 2 } }); room.advance(2000);
  assert.equal(planRejected, true); assert.equal(ackRejected, true);
  assert.equal(guest.runtime.replicationDiagnostics.alias, before + 1);
  assert.equal(guest.runtime.replicationDiagnostics.barrier, false);
  assert.equal(guest.runtime.replicationDiagnostics.recoveryRequired, false);
  room.sends.length = 0; room.advance(1000);
  assert.equal(room.sends.filter(m => m.type === 'directPlan').length, 0);
});


test('stale and foreign acknowledgements cannot stop paced plan delivery, even with duplicate hellos', () => {
  const room = setup(), creator = room.members.get('p0')!;
  room.accept((from, _to, raw) => !(from === 'p1' && raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directPlanAck'));
  creator.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), length: 2 } }); room.advance(100);
  const revision = creator.runtime.replicationDiagnostics.alias!;
  creator.callbacks.message('p1', { type: 'directPlanAck', revision: revision - 1 });
  creator.callbacks.message('foreign', { type: 'directPlanAck', revision });
  room.sends.length = 0;
  for (let i = 0; i < 60; i++) {
    creator.callbacks.message('p1', { type: 'directHello', rules: DIRECT_RULES, display: false }); room.advance(10);
  }
  const retries = room.sends.filter(m => m.to === 'p1' && m.type === 'directPlan');
  assert.ok(retries.length >= 2 && retries.length <= 3, `${retries.length} paced retries`);
  creator.callbacks.message('p1', { type: 'directPlanAck', revision });
  room.sends.length = 0; room.advance(1000);
  assert.equal(room.sends.filter(m => m.to === 'p1' && m.type === 'directPlan').length, 0);
});

test('only an identical current plan duplicate receives another delivery acknowledgement', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  let plan: RoomPlan | undefined;
  room.accept((from, to, raw) => { if (from === 'p0' && to === 'p1' && isPlan(raw)) plan = structuredClone(raw); return true; });
  creator.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), length: 2 } }); room.advance(1800); assert.ok(plan);
  const view = structuredClone(guest.view), alias = guest.runtime.replicationDiagnostics.alias;
  room.sends.length = 0;
  guest.callbacks.message('p0', { ...plan, settings: { ...plan.settings, length: 20 } });
  guest.callbacks.message('p0', { ...plan, revision: plan.revision - 1 });
  assert.equal(room.sends.filter(m => m.type === 'directPlanAck').length, 0);
  guest.callbacks.message('p0', plan);
  assert.equal(room.sends.filter(m => m.type === 'directPlanAck').length, 1);
  assert.equal(guest.runtime.replicationDiagnostics.alias, alias);
  assert.deepEqual(guest.view, view);
});


test('delegated setup request retries do not resend an already acknowledged room plan', () => {
  const room = setup(true), creator = room.members.get('p0')!;
  room.accept((from, to, raw) => !(from === 'p1' && to === 'tv' && raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directReady'));
  room.sends.length = 0;
  creator.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), mode: 'shared', length: 2 } }); room.advance(1400);
  assert.ok(room.sends.filter(m => m.from === 'tv' && m.type === 'directPlanRequest').length >= 3);
  assert.equal(room.sends.filter(m => m.to === 'tv' && m.type === 'directPlan').length, 1);
  assert.equal(room.members.get('tv')!.runtime.replicationDiagnostics.barrier, true);
  assert.equal(room.members.get('tv')!.runtime.replicationDiagnostics.recoveryRequired, false);
});


test('an intentionally idle shared lobby does not keep a previous simulation recovery deadline running', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  guest.callbacks.linkReset?.('p0'); room.advance(20);
  creator.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), mode: 'shared' } }); room.advance(20000);
  for (const member of room.members.values()) {
    assert.equal(member.runtime.replicationDiagnostics.coordinator, null);
    assert.equal(member.runtime.replicationDiagnostics.simulator, false);
    assert.equal(member.runtime.replicationDiagnostics.recoveryRequired, false);
  }
  const tv = room.add('tv', true); for (const [id, member] of room.members) if (id !== 'tv') member.callbacks.peer('tv', true); tv.runtime.start(); room.advance(2000);
  assert.equal(tv.runtime.replicationDiagnostics.simulator, true);
  for (const member of room.members.values()) assert.equal(member.runtime.replicationDiagnostics.recoveryRequired, false);
});


test('freezing a runtime deactivates its installed alias before another preparation',()=>{
  const room=setup(),creator=room.members.get('p0')!;
  const alias=creator.runtime.replicationDiagnostics.alias!;room.sends.length=0;
  creator.runtime.command({type:'settings',settings:{...defaultRoomSettings(),length:2}});room.advance(10);
  assert.ok(room.sends.some(m=>m.from==='p0'&&m.type===`deactivate:${alias}`));
  room.advance(2000);assert.equal(creator.runtime.replicationDiagnostics.barrier,false);
  assert.ok(room.sends.some(m=>m.from==='p0'&&m.type.startsWith('activate:')&&m.type!==`activate:${alias}`));
});


test('exact lifecycle bases activate without checkpoint chunks even when the bulk lane is blocked', () => {
  const room = setup(), creator = room.members.get('p0')!;
  for (const id of ['p1', 'p2']) room.checkpointBlocked.add(id);
  const before = room.sends.filter(m => m.type === 'directChunk').length;
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(4300);
  assert.equal(room.sends.filter(m => m.type === 'directChunk').length, before);
  for (const member of room.members.values()) {
    assert.equal(member.view?.phase, 'playing');
    assert.equal(member.runtime.replicationDiagnostics.barrier, false);
    assert.equal(member.runtime.replicationDiagnostics.lastFault, undefined);
  }
});

test('only a peer without an eligible base downloads the lifecycle payload', () => {
  const room = setup(), creator = room.members.get('p0')!;
  room.members.get('p1')!.callbacks.authorityChanged?.();
  const chunks: string[] = [];
  room.accept((_from, to, raw) => { if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directChunk') chunks.push(to); return true; });
  room.checkpointBlocked.add('p2');
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(4300);
  assert.ok(chunks.length > 0); assert.deepEqual([...new Set(chunks)], ['p1']);
  for (const member of room.members.values()) assert.equal(member.view?.phase, 'playing');
});

test('a conflicting payload ACK fails the current preparation without accepting a new transfer mode', () => {
  const room = setup(), creator = room.members.get('p0')!;
  let ack: unknown;
  room.accept((from, _to, raw) => { if (from === 'p1' && raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directHeader') ack = structuredClone(raw); return !(raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directReady'); });
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(200);
  assert.ok(ack && typeof ack === 'object' && 'needsPayload' in ack);
  const before = room.sends.filter(m => m.type === 'directChunk').length;
  creator.callbacks.message('p1', { ...ack, needsPayload: !ack.needsPayload }); room.advance(10);
  assert.equal(room.sends.filter(m => m.type === 'directChunk').length, before);
  assert.match(creator.runtime.replicationDiagnostics.lastFault ?? '', /Conflicting checkpoint requirement/);
});

test('delayed remote rendering preserves immediate local steering without advancing simulation or sending packets', () => {
  const room = setup(), creator = room.members.get('p0')!;
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(4300);
  let before = creator.runtime.renderSnapshot()!;
  for (let i = 0; i < 5 && before.players[0].x === creator.view!.players[0].x; i++) { room.advance(10); before = creator.runtime.renderSnapshot()!; }
  assert.equal(before.phase, 'playing');
  assert.ok(before.tick < creator.runtime.replicationDiagnostics.replicaTick!);
  assert.equal(creator.runtime.command({ type: 'input', seq: 1, left: true, right: false, bomb: false }), true);
  const tick = creator.runtime.replicationDiagnostics.replicaTick, sent = room.sends.length;
  const after = creator.runtime.renderSnapshot()!;
  assert.notEqual(after.players.find(p => p.id === 'p0')!.angle, before.players.find(p => p.id === 'p0')!.angle);
  assert.deepEqual(after.players.find(p => p.id === 'p1'), before.players.find(p => p.id === 'p1'));
  const local = after.players.find(p => p.id === 'p0')!;
  assert.equal(local.trail.at(-1)!.x2, local.x); assert.equal(local.trail.at(-1)!.y2, local.y);
  assert.equal(creator.runtime.replicationDiagnostics.replicaTick, tick); assert.equal(room.sends.length, sent);
  assert.ok(creator.runtime.replicationDiagnostics.presentationBytes > 0);
});

test('an unqualified clock freezes the complete last rendered scene including the local overlay', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(4320);
  const before = structuredClone(guest.runtime.renderSnapshot());
  room.unscheduled.add('p1'); room.silent.add('p1'); room.advance(1100);
  assert.deepEqual(guest.runtime.renderSnapshot(), before);
  room.advance(100); assert.deepEqual(guest.runtime.renderSnapshot(), before);
});

test('discarding the simulator retires cached rendering and idle catalogs stay current before TV activation', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(4320);
  assert.equal(creator.runtime.renderSnapshot()!.phase, 'playing');
  creator.runtime.command({ type: 'action', action: 'lobby' }); room.advance(1800);
  assert.equal(creator.runtime.renderSnapshot()!.phase, 'lobby');
  creator.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), mode: 'shared' } }); room.advance(1800);
  assert.equal(creator.runtime.replicationDiagnostics.simulator, false);
  assert.deepEqual(creator.runtime.renderSnapshot(), creator.view);
  assert.equal(creator.runtime.command({ type: 'bot', action: 'add' }), true); room.advance(1000);
  assert.equal(creator.view!.players.length, 4, 'the management operation changed the idle catalog');
  assert.deepEqual(creator.runtime.renderSnapshot(), creator.view);
  const tv = room.add('tv', true); for (const [id, member] of room.members) if (id !== 'tv') member.callbacks.peer('tv', true); tv.runtime.start(); room.advance(2000);
  assert.equal(tv.runtime.replicationDiagnostics.simulator, true); assert.equal(tv.runtime.renderSnapshot()!.phase, 'lobby');
  assert.deepEqual(creator.runtime.renderSnapshot(), creator.view);
});

test('individual views and shared-TV controllers play consecutive rounds in one segment without checkpoint traffic', () => {
  for (const shared of [false, true]) {
    const room = setup(shared), creator = room.members.get('p0')!;
    creator.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), mode: shared ? 'shared' : 'devices', match: 'rounds', length: 2 } });
    room.advance(1800);
    creator.runtime.command({ type: 'action', action: 'start' }); room.advance(1800);
    const alias = creator.runtime.replicationDiagnostics.alias;
    const metadata = () => room.sends.filter(m => ['directPrepare', 'directChunk', 'directActivate'].includes(m.type)).length;
    const before = metadata(), rounds = new Map([...room.members.keys()].map(id => [id, new Set<number>()]));
    for (let elapsed = 0; elapsed < 90000 && ![...room.members.values()].every(m => m.view?.phase === 'matchOver'); elapsed += 50) {
      room.advance(50);
      for (const [id, member] of room.members) {
        if (member.view?.phase === 'playing') rounds.get(id)!.add(member.view.round);
        assert.equal(member.runtime.replicationDiagnostics.alias, alias);
        assert.equal(member.runtime.replicationDiagnostics.lastFault, undefined);
      }
    }
    assert.equal(metadata(), before, 'automatic next-round transition sends no lifecycle traffic');
    for (const [id, member] of room.members) {
      assert.equal(member.view?.phase, 'matchOver', id);
      assert.equal(member.view?.round, 2);
      assert.deepEqual([...rounds.get(id)!], [1, 2]);
      assert.equal(member.runtime.replicationDiagnostics.simulator, !shared || id === 'tv');
      assert.deepEqual(member.view?.leaderboard, creator.view?.leaderboard);
    }
  }
});

test('shared-controller statuses retain departed human and exact bot identities across rounds', () => {
  const room = setup(true), creator = room.members.get('p0')!, tv = room.members.get('tv')!;
  creator.runtime.command({ type: 'bot', action: 'add' }); room.advance(1800);
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(4300);
  assert.equal(creator.view?.phase, 'playing');
  room.remove('p1'); room.advance(2200);
  assert.equal(creator.view?.players.find(p => p.id === 'p1')?.connected, false);
  assert.equal(creator.runtime.replicationDiagnostics.simulator, false);
  assert.equal(creator.view?.round, tv.view?.round);
  let latest: { type: string; revision: number; sequence: number; matchId: string; view: ViewSnapshot } | undefined;
  room.accept((from, to, raw) => {
    if (from === 'tv' && to === 'p0' && raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directStatus')
      latest = structuredClone(raw) as NonNullable<typeof latest>;
    return true;
  });
  const round = creator.view!.round;
  for (let elapsed = 0; elapsed < 45000 && creator.view!.round === round; elapsed += 50) room.advance(50);
  assert.ok(creator.view!.round > round);
  assert.equal(creator.view?.round, tv.view?.round);
  assert.ok(latest);
  room.accept(() => false);
  const before = structuredClone(creator.view!);
  for (const view of [
    { ...latest.view, round: latest.view.round - 1 },
    { ...latest.view, tick: latest.view.tick - 1 },
    { ...latest.view, players: latest.view.players.map(p => p.id.startsWith('bot:') ? { ...p, id: 'bot:impostor' } : p) },
  ]) {
    assert.notDeepEqual(view, latest.view);
    creator.callbacks.message('tv', unpackMessage(packMessage({ ...latest, sequence: latest.sequence + 1, view })));
    assert.deepEqual(creator.view, before, 'regression or identity substitution cannot replace accepted status');
  }
});

test('only the installed coordinator pause freezes play while a delayed replacement plan arrives', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(4300);
  const alias = guest.runtime.replicationDiagnostics.alias!;
  guest.callbacks.paused?.('p2', alias); guest.callbacks.paused?.('p0', alias - 1); room.advance(50);
  assert.equal(guest.runtime.replicationDiagnostics.fault, undefined);
  let hold = true;
  room.accept((from, to, raw) => !(hold && from === 'p0' && to === 'p1' && raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directPlan'));
  creator.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), length: 5 } }); room.advance(10);
  guest.callbacks.paused?.('p0', alias);
  const tick = guest.runtime.replicationDiagnostics.replicaTick;
  const frozenView = structuredClone(guest.view), frozenRender = structuredClone(guest.runtime.renderSnapshot());
  room.advance(2200);
  assert.deepEqual(guest.view, frozenView); assert.deepEqual(guest.runtime.renderSnapshot(), frozenRender);
  assert.equal(guest.runtime.replicationDiagnostics.replicaTick, tick);
  assert.equal(guest.runtime.replicationDiagnostics.lastFault, undefined);
  assert.equal(guest.runtime.replicationDiagnostics.recoveryRequired, false);
  hold = false; room.advance(1800);
  assert.ok(guest.runtime.replicationDiagnostics.alias! > alias);
  assert.equal(guest.runtime.replicationDiagnostics.fault, undefined);
  assert.equal(guest.runtime.replicationDiagnostics.lastFault, undefined);
});

test('duplicate coordinator pauses cannot postpone the missing-plan recovery deadline', () => {
  const room = setup(), guest = room.members.get('p1')!;
  let plan: RoomPlan | undefined;
  room.accept((_from, _to, raw) => { if (isPlan(raw)) plan = structuredClone(raw); return true; });
  room.members.get('p0')!.runtime.command({ type: 'settings', settings: defaultRoomSettings() }); room.advance(1800);
  assert.ok(plan);
  const alias = guest.runtime.replicationDiagnostics.alias!;
  room.silent.add('p0'); guest.callbacks.paused?.('p0', alias);
  for (let elapsed = 0; elapsed < 5000; elapsed += 100) { room.advance(100); guest.callbacks.paused?.('p0', alias); guest.callbacks.message('p0', structuredClone(plan)); }
  assert.equal(guest.runtime.replicationDiagnostics.lastFault, undefined);
  room.advance(10);
  assert.equal(guest.runtime.replicationDiagnostics.lastFault, 'Coordinator transition timed out — synchronizing');
  room.advance(10);
  assert.ok(room.sends.some(m => m.from === 'p1' && m.type === 'directRecover'), 'missing plan enters bounded recovery');
  room.advance(5100);
  assert.equal(guest.runtime.replicationDiagnostics.recoveryRequired, true);
});

test('a paused controller keeps its published scene despite queued old-segment status', () => {
  const room = setup(true), creator = room.members.get('p0')!;
  let status: Record<string, unknown> | undefined;
  room.accept((from, to, raw) => {
    if (from === 'tv' && to === 'p0' && raw && typeof raw === 'object' && 'type' in raw && raw.type === 'directStatus') status = structuredClone(raw) as Record<string, unknown>;
    return true;
  });
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(4300);
  assert.ok(status);
  creator.callbacks.paused?.('tv', creator.runtime.replicationDiagnostics.alias!);
  const frozen = structuredClone(creator.view!), frozenRender = structuredClone(creator.runtime.renderSnapshot());
  creator.callbacks.message('tv', { ...status, sequence: 0xffff_ffff, view: { ...frozen, tick: frozen.tick + 10 } });
  room.advance(1000);
  assert.deepEqual(creator.view, frozen);
  assert.deepEqual(creator.runtime.renderSnapshot(), frozenRender);
  assert.equal(creator.runtime.replicationDiagnostics.lastFault, undefined);
});


for (const delayed of ['p0', 'p1']) test(`transient pulse activation failure on ${delayed} retains the frozen world and retries the same prepared match`, () => {
  const room = setup(), guest = room.members.get(delayed)!;
  const before = structuredClone(guest.view);
  let available = false;
  room.activation((from, to) => from !== delayed || to !== 'p2' || available);
  room.members.get('p0')!.runtime.command({ type: 'action', action: 'start' });
  room.advance(250);
  const alias = guest.runtime.replicationDiagnostics.alias!;
  assert.ok(room.sends.some(s => s.from === delayed && s.type === `activate:${alias}` && !s.accepted), 'activation lost readiness after preparation');
  assert.equal(guest.runtime.replicationDiagnostics.barrier, true);
  assert.equal(guest.runtime.replicationDiagnostics.fault, 'Segment replaced', 'old world remains stopped until every pulse binding activates');
  assert.equal(guest.runtime.replicationDiagnostics.lastFault, undefined);
  assert.deepEqual(guest.view, before, 'failed activation cannot publish a partial new match');
  available = true; room.advance(4300);
  for (const member of room.members.values()) {
    assert.equal(member.runtime.replicationDiagnostics.alias, alias, 'same preparation survives the transient lapse');
    assert.equal(member.runtime.replicationDiagnostics.lastFault, undefined);
    assert.equal(member.runtime.replicationDiagnostics.barrier, false);
    assert.equal(member.view?.phase, 'playing');
  }
});

test('permanently unavailable pulse activation retains the bounded setup and recovery deadlines', () => {
  const room = setup(), creator = room.members.get('p0')!;
  room.activation(from => from !== 'p0');
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(4500);
  assert.equal(creator.runtime.replicationDiagnostics.barrier, true);
  assert.equal(creator.runtime.replicationDiagnostics.lastFault, undefined, 'activation retries do not restart setup');
  room.advance(1500);
  assert.ok(creator.notices.some(s => /setup timed out|confirmed the lifecycle/.test(s)), 'original setup deadline still expires');
  room.advance(16000);
  assert.equal(creator.runtime.replicationDiagnostics.recoveryRequired, true, 'repeated setup cannot extend the unsuccessful episode');
});

test('authority replacement during pulse activation cannot publish or acknowledge the retired preparation', () => {
  const room = setup(), guest = room.members.get('p1')!;
  const before = structuredClone(guest.view); let replaced = false;
  room.activation(from => {
    if (from === 'p1' && !replaced) { replaced = true; guest.callbacks.authorityChanged?.(); }
    return true;
  });
  room.members.get('p0')!.runtime.command({ type: 'action', action: 'start' }); room.advance(200);
  assert.equal(replaced, true);
  assert.equal(guest.runtime.replicationDiagnostics.alias, undefined);
  assert.deepEqual(guest.view, before);
  assert.equal(guest.runtime.replicationDiagnostics.fault, 'Segment replaced');
});


test('an activation callback cannot install a prepared world after setup expiry before the scheduler runs', () => {
  const room = setup(), creator = room.members.get('p0')!;
  room.activation(from => from !== 'p0');
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(250);
  const revision = creator.runtime.replicationDiagnostics.alias!, before = structuredClone(creator.view);
  const attempts = room.sends.filter(s => s.from === 'p0' && s.type === `activate:${revision}`).length;
  room.activation(() => true); room.jumpClock(5100);
  creator.callbacks.message('p0', { type: 'directActivate', revision });
  assert.equal(room.sends.filter(s => s.from === 'p0' && s.type === `activate:${revision}`).length, attempts, 'expired setup cannot activate any binding');
  assert.equal(creator.runtime.replicationDiagnostics.barrier, true);
  assert.deepEqual(creator.view, before);
  creator.tick?.();
  assert.ok(creator.notices.some(s => s.includes('setup timed out')), 'scheduler takes the existing bounded recovery path');
});

test('delayed finality certificates do not force checkpoint transfers for a retained lifecycle base', () => {
  const room = setup(), creator = room.members.get('p0')!, guest = room.members.get('p1')!;
  creator.runtime.command({ type: 'action', action: 'start' }); room.advance(4300);
  let withhold = true;
  room.accept((from, to, raw) => {
    if (!withhold || from !== 'p0' || to !== 'p1') return true;
    const packet: unknown = raw instanceof Uint8Array ? unpackMessage(raw) : raw;
    if (!Array.isArray(packet)) return true;
    return packet[2] !== 'final' && !([10, 11].includes(packet[2]) && packet[5]?.[3]);
  });
  room.advance(1200);
  assert.ok(guest.runtime.replicationDiagnostics.finalizedTick! < creator.runtime.replicationDiagnostics.finalizedTick!, 'guest has not received the latest source finality');
  assert.ok(guest.runtime.replicationDiagnostics.replicaTick! >= creator.runtime.replicationDiagnostics.finalizedTick!, 'guest retains the requested tick');
  room.checkpointBlocked.add('p1');
  const before = room.sends.length;
  creator.runtime.command({ type: 'settings', settings: { ...defaultRoomSettings(), length: 5 } });
  room.advance(200); withhold = false; room.advance(2000);
  for (const member of room.members.values()) {
    assert.equal(member.runtime.replicationDiagnostics.barrier, false);
    assert.equal(member.runtime.replicationDiagnostics.lastFault, undefined);
  }
  assert.ok(!room.sends.slice(before).some(s => s.to === 'p1' && s.type === 'directChunk'), 'retained source tick activates while the bulk lane remains blocked');
});
