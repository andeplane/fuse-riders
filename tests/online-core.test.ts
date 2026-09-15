import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRoomSettings, parseRoomSettings, roomPickup, loadRoomSettings } from '../src/shared/room-settings.js';
import { HostSession } from '../src/online/host-session.js';
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
  assert.equal(a.command('host',{type:'action',action:'start'}),undefined);a.advance();assert.equal(a.game.phase,'countdown');
  a.command('late',{type:'join',name:'Late'});a.advance();assert.equal(a.snapshot().players.find(player=>player.id==='late')!.waitingForNextRound,true);
});
test('bomb aim time validates saved preferences and defaults older preferences',()=>{
  const defaults=defaultRoomSettings();
  const {bombChargeTicks:_,...older}=defaults;
  assert.equal(loadRoomSettings({getItem:()=>JSON.stringify(older)}).bombChargeTicks,8);
  for(const value of [2,8,24,40])assert.equal(parseRoomSettings({...defaults,bombChargeTicks:value})?.bombChargeTicks,value);
  for(const value of [null,'8',NaN,Infinity,0,1,41,2.5])assert.equal(parseRoomSettings({...defaults,bombChargeTicks:value}),undefined);
});
// The world codec carried the active value to views before the input-log cutover; every view now folds
// the host's settings entry itself, so this keeps the round boundary and drops the replication half.
test('aim time changes at the next round',()=>{
  const room=session();
  room.command('host',{type:'join',name:'Host'});room.command('guest',{type:'join',name:'Guest'});
  room.command('host',{type:'action',action:'start'});
  for(let i=0;i<60;i++)room.advance();
  assert.equal(room.snapshot().bombChargeTicks,8);
  assert.equal(room.command('host',{type:'settings',settings:{...room.settings,bombChargeTicks:24}}),undefined);
  assert.equal(room.settings.bombChargeTicks,24);assert.equal(room.snapshot().bombChargeTicks,8);
  eliminatePlayer(room.game,'guest');room.advance();
  for(let i=0;i<100&&room.game.round===1;i++)room.advance();
  assert.equal(room.game.round,2);assert.equal(room.snapshot().bombChargeTicks,24);
});
test('fixed one-round rooms finish after one round',()=>{
  const room=session();room.command('host',{type:'settings',settings:{...defaultRoomSettings(),match:'rounds',length:1}});
  room.command('host',{type:'join',name:'Host'});room.command('p',{type:'join',name:'Player'});room.command('host',{type:'action',action:'start'});
  for(let i=0;i<60;i++)room.advance();eliminatePlayer(room.game,'p');room.advance();assert.equal(room.game.phase,'matchOver');assert.equal(room.game.matchWinnerId,'host');
});

test('host checkpoint restores world and sequence numbers without replaying held fire',()=>{
  const a=session();a.command('host',{type:'join',name:'Host'});a.command('p',{type:'join',name:'P'});a.command('host',{type:'action',action:'start'});
  for(let i=0;i<60;i++)a.advance();a.command('p', { type: 'input', left:true,right:false,bomb:true,bombAction:'press'});a.advance();
  const b=session();assert.equal(b.restore(a.checkpoint()),true);assert.equal(b.game.tick,a.game.tick);
  b.advance();assert.equal(b.game.players.get('p')!.bombChargeStartedTick,undefined);
  assert.equal(b.restore('invalid'),false);
});

test('online return to lobby preserves transport simulation time',()=>{
  const room=session();for(let i=0;i<10;i++)room.advance();
  room.command('host',{type:'action',action:'lobby'});
  assert.equal(room.game.tick,10);room.advance();assert.equal(room.game.tick,11);
});

test('guests that vanish in the lobby free their seats',()=>{
  const room=session();const seats=['host','b','c','d','e'];
  for(const id of seats)room.command(id,{type:'join',name:id});room.advance();
  assert.equal(room.command('f',{type:'join',name:'Late'}),'Room is full (5 players)');
  for(const id of ['b','c','d'])room.disconnect(id);room.advance();
  assert.equal(room.game.players.size,2);
  assert.deepEqual([...room.game.players.keys()],['host','e']);
  assert.equal(room.command('f',{type:'join',name:'Newcomer'}),undefined);
  assert.equal(room.command('host',{type:'action',action:'start'}),undefined);room.advance();
  assert.equal(room.game.phase,'countdown');
  assert.equal(room.game.players.size,3);
  assert.equal(room.command('host',{type:'action',action:'other'}),'Unknown action');
});

test('a guest lost mid-round keeps its seat until the match ends, then a newcomer reclaims it',()=>{
  const room=session();room.command('host',{type:'settings',settings:{...defaultRoomSettings(),match:'rounds',length:1}});
  for(const id of ['host','b','c','d','e'])room.command(id,{type:'join',name:id});
  room.command('host',{type:'action',action:'start'});room.advance();
  while(room.game.phase==='countdown')room.advance();
  const slot=room.game.players.get('d')!.slot;
  room.disconnect('d');room.disconnect('e');room.advance();
  assert.equal(room.game.players.size,5,'a mid-round seat is reserved for the phone that lost it');
  assert.equal(room.game.players.get('d')!.connected,false);
  assert.equal(room.command('f',{type:'join',name:'Late'}),'Room is full (5 players)');
  assert.equal(room.command('d',{type:'join',name:'d'}),undefined);room.advance();
  assert.equal(room.game.players.get('d')!.connected,true);
  assert.equal(room.game.players.get('d')!.slot,slot);
  for(const id of ['b','c','d','e'])eliminatePlayer(room.game,id);
  room.advance();assert.equal(room.game.phase,'matchOver');
  assert.equal(room.command('f',{type:'join',name:'Newcomer'}),undefined);room.advance();
  assert.equal(room.game.players.has('e'),false);
  assert.deepEqual([...room.game.players.keys()].sort(),['b','c','d','f','host']);
});

test('a rematch drops the riders that were lost during the finished match',()=>{
  const room=session();room.command('host',{type:'settings',settings:{...defaultRoomSettings(),match:'rounds',length:1}});
  for(const id of ['host','b','c'])room.command(id,{type:'join',name:id});
  room.command('host',{type:'action',action:'start'});room.advance();
  while(room.game.phase==='countdown')room.advance();
  room.disconnect('c');room.advance();
  for(const id of ['b','c'])eliminatePlayer(room.game,id);
  room.advance();assert.equal(room.game.phase,'matchOver');
  assert.equal(room.game.players.size,3);
  assert.equal(room.command('host',{type:'action',action:'rematch'}),undefined);room.advance();
  assert.equal(room.game.phase,'countdown');
  assert.deepEqual([...room.game.players.keys()].sort(),['b','host']);
});

