import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeNetwork, type NetworkOptions } from './fixtures/fake-room.js';
import { RoomRuntime, CREATOR_SILENCE_MS, DISCONNECT_MS, SNAPSHOT_RETRY_MS } from '../src/online/room-runtime.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { COUNTDOWN_TICKS } from '../src/shared/game.js';
import { roomHash, packMessage } from '../src/online/packet.js';
import { hashRoomState } from '../src/shared/apply-tick.js';

const settings = defaultRoomSettings();
const HOST = 'a-host', GUESTS = ['b-guest', 'c-guest', 'd-guest', 'e-guest'], TV = 'f-tv';
function room(options: NetworkOptions = { loss: 0, baseMs: 20, jitterMs: 0, reliableMs: 30 }, seed = 1) {
  const net = new FakeNetwork(HOST, options, seed);
  const join = (id: string, name: string) => { const runtime = net.add(id, settings, { humanName: name }); runtime.start(); runtime.command({ type: 'join', name }); return runtime; };
  return { net, join };
}
const world = (runtime: RoomRuntime) => (runtime as unknown as { world: { state: Parameters<typeof hashRoomState>[0]; tick: number } }).world;
const hashes = (net: FakeNetwork, ids: string[]) => new Set(ids.map(id => hashRoomState(world(net.runtimes.get(id)!).state)));

test('the creator opens a fresh world, seats joiners, adds bots and starts; everyone folds the same log', () => {
  const { net, join } = room();
  const host = join(HOST, 'Host'); net.step(200);
  assert.deepEqual(net.recorded.get(HOST)!.ready, [[HOST, true]]); assert.equal(net.frame(HOST)!.players.length, 1); assert.equal(net.frame(HOST)!.players[0]!.name, 'Host');
  const guest = join(GUESTS[0]!, 'Guest'); net.step(400);
  assert.deepEqual(net.recorded.get(GUESTS[0]!)!.ready, [[GUESTS[0]!, false]]);
  assert.deepEqual(net.frame(GUESTS[0]!)!.players.map(p => p.name), ['Host', 'Guest'], 'the guest received a snapshot and the join entry');
  assert.equal(host.command({ type: 'bot', action: 'add' }), true); assert.equal(guest.command({ type: 'bot', action: 'add' }), false);
  assert.equal(host.command({ type: 'action', action: 'start' }), true); net.step(100);
  assert.equal(net.frame(GUESTS[0]!)!.phase, 'countdown'); assert.equal(net.frame(GUESTS[0]!)!.players.length, 3);
  assert.equal(host.command({ type: 'action', action: 'start' }), false, 'already running');
  net.step(COUNTDOWN_TICKS * 50 + 200);
  assert.equal(net.frame(HOST)!.phase, 'playing'); assert.equal(net.frame(GUESTS[0]!)!.phase, 'playing');
  guest.command({ type: 'input', seq: 1, left: true, right: false, bomb: false }); guest.command({ type: 'input', seq: 2, left: true, right: false, bomb: false });
  net.step(500);
  assert.equal(hashes(net, [HOST, GUESTS[0]!]).size, 1);
  const angle = net.frame(HOST)!.players.find(p => p.id === GUESTS[0])!.angle; assert.notEqual(angle, net.frame(HOST)!.players.find(p => p.id === HOST)!.angle);
  assert.equal(net.runtimes.get(HOST)!.metrics().rtt[GUESTS[0]!], 40); assert.ok(Math.abs(net.runtimes.get(GUESTS[0]!)!.metrics().clockTick - net.runtimes.get(HOST)!.metrics().clockTick) < 1);
  assert.match(net.recorded.get(HOST)!.statuses.join('|'), /direct game link/);
  host.stop(); guest.stop();
});

test('five riders and a TV keep one world through 5% loss, 100 ms jitter and reordering; gaps repair within 600 ms', () => {
  const { net, join } = room({ loss: .05, baseMs: 20, jitterMs: 100, reliableMs: 40 }, 7);
  const host = join(HOST, 'Host'); net.step(200);
  const guests = GUESTS.map((id, index) => { const runtime = join(id, `Rider ${index}`); net.step(150); return runtime; });
  const tv = net.add(TV, settings, { displayOnly: true }); tv.start(); net.step(600);
  assert.equal(net.frame(TV)!.players.length, 5); assert.equal(host.command({ type: 'action', action: 'start' }), true);
  net.step(COUNTDOWN_TICKS * 50 + 300);
  let steer = 0, longestGapMs = 0; const gapSince = new Map<string, number>();
  for (let elapsed = 0; elapsed < 20_000; elapsed += 50) {
    for (const [index, guest] of guests.entries()) { const flags = Math.floor(((elapsed / 50) * 7 + index * 13) % 5); guest.command({ type: 'input', seq: ++steer, left: flags === 1, right: flags === 2, bomb: flags === 3, ...(flags === 3 ? { bombAction: 'press' as const } : flags === 4 ? { bombAction: 'release' as const } : {}) }); }
    net.step(50);
    for (const [id, runtime] of net.runtimes) for (const [from, stream] of world(runtime).state.folds.size ? (runtime as unknown as { world: { streams: Map<string, { gap: boolean }> } }).world.streams : []) {
      const key = `${id}<${from}`;
      if (stream.gap) { if (!gapSince.has(key)) gapSince.set(key, net.now); longestGapMs = Math.max(longestGapMs, net.now - gapSince.get(key)!); } else gapSince.delete(key);
    }
  }
  assert.ok(longestGapMs <= 600, `longest unrepaired gap ${longestGapMs} ms`);
  net.step(2500);
  assert.equal(hashes(net, [HOST, ...GUESTS, TV]).size, 1, 'every replica agrees once packets settle');
  assert.ok(net.droppedFast > 0); assert.ok([...net.runtimes.values()].some(runtime => runtime.metrics().rollbacks > 0), 'late packets rolled back');
  assert.ok([...net.runtimes.values()].every(runtime => runtime.metrics().mismatches === 0), 'no divergence');
  const perSecond = net.bytesFast / 6 / 5 / ((net.now) / 1000); assert.ok(perSecond < 15_000, `${Math.round(perSecond)} B/s per link`);
  assert.ok(world(host).state.game.round >= 1);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test('malformed, foreign and oversized fast packets change nothing; the clock tracks the authority under asymmetric delay', () => {
  const { net, join } = room({ loss: 0, baseMs: 20, jitterMs: 0, reliableMs: 30, oneWayMs: (from: string) => from === HOST ? 90 : 10 });
  const host = join(HOST, 'Host'); net.step(200); const guest = join(GUESTS[0]!, 'Guest'); net.step(1500);
  const before = hashRoomState(world(guest).state), tick = world(guest).tick;
  const transport = net.transports.get(GUESTS[0]!)!;
  for (const bytes of [new Uint8Array(600), packMessage([1, roomHash('other'), HOST, 1, 5, 0, [], 1, 0, 0, 1, null]), packMessage([1, roomHash('AB42:a-host'), 'someone', 1, 5, 0, [], 1, 0, 0, 1, null]), packMessage([2, 1, 'x', 1]), packMessage('junk'), packMessage([1, roomHash('AB42:a-host'), HOST, 1, 5, 99, [[1, 999999, 0, 1]], 1, 0, 0, 1, null])]) transport.events.fast(HOST, bytes);
  assert.equal(hashRoomState(world(guest).state), before); assert.equal(world(guest).tick, tick);
  net.step(4000);
  const drift = guest.metrics().clockTick - host.metrics().clockTick;
  assert.ok(Math.abs(drift) <= 1, `follower within one tick of the authority: ${drift}`);
  assert.equal(guest.metrics().rtt[HOST], 100);
  host.stop(); guest.stop();
});

test('a silent rider is marked absent after one second, play continues, and its return restores the seat', () => {
  const { net, join } = room();
  const host = join(HOST, 'Host'); net.step(200); const guest = join(GUESTS[0]!, 'Guest'); net.step(400);
  host.command({ type: 'action', action: 'start' }); net.step(COUNTDOWN_TICKS * 50 + 200);
  net.ticks.delete(GUESTS[0]!); // The guest's tab froze: no packets leave it.
  net.step(DISCONNECT_MS + 300);
  assert.equal(net.frame(HOST)!.players.find(p => p.id === GUESTS[0])!.connected, false);
  const stalled = world(host).tick; net.step(3000); assert.ok(world(host).tick > stalled + 40, 'the world keeps running past the absent rider');
  net.ticks.set(GUESTS[0]!, () => (guest as unknown as { tickLoop(): void }).tickLoop());
  net.step(3000);
  assert.equal(net.frame(HOST)!.players.find(p => p.id === GUESTS[0])!.connected, true, 'the creator re-enables a rider whose packets resumed');
  assert.equal(hashes(net, [HOST, GUESTS[0]!]).size, 1);
  host.stop(); guest.stop();
});

test('a guest refresh mid-round installs a snapshot with a new generation and converges', () => {
  const { net, join } = room({ loss: .02, baseMs: 15, jitterMs: 30, reliableMs: 30 }, 3);
  const host = join(HOST, 'Host'); net.step(200); join(GUESTS[0]!, 'Guest'); join(GUESTS[1]!, 'Other'); net.step(600);
  host.command({ type: 'action', action: 'start' }); net.step(COUNTDOWN_TICKS * 50 + 500);
  const reloaded = net.reload(GUESTS[0]!, settings, { humanName: 'Guest' }); reloaded.command({ type: 'join', name: 'Guest' });
  net.step(3000);
  assert.equal(net.frame(GUESTS[0]!)!.players.find(p => p.id === GUESTS[0])!.connected, true);
  reloaded.command({ type: 'input', seq: 1, left: false, right: true, bomb: false }); net.step(1500);
  assert.equal(hashes(net, [HOST, GUESTS[0]!, GUESTS[1]!]).size, 1);
  assert.ok(reloaded.metrics().tick > 0);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test('a creator refresh mid-round rejoins the running world from a peer; a creator silent for five seconds is delegated', () => {
  const { net, join } = room();
  let host = join(HOST, 'Host'); net.step(200); const guest = join(GUESTS[0]!, 'Guest'); join(GUESTS[1]!, 'Other'); net.step(600);
  host.command({ type: 'action', action: 'start' }); net.step(COUNTDOWN_TICKS * 50 + 500);
  const matchId = net.frame(GUESTS[0]!)!.matchId;
  host = net.reload(HOST, settings, { humanName: 'Host' }); host.command({ type: 'join', name: 'Host' }); net.step(3000);
  assert.equal(net.frame(HOST)!.matchId, matchId, 'the creator recovered the running match rather than starting over');
  assert.equal(net.frame(HOST)!.players.find(p => p.id === HOST)!.connected, true); assert.equal(hashes(net, [HOST, GUESTS[0]!, GUESTS[1]!]).size, 1);
  assert.equal(host.command({ type: 'action', action: 'lobby' }), true); net.step(300); assert.equal(net.frame(GUESTS[0]!)!.phase, 'lobby');
  host.command({ type: 'action', action: 'start' }); net.step(COUNTDOWN_TICKS * 50 + 300);
  net.ticks.delete(HOST); net.step(CREATOR_SILENCE_MS + 1500);
  assert.equal(net.frame(GUESTS[0]!)!.players.find(p => p.id === HOST)!.connected, false, 'the lowest rider logged the creator absent');
  assert.match(net.recorded.get(GUESTS[0]!)!.statuses.join('|'), /Waiting for Host/);
  const tick = world(guest).tick; net.step(2000); assert.ok(world(guest).tick > tick + 30, 'play resumed without the creator');
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test('a joiner whose snapshot source vanishes retries other peers and reports repeated failures', () => {
  const { net, join } = room();
  const host = join(HOST, 'Host'); net.step(200); join(GUESTS[0]!, 'Guest'); net.step(600);
  const late = net.add(GUESTS[1]!, settings); late.start();
  net.step(60); // welcome, peers announced, links opening
  net.transports.get(HOST)!.deaf = true; net.transports.get(GUESTS[0]!)!.deaf = true; // nobody hears the request
  net.step(SNAPSHOT_RETRY_MS * 3 + 200);
  assert.match(net.recorded.get(GUESTS[1]!)!.statuses.join('|'), /reload this page/);
  net.transports.get(HOST)!.deaf = false; net.step(SNAPSHOT_RETRY_MS + 500); void host;
  assert.equal(net.frame(GUESTS[1]!)!.players.length, 2, 'a later attempt succeeds');
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test('solo runs a room with no peers: one human, four AI, a paused clock while hidden and lobby actions', () => {
  const net = new FakeNetwork('solo', { loss: 0, baseMs: 0, jitterMs: 0, reliableMs: 0 });
  const recorded: string[] = []; let frame: ReturnType<RoomRuntime['view']>;
  const runtime = new RoomRuntime('SOLO', { ...settings, mode: 'shared' }, { state: state => { frame = state; }, event: () => {}, status: text => recorded.push(text), ready: id => recorded.push(`ready:${id}`) }, { humanName: 'Player', dependencies: net.dependencies('solo') });
  assert.equal(runtime.command({ type: 'action', action: 'start' }), false);
  runtime.start(); runtime.start();
  assert.ok(recorded.includes('ready:solo'), recorded.join('|'));
  assert.equal(frame!.players.length, 5); assert.equal(frame!.players[0]!.name, 'Player'); assert.equal(frame!.phase, 'countdown');
  net.step(COUNTDOWN_TICKS * 50 + 100); assert.equal(frame!.phase, 'playing'); assert.equal(runtime.solo, true);
  assert.equal(runtime.command({ type: 'input', seq: 0, left: true, right: false, bomb: true, bombAction: 'press' }), true);
  net.step(50); assert.notEqual(frame!.players[0]!.bombChargeStartedTick, undefined);
  const view = runtime.view()!; assert.equal(view.players[0]!.presentationTick! > frame!.tick - 1, true);
  net.setHidden('solo', true); const paused = frame!.tick; net.step(5000); assert.equal(frame!.tick, paused); assert.equal(frame!.players[0]!.bombChargeStartedTick, undefined, 'hiding cancels the charge');
  assert.equal(recorded.at(-1), 'Solo · you and four AI riders', 'the recurring status returns once the notice hold expires');
  assert.equal(runtime.command({ type: 'input', seq: 1, left: true, right: false, bomb: false }), false);
  net.setHidden('solo', false); net.step(110); assert.ok(frame!.tick >= paused + 1 && frame!.tick <= paused + 2, `resumed: ${frame!.tick} after ${paused}`);
  assert.equal(runtime.command({ type: 'action', action: 'lobby' }), true); net.step(60); assert.equal(frame!.phase, 'lobby');
  assert.equal(runtime.command({ type: 'settings', settings: { ...settings, mode: 'shared', length: 2 } }), true); net.step(60);
  assert.equal(runtime.command({ type: 'action', action: 'start' }), true); net.step(60); assert.equal(frame!.phase, 'countdown');
  assert.equal(runtime.command({ type: 'action', action: 'rematch' }), false);
  assert.equal(runtime.command({ type: 'bot', action: 'remove', id: 'nope' }), false); assert.equal(runtime.command({ type: 'bot', action: 'add' }), false, 'five seats are taken');
  assert.equal(runtime.command({ type: 'avatar', avatarId: 'robot' }), true); net.step(60); assert.equal(frame!.players[0]!.avatarId, 'robot');
  runtime.stop(); runtime.stop(); assert.equal(runtime.command({ type: 'action', action: 'lobby' }), true, 'commands still fold locally after stop');
});
