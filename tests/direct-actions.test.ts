import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, createGame, eliminatePlayer, SLOT_COLORS, startMatch, step } from '../src/shared/game.js';
import { canonical, replayHash } from '../src/shared/action-log.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { DIRECT_RULES, isDirectAction, stepDirect, type DirectAction, type DirectState } from '../src/shared/direct-input.js';
import { packMessage, unpackMessage } from '../src/online/action-replication.js';
import { decodeDirectPacket, DirectDelivery, DirectStream, FAST_PACKET_BYTES, type DirectPacket, type Watermark } from '../src/online/direct-stream.js';
import { packBootstrap, RollbackWorld, ROLLBACK_TICKS, type Finality } from '../src/online/rollback-world.js';

function fixture(seed = 123): DirectState {
  const game = createGame('direct-test', seed);
  game.settings = defaultRoomSettings();
  for (let slot = 0; slot < 5; slot++) addPlayer(game, { id: `p${slot}`, name: `Player ${slot}`, slot, color: SLOT_COLORS[slot] });
  startMatch(game);
  for (let i = 0; i < 65; i++) step(game, new Map());
  return { game, held: new Map(), gestures: new Map() };
}
function setup(state = fixture(), segment = 7): RollbackWorld {
  const world = RollbackWorld.open(packBootstrap(segment, state, [...state.game.players.values()].map(p => [p.slot, 0])), segment);
  assert.ok(world); return world;
}
function packet(slot: number, actions: DirectAction[], watermark: Watermark | null = null, segment = 7): Uint8Array {
  return packMessage([1, segment, slot, actions, watermark] satisfies DirectPacket);
}
function advance(world: RollbackWorld, tick: number): void {
  while (world.state.game.tick < tick) {
    const before = world.state.game.tick;
    const outcome = world.advance(tick);
    assert.equal(outcome.status, 'accepted'); assert.ok(world.state.game.tick > before);
  }
}
function certify(world: RollbackWorld, tick: number, prefixes = [0, 0, 0, 0, 0]): Finality {
  for (let slot = 0; slot < 5; slot++) assert.equal(world.receive(slot, packet(slot, [], [tick, prefixes[slot]]), tick).status, 'accepted');
  const finality = world.proposeFinality(tick); assert.ok(finality); return finality;
}

test('release or cancel after round/match completion stays replayable through late rollback and finality',()=>{
 for(const phase of ['roundOver','matchOver'])for(const kind of [2,3] as const)for(const late of [false,true]){
  const game=createGame('finished-charge',123);game.settings={...defaultRoomSettings(),match:'rounds',length:phase==='matchOver'?1:2};
  for(let slot=0;slot<2;slot++)addPlayer(game,{id:`p${slot}`,name:`Player ${slot}`,slot,color:SLOT_COLORS[slot]});
  startMatch(game);for(let i=0;i<60;i++)step(game,new Map());eliminatePlayer(game,'p1');
  const world=setup({game,held:new Map(),gestures:new Map()});
  const actions:DirectAction[]=[[1,61,1,1],kind===2?[2,62,2,1,null]:[2,62,3,1]];
  if(late)advance(world,64);
  const delivered=world.receive(0,packet(0,actions,[64,2]),64);assert.equal(delivered.status,'accepted');assert.equal(delivered.rollbackTicks,late?4:0);
  assert.equal(world.receive(1,packet(1,[],[64,0]),64).status,'accepted');if(!late)advance(world,64);
  assert.equal(world.state.game.phase,phase);
  const finality=world.proposeFinality(64);assert.ok(finality);assert.equal(world.finalize(finality).status,'accepted');
  const restored=world.finalizedState();assert.ok(restored,`${phase} ${kind} late=${late}: accepted finality must retain a readable checkpoint`);
  assert.equal(restored.game.players.get('p0')!.bombChargeStartedTick,undefined);assert.equal(restored.game.players.get('p0')!.bombTarget,undefined);
  assert.equal(restored.gestures.get(0)!.active,0);assert.equal(restored.held.get(0)!.flags&4,0);assert.equal(replayHash(restored),finality[5]);
  assert.ok(RollbackWorld.open(world.bootstrap(),7));
 }
});

test('wire actions use full uint32 ticks and strict bounded MessagePack tuples', () => {
  const small: DirectAction = [1, 120, 0, 1], late: DirectAction = [100, 72_000, 0, 0];
  assert.equal(packMessage(small).byteLength, 5);
  assert.equal(packMessage(late).byteLength, 9);
  assert.deepEqual(decodeDirectPacket(packet(0, [late]))?.[3], [late]);
  for (const invalid of [null, {}, [], [0, 1, 0, 1], [1, -1, 0, 0], [1, 2 ** 32, 0, 0], [1, 2, 0, 4], [1, 2, 1, 0], [1, 2, 2, 1], [1, 2, 2, 1, [-0, 0]], [1, 2, 4, [0, 2]], [1, 2, 99, 0], [1, 2, 3, 1, 0]]) assert.equal(isDirectAction(invalid), false);
  for (const bad of [new Uint8Array(513), new Uint8Array([0xdd, 0xff, 0xff, 0xff, 0xff]), packMessage([1, 7, 5, [], null]), packMessage([1, 7, 0, Array(5).fill(small), null]), packMessage([2, 7, 0, [], null]), packMessage([1, 0, 0, [], null])]) assert.equal(decodeDirectPacket(bad), undefined);
});

test('independent stream fills holes, permits older repairs after watermark, ignores reordered watermarks', () => {
  let stream = new DirectStream({ sequence: 0, tick: 65, gesture: 0 });
  let received = stream.receive([[3, 70, 0, 0]], [72, 3], 80);
  assert.equal(received.status, 'accepted'); if (received.status !== 'accepted') return;
  stream = received.stream; assert.equal(stream.contiguous, 0); assert.equal(stream.completeThrough(72), false);
  received = stream.receive([[1, 66, 0, 1], [2, 68, 0, 2]], [68, 2], 80);
  assert.equal(received.status, 'accepted'); if (received.status !== 'accepted') return;
  stream = received.stream;
  assert.deepEqual(received.added.map(a => a[0]), [1, 2, 3]); assert.equal(stream.contiguous, 3);
  assert.equal(stream.completeThrough(72), true); assert.equal(stream.prefixAt(69), 2);
  assert.deepEqual(stream.at(70), [[3, 70, 0, 0]]);
});

test('conflicting IDs, incomparable promises, chronological inversion and reused gesture are atomic faults', () => {
  const base = new DirectStream({ sequence: 0, tick: 65, gesture: 0 });
  const seeded = base.receive([[1, 66, 1, 1], [2, 68, 2, 1, null]], [68, 2], 80);
  assert.equal(seeded.status, 'accepted'); if (seeded.status !== 'accepted') return;
  const stream = seeded.stream, before = canonical(stream);
  for (const [actions, mark] of [
    [[[1, 66, 0, 2]], null], [[[3, 68, 0, 0]], null], [[[3, 70, 1, 1]], null],
    [[], [69, 1]], [[], [67, 3]], [[], [68, 3]], [[], [100, 2]],
    [[[4, 69, 0, 0], [3, 70, 0, 1]], null],
  ] as [DirectAction[], Watermark | null][]) {
    assert.equal(stream.receive(actions, mark, 80).status, 'invalid'); assert.equal(canonical(stream), before);
  }
  assert.equal(stream.receive([[257, 70, 0, 1]], null, 80).status, 'overflow');
  assert.equal(stream.receive([[3, 81, 0, 1]], null, 80).status, 'invalid');
});

test('whole world advances with no action packets, then bounded rollback exactly reconstructs late actions', () => {
  const state = fixture(), expected = setup(state), delayed = setup(state);
  const actions: DirectAction[] = [[1, 66, 0, 1], [2, 70, 1, 1], [3, 74, 2, 1, null], [4, 77, 0, 0]];
  assert.equal(expected.receive(0, packet(0, actions), 77).status, 'accepted');
  advance(expected, 80); advance(delayed, 80);
  assert.notEqual(replayHash(expected.state), replayHash(delayed.state));
  const correction = delayed.receive(0, packet(0, [...actions].reverse()), 80);
  assert.equal(correction.status, 'accepted'); assert.equal(correction.rollbackTicks, 15);
  assert.equal(canonical(delayed.state), canonical(expected.state));
  assert.ok(expected.state.game.bombs.size > 0);
  const duplicate = delayed.receive(0, packet(0, actions), 80);
  assert.equal(duplicate.rollbackTicks, 0); assert.equal(canonical(delayed.state), canonical(expected.state));
});

test('all same-tick press/release packet permutations yield exactly one identical shot', () => {
  const actions: DirectAction[] = [[1, 66, 1, 1], [2, 66, 2, 1, [0.5, 0.25]], [3, 66, 0, 2]];
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const worlds = permutations.map(order => {
    const world = setup(); advance(world, 67);
    for (const i of order) assert.equal(world.receive(0, packet(0, [actions[i]]), 67).status, 'accepted');
    assert.equal(world.state.game.nextBombId, 2); return canonical(world.state);
  });
  assert.ok(worlds.every(s => s === worlds[0]));
});

test('replacement press restarts charge; old release cannot fire the newer gesture', () => {
  const world = setup();
  assert.equal(world.receive(0, packet(0, [[1, 66, 1, 1], [2, 67, 1, 2], [3, 68, 2, 1, null]]), 68).status, 'accepted');
  advance(world, 68);
  assert.equal(world.state.game.players.get('p0')!.bombChargeStartedTick, 67);
  assert.equal(world.state.game.bombs.size, 0);
  assert.equal(world.receive(0, packet(0, [[4, 70, 2, 2, null]]), 70).status, 'accepted');
  advance(world, 70); assert.equal(world.state.game.nextBombId, 2);
  assert.equal(world.state.game.players.get('p0')!.bombChargeStartedTick, undefined);
});

test('missing press never invents charge; cancel and aiming preserve per-action target order', () => {
  const world = setup();
  world.receive(0, packet(0, [[1, 66, 2, 1, null], [2, 67, 3, 1]]), 67); advance(world, 67);
  assert.equal(world.state.game.nextBombId, 1);
  const state = fixture(); state.game.players.get('p0')!.targetBombArmed = true;
  stepDirect(state, new Map([[0, [[1, 66, 4, [0.1, 0.1]], [2, 66, 1, 1], [3, 66, 3, 1], [4, 66, 1, 2], [5, 66, 4, [0.9, 0.9]]]]]));
  assert.equal(state.gestures.get(0)!.active, 2); assert.deepEqual(state.held.get(0)!.aim, [0.9, 0.9]);
  assert.throws(() => stepDirect(state, new Map([[0, [[6, 67, 1, 2]]]])), /Reused gesture/);
  assert.throws(() => stepDirect(fixture(), new Map([[0, [[2, 66, 0, 1], [1, 66, 0, 0]]]])), /Invalid direct/);
});

test('idle repair delivers a lost final release; receipt loss never duplicates shots', () => {
  const world = setup(), delivery = new DirectDelivery(7, 0, 65);
  let wire: Uint8Array[] = [];
  const send = (bytes: Uint8Array) => { wire.push(bytes); return true; };
  delivery.enqueue([1, 66, 1, 1], 0, send);
  const press = world.receive(0, wire.shift()!, 66); assert.ok(press.receipt); delivery.acknowledge(press.receipt);
  advance(world, 67);
  delivery.enqueue([2, 68, 2, 1, null], 100, send); wire = []; // The last new action is lost.
  advance(world, 70); assert.equal(world.state.game.bombs.size, 0);
  delivery.pump(149, send); assert.equal(wire.length, 0);
  delivery.pump(150, send); assert.equal(wire.length, 1);
  const release = world.receive(0, wire.shift()!, 70); assert.equal(release.rollbackTicks, 3);
  assert.equal(world.state.game.nextBombId, 2);
  delivery.pump(200, send); const repeated = world.receive(0, wire.shift()!, 70);
  assert.equal(world.state.game.nextBombId, 2); assert.equal(repeated.rollbackTicks, 0);
  assert.ok(repeated.receipt); assert.equal(delivery.acknowledge(repeated.receipt), true); assert.equal(delivery.retainedRecords, 0);
  delivery.pump(249, send); assert.equal(wire.length, 0);
  delivery.pump(300, send); delivery.pump(10000, send); assert.equal(wire.length, 0, 'acknowledged queues have no idle send timer');
});

test('origin immediately sends newest plus old gap records; backpressure repair is paced and bounded', () => {
  const delivery = new DirectDelivery(7, 0, 65), wire: Uint8Array[] = [];
  const send = (bytes: Uint8Array) => { wire.push(bytes); return false; };
  for (let seq = 1; seq <= 6; seq++) assert.equal(delivery.enqueue([seq, 66 + seq, 0, seq % 4], seq, send), true);
  const repeated = decodeDirectPacket(wire[5])![3].map(a => a[0]);
  assert.deepEqual(repeated.slice(0, 2), [6, 1]); assert.ok(repeated.includes(5));
  for (let now = 7; now < 56; now++) delivery.pump(now, send);
  assert.equal(wire.length, 6); delivery.pump(56, send); assert.equal(wire.length, 7);
  assert.ok(wire.every(bytes => bytes.byteLength <= FAST_PACKET_BYTES));
  assert.equal(delivery.advanceWatermark(80), true);
  assert.equal(delivery.enqueue([7, 80, 0, 0], 90, send), false);
  assert.equal(delivery.advanceWatermark(79), false);
  for (const invalid of [new Uint8Array(513), new Uint8Array([0xc1]), packMessage([1, 8, 0, 6]), packMessage([1, 7, 1, 6]), packMessage([1, 7, 0, 7])]) assert.equal(delivery.acknowledge(invalid), false);
  assert.equal(delivery.acknowledge(packMessage([1, 7, 0, 3])), true);
  assert.equal(delivery.acknowledge(packMessage([1, 7, 0, 2])), false);
  assert.throws(() => new DirectDelivery(0, 0, 65));
  const full = new DirectDelivery(7, 0, 65);
  for (let seq = 1; seq <= 256; seq++) assert.equal(full.enqueue([seq, 66, 0, seq % 4], 0, () => true), true);
  assert.equal(full.enqueue([257, 66, 0, 0], 1, () => true), false); assert.equal(full.retainedRecords, 256);
});

test('finality waits for cross-channel input gaps, then emits derived effects exactly once', () => {
  const coordinator = setup(), guest = setup();
  const actions: DirectAction[] = [[1, 66, 1, 1], [2, 68, 2, 1, null]];
  coordinator.receive(0, packet(0, actions), 70); advance(coordinator, 70); advance(guest, 70);
  const finality = certify(coordinator, 70, [2, 0, 0, 0, 0]);
  assert.equal(guest.finalize(finality).status, 'waiting'); assert.equal(guest.pendingFinalizedTick, 70);
  for (let slot = 1; slot < 5; slot++) guest.receive(slot, packet(slot, [], [70, 0]), 70);
  assert.equal(guest.receive(0, packet(0, [actions[1]], [70, 2]), 70).status, 'accepted');
  assert.equal(guest.finalizedTick, 65);
  const repaired = guest.receive(0, packet(0, [actions[0]]), 70);
  assert.equal(repaired.status, 'accepted'); assert.equal(guest.finalizedTick, 70);
  const committed = coordinator.finalize(finality);
  assert.deepEqual(repaired.events, committed.events); assert.ok(repaired.events.length > 0);
  assert.equal(new Set(repaired.events.map(e => e.id)).size, repaired.events.length);
  assert.equal(guest.finalize(finality).status, 'stale'); assert.deepEqual(guest.finalize(finality).events, []);
  assert.equal(guest.retainedRecords, 0);
  assert.equal(guest.receive(0, packet(0, actions), 70).rollbackTicks, 0);
  assert.equal(guest.receive(0, packet(0, [[3, 69, 0, 1]]), 70).status, 'invalid');
});

test('finalized bootstrap uses applied prefixes, leaving already received future actions for suffix replay', () => {
  const world = setup();
  const actions: DirectAction[] = [[1, 66, 0, 1], [2, 74, 0, 0]];
  world.receive(0, packet(0, actions, [75, 2]), 75); advance(world, 75);
  for (let slot = 1; slot < 5; slot++) world.receive(slot, packet(slot, [], [75, 0]), 75);
  const at70 = world.proposeFinality(70)!; assert.deepEqual(at70[4][0], [0, 1]);
  assert.equal(world.finalize(at70).status, 'accepted'); assert.equal(world.retainedRecords, 1);
  const restored = RollbackWorld.open(world.bootstrap(), 7)!; assert.ok(restored);
  assert.equal(restored.state.game.tick, 70);
  assert.equal(restored.receive(0, packet(0, [actions[1]], [75, 2]), 75).status, 'accepted');
  advance(restored, 75); assert.equal(canonical(restored.state), canonical(world.state));
});

test('speculation pauses at its fixed bound and resumes after verified finality', () => {
  const world = setup();
  advance(world, 65 + ROLLBACK_TICKS);
  assert.equal(world.advance(65 + ROLLBACK_TICKS + 1).status, 'paused');
  assert.equal(world.state.game.tick, 105);
  const finality = certify(world, 105); assert.equal(world.finalize(finality).status, 'accepted');
  advance(world, 110); assert.equal(world.state.game.tick, 110);
  assert.equal(world.advance(109).status, 'invalid');
});

test('malformed/future/wrong-owner/stale-segment messages do not alter healthy world', () => {
  const world = setup(), before = canonical(world.state), size = world.retainedBytes;
  assert.equal(world.receive(1, packet(0, [[1, 66, 0, 1]]), 66).status, 'invalid');
  assert.equal(world.receive(0, packet(0, [[1, 66, 0, 1]], null, 6), 66).status, 'stale');
  assert.equal(world.receive(0, packet(0, [[1, 81, 0, 1]]), 66).status, 'invalid');
  assert.equal(world.receive(0, packet(0, [[257, 66, 0, 1]]), 66).status, 'overflow');
  assert.equal(world.receive(0, new Uint8Array([0xc1]), 66).status, 'invalid');
  assert.equal(world.receive(0, packet(0, []), NaN).status, 'invalid');
  assert.equal(canonical(world.state), before); assert.equal(world.retainedBytes, size);
  assert.equal(world.finalize([1, 7, 'final', 66, [], '0'.repeat(16)]).status, 'invalid');
  advance(world, 70); const finality = certify(world, 70), healthy = canonical(world.state);
  assert.equal(world.finalize([...finality.slice(0, 5), '0'.repeat(16)]).status, 'invalid');
  assert.equal(world.finalizedTick, 65); assert.equal(canonical(world.state), healthy);
  assert.equal(world.finalize(finality).status, 'accepted');
});

test('invalid bootstrap, changed rules, corrupt state and wrong scope never instantiate a replica', () => {
  const good = setup().bootstrap();
  for (const bytes of [new Uint8Array(2_000_001), new Uint8Array([0xc1]), packMessage([])]) assert.equal(RollbackWorld.open(bytes, 7), undefined);
  assert.equal(RollbackWorld.open(good, 8), undefined); assert.equal(RollbackWorld.open(good, 7, 0), undefined);
  const wire = unpackMessage(good) as unknown[];
  for (const [index, value] of [[1, `${DIRECT_RULES}-old`], [3, packMessage(['{}', [], []])], [4, [[0, 0], [0, 0], [2, 0], [3, 0], [4, 0]]], [5, '0'.repeat(16)]] as [number, unknown][]) {
    const bad = [...wire]; bad[index] = value; assert.equal(RollbackWorld.open(packMessage(bad), 7), undefined);
  }
  assert.throws(() => packBootstrap(0, fixture(), []));
});

test('encoded history budget rejects growth atomically rather than discarding rollback dependencies', () => {
  const state = fixture(), bytes = packBootstrap(7, state, [0, 1, 2, 3, 4].map(slot => [slot, 0]));
  const initial = setup(state).retainedBytes;
  const world = RollbackWorld.open(bytes, 7, initial + 100)!; assert.ok(world);
  const before = canonical(world.state);
  assert.equal(world.advance(70).status, 'overflow'); assert.equal(canonical(world.state), before);
  assert.equal(world.retainedBytes, initial);
});

test('six independently advancing replicas converge through delayed/reordered delivery for five streams', () => {
  for (const seed of [17, 42, 901]) {
    const worlds = Array.from({ length: 6 }, () => setup(fixture(seed)));
    const sequences = [0, 0, 0, 0, 0];
    for (let block = 0; block < 12; block++) {
      const end = 75 + block * 10, messages: { slot: number; bytes: Uint8Array }[] = [];
      for (let slot = 0; slot < 5; slot++) {
        const action: DirectAction = [++sequences[slot], end - 8 + ((seed + slot) % 3), 0, (block + slot) % 4];
        messages.push({ slot, bytes: packet(slot, [action], [end, sequences[slot]]) });
      }
      for (const world of worlds) advance(world, end);
      for (let peer = 0; peer < worlds.length; peer++) {
        const order = [...messages.slice(peer % 5), ...messages.slice(0, peer % 5)];
        if (peer % 2) order.reverse();
        for (const { slot, bytes } of order) {
          assert.equal(worlds[peer].receive(slot, bytes, end).status, 'accepted');
          if ((slot + seed + peer) % 3 === 0) assert.equal(worlds[peer].receive(slot, bytes, end).rollbackTicks, 0);
        }
      }
      const finality = worlds[0].proposeFinality(end)!; assert.ok(finality);
      for (const world of worlds) {
        assert.equal(world.finalize(unpackMessage(packMessage(finality))).status, 'accepted');
        assert.equal(canonical(world.state), canonical(worlds[0].state));
        assert.equal(world.retainedRecords, 0);
      }
    }
  }
});

test('new completeness cuts preserve older promises and already certified progress', () => {
  const base = new DirectStream({ sequence: 0, tick: 0, gesture: 0 });
  const first = base.receive([], [5, 1], 20); assert.equal(first.status, 'accepted'); if (first.status !== 'accepted') return;
  const second = first.stream.receive([], [10, 2], 20); assert.equal(second.status, 'accepted'); if (second.status !== 'accepted') return;
  assert.equal(second.stream.receive([[1, 3, 0, 1], [2, 4, 0, 0]], null, 20).status, 'invalid');
  const complete = first.stream.receive([[1, 3, 0, 1]], null, 20); assert.equal(complete.status, 'accepted'); if (complete.status !== 'accepted') return;
  assert.equal(complete.stream.completeThrough(5), true);
  const futureGap = complete.stream.receive([], [10, 2], 20); assert.equal(futureGap.status, 'accepted'); if (futureGap.status !== 'accepted') return;
  assert.equal(futureGap.stream.completeThrough(5), true); assert.equal(futureGap.stream.completeThrough(10), false);
  const newestFirst = base.receive([[1, 3, 0, 1], [2, 4, 0, 0]], [10, 2], 20); assert.equal(newestFirst.status, 'accepted'); if (newestFirst.status !== 'accepted') return;
  assert.equal(newestFirst.stream.receive([], [5, 1], 20).status, 'invalid');
});

test('watermark cuts, including empty periods, have a hard retention bound', () => {
  let stream = new DirectStream({ sequence: 0, tick: 0, gesture: 0 });
  for (let tick = 1; tick < 64; tick++) {
    const r = stream.receive([], [tick, 0], 100); assert.equal(r.status, 'accepted'); if (r.status === 'accepted') stream = r.stream;
  }
  assert.equal(stream.receive([], [64, 0], 100).status, 'overflow');
  const trimmed = stream.trim(60, 0);
  assert.equal(trimmed.receive([], [64, 0], 100).status, 'accepted');
  assert.equal(trimmed.receive([], [5, 0], 100).status, 'accepted');
  assert.equal(trimmed.receive([], [5, 1], 100).status, 'invalid');
});

test('bootstrap rejects a rehashed impossible gesture state, not only corrupt hashes', () => {
  const state = fixture();
  state.held.set(0, { at: 65, flags: 4, aim: null }); state.gestures.set(0, { active: 1, latest: 2 });
  const bytes = packBootstrap(7, state, [0, 1, 2, 3, 4].map(slot => [slot, 0]));
  assert.equal(RollbackWorld.open(bytes, 7), undefined);
});

test('older complete finality advances while newer certificates still await input repair', () => {
  const leader = setup(), guest = setup();
  const actions: DirectAction[] = [[1, 66, 1, 1], [2, 68, 2, 1, null], [3, 73, 0, 1], [4, 78, 0, 0]];
  leader.receive(0, packet(0, actions), 80); advance(leader, 80); advance(guest, 80);
  const certificates = [certify(leader, 70, [2, 0, 0, 0, 0]), certify(leader, 75, [3, 0, 0, 0, 0]), certify(leader, 80, [4, 0, 0, 0, 0])];
  for (const certificate of certificates) assert.equal(guest.finalize(certificate).status, 'waiting');
  for (let slot = 1; slot < 5; slot++) guest.receive(slot, packet(slot, [], [80, 0]), 80);
  for (const [tick, prefix] of [[70, 2], [75, 3], [80, 4]]) guest.receive(0, packet(0, [], [tick, prefix]), 80);
  const early = guest.receive(0, packet(0, actions.slice(0, 2)), 80);
  assert.equal(guest.finalizedTick, 70); assert.equal(guest.pendingFinalizedTick, 80);
  assert.deepEqual(early.events, leader.finalize(certificates[0]).events);
  assert.ok(early.events.length > 0);
  const middle = guest.receive(0, packet(0, [actions[2]]), 80);
  assert.equal(guest.finalizedTick, 75); assert.equal(guest.pendingFinalizedTick, 80);
  assert.deepEqual(middle.events, leader.finalize(certificates[1]).events);
  const latest = guest.receive(0, packet(0, [actions[3]]), 80);
  assert.equal(guest.finalizedTick, 80); assert.equal(guest.pendingFinalizedTick, undefined);
  assert.deepEqual(latest.events, leader.finalize(certificates[2]).events);
  const events = [...early.events, ...middle.events, ...latest.events];
  assert.equal(new Set(events.map(e => e.id)).size, events.length);
  assert.equal(replayHash(guest.finalizedState()), replayHash(leader.finalizedState()));
  assert.deepEqual(guest.receive(0, packet(0, actions), 80).events, []);
});

test('pending certificates normalize prefix order and reject conflicts without bypassing a bad older hash', () => {
  const leader = setup(), guest = setup(); advance(leader, 75); advance(guest, 75);
  const early = certify(leader, 70), late = certify(leader, 75);
  const corrupt = structuredClone(early); corrupt[5] = '0'.repeat(16);
  assert.equal(guest.finalize(corrupt).status, 'waiting');
  const bytes = guest.retainedBytes;
  const reordered = structuredClone(corrupt); reordered[4].reverse();
  assert.equal(guest.finalize(reordered).status, 'waiting'); assert.equal(guest.retainedBytes, bytes);
  assert.equal(guest.finalize(early).status, 'invalid'); assert.equal(guest.retainedBytes, bytes);
  assert.equal(guest.finalize(late).status, 'waiting');
  for (let slot = 0; slot < 4; slot++) guest.receive(slot, packet(slot, [], [75, 0]), 75);
  const rejected = guest.receive(4, packet(4, [], [75, 0]), 75);
  assert.equal(rejected.status, 'invalid'); assert.deepEqual(rejected.events, []); assert.equal(guest.finalizedTick, 65);
  // Rejection clears the bad proposal without accepting the packet that exposed it.
  assert.equal(guest.streamProgress().find(s => s.slot === 4)!.watermark[0], 65);
  assert.equal(guest.finalize(late).status, 'waiting');
  assert.equal(guest.receive(4, packet(4, [], [75, 0]), 75).status, 'accepted'); assert.equal(guest.finalizedTick, 75);
  assert.equal(guest.finalize(early).status, 'stale'); assert.deepEqual(guest.finalize(late).events, []);
});

test('pending finality has a forty-tick bound and encoded-byte admission is atomic', () => {
  const world = setup(), initial = world.retainedBytes;
  const certificates: Finality[] = Array.from({ length: ROLLBACK_TICKS }, (_, i) => [1, 7, 'final', 66 + i, [0, 1, 2, 3, 4].map(slot => [slot, 0]), '0'.repeat(16)]);
  for (const certificate of certificates) assert.equal(world.finalize(certificate).status, 'waiting');
  assert.equal(world.pendingFinalizedTick, 105);
  assert.equal(world.retainedBytes, initial + packMessage(certificates).byteLength - packMessage([]).byteLength);
  const retained = world.retainedBytes;
  assert.equal(world.finalize([1, 7, 'final', 106, certificates[0][4], '0'.repeat(16)]).status, 'invalid');
  assert.equal(world.retainedBytes, retained);
  const limit = initial + packMessage([certificates[0]]).byteLength - packMessage([]).byteLength;
  const bounded = RollbackWorld.open(setup().bootstrap(), 7, limit)!; assert.ok(bounded);
  assert.equal(bounded.finalize(certificates[0]).status, 'waiting'); assert.equal(bounded.retainedBytes, limit);
  const before = canonical(bounded.state);
  assert.equal(bounded.finalize(certificates[1]).status, 'overflow');
  assert.equal(bounded.pendingFinalizedTick, 66); assert.equal(bounded.retainedBytes, limit); assert.equal(canonical(bounded.state), before);
});


test('lost receipts retain the oldest gap without starving rotation through the unacknowledged tail', () => {
  let delivery = new DirectDelivery(7, 0, 65);
  for (let seq = 1; seq <= 23; seq++) {
    const action: DirectAction = [seq, 66 + seq, 0, seq % 4];
    const next = delivery.prepare([action]); assert.ok(next); delivery = next;
    delivery.publish([action], seq, () => true);
  }
  const covered = new Set<number>();
  for (let now = 73; now <= 423; now += 50) delivery.pump(now, bytes => {
    const actions = decodeDirectPacket(bytes)![3];
    assert.equal(actions[0][0], 1); assert.equal(actions.length, 4);
    assert.equal(new Set(actions.map(a => a[0])).size, actions.length);
    actions.forEach(a => covered.add(a[0])); return true;
  });
  assert.equal(covered.size, 23); assert.equal(delivery.retainedRecords, 23);
  assert.equal(delivery.acknowledge(packMessage([1, 7, 0, 23])), true);
  assert.equal(delivery.retainedRecords, 0);
});


test('delivery exact cuts exclude future groups and cannot contradict retained actions', () => {
  let delivery = new DirectDelivery(7, 0, 65);
  delivery = delivery.prepare([[1, 66, 0, 1], [2, 68, 0, 0]])!;
  assert.equal(delivery.advanceCut([65, 0]), true);
  assert.equal(delivery.advanceCut([66, 2]), false);
  assert.equal(delivery.advanceCut([66, 0]), false);
  assert.equal(delivery.advanceCut([66, 1]), true);
  assert.equal(delivery.advanceCut([65, 0]), false);
  assert.equal(delivery.advanceCut([68, 1]), false);
  const sent: Uint8Array[] = []; delivery.flush(0, bytes => { sent.push(bytes); return true; });
  assert.deepEqual(decodeDirectPacket(sent[0])![4], [66, 1]);
  assert.equal(delivery.advanceCut([68, 2]), true);
  assert.equal(delivery.advanceCut([69, 3]), false);
  assert.equal(delivery.acknowledge(packMessage([1, 7, 0, 2])), true);
  assert.equal(delivery.advanceCut([70, 2]), true);
});


test('remote future staging derives from both clock uncertainties without extending the execution horizon', () => {
  const world = setup();
  assert.equal(world.receive(0, packet(0, [[1, 79, 0, 1]]), 65).status, 'accepted');
  const before = canonical(world.state), bytes = world.retainedBytes;
  assert.equal(world.receive(0, packet(0, [[2, 80, 0, 0]]), 65).status, 'invalid');
  assert.equal(canonical(world.state), before); assert.equal(world.retainedBytes, bytes);
  advance(world, 78); assert.equal(world.state.held.get(0)?.flags ?? 0, 0);
  advance(world, 79); assert.equal(world.state.held.get(0)?.flags, 1);
  advance(world, 105); assert.equal(world.advance(106).status, 'paused');
});

test('recovery distinguishes invalid action admission from verified finality disagreement', () => {
  const world = setup();
  const input = world.receive(0, packet(0, [[1, 1000, 0, 1]]), 65);
  assert.equal(input.status, 'invalid'); assert.equal(input.corrupt, undefined);
  assert.equal(world.finalize([1, 7, 'final', 66, [], '0'.repeat(16)]).corrupt, undefined);
  advance(world, 66); const finality = certify(world, 66);
  const corrupt = world.finalize([...finality.slice(0, 5), '0'.repeat(16)]);
  assert.equal(corrupt.status, 'invalid'); assert.equal(corrupt.corrupt, true);
  assert.equal(world.finalize(finality).status, 'accepted');
});


test('combined progress rejects late conflicts atomically, including pending finality and events', () => {
  const world = setup(); advance(world, 70);
  const certificate = certify(setup(), 65);
  const reference = setup(); advance(reference, 70); const future = certify(reference, 70);
  assert.equal(world.finalize(future).status, 'waiting');
  const before = { hash: replayHash(world.state), tick: world.finalizedTick, progress: world.streamProgress(), pending: world.pendingFinalizedTick, event: world.pendingEventTick, bytes: world.retainedBytes };
  for (const [cuts, finality] of [
    [[[0,70,0],[1,65,1]], null],
    [[[0,70,0],[0,71,0]], null],
    [[[0,70,0]], [1,7,'final',65,certificate[4],'f'.repeat(16)]],
    [[[0,70,0]], [1,7,'final',70,future[4],'f'.repeat(16)]],
  ] as [[number,number,number][], unknown][]) {
    const prepared = world.prepareProgress(cuts, finality, 70);
    assert.equal(prepared.outcome.status, 'invalid'); assert.equal(prepared.world, undefined);
    assert.deepEqual({ hash: replayHash(world.state), tick: world.finalizedTick, progress: world.streamProgress(), pending: world.pendingFinalizedTick, event: world.pendingEventTick, bytes: world.retainedBytes }, before);
  }
  const next = world.prepareProgress(Array.from({length:5},(_,slot)=>[slot,70,0]), future, 70);
  assert.ok(next.world); assert.equal(next.world.finalizedTick, 70); assert.equal(world.finalizedTick,65);
  assert.equal(world.pendingFinalizedTick,70); assert.equal(next.world.pendingFinalizedTick,undefined);
  assert.equal(replayHash(world.state),replayHash(next.world.state));
  next.world.advance(71);assert.equal(world.state.game.tick,70);
});

test('presentation history is exact after rollback, survives finality pruning and stays bounded', () => {
  const state = fixture(), onTime = setup(state), late = setup(state);
  const actions: DirectAction[] = [[1, 67, 0, 1], [2, 69, 0, 0]];
  assert.equal(onTime.receive(0, packet(0, actions), 72).status, 'accepted');
  advance(onTime, 72); advance(late, 72);
  const previous = structuredClone(late.presentationFrames());
  const replay = late.receive(0, packet(0, actions), 72); assert.equal(replay.status, 'accepted'); assert.ok(replay.rollbackTicks);
  assert.deepEqual(late.presentationFrames(), onTime.presentationFrames());
  assert.notDeepEqual(late.presentationFrames(), previous);
  assert.deepEqual(late.presentationFrames().map(f => f.tick), [69, 70, 71, 72]);
  const before = structuredClone(late.presentationFrames());
  assert.equal(late.receive(0, packet(0, [[2, 69, 0, 2]]), 72).status, 'invalid');
  assert.deepEqual(late.presentationFrames(), before);
  const certificate = certify(late, 72, [2, 0, 0, 0, 0]);
  assert.deepEqual(late.presentationFrames(), before, 'temporary finality replay cannot alter installed frames');
  assert.equal(late.finalize(certificate).status, 'accepted');
  assert.deepEqual(late.presentationFrames(), before, 'finality retains recent presentation even before its replay fence');
  advance(late, 80); assert.deepEqual(late.presentationFrames().map(f => f.tick), [77, 78, 79, 80]);
  assert.ok(late.presentationBytes > 0 && late.presentationBytes < late.retainedBytes);
});

test('a late action exposing a corrupt pending finality cannot mutate simulation or presentation history', () => {
  const world = setup(); advance(world, 69);
  for (let slot = 1; slot < 5; slot++) assert.equal(world.receive(slot, packet(slot, [], [69, 0]), 69).status, 'accepted');
  const pending: Finality = [1, 7, 'final', 69, [[0, 1], [1, 0], [2, 0], [3, 0], [4, 0]], '0'.repeat(16)];
  assert.equal(world.finalize(unpackMessage(packMessage(pending))).status, 'waiting');
  const before = structuredClone(world.presentationFrames()), state = replayHash(world.state), progress = world.streamProgress();
  const rejected = world.receive(0, packet(0, [[1, 66, 0, 1]], [69, 1]), 69);
  assert.equal(rejected.status, 'invalid'); assert.equal(rejected.corrupt, true);
  assert.deepEqual(world.presentationFrames(), before); assert.equal(replayHash(world.state), state); assert.deepEqual(world.streamProgress(), progress);
  assert.equal(world.pendingFinalizedTick, undefined, 'discard the corrupt certificate without keeping a poison retry');
});
