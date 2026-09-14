import test from 'node:test';
import assert from 'node:assert/strict';
import { AcceptedKeyframe, KeyframeDelivery, keyframeReceipt } from '../src/online/keyframe-delivery.js';
import { WorldEncoder, WorldDecoder } from '../src/online/world-codec.js';
import { createGame, toSnapshot } from '../src/shared/game.js';
const fixture=()=>({type:'world' as const,frame:new WorldEncoder(1).encode(toSnapshot(createGame('keyframe-test')),'match',1,0),ack:{player:7},motion:{tick:0},settings:{length:3}});

test('lost baseline retries identical full envelope on bounded clock, not dependent deltas',()=>{
 const delivery=new KeyframeDelivery<ReturnType<typeof fixture>>(),world=fixture(),original=structuredClone(world),sent:typeof world[]=[];
 delivery.hold(world,0);world.ack.player=99;world.motion.tick=100;
 const send=(value:typeof world)=>{sent.push(value);value.settings.length=77;return false;};
 assert.equal(delivery.pump(0,send),'waiting');assert.equal(delivery.pump(499,send),'waiting');assert.equal(sent.length,1);
 assert.equal(delivery.pump(500,value=>{assert.deepEqual(value,original);sent.push(value);return true;}),'waiting');assert.equal(sent.length,2);
 assert.equal(delivery.waiting,true);assert.equal(delivery.acknowledge(keyframeReceipt(original.frame)),true);assert.equal(delivery.pump(501,send),'idle');
 assert.equal(delivery.matchesScope('match',1),true);assert.equal(delivery.matchesScope('match',2),false);
});

test('lost ACK can acknowledge exact previously accepted duplicate without applying it twice',()=>{
 const world=fixture(),decoder=new WorldDecoder(),receipts=new AcceptedKeyframe(),delivery=new KeyframeDelivery<typeof world>();delivery.hold(world,0);
 assert.equal(receipts.receipt(world),undefined);assert.equal(decoder.decode(world.frame).status,'accepted');receipts.remember(world);
 const receipt=receipts.receipt(world)!;assert.ok(receipt);assert.equal(decoder.decode(world.frame).status,'stale');
 assert.deepEqual(receipts.receipt(structuredClone(world)),receipt);assert.equal(delivery.acknowledge(receipt),true);
 assert.equal(receipts.receipt({...world,ack:{player:99}}),undefined);
 assert.equal(receipts.receipt({...world,frame:{...world.frame,trails:[{player:'unseen',add:[],remove:[]}]}}),undefined);
 receipts.clear();assert.equal(receipts.receipt(world),undefined);
});

test('old generation stream sequence match and round ACKs cannot retire current baseline',()=>{
 const delivery=new KeyframeDelivery<ReturnType<typeof fixture>>(),world=fixture();delivery.hold(world,0);const receipt=keyframeReceipt(world.frame);
 for(const wrong of [null,{}, {...receipt,generation:2},{...receipt,id:'old'},{...receipt,seq:2},{...receipt,matchId:'old'},{...receipt,round:2},{...receipt,seq:NaN}]){assert.equal(delivery.acknowledge(wrong),false);assert.equal(delivery.waiting,true);}
 delivery.clear();assert.equal(delivery.acknowledge(receipt),false);assert.equal(delivery.pump(100,()=>true),'idle');
 const next={...world,frame:{...world.frame,generation:2}};delivery.hold(next,100);assert.equal(delivery.acknowledge(receipt),false);assert.equal(delivery.acknowledge(keyframeReceipt(next.frame)),true);
});

test('five-second expiry bounds retained baseline and repeated poll/resync cannot flood retries',()=>{
 const delivery=new KeyframeDelivery<ReturnType<typeof fixture>>();delivery.hold(fixture(),0);let sends=0;
 for(let now=0;now<5000;now+=10)assert.equal(delivery.pump(now,()=>{sends++;return true;}),'waiting');
 assert.equal(sends,10);assert.equal(delivery.pump(5000,()=>{sends++;return true;}),'expired');assert.equal(delivery.waiting,false);assert.equal(sends,10);
 assert.throws(()=>delivery.hold({...fixture(),frame:{...fixture().frame,base:1}},5001));
});

test('baseline is accepted before any dependent delta; ACK loss does not corrupt next decode',()=>{
 const game=createGame('keyframe-test'),encoder=new WorldEncoder(),decoder=new WorldDecoder(),cache=new AcceptedKeyframe();
 const world={frame:encoder.encode(toSnapshot(game),'match',1,0)},delivery=new KeyframeDelivery<typeof world>();delivery.hold(world,0);
 // First send lost; second succeeds. Caller observes waiting and does not encode deltas.
 delivery.pump(0,()=>true);delivery.pump(500,retry=>{assert.equal(decoder.decode(retry.frame).status,'accepted');cache.remember(retry);return true;});
 delivery.pump(1000,retry=>{assert.equal(decoder.decode(retry.frame).status,'stale');assert.equal(delivery.acknowledge(cache.receipt(retry)),true);return true;});
 assert.equal(delivery.waiting,false);const delta=encoder.encode(toSnapshot(game),'match',1,2);assert.equal(decoder.decode(delta).status,'accepted');
});
