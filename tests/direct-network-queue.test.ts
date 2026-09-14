import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectNetworkQueue } from '../scripts/fixtures/direct-network-queue.js';

test('seeded jitter reorders fast actions but keeps reliable messages ordered and copies queued binary data',()=>{
 const channel={},fast:number[]=[],reliable:number[]=[];
 const profile={name:'test',delayMs:50,jitterMs:50,fastLoss:0,kilobitsPerSecond:0};
 const q=new DirectNetworkQueue(profile,1,(_,data)=>{if(typeof data==='string')reliable.push(Number(data));else fast.push(data[0]);return true;});
 for(let i=0;i<20;i++){const data=new Uint8Array([i]);q.enqueue(channel,data,true,0);data[0]=255;q.enqueue(channel,String(i),false,0);}
 q.pump(100);assert.deepEqual(reliable,Array.from({length:20},(_,i)=>i));assert.notDeepEqual(fast,reliable);assert.deepEqual([...fast].sort((a,b)=>a-b),reliable);assert.equal(q.stats.queuedBytes,0);
});

test('fast loss leaves reliable delivery intact and shared sender bandwidth delays both channels',()=>{
 const sent:string[]=[];
 const q=new DirectNetworkQueue({name:'test',delayMs:0,jitterMs:0,fastLoss:1,kilobitsPerSecond:8},1,(_,data)=>{sent.push(String(data));return true;});
 q.enqueue({},new Uint8Array(10),true,0);q.enqueue({},'a'.repeat(10),false,0);q.enqueue({},'b'.repeat(10),false,0);
 q.pump(9);assert.equal(sent.length,0);q.pump(10);assert.equal(sent.length,1);q.pump(20);assert.equal(sent.length,2);assert.equal(q.stats.fastDropped,1);
});

test('fixture queues are bounded and report overflow and closed sends explicitly',()=>{
 const q=new DirectNetworkQueue({name:'test',delayMs:100,jitterMs:0,fastLoss:0,kilobitsPerSecond:0},1,()=>false);
 for(let i=0;i<2049;i++)q.enqueue({},'a',false,0);
 assert.equal(q.stats.overflow,1);assert.equal(q.stats.maxQueuedPackets,2048);q.pump(100);assert.equal(q.stats.closed,2048);assert.equal(q.stats.queuedBytes,0);
 q.enqueue({},new Uint8Array(512*1024),false,200);q.enqueue({},'b',false,200);assert.equal(q.stats.overflow,2);q.clear();assert.equal(q.stats.queuedBytes,0);
});

test('per-channel buffered amount excludes propagation delay after shared serialization and resets on stop',()=>{
 const a={},b={};
 const q=new DirectNetworkQueue({name:'test',delayMs:100,jitterMs:0,fastLoss:0,kilobitsPerSecond:8},1,(channel)=>{assert.equal(q.bufferedAmount(channel),0);return true;});
 q.enqueue(a,'abc',false,0);q.enqueue(b,new Uint8Array(10),false,0);
 assert.equal(q.bufferedAmount(a),3);assert.equal(q.bufferedAmount(b),10);
 q.pump(2);assert.equal(q.stats.bufferedBytes,13);
 q.pump(3);assert.equal(q.bufferedAmount(a),0);assert.equal(q.bufferedAmount(b),10);assert.equal(q.stats.queuedBytes,13);
 q.pump(13);assert.equal(q.stats.bufferedBytes,0);assert.equal(q.stats.queuedBytes,13);assert.equal(q.stats.delivered,0);
 q.pump(13);assert.equal(q.stats.bufferedBytes,0);q.pump(103);assert.equal(q.stats.delivered,1);assert.equal(q.stats.queuedBytes,10);
 q.clear();assert.equal(q.bufferedAmount(b),0);assert.equal(q.stats.queuedBytes,0);
});
