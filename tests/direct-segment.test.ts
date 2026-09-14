import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, createGame, SLOT_COLORS, startMatch, step } from '../src/shared/game.js';
import { replayHash } from '../src/shared/action-log.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import type { DirectState } from '../src/shared/direct-input.js';
import { DirectSegment } from '../src/online/direct-segment.js';
import { packBootstrap } from '../src/online/rollback-world.js';
import { packMessage, unpackMessage } from '../src/online/action-replication.js';

function setup(shared = false, clockDelay?: 'ahead' | 'opposed', countdown = false) {
  const game = createGame('segment-test', 42); game.settings = defaultRoomSettings();
  for (let slot = 0; slot < 5; slot++) addPlayer(game, { id: `p${slot}`, name: `Rider ${slot}`, slot, color: SLOT_COLORS[slot] });
  startMatch(game); for (let i = 0; i < (countdown ? 55 : 65); i++) step(game, new Map());
  for (const p of game.players.values()) p.invulnerableUntilTick = 10000;
  const state: DirectState = { game, held: new Map(), gestures: new Map() };
  const checkpoint = packBootstrap(7, state, [...game.players.values()].map(p => [p.slot, 0]));
  const members = ['p0', 'p1', 'p2', 'p3', 'p4', 'tv'], views = shared ? ['tv'] : members;
  const coordinator = shared ? 'tv' : 'p0';
  let now = 0, count = 0, blockCoordinator = false, impair = false;
  const faults: { peer: string; reason: string }[] = [], traffic: { from: string; to: string; fast: boolean; bytes: number; pulse?: boolean; kind?: string }[] = [];
  const queue: { at: number; from: string; to: string; bytes: Uint8Array; fast: boolean }[] = [];
  const peers = new Map<string, DirectSegment>(), silenced = new Set<string>();
  for (const id of members) peers.set(id, new DirectSegment({ alias: 7, id, coordinator, baseTick: game.tick, running: true, owners: [...game.players.values()].map(p => [p.slot, p.id]), views, members, ...(views.includes(id) ? { bootstrap: checkpoint } : {}), startAt: 200 }, {
    now: () => now, pulse: (to, bytes) => {
      const tuple = unpackMessage(bytes) as unknown[];
      traffic.push({ from: id, to, fast: true, bytes: bytes.byteLength, pulse: true, kind: 'pulse' });
      if (silenced.has(id) || blockCoordinator && (id === coordinator || to === coordinator)) return true;
      const n = ++count; if (impair && n % 7 === 0) return true;
      const delay = clockDelay && id === 'p1' && to === coordinator && tuple[2] === 10 || clockDelay === 'opposed' && id === coordinator && to === 'p2' && tuple[2] === 11 ? 480 : impair ? 10 + n % 60 : 10;
      queue.push({ at: now + delay, from: id, to, bytes: new Uint8Array(bytes), fast: true }); return true;
    }, events: () => {}, fault: reason => faults.push({ peer: id, reason }),
    fast: (to, bytes) => {
      const raw = unpackMessage(bytes) as unknown[];
      traffic.push({ from: id, to, fast: true, bytes: bytes.byteLength, kind: raw.length === 5 ? (raw[3] as unknown[]).length ? 'action' : 'cut' : 'receipt' });
      if (silenced.has(id)) return true;
      const n = ++count; if (impair && n % 7 === 0) return true;
      queue.push({ at: now + (impair ? 10 + n % 60 : 10), from: id, to, bytes: new Uint8Array(bytes), fast: true }); return true;
    },
    reliable: (to, tuple) => {
      const bytes = packMessage(tuple); traffic.push({ from: id, to, fast: false, bytes: bytes.byteLength, kind: String(tuple[2]) });
      if (!blockCoordinator || (id !== coordinator && to !== coordinator)) queue.push({ at: now + (clockDelay && id === 'p1' && to === coordinator && tuple[2] === 'clock' || clockDelay === 'opposed' && id === coordinator && to === 'p2' && tuple[2] === 'time' ? 480 : 10), from: id, to, bytes, fast: false }); return true;
    },
  }));
  function advance(ms: number, input?: () => void) {
    const end = now + ms;
    while (now < end) {
      now += 10;
      // Input deliberately happens before the watermark pump at every observation.
      input?.();
      for (const peer of peers.values()) peer.tick();
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= now) {
        const message = queue.splice(i, 1)[0], peer = peers.get(message.to)!;
        if (message.fast) peer.receiveFast(message.from, message.bytes); else peer.receiveControl(message.from, unpackMessage(message.bytes));
      }
    }
  }
  return { peers, faults, traffic, advance, silence: (peer: string) => silenced.add(peer), now: () => now, impair: () => { impair = true; }, block: () => { blockCoordinator = true; }, coordinator };
}

test('six live segments independently advance and finalize continuous inputs under loss and reordering', () => {
  const room = setup(); room.advance(400); room.impair();
  let revision = 0;
  room.advance(2200, () => {
    assert.equal(room.peers.get('p1')!.input(1, { revision: revision++, left: revision % 20 < 10, right: false, bomb: false, aim: [(revision % 100) / 100, .5] }), true);
  });
  room.advance(1300); // One quiet heartbeat phase after the final action, including loss repair.
  assert.deepEqual(room.faults, []);
  const finalTick = Math.min(...[...room.peers.values()].map(p => p.finalizedTick));
  assert.ok(finalTick >= 110, JSON.stringify([...room.peers].map(([id,p])=>({id,final:p.finalizedTick,tick:p.world?.state.game.tick,progress:p.world?.streamProgress(),retained:p.retainedRecords}))));
  assert.ok([...room.peers.values()].every(p => p.world!.state.game.tick > 110));
  assert.ok(room.peers.get('p2')!.rollbackCount > 0);
  assert.ok(room.traffic.some(m => m.from === 'p1' && m.to === 'p2' && m.fast));
  // Every checkpoint is independently hash validated by its owning world; compare a common finality fence.
  const leader = room.peers.get('p0')!;
  const proposal = leader.world!.proposeFinality(leader.finalizedTick)!;
  for (const peer of room.peers.values()) peer.receiveControl('p0', proposal);
  room.advance(100);
  const at = new Map<number, Set<string>>();
  for (const peer of room.peers.values()) {
    const tick = peer.finalizedTick; if (!at.has(tick)) at.set(tick, new Set());
    at.get(tick)!.add(replayHash(peer.world!.finalizedState()));
  }
  assert.ok([...at.values()].every(hashes => hashes.size === 1));
});

test('shared TV is the only simulator while five controller origins send directly to it', () => {
  const room = setup(true); room.advance(400);
  assert.ok([...room.peers].filter(([id]) => id !== 'tv').every(([, peer]) => peer.world === undefined));
  assert.equal(room.peers.get('p2')!.input(2, { revision: 0, left: true, right: false, bomb: true, bombAction: 'press', aim: null }), true);
  room.advance(200);
  assert.equal(room.peers.get('p2')!.input(2, { revision: 1, left: false, right: false, bomb: false, bombAction: 'release', aim: null }), true);
  room.advance(1500);
  assert.deepEqual(room.faults, []);
  assert.ok(room.peers.get('tv')!.finalizedTick > 80, JSON.stringify({final:room.peers.get('tv')!.finalizedTick,progress:room.peers.get('tv')!.world?.streamProgress()}));
  assert.ok(room.traffic.filter(m => m.fast && !m.pulse && m.from !== 'tv').every(m => m.to === 'tv'));
  assert.equal(room.peers.get('p2')!.retainedRecords, 0);
});

test('coordinator traffic is unnecessary for immediate peer actions, then clock/finality loss pauses safely', () => {
  const room = setup(); room.advance(400); room.block();
  assert.equal(room.peers.get('p1')!.input(1, { revision: 0, left: true, right: false, bomb: false, aim: null }), true);
  room.advance(250);
  assert.equal(room.peers.get('p2')!.world!.state.held.get(1)?.flags, 1);
  assert.equal(room.peers.get('p2')!.faultReason, undefined);
  room.advance(1200);
  assert.equal(room.peers.get('p2')!.faultReason, undefined);
  // ADR042's longer clock freshness does not extend the unchanged 40-tick world cap.
  room.advance(700);
  assert.equal(room.peers.get('p2')!.faultReason, 'World paused — synchronizing');
  assert.ok(room.peers.get('p2')!.world!.state.game.tick <= room.peers.get('p2')!.finalizedTick + 40);
  assert.equal(room.peers.get('p1')!.input(1, { revision: 1, left: false, right: false, bomb: false, aim: null }), false);
});

test('provisional eliminations cannot publish death or placements before verified finality', () => {
  const game = createGame('outcome-test', 42); game.settings = defaultRoomSettings();
  for (let slot = 0; slot < 2; slot++) addPlayer(game, { id: `p${slot}`, name: `Rider ${slot}`, slot, color: SLOT_COLORS[slot] });
  startMatch(game); for (let i = 0; i < 65; i++) step(game, new Map());
  const doomed = game.players.get('p0')!; doomed.x = 0; doomed.angle = Math.PI; doomed.invulnerableUntilTick = 0;
  const checkpoint = packBootstrap(7, { game, held: new Map(), gestures: new Map() }, [[0, 0], [1, 0]]);
  const segment = new DirectSegment({ alias: 7, id: 'p0', coordinator: 'p0', baseTick: 65, running: true, owners: [[0, 'p0'], [1, 'p1']], views: ['p0'], members: ['p0', 'p1'], bootstrap: checkpoint }, {
    now: () => 0, pulse: () => true, fast: () => true, reliable: () => true, events: () => {}, fault: reason => assert.fail(reason),
  });
  segment.world!.advance(66);
  assert.equal(segment.world!.state.game.players.get('p0')!.alive, false);
  assert.equal(segment.snapshot()!.players.find(p => p.id === 'p0')!.alive, true);
  assert.deepEqual(segment.snapshot()!.roundPlacements, []);
  for (let slot = 0; slot < 2; slot++) segment.world!.receive(slot, packMessage([1, 7, slot, [], [66, 0]]), 66);
  segment.receiveControl('p0', segment.world!.proposeFinality(66));
  assert.equal(segment.snapshot()!.players.find(p => p.id === 'p0')!.alive, false);
  assert.ok(segment.snapshot()!.roundPlacements.some(p => p.playerId === 'p0'));
});

test('controller finality is coordinator-scoped and conflicting progress cannot overwrite the accepted fence', () => {
  const room = setup(true); room.advance(400);
  const controller = room.peers.get('p1')!, leader = room.peers.get('tv')!;
  const finality = leader.world!.proposeFinality(leader.finalizedTick)!;
  const before = controller.finalizedTick;
  controller.receiveControl('p0', [1, 7, 'final', before + 1, finality[4], finality[5]]);
  controller.receiveControl('tv', [1, 8, 'final', before + 1, finality[4], finality[5]]);
  assert.equal(controller.finalizedTick, before); assert.equal(controller.faultReason, undefined);
  controller.receiveControl('tv', finality);
  controller.receiveControl('tv', [...finality.slice(0, 5), '0'.repeat(16)]);
  assert.match(controller.faultReason!, /Conflicting coordinator/);
  assert.equal(controller.finalizedTick, finality[3]);
});


test('asymmetric clock samples and opposite follower errors retain valid future actions without executing early', () => {
  for (const delay of ['ahead', 'opposed'] as const) {
    const room = setup(false, delay); room.advance(1200);
    assert.deepEqual(room.faults, []);
    const origin = room.peers.get('p1')!, receiver = room.peers.get('p2')!;
    assert.equal(origin.clock.read().canOriginate, true); assert.equal(receiver.clock.read().canOriginate, true);
    assert.ok(origin.clock.read().fractionalTick - receiver.clock.read().fractionalTick > (delay === 'opposed' ? 9 : 4));
    assert.equal(origin.input(1, { revision: 0, left: true, right: false, bomb: false, aim: null }), true);
    room.advance(20); assert.deepEqual(room.faults, []);
    assert.equal(receiver.world!.state.held.get(1)?.flags ?? 0, 0);
    room.advance(700); assert.deepEqual(room.faults, []);
    assert.equal(receiver.world!.state.held.get(1)?.flags, 1);
    assert.ok(receiver.finalizedTick > 80);
  }
});

test('initial progress grace is bounded and replayed base cuts cannot postpone it', () => {
  const room = setup(); room.silence('p1'); room.advance(1700);
  const coordinator = room.peers.get('p0')!;
  assert.equal(coordinator.faultReason, undefined);
  coordinator.receiveFast('p1', packMessage([1, 7, 1, [], [65, 0]]));
  room.advance(10);
  assert.match(coordinator.faultReason!, /stopped publishing progress/);
});

test('replayed progress cannot prevent bounded synchronization when an origin falls silent', () => {
  const room = setup(); room.advance(400); room.silence('p1');
  const coordinator = room.peers.get('p0')!;
  const cut = coordinator.world!.streamProgress().find(p => p.slot === 1)!.watermark;
  room.advance(1000, () => coordinator.receiveFast('p1', packMessage([1, 7, 1, [], cut])));
  assert.equal(coordinator.faultReason, undefined);
  room.advance(1600, () => coordinator.receiveFast('p1', packMessage([1, 7, 1, [], cut])));
  assert.ok(coordinator.faultReason, 'unchanged cuts cannot keep the world running');
  assert.ok(coordinator.world!.state.game.tick <= coordinator.finalizedTick + 40);
});

test('uncertain clocks stop input, cuts and world advancement, and a failed release never revives', () => {
  const game = createGame('uncertain-test', 42); game.settings = defaultRoomSettings();
  for (let slot = 0; slot < 2; slot++) addPlayer(game, { id: `p${slot}`, name: `Rider ${slot}`, slot, color: SLOT_COLORS[slot] });
  startMatch(game); for (let i = 0; i < 65; i++) step(game, new Map());
  const checkpoint = packBootstrap(7, { game, held: new Map(), gestures: new Map() }, [[0, 0], [1, 0]]);
  let now = 0; const fast: Uint8Array[] = [], pulses: Uint8Array[] = [], faults: string[] = [];
  const segment = new DirectSegment({ alias: 7, id: 'p1', coordinator: 'p0', baseTick: 65, running: true, owners: [[0, 'p0'], [1, 'p1']], views: ['p0', 'p1'], members: ['p0', 'p1'], bootstrap: checkpoint }, {
    now: () => now, pulse: (_peer, bytes) => { pulses.push(bytes); return true; }, fast: (_peer, bytes) => { fast.push(bytes); return true; }, reliable: () => true, events: () => {}, fault: reason => faults.push(reason),
  });
  segment.tick(); let request = unpackMessage(pulses.at(-1)!) as unknown[]; now = 490;
  segment.receiveFast('p0', packMessage([1, 7, 11, 1, request[3], [[], [], [1, 7, 'time', request[3], 65], null]])); segment.tick();
  assert.equal(segment.clock.read().canOriginate, true);
  assert.equal(segment.input(1, { revision: 0, left: false, right: false, bomb: true, bombAction: 'press', aim: null }), true);
  now = 1000; segment.tick(); request = unpackMessage(pulses.at(-1)!) as unknown[];
  const beforeCut = segment.world!.streamProgress().find(p => p.slot === 1)!.watermark; now = 1480;
  // Opposite asymmetry has a lower RTT: the clock sample is valid, but the current projection is uncertain.
  segment.receiveFast('p0', packMessage([1, 7, 11, 2, request[3], [[], [], [1, 7, 'time', request[3], 94.6], null]]));
  assert.equal(segment.clock.read().reason, 'uncertain'); assert.equal(segment.clock.read().canAdvance, false);
  const beforeTick = segment.world!.state.game.tick;
  segment.tick();
  const cut = segment.world!.streamProgress().find(p => p.slot === 1)!.watermark;
  assert.deepEqual(cut, beforeCut); assert.equal(segment.world!.state.game.tick, beforeTick);
  const records = segment.world!.retainedRecords;
  segment.receiveFast('p0', packMessage([1, 7, 0, [[1, 90, 0, 1]], [90, 1]]));
  assert.equal(segment.world!.retainedRecords, records); assert.deepEqual(faults, []);
  assert.equal(segment.input(1, { revision: 1, left: false, right: false, bomb: false, bombAction: 'release', aim: null }), false);
  const sent = fast.length;
  const probe = segment.clock.request()!;
  assert.equal(segment.clock.accept([1, 7, 'time', probe[3], 94.6]), 'accepted');
  assert.equal(segment.clock.read().canOriginate, true);
  assert.equal(segment.input(1, { revision: 2, left: false, right: false, bomb: false, bombAction: 'release', aim: null }), false);
  segment.tick(); assert.equal(fast.length, sent); assert.equal(faults.length, 1);
});


test('quiet gameplay has one heartbeat exchange per pair per second and no idle action or clock loop', t => {
  const room=setup();room.advance(1500);room.traffic.length=0;room.advance(10000);
  assert.deepEqual(room.faults,[]);
  const counts:Record<string,number>={};for(const message of room.traffic)counts[message.kind!]=(counts[message.kind!]??0)+1;
  assert.equal(counts.pulse,300);assert.equal(counts.action??0,0);assert.equal(counts.receipt??0,0);assert.equal(counts.clock??0,0);assert.equal(counts.time??0,0);
  for(const peer of room.peers.values())assert.ok(peer.world!.state.game.tick-peer.finalizedTick<=40);
  t.diagnostic(JSON.stringify({durationMs:10000,counts,applicationUploadBytesPerSecond:[...room.peers.keys()].map(peer=>({peer,bytes:room.traffic.filter(m=>m.from===peer).reduce((n,m)=>n+m.bytes,0)/10}))}));
});

test('a heartbeat with an unauthorized nested receipt cannot install its otherwise valid cut',()=>{
  const room=setup();room.advance(400);const coordinator=room.peers.get('p0')!;
  const before=coordinator.world!.streamProgress();
  const packet=packMessage([1,7,10,100,0,[[[1,68,0]],[[4,0]],[1,7,'clock',100],null]]);
  assert.equal(coordinator.receiveFast('p1',packet)?.status,'invalid');
  assert.deepEqual(coordinator.world!.streamProgress(),before);assert.deepEqual(room.faults,[]);
});


test('newer or duplicate confirmation requests cannot postpone failed delivery expiry',()=>{
  let now=0,attempts=0;const pulses:Uint8Array[]=[];
  const segment=new DirectSegment({alias:7,id:'p1',coordinator:'p0',baseTick:0,running:true,owners:[[0,'p1']],views:['p0'],members:['p0','p1']},{
    now:()=>now,fast:()=>{attempts++;return false;},pulse:(_peer,bytes)=>{pulses.push(bytes);return true;},reliable:()=>true,events:()=>{},fault:()=>{},
  });
  segment.tick();const request=unpackMessage(pulses[0]) as unknown[];
  segment.receiveFast('p0',packMessage([1,7,11,1,request[3],[[],[],[1,7,'time',request[3],0],null]]));segment.tick();attempts=0;
  segment.receiveControl('p0',[1,7,'confirm',10]);
  for(now=50;now<=1500;now+=50){
    segment.receiveControl('p0',[1,7,'confirm',Math.min(40,10+Math.floor(now/50))]);segment.tick();
    assert.equal(segment.faultReason,undefined);
  }
  assert.ok(attempts<=7,`${attempts} paced attempts`);
  now=1501;segment.tick();assert.equal(segment.faultReason,'Progress confirmation expired — synchronizing');
  now=1600;segment.receiveControl('p0',[1,7,'confirm',35]);segment.tick();assert.equal(segment.faultReason,'Progress confirmation expired — synchronizing');
});


test('a reordered old piggyback receipt does not discard a fresh clock sample',()=>{
  let now=0;const pulses:Uint8Array[]=[];
  const segment=new DirectSegment({alias:7,id:'p1',coordinator:'p0',baseTick:0,running:true,owners:[[0,'p1']],views:['p0'],members:['p0','p1']},{
    now:()=>now,fast:()=>true,pulse:(_peer,bytes)=>{pulses.push(bytes);return true;},reliable:()=>true,events:()=>{},fault:()=>{},
  });
  segment.tick();let request=unpackMessage(pulses.at(-1)!) as unknown[];
  segment.receiveFast('p0',packMessage([1,7,11,1,request[3],[[],[[0,0]],[1,7,'time',request[3],0],null]]));
  assert.equal(segment.input(0,{revision:0,left:true,right:false,bomb:false,aim:null}),true);
  segment.receiveFast('p0',packMessage([1,7,0,1]));assert.equal(segment.retainedRecords,0);
  now=1000;segment.tick();request=unpackMessage(pulses.at(-1)!) as unknown[];
  assert.equal(segment.receiveFast('p0',packMessage([1,7,11,2,request[3],[[],[[0,0]],[1,7,'time',request[3],20],null]]))?.status,'accepted');
  assert.equal(segment.clock.outstandingProbes,0);assert.equal(segment.retainedRecords,0);
  now=2000;segment.tick();request=unpackMessage(pulses.at(-1)!) as unknown[];
  assert.equal(segment.receiveFast('p0',packMessage([1,7,11,3,request[3],[[],[[0,2]],[1,7,'time',request[3],40],null]]))?.status,'invalid');
  assert.equal(segment.clock.outstandingProbes,1);assert.equal(segment.retainedRecords,0);
});


test('countdown transition is publicly confirmed promptly between periodic certificate ticks',()=>{
  const room=setup(false,undefined,true);room.advance(430);
  assert.ok([...room.peers.values()].every(p=>p.snapshot()!.phase==='countdown'));
  room.advance(120);
  assert.deepEqual(room.faults,[]);
  for(const peer of room.peers.values()){
    assert.equal(peer.snapshot()!.phase,'playing');assert.ok(peer.finalizedTick>=60);
  }
});

test('an enqueued but lost certificate pulse cannot cancel reliable finality retry',()=>{
  const game=createGame('certificate-loss',42);game.settings=defaultRoomSettings();
  for(let slot=0;slot<2;slot++)addPlayer(game,{id:`p${slot}`,name:`Rider${slot}`,slot,color:SLOT_COLORS[slot]});
  startMatch(game);for(let i=0;i<65;i++)step(game,new Map());for(const p of game.players.values())p.invulnerableUntilTick=10000;
  let now=0;const pulses:Uint8Array[]=[],certificates:{at:number;tuple:unknown[]}[]=[];
  const segment=new DirectSegment({alias:7,id:'p0',coordinator:'p0',baseTick:65,running:true,owners:[[0,'p0'],[1,'p1']],views:['p0','p1'],members:['p0','p1'],bootstrap:packBootstrap(7,{game,held:new Map(),gestures:new Map()},[[0,0],[1,0]])},{
    now:()=>now,fast:()=>true,pulse:(_peer,bytes)=>{pulses.push(bytes);return true;},reliable:(_peer,tuple)=>{if(tuple[2]!=='final')return true;certificates.push({at:now,tuple});return certificates.length>1;},events:()=>{},fault:reason=>assert.fail(reason),
  });
  for(now=0;now<=1000;now+=10)segment.tick();now=1000;
  segment.receiveFast('p1',packMessage([1,7,10,1,0,[[[1,85,0]],[],[1,7,'clock',1],null]]));segment.tick();
  assert.equal(certificates.length,1);assert.equal(certificates[0].tuple[3],85);
  now=1010;segment.receiveFast('p1',packMessage([1,7,10,2,1,[[[1,85,0]],[],[1,7,'clock',2],null]]));
  const lost=unpackMessage(pulses.at(-1)!) as [number,number,number,number,number,[unknown,unknown,unknown,unknown[]]];
  assert.equal(lost[5][3][3],85); // The fast send returned true, but no receiver delivered it.
  now=1250;segment.tick();assert.equal(certificates.length,2);assert.equal(certificates[1].at,1250);assert.equal(certificates[1].tuple[3],85);
});

test('presentation samples newly executable remote actions once, including a repaired sequence gap', () => {
  const room = setup(); room.advance(400); const peer = room.peers.get('p0')!, tick = peer.clock.read().tick;
  const second = [1, 7, 1, [[2, tick + 2, 0, 0]], null];
  peer.receiveFast('p1', packMessage(second)); assert.equal(peer.presentation.diagnostics.samples, 0);
  const first = [1, 7, 1, [[1, tick + 1, 0, 1]], null];
  peer.receiveFast('p1', packMessage(first)); assert.equal(peer.presentation.diagnostics.samples, 2);
  peer.receiveFast('p1', packMessage(second)); peer.receiveFast('p1', packMessage(first));
  peer.receiveFast('p2', packMessage(first)); peer.receiveFast('p1', new Uint8Array([0xc1]));
  assert.equal(peer.presentation.diagnostics.samples, 2); assert.equal(peer.faultReason, undefined);
  assert.equal(room.peers.get('tv')!.presentation.diagnostics.samples, 0);
});
