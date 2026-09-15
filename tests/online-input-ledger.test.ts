import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession, type RoomCommand } from '../src/online/host-session.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { advanceRiderPose } from '../src/shared/rider-motion.js';
import { RIDER_SPEED, RIDER_TURN_RATE } from '../src/shared/game.js';

type Input=Extract<RoomCommand,{type:'input'}>;
function playing(){const s=new HostSession('host',defaultRoomSettings(),{token:()=> 'injected'});s.command('host',{type:'join',name:'Host'});s.command('guest',{type:'join',name:'Guest'});s.command('host',{type:'action',action:'start'});while(s.game.phase==='countdown')s.advance();return s;}
function input(s:HostSession,seq:number,patch:Partial<Input>={}):Input {return {type:'input',scope:s.controlScope('host')!,intendedTick:s.game.tick+1,seq,left:false,right:false,bomb:false,...patch};}

test('receipt is not application: future steering waits and reports exact application tick',()=>{
 const s=playing(),tick=s.game.tick;assert.equal(s.command('host',input(s,1,{left:true,intendedTick:tick+3})),undefined);
 assert.equal(s.acknowledgements().host,1);assert.equal(s.appliedMotion('host')!.appliedSeq,-1);
 s.advance();s.advance();assert.equal(s.appliedMotion('host')!.appliedSeq,-1);s.advance();
 const state=s.appliedMotion('host')!;assert.equal(state.tick,tick+3);assert.equal(state.appliedTick,tick+3);assert.equal(state.appliedSeq,1);assert.deepEqual(state.held,{left:true,right:false});assert.deepEqual(state.results,[{seq:1,status:'applied',appliedTick:tick+3}]);
});
test('same-tick newest movement wins while all outcomes are acknowledged',()=>{
 const s=playing(),p=s.game.players.get('host')!,pose={...p};s.command('host',input(s,2,{right:true}));s.command('host',input(s,1,{left:true}));s.advance();
 const expected=advanceRiderPose(pose,{left:false,right:true},{distance:RIDER_SPEED/20,turn:RIDER_TURN_RATE/20,drunkHeadingOffset:0});assert.ok(Math.abs(p.x-expected.x)<1e-6);assert.ok(Math.abs(p.y-expected.y)<1e-6);
 assert.deepEqual(s.appliedMotion('host')!.results.map(r=>[r.seq,r.status]),[[1,'superseded'],[2,'applied']]);
});
test('older future slot cannot undo newer applied movement and exact result acknowledgements preserve pending input',()=>{
 const s=playing();s.command('host',input(s,1,{left:true,intendedTick:s.game.tick+3}));s.command('host',input(s,2,{right:true}));s.advance();assert.equal(s.acknowledgeMotion('host',s.controlScope('host')!,[2]),true);s.advance();s.advance();
 assert.equal(s.appliedMotion('host')!.appliedSeq,2);assert.deepEqual(s.appliedMotion('host')!.held,{left:false,right:true});assert.deepEqual(s.appliedMotion('host')!.results,[{seq:1,status:'superseded'}]);
});
test('held acknowledged steering continues then expires at twenty ticks without fresh application',()=>{
 const s=playing();s.command('host',input(s,1,{left:true}));s.advance();const applied=s.game.tick;s.acknowledgeMotion('host',s.controlScope('host')!,[1]);
 for(let i=0;i<19;i++)s.advance();assert.equal(s.appliedMotion('host')!.held.left,true);assert.equal(s.appliedMotion('host')!.results.length,0);s.advance();assert.equal(s.game.tick,applied+20);assert.equal(s.appliedMotion('host')!.held.left,false);assert.equal(s.appliedMotion('host')!.appliedTick,applied);
});
test('same-tick press/release survives steering supersession, duplicates cannot launch twice',()=>{
 const s=playing();s.command('host',input(s,0));s.command('host',input(s,1,{left:true,bomb:true,bombAction:'press'}));const release=input(s,2,{right:true,bombAction:'release'});s.command('host',release);s.advance();assert.equal(s.game.bombs.size,1);s.command('host',release);s.advance();assert.equal(s.game.bombs.size,1);
});
test('a press stamped later than the following hold sample is still processed first in sequence order (#43)',()=>{
 const s=playing(),tick=s.game.tick;s.command('host',input(s,0));
 assert.equal(s.command('host',input(s,1,{bomb:true,bombAction:'press',intendedTick:tick+3})),undefined); // stale clock sample extrapolated ahead
 assert.equal(s.command('host',input(s,2,{bomb:true,intendedTick:tick+1})),undefined); // 50 ms hold resend after a fresh sample
 s.advance();const p=s.game.players.get('host')!;assert.notEqual(p.bombChargeStartedTick,undefined);
 assert.deepEqual(s.appliedMotion('host')!.results.map(r=>[r.seq,r.status]),[[0,'superseded'],[1,'superseded'],[2,'applied']]);
 s.command('host',input(s,3,{bombAction:'release'}));s.advance();assert.equal(s.game.bombs.size,1);assert.equal(p.bombChargeStartedTick,undefined);
});
test('old-scope release cannot cancel current charge; a late current release fires at the next step',()=>{
 const s=playing(),old=input(s,2,{bombAction:'release'});s.clear();s.command('host',input(s,0));s.command('host',input(s,1,{bomb:true,bombAction:'press'}));s.advance();const p=s.game.players.get('host')!;assert.notEqual(p.bombChargeStartedTick,undefined);
 assert.match(s.command('host',old)!,/scope/);s.advance();assert.notEqual(p.bombChargeStartedTick,undefined);
 assert.equal(s.command('host',input(s,2,{intendedTick:s.game.tick-5,bombAction:'release'})),undefined);s.advance();assert.equal(p.bombChargeStartedTick,undefined);assert.equal(s.game.bombs.size,1);
});
test('disconnect, match changes and restore create fresh neutral scope while preserving received highwater',()=>{
 const s=playing(),old=s.controlScope('host')!;s.command('host',input(s,9,{left:true}));s.advance();s.disconnect('host');assert.notDeepEqual(s.controlScope('host'),old);assert.equal(s.appliedMotion('host')!.appliedSeq,-1);assert.equal(s.appliedMotion('host')!.held.left,false);
 const raw=s.checkpoint(),before=s.controlScope('host');assert.equal(s.restore(raw),true);assert.notDeepEqual(s.controlScope('host'),before);assert.equal(s.acknowledgements().host,9);assert.match(s.command('host',{...input(s,10),scope:old})!,/scope/);
 const restored=s.controlScope('host');s.command('host',{type:'action',action:'lobby'});assert.notDeepEqual(s.controlScope('host'),restored);
});
test('queue and result history are bounded and overflow forces explicit neutral resync',()=>{
 const s=playing(),scope=s.controlScope('host');for(let i=0;i<128;i++)assert.equal(s.command('host',input(s,i,{left:true,intendedTick:s.game.tick+4})),undefined);
 assert.match(s.command('host',input(s,128))!,/history full/);assert.notDeepEqual(s.controlScope('host'),scope);assert.deepEqual(s.appliedMotion('host')!.held,{left:false,right:false});assert.equal(s.appliedMotion('host')!.results.length,0);
 assert.equal(s.acknowledgeMotion('host',s.controlScope('host')!,Array(129).fill(0)),false);
});
test('malformed timing and aim cannot apply motion or keep an invalid release charging',()=>{
 const s=playing();assert.match(s.command('host',input(s,0,{intendedTick:NaN}))!,/Invalid input/);assert.match(s.command('host',input(s,0,{gesture:-1}))!,/gesture/);assert.match(s.command('host',{...input(s,0),scope:null})!,/scope/);s.command('host',input(s,1));s.command('host',input(s,2,{bomb:true,bombAction:'press'}));s.advance();
 assert.match(s.command('host',input(s,3,{bombAction:'release',aim:{x:NaN,y:0}}))!,/aim/);s.advance();assert.equal(s.game.players.get('host')!.bombChargeStartedTick,undefined);assert.equal(s.game.bombs.size,0);
});
test('queued release is discarded on disconnect and cannot fire into a rejoined control scope',()=>{
 const s=playing();s.command('host',input(s,0));s.command('host',input(s,1,{bomb:true,bombAction:'press'}));s.advance();
 const release=input(s,2,{bombAction:'release',intendedTick:s.game.tick+3});s.command('host',release);s.disconnect('host');s.command('host',{type:'join',name:'Host'});assert.match(s.command('host',release)!,/scope/);
 for(let i=0;i<4;i++)s.advance();assert.equal(s.game.bombs.size,0);assert.equal(s.game.players.get('host')!.bombChargeStartedTick,undefined);
});
