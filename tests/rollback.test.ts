import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, TickClock, MAX_ADVANCE_TICKS, MAX_FUTURE_TICKS, SNAPSHOT_COUNT, SNAPSHOT_EVERY_TICKS } from '../src/online/rollback.js';
import { StreamSender } from '../src/online/stream.js';
import { cloneState, createReplayState, edgesFrom, replayHash, ROLLBACK_WINDOW_TICKS, type EntryBody, type LogEntry, type ReplayState } from '../src/shared/action-log.js';
import { BotController, botRandom } from '../src/shared/bot-controller.js';
import { createGame } from '../src/shared/game.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import type { GameEvent } from '../src/shared/protocol.js';

const HOST = 'host';
function seeded(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let v = s; v = Math.imul(v ^ (v >>> 15), v | 1); v ^= v + Math.imul(v ^ (v >>> 7), v | 61); return ((v ^ (v >>> 14)) >>> 0) / 0x100000000; }; }
function initial(): ReplayState { return createReplayState(createGame('match-1'), defaultRoomSettings()); }
const noop = () => {};
/** A room: host stream authors management; every member has a sender; a straight replica applies everything in order. */
function room(members: string[]) {
  const senders = new Map(members.map(id => [id, new StreamSender()]));
  const host = senders.get(HOST)!;
  const joins: LogEntry[] = members.map((id, slot) => host.append(0, [10, id, id.startsWith('bot:') ? 'AI' : id, slot, id.startsWith('bot:') ? 'robot' : null]));
  const start = host.append(0, [14, 'start', 'match-1']);
  const sim = () => { const s = new Simulation(cloneState(initial()), HOST); for (const e of [...joins, start]) assert.equal(s.insert(HOST, e), 'new'); return s; };
  return { senders, sim };
}
function run(sim: Simulation, to: number) { const events: string[] = []; const result = sim.advanceTo(to, (e, t) => events.push(`${t}:${e.type}`)); return { result, events }; }
/** Delivers entries on time: the receiver's clock stands at the entry's tick when it arrives, as it does on a healthy link. */
function feed(sim: Simulation, id: string, entries: LogEntry[]): string[] {
  const events: string[] = [];
  for (const e of entries) { events.push(...run(sim, Math.max(sim.tick, e[1] - 1)).events); assert.equal(sim.insert(id, e), 'new', `seq ${e[0]}`); }
  return events;
}

test('every arrival order of the same entries converges to one hash, and a late entry rewinds', () => {
  const { senders, sim } = room([HOST, 'guest']);
  const guest = senders.get('guest')!;
  const script: [number, EntryBody][] = [[70, [0, 1]], [72, [2, 1]], [80, [0, 2]], [86, [3, 1, null, null]], [95, [0, 0]], [100, [2, 2]], [106, [3, 2, 0.4, 0.6]]];
  const entries = script.map(([tick, body]) => guest.append(tick, body));
  const straight = sim(); feed(straight, 'guest', entries); run(straight, 200); const truth = replayHash(straight.state);
  const reversed = sim(); run(reversed, 95); for (const e of [...entries].reverse()) reversed.insert('guest', e); run(reversed, 200); assert.equal(replayHash(reversed.state), truth, 'reverse order');
  const late = sim(); const before = run(late, 108);
  assert.equal(before.result.status, 'ok');
  for (const e of entries) assert.equal(late.insert('guest', e), 'new', `seq ${e[0]}`);
  const after = run(late, 200);
  assert.equal(after.result.status, 'ok'); if (after.result.status === 'ok') assert.ok(after.result.rewound >= 20, `rewound ${after.result.rewound}`);
  assert.equal(replayHash(late.state), truth, 'late arrival');
  const dupe = late.insert('guest', entries[0]!); assert.equal(dupe, 'duplicate');
});
test('a stream with a gap applies nothing past the gap until repair, then converges', () => {
  const { senders, sim } = room([HOST, 'guest']); const guest = senders.get('guest')!;
  const a = guest.append(100, [2, 1]), b = guest.append(110, [3, 1, null, null]);
  const s = sim(); run(s, 99); s.insert('guest', b); run(s, 120);
  assert.equal([...s.state.game.bombs.values()].length, 0, 'the release cannot apply before its press');
  assert.deepEqual(s.gaps(), [['guest', 1]]);
  s.insert('guest', a); const r = run(s, 120); assert.equal(r.result.status, 'ok');
  assert.equal([...s.state.game.bombs.values()].filter(x => x.ownerId === 'guest').length, 1);
  const straight = sim(); feed(straight, 'guest', [a, b]); run(straight, 120);
  assert.equal(replayHash(s.state), replayHash(straight.state));
});
test('entries older than the ring need a baseline unless the authority clamps them forward', () => {
  const { senders, sim } = room([HOST, 'guest']); const guest = senders.get('guest')!;
  const old = guest.append(70, [0, 1]);
  const view = sim(); run(view, 200); assert.equal(view.insert('guest', old), 'invalid');
  const host = sim(); run(host, 200); assert.equal(host.insert('guest', old, true), 'clamped');
  const r = run(host, 210); assert.equal(r.result.status, 'ok'); assert.equal(host.state.streams.get('guest')!.flags, 1);
  const window = sim(); run(window, 100); const e2 = guest.append(70, [0, 2]);
  assert.equal(window.insert('guest', e2), 'new'); const r2 = run(window, 100); assert.equal(r2.result.status, 'ok');
});
test('management preconditions are part of the fold: a late join makes a previously ignored start succeed', () => {
  const senders = new Map([[HOST, new StreamSender()]]); const host = senders.get(HOST)!;
  const joinHost = host.append(0, [10, HOST, 'Host', 0, null]);
  const joinGuest = host.append(5, [10, 'guest', 'Guest', 1, null]);
  const start = host.append(10, [14, 'start', 'match-1']);
  const straight = new Simulation(cloneState(initial()), HOST); for (const e of [joinHost, joinGuest, start]) straight.insert(HOST, e); run(straight, 20);
  assert.equal(straight.state.game.phase, 'countdown');
  const late = new Simulation(cloneState(initial()), HOST); late.insert(HOST, joinHost); late.insert(HOST, start); run(late, 20);
  assert.equal(late.state.game.phase, 'lobby', 'start with one player is a no-op');
  late.insert(HOST, joinGuest); run(late, 20);
  assert.equal(late.state.game.phase, 'countdown'); assert.equal(replayHash(late.state), replayHash(straight.state));
});
test('a rewind across a phase boundary replays the transition and emits each event once by content', () => {
  const { senders, sim } = room([HOST, 'guest']); const guest = senders.get('guest')!;
  const straight = sim(); const view = sim();
  run(view, 66);
  const press = guest.append(55, [0, 1]), fire = guest.append(75, [2, 1]), release = guest.append(76, [3, 1, null, null]);
  const early = feed(straight, 'guest', [press, fire, release]); const rest = run(straight, 140); const truth = [...early, ...rest.events];
  for (const e of [press, fire, release]) view.insert('guest', e); const first = run(view, 100); const second = run(view, 140);
  assert.equal(replayHash(view.state), replayHash(straight.state));
  assert.deepEqual([...first.events, ...second.events], truth, 'events are emitted once and in order');
  assert.ok(truth.some(e => e.endsWith('bombPlaced')) && truth.some(e => e.endsWith('playerEliminated')), 'the shot and the round end both replayed');
});
test('bot entries authored once by the creator replay identically after a rewind', () => {
  const { senders, sim } = room([HOST, 'bot:1', 'bot:2']); const bots = new BotController({ random: botRandom });
  const host = sim(); const mirror = sim(); let gesture = 0;
  const previous = new Map<string, { flags: number; aim?: { x: number; y: number }; gesture?: number }>();
  const authored: [string, LogEntry][] = [];
  for (let t = 1; t <= 120; t++) {
    for (const id of ['bot:1', 'bot:2']) {
      const prev = previous.get(id) ?? { flags: 0 };
      const intent = bots.input(host.state.game, id);
      for (const body of edgesFrom(prev, intent, () => ++gesture)) { const e = senders.get(id)!.append(t, body); authored.push([id, e]); host.insert(id, e); }
      const s = host.state.streams.get(id);
      previous.set(id, { flags: Number(intent.left) | Number(intent.right) << 1, ...(intent.aim ? { aim: intent.aim } : {}), ...(s?.gesture === undefined ? {} : { gesture: s.gesture }) });
    }
    run(host, t);
  }
  const straightHash = replayHash(host.state);
  for (const [id, e] of authored) if (e[1] <= 90) { run(mirror, e[1] - 1); assert.equal(mirror.insert(id, e), 'new'); }
  run(mirror, 110); for (const [id, e] of authored) if (e[1] > 90) assert.equal(mirror.insert(id, e), 'new'); const r = run(mirror, 120);
  assert.equal(r.result.status, 'ok'); if (r.result.status === 'ok') assert.ok(r.result.rewound > 0);
  assert.equal(replayHash(mirror.state), straightHash);
});
test('six replicas on a lossy, jittery, reordering network agree at every tick and every gap repairs', () => {
  const members = [HOST, 'p1', 'p2', 'p3', 'p4', 'p5'];
  const { senders, sim } = room(members);
  const replicas = new Map(members.map(id => [id, sim()]));
  const random = seeded(7); let gesture = 0;
  type Packet = { from: string; entries: LogEntry[]; at: number };
  const inFlight: { to: string; packet: Packet }[] = [];
  const deliveries = new Map<string, number>();
  for (let t = 1; t <= 400; t++) {
    for (const id of members) {
      const sender = senders.get(id)!, mine = replicas.get(id)!;
      if (random() < 0.15) { const body: EntryBody = random() < 0.7 ? [0, Math.floor(random() * 4) as 0 | 1 | 2 | 3] : mine.state.streams.get(id)?.gesture === undefined ? [2, ++gesture] : [3, mine.state.streams.get(id)!.gesture!, null, null]; const e = sender.append(t, body); mine.insert(id, e); }
      sender.retain(t);
      const packet: Packet = { from: id, entries: sender.next(), at: t };
      for (const to of members) if (to !== id && random() >= 0.05) inFlight.push({ to, packet: { ...packet, at: t + 1 + Math.floor(random() * 3) } });
    }
    for (const item of inFlight.splice(0).sort(() => random() - 0.5)) {
      if (item.packet.at > t) { inFlight.push(item); continue; }
      const replica = replicas.get(item.to)!;
      for (const e of item.packet.entries) { const r = replica.insert(item.packet.from, e); if (r === 'new') deliveries.set(item.to, (deliveries.get(item.to) ?? 0) + 1); assert.notEqual(r, 'invalid', `${item.to} refused an entry from ${item.packet.from} at tick ${t}`); }
    }
    for (const replica of replicas.values()) assert.equal(run(replica, t).result.status, 'ok', `tick ${t}`);
  }
  for (const item of inFlight) for (const e of item.packet.entries) replicas.get(item.to)!.insert(item.packet.from, e);
  for (const replica of replicas.values()) assert.equal(run(replica, 403).result.status, 'ok');
  for (const [id, replica] of replicas) assert.deepEqual(replica.gaps(), [], `${id} still has a gap`);
  const hashes = new Set([...replicas.values()].map(r => replayHash(r.state)));
  assert.equal(hashes.size, 1, 'all six replicas agree');
  assert.ok([...deliveries.values()].every(n => n > 0));
});
test('a baseline install replaces state and keeps buffered later entries', () => {
  const { senders, sim } = room([HOST, 'guest']); const guest = senders.get('guest')!;
  const truth = sim(); const early = guest.append(80, [0, 1]); feed(truth, 'guest', [early]); run(truth, 100);
  const later = guest.append(112, [0, 2]); truth.insert('guest', later);
  const view = sim(); run(view, 145); view.insert('guest', later);
  assert.equal(truth.folded('guest'), 1, 'the entry stamped after the snapshot is not folded');
  view.install(cloneState(truth.state), new Map([['guest', truth.folded('guest')], [HOST, truth.folded(HOST)]]));
  for (const e of truth.retained('guest')) view.insert('guest', e);
  assert.equal(view.tick, 100); run(view, 130); run(truth, 130);
  assert.equal(replayHash(view.state), replayHash(truth.state)); assert.equal(view.state.streams.get('guest')!.flags, 2);
});
test('an install drops what the baseline already contains and forgets a stream it does not mention', () => {
  const { senders, sim } = room([HOST, 'guest']); const guest = senders.get('guest')!;
  const truth = sim(); run(truth, 100);
  const view = sim(); run(view, 100);
  const stale = guest.append(90, [0, 1]);                       // buffered here, never seen by the authority
  assert.equal(view.insert('guest', stale), 'new');
  view.install(cloneState(truth.state), new Map([[HOST, truth.folded(HOST)]]));
  assert.equal(view.stream('guest').contiguous, 0, 'a stream the baseline does not know is cleared');
  assert.equal(view.retained('guest').length, 0);
  const again = sim(); run(again, 100); assert.equal(again.insert('guest', stale), 'new');
  again.install(cloneState(truth.state), new Map([[HOST, truth.folded(HOST)], ['guest', 0]]));
  const r = run(again, 120);
  assert.equal(r.result.status, 'ok', 'a pre-baseline entry must not send the view back for another baseline');
  assert.equal(again.retained('guest').length, 0, 'the unreachable entry is dropped, not left pending');
  assert.equal(again.folded('guest'), 1, 'contiguous never falls below what the install dropped');
  assert.equal(again.state.streams.get('guest')?.flags ?? 0, 0, 'and it is never folded');
});
test('the snapshot ring is at least as deep as the rollback window it advertises', () => {
  assert.ok((SNAPSHOT_COUNT - 1) * SNAPSHOT_EVERY_TICKS >= ROLLBACK_WINDOW_TICKS, 'a rewind must never replay ticks whose entries were pruned');
});
test('an accepted late entry never rewinds past the input the log still holds', () => {
  const { senders, sim } = room([HOST, 'guest']); const guest = senders.get('guest')!;
  const first = guest.append(158, [0, 1]), second = guest.append(158, [2, 1]);
  const view = sim(); feed(view, 'guest', [first, second]); run(view, 200);
  const third = guest.append(159, [3, 1, null, null]);
  assert.equal(view.insert('guest', third), 'new');
  const straight = sim(); feed(straight, 'guest', [first, second, third]); run(straight, 200);
  run(view, 200);
  assert.equal(replayHash(view.state), replayHash(straight.state), 'the rewind replayed every entry the straight fold saw');
  const oldest = guest.append(200 - ROLLBACK_WINDOW_TICKS, [0, 2]);
  assert.notEqual(view.insert('guest', oldest), 'invalid', 'the advertised window is honoured, not just the ring');
  run(view, 210);
});
test('a shuffled arrival of non-monotonic ticks stores the same effective ticks whatever the order', () => {
  const { sim } = room([HOST, 'guest']);
  const script: LogEntry[] = [[1, 50, 0, 1], [2, 60, 0, 2], [3, 55, 0, 3], [4, 58, 2, 1], [5, 70, 3, 1, null, null]];
  const orders = [[0, 1, 2, 3, 4], [0, 2, 1, 4, 3], [4, 3, 2, 1, 0], [2, 4, 0, 3, 1]];
  const hashes = new Set<string>(), stored = new Set<string>();
  for (const order of orders) {
    const s = sim(); run(s, 60);
    for (const i of order) assert.notEqual(s.insert('guest', structuredClone(script[i]!)), 'invalid');
    run(s, 120);
    hashes.add(replayHash(s.state)); stored.add(JSON.stringify(s.retained('guest')));
  }
  assert.equal(stored.size, 1, `arrival order changed the stored ticks: ${[...stored].join(' | ')}`);
  assert.equal(hashes.size, 1, 'and the fold with them');
});
test('an absurd tick is refused and a bogus target advances a bounded number of ticks', () => {
  const { sim } = room([HOST, 'guest']);
  const s = sim(); run(s, 50);
  assert.equal(s.insert('guest', [1, Number.MAX_SAFE_INTEGER, 0, 1]), 'invalid', 'nothing could ever prune it');
  assert.equal(s.insert('guest', [1, 50 + MAX_FUTURE_TICKS + 1, 0, 1]), 'invalid');
  assert.equal(s.insert('guest', [1, 50 + MAX_FUTURE_TICKS, 0, 1]), 'new', 'the bound itself is still held and folded');
  const before = s.tick; run(s, 1e9);
  assert.equal(s.tick, before + MAX_ADVANCE_TICKS, 'one call simulates at most MAX_ADVANCE_TICKS');
});
test('a clamped tick is written back into the entry the caller handed over, so a relay sends what was folded', () => {
  const { senders, sim } = room([HOST, 'guest']); const guest = senders.get('guest')!;
  const old = guest.append(70, [0, 1]);
  const host = sim(); run(host, 200);
  assert.equal(host.insert('guest', old, true), 'clamped');
  assert.ok(old[1] > 70 && old[1] <= 200, `the caller now relays the tick that was actually folded, not ${old[1]}`);
  const peer = sim(); run(peer, 200); assert.equal(peer.insert('guest', old), 'new', 'and a peer at the same tick accepts it');
  run(host, 210); run(peer, 210);
  assert.equal(replayHash(peer.state), replayHash(host.state));
});
test('a rewind that moves an event to another tick does not emit it twice', () => {
  const { senders, sim } = room([HOST, 'guest']); const guest = senders.get('guest')!;
  const view = sim(); run(view, 54);
  const press = guest.append(55, [0, 1]); assert.equal(view.insert('guest', press), 'new');
  const events: string[] = []; const sink = (e: GameEvent, t: number) => events.push(`${t}:${e.type}`);
  view.advanceTo(105, sink);
  assert.ok(events.some(e => e.endsWith('playerEliminated')), 'the guest dies before the rewind');
  const late = guest.append(73, [0, 2]); assert.equal(view.insert('guest', late), 'new');
  view.advanceTo(140, sink);
  const dead = events.filter(e => e.endsWith('playerEliminated'));
  assert.equal(dead.length, 1, `the elimination moved tick and was emitted twice: ${dead.join(', ')}`);
});
test('the tick clock sets once, slews slowly, steps forward when far behind and re-locks after host silence', () => {
  let now = 0; const clock = new TickClock(() => now);
  assert.equal(clock.tick(), 0); assert.equal(clock.live, false);
  clock.observe(100, 40); assert.ok(Math.abs(clock.tick() - 100.4) < 1e-9); assert.equal(clock.live, true);
  now = 1000; assert.ok(Math.abs(clock.tick() - 120.4) < 1e-9);
  clock.observe(121.4, 40); now = 2000; assert.ok(clock.tick() <= 141.4 + 1e-9 && clock.tick() > 140.4, 'at most one tick per second of slew');
  clock.observe(160, 40); assert.ok(clock.tick() > 159, 'a jump of more than four ticks steps forward');
  now = 3500; assert.equal(clock.live, false); clock.observe(50, 40); assert.ok(Math.abs(clock.tick() - 50.4) < 1e-9, 'after silence the clock may step backwards');
  clock.observe(NaN, 40); clock.observe(60, -1); assert.ok(Math.abs(clock.tick() - 50.4) < 1e-9);
  clock.reset(); assert.equal(clock.tick(), 0);
});
test('the tick clock slews down as well as up and ignores an absurd sample while it is live', () => {
  let now = 0; const clock = new TickClock(() => now);
  clock.observe(100, 0); assert.equal(clock.tick(), 100);
  now = 500; clock.observe(109, 0);                       // the host is behind our estimate of it
  const after = clock.tick();
  assert.ok(after < 110 && after > 109, `slewed down to ${after}`);
  assert.ok(after >= 100, 'never below where the clock stood at the previous sample');
  now = 1000; clock.observe(1e9, 0);
  assert.ok(clock.tick() < 130, 'a hostile stamp cannot pin a live clock');
  assert.equal(clock.live, true, 'and the sample is dropped, not treated as silence');
});
void noop; void (0 as unknown as GameEvent);
