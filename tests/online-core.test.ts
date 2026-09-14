import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRoomSettings, parseRoomSettings, roomPickup, loadRoomSettings } from '../src/shared/room-settings.js';
import { HostSession } from '../src/online/host-session.js';
import { WorldEncoder, WorldDecoder } from '../src/online/world-codec.js';
import { eliminatePlayer } from '../src/shared/game.js';
const session=()=>new HostSession('host',defaultRoomSettings(),{token:()=>crypto.randomUUID()});
test('room settings reject malformed values, restore safe defaults and allow all drops off',()=>{
  const defaults=defaultRoomSettings();assert.deepEqual(parseRoomSettings(defaults),defaults);
  assert.equal(parseRoomSettings({...defaults,length:0}),undefined);
  assert.equal(parseRoomSettings({...defaults,weights:{shell:Infinity}}),undefined);
  assert.equal(parseRoomSettings({...defaults,weights:{bad:2}}),undefined);
  assert.equal(roomPickup(.5,{}),undefined);
  assert.equal(roomPickup(.1,{shell:1,gun:3}),'shell');assert.equal(roomPickup(.9,{shell:1,gun:3}),'gun');
  assert.deepEqual(loadRoomSettings({getItem:()=>'{broken'}),defaults);
});
test('rooms isolate players and only the host can start or change rules',()=>{
  const a=session(),b=session();a.command('host',{type:'join',name:'Host'});a.command('guest',{type:'join',name:'Guest'});
  assert.equal(b.game.players.size,0);
  assert.match(a.command('guest',{type:'action',action:'start'})!,/host/);
  assert.match(a.command('guest',{type:'settings',settings:defaultRoomSettings()})!,/host/);
  assert.equal(a.command('host',{type:'action',action:'start'}),undefined);assert.equal(a.game.phase,'countdown');
  a.command('late',{type:'join',name:'Late'});assert.equal(a.snapshot().players.find(player=>player.id==='late')!.waitingForNextRound,true);
});
test('fixed one-round rooms finish after one round',()=>{
  const room=session();room.command('host',{type:'settings',settings:{...defaultRoomSettings(),match:'rounds',length:1}});
  room.command('host',{type:'join',name:'Host'});room.command('p',{type:'join',name:'Player'});room.command('host',{type:'action',action:'start'});
  for(let i=0;i<60;i++)room.advance();eliminatePlayer(room.game,'p');room.advance();assert.equal(room.game.phase,'matchOver');assert.equal(room.game.matchWinnerId,'host');
});
test('world deltas reconstruct split, removed and appended trails and recover via keyframe',()=>{
  const room=session();room.command('host',{type:'join',name:'Host'});
  const player=room.game.players.get('host')!;const encoder=new WorldEncoder(),decoder=new WorldDecoder();
  player.trail=[{x1:0,y1:0,x2:100,y2:0,createdTick:1,expiresAtTick:161}];
  const first=encoder.encode(room.snapshot(),'m',1,1,true);assert.deepEqual(decoder.accept(first),room.snapshot());
  player.trail=[{...player.trail[0]!,x2:30},{...player.trail[0]!,x1:70}];
  const second=encoder.encode(room.snapshot(),'m',1,2);assert.deepEqual(decoder.accept(second),room.snapshot());
  const missing=encoder.encode(room.snapshot(),'m',1,3);void missing;
  assert.equal(decoder.accept(encoder.encode(room.snapshot(),'m',1,4)),undefined);
  assert.deepEqual(decoder.accept(encoder.encode(room.snapshot(),'m',1,5,true)),room.snapshot());
  player.trail=[];assert.deepEqual(decoder.accept(encoder.encode(room.snapshot(),'m',1,6)),room.snapshot());
});

test('fresh encoder after reconnection replaces old stream without accepting retired frames',()=>{
  const room=session();const a=new WorldEncoder(1),b=new WorldEncoder(2),decoder=new WorldDecoder();
  const first=a.encode(room.snapshot(),'m',1,1,true);decoder.accept(first);decoder.accept(a.encode(room.snapshot(),'m',1,2));
  assert.ok(decoder.accept(b.encode(room.snapshot(),'m',1,3,true)));
  assert.equal(decoder.accept(first),undefined);
});

test('host checkpoint restores world and sequence numbers without replaying held fire',()=>{
  const a=session();a.command('host',{type:'join',name:'Host'});a.command('p',{type:'join',name:'P'});a.command('host',{type:'action',action:'start'});
  for(let i=0;i<60;i++)a.advance();a.command('p', { type: 'input', scope: a.controlScope('p'), intendedTick: a.game.tick+1,seq:99,left:true,right:false,bomb:true,bombAction:'press'});a.advance();
  const b=session();assert.equal(b.restore(a.checkpoint()),true);assert.equal(b.game.tick,a.game.tick);assert.equal(b.acknowledgements().p,99);
  b.advance();assert.equal(b.game.players.get('p')!.bombChargeStartedTick,undefined);
  assert.equal(b.restore('invalid'),false);
});

test('field patches update joins and clear optional charge state without repeating identity',()=>{
  const room=session();room.command('host',{type:'join',name:'Host'});const encoder=new WorldEncoder(),decoder=new WorldDecoder();
  const wire=(frame:ReturnType<WorldEncoder['encode']>)=>decoder.accept(JSON.parse(JSON.stringify(frame)));
  wire(encoder.encode(room.snapshot(),'m',1,1,true));room.command('p',{type:'join',name:'New guest'});
  room.game.players.get('host')!.bombChargeStartedTick=4;
  assert.deepEqual(wire(encoder.encode(room.snapshot(),'m',1,2)),JSON.parse(JSON.stringify(room.snapshot())));
  room.game.players.get('host')!.bombChargeStartedTick=undefined;
  const update=encoder.encode(room.snapshot(),'m',1,3);
  assert.equal(JSON.stringify(update).includes('New guest'),false);
  assert.deepEqual(wire(update),JSON.parse(JSON.stringify(room.snapshot())));
});

test('delayed unseen old keyframe cannot roll a newer generation backward',()=>{
  const room=session(),old=new WorldEncoder(1),current=new WorldEncoder(2),decoder=new WorldDecoder();
  const late=old.encode(room.snapshot(),'m',1,60,true);
  assert.equal(decoder.decode(current.encode(room.snapshot(),'m',1,62,true)).status,'accepted');
  assert.equal(decoder.decode(late).status,'stale');
  assert.equal(decoder.decode(current.encode(room.snapshot(),'m',1,64)).status,'accepted');
});

test('invalid higher generation and corrupt trail patches cannot mutate accepted baseline',()=>{
  const room=session();room.command('host',{type:'join',name:'Host'});
  const a=new WorldEncoder(1),b=new WorldEncoder(2),decoder=new WorldDecoder();
  assert.ok(decoder.accept(a.encode(room.snapshot(),'m',1,1,true)));
  const corrupt=b.encode(room.snapshot(),'m',1,2,true);
  assert.equal(decoder.decode({...corrupt,state:{...room.snapshot(),players:[]},trails:[{player:'missing',add:[],remove:[]}]}).status,'invalid');
  const next=a.encode(room.snapshot(),'m',1,3);
  assert.deepEqual(decoder.accept(next),room.snapshot());
  assert.equal(decoder.decode({...next,seq:next.seq+1,base:next.seq,trails:[{player:'host',add:[[1,0,0,0,0,4,2]],remove:[]}]}).status,'invalid');
  assert.deepEqual(decoder.accept(a.encode(room.snapshot(),'m',1,4)),room.snapshot());
});

test('online return to lobby preserves transport simulation time',()=>{
  const room=session();for(let i=0;i<10;i++)room.advance();
  room.command('host',{type:'action',action:'lobby'});
  assert.equal(room.game.tick,10);room.advance();assert.equal(room.game.tick,11);
});

test('guests that vanish in the lobby free their seats and the removal replicates to guests',()=>{
  const room=session();const seats=['host','b','c','d','e'];
  for(const id of seats)room.command(id,{type:'join',name:id});
  assert.equal(room.command('f',{type:'join',name:'Late'}),'Room is full (5 players)');
  const encoder=new WorldEncoder(),decoder=new WorldDecoder();
  assert.deepEqual(decoder.accept(encoder.encode(room.snapshot(),'m',1,1,true)),room.snapshot());
  for(const id of ['b','c','d'])room.disconnect(id);
  assert.equal(room.game.players.size,2);
  assert.deepEqual([...room.game.players.keys()],['host','e']);
  assert.deepEqual(decoder.accept(encoder.encode(room.snapshot(),'m',1,2))!.players.map(player=>player.id),['host','e']);
  assert.equal(room.command('f',{type:'join',name:'Newcomer'}),undefined);
  assert.equal(room.command('host',{type:'action',action:'start'}),undefined);
  assert.equal(room.game.phase,'countdown');
  assert.equal(room.game.players.size,3);
  assert.equal(room.command('host',{type:'action',action:'other'}),'Unknown action');
});

test('a guest lost mid-round keeps its seat until the match ends, then a newcomer reclaims it',()=>{
  const room=session();room.command('host',{type:'settings',settings:{...defaultRoomSettings(),match:'rounds',length:1}});
  for(const id of ['host','b','c','d','e'])room.command(id,{type:'join',name:id});
  room.command('host',{type:'action',action:'start'});
  while(room.game.phase==='countdown')room.advance();
  const slot=room.game.players.get('d')!.slot;
  room.disconnect('d');room.disconnect('e');
  assert.equal(room.game.players.size,5,'a mid-round seat is reserved for the phone that lost it');
  assert.equal(room.game.players.get('d')!.connected,false);
  assert.equal(room.command('f',{type:'join',name:'Late'}),'Room is full (5 players)');
  assert.equal(room.command('d',{type:'join',name:'d'}),undefined);
  assert.equal(room.game.players.get('d')!.connected,true);
  assert.equal(room.game.players.get('d')!.slot,slot);
  for(const id of ['b','c','d','e'])eliminatePlayer(room.game,id);
  room.advance();assert.equal(room.game.phase,'matchOver');
  assert.equal(room.command('f',{type:'join',name:'Newcomer'}),undefined);
  assert.equal(room.game.players.has('e'),false);
  assert.deepEqual([...room.game.players.keys()].sort(),['b','c','d','f','host']);
});

test('a rematch drops the riders that were lost during the finished match',()=>{
  const room=session();room.command('host',{type:'settings',settings:{...defaultRoomSettings(),match:'rounds',length:1}});
  for(const id of ['host','b','c'])room.command(id,{type:'join',name:id});
  room.command('host',{type:'action',action:'start'});
  while(room.game.phase==='countdown')room.advance();
  room.disconnect('c');
  for(const id of ['b','c'])eliminatePlayer(room.game,id);
  room.advance();assert.equal(room.game.phase,'matchOver');
  assert.equal(room.game.players.size,3);
  assert.equal(room.command('host',{type:'action',action:'rematch'}),undefined);
  assert.equal(room.game.phase,'countdown');
  assert.deepEqual([...room.game.players.keys()].sort(),['b','host']);
});
