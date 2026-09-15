import test from 'node:test';
import assert from 'node:assert/strict';
import { encode } from '@msgpack/msgpack';
import { decodeFast, encodeFast, hashScope, packFast, unpackFast, FAST_MESSAGE_BYTES, type FastMessage } from '../src/online/wire.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { ControllerInputState } from '../src/client/controller-state.js';

const scope={matchId:'match-uuid',round:2,controlEpoch:'token:3'};
const resolve=(hash:number)=>hash===hashScope(scope)?scope:undefined;
const roundTrip=(message:FastMessage)=>{const bytes=encodeFast({id:7,epoch:3,incarnation:123,data:packFast(message)});const envelope=decodeFast(bytes)!;assert.deepEqual([envelope.id,envelope.epoch,envelope.incarnation],[7,3,123]);return {bytes,message:unpackFast(envelope.data,resolve)};};

test('input, batch and clock tuples round-trip exactly and stay a few dozen bytes',()=>{
  const input:FastMessage={type:'command',command:{type:'input',scope,seq:5,intendedTick:120,left:true,right:false,bomb:true,gesture:2,bombAction:'press',aim:{x:.25,y:.5},resultAcks:[3,4]}};
  const held=roundTrip(input);assert.deepEqual(held.message,input);assert.ok(held.bytes.byteLength<=48,`${held.bytes.byteLength} bytes`);
  const neutral=roundTrip({type:'command',command:{type:'input',scope,seq:6,intendedTick:121,left:false,right:false,bomb:false,resultAcks:[]}});assert.ok(neutral.bytes.byteLength<=24,`${neutral.bytes.byteLength} bytes`);
  const idle:FastMessage={type:'actions',from:1000,tick:1002,ops:[[0,1001,[]],[0,1002,[]]],hash:null,meta:{ack:4,paused:false}};
  const batch=roundTrip(idle);assert.deepEqual(batch.message,idle);assert.ok(batch.bytes.byteLength<=32,`${batch.bytes.byteLength} bytes`);
  const rich:FastMessage={type:'actions',from:1,tick:2,ops:[[0,2,[[1,2,5,[.5,.5],[[0,null]]]]]],hash:'0123456789abcdef',meta:{ack:-1,paused:true,motion:null,settings:defaultRoomSettings()}};
  assert.deepEqual(roundTrip(rich).message,rich);
  assert.deepEqual(roundTrip({type:'tickProbe',probeId:9,localSentAt:1234.5}).message,{type:'tickProbe',probeId:9,localSentAt:1234.5});
  const pong:FastMessage={type:'tickPong',probeId:9,localSentAt:1234.5,authorityTick:77.25,paused:false,scope};
  assert.deepEqual(roundTrip(pong).message,pong);
});
test('an unknown control scope hash yields a stale scope for input and drops a clock reply',()=>{
  const packed=packFast({type:'command',command:{type:'input',scope,seq:1,intendedTick:2,left:false,right:false,bomb:false}});
  const stale=unpackFast(packed,()=>undefined)!;assert.equal(stale.type,'command');if(stale.type==='command')assert.equal(stale.command.scope.round,-1);
  assert.equal(unpackFast(packFast({type:'tickPong',probeId:1,localSentAt:1,authorityTick:1,paused:false,scope}),()=>undefined),undefined);
});
test('malformed and oversized fast packets are rejected before anything is applied',()=>{
  assert.equal(decodeFast(new Uint8Array(FAST_MESSAGE_BYTES+1)),undefined);
  assert.equal(decodeFast(encode('text')),undefined);assert.equal(decodeFast(encode([1,2])),undefined);assert.equal(decodeFast(encode(['a',1,2,null])),undefined);
  assert.equal(decodeFast(new Uint8Array([0xc1,0xc1,0xc1])),undefined);
  for(const bad of [null,7,[],[9],[1],[1,1,1,[],null,1,false,0],[2,1,2,3,99,null,0,null,[]],[2,1,2,3,1,null,7,null,[]],[3],[4,1,2,3,false,'x']])assert.equal(unpackFast(bad,resolve),undefined);
});
test('held controls repeat at the heartbeat interval after the trailing resends; the LAN default repeats every call',()=>{
  let now=0;const sent:number[]=[];const state=new ControllerInputState({send:m=>{sent.push(m.seq);return true;}},()=>now,250);
  state.pointerDown(1,'left');for(let i=1;i<=10;i++){now=i*50;state.resend();}
  assert.deepEqual(sent,[0,1,2,3,4],'three trailing resends, then one heartbeat at 250 ms');
  now=600;state.pointerRelease(1);for(let i=1;i<=4;i++){now=600+i*50;state.resend();}
  assert.deepEqual(sent.slice(5),[5,6,7,8],'a release is followed by exactly three trailing resends');
  const lan:number[]=[];const fast=new ControllerInputState({send:m=>{lan.push(m.seq);return true;}},()=>now);fast.pointerDown(1,'left');for(let i=0;i<5;i++)fast.resend();assert.equal(lan.length,6);
});
