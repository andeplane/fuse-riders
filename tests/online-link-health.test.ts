import test from 'node:test';
import assert from 'node:assert/strict';
import { LinkHealth, LinkPulseMode } from '../src/online/link-health.js';
import { packMessage, unpackMessage } from '../src/online/action-replication.js';
function ack(health:LinkHealth,sent:number,received=sent+10){assert.equal(health.acknowledge(health.probe(sent),received),true);}

test('paused old-alias endpoint restores outbound health before acknowledging a new checkpoint header',()=>{
 for(const side of ['local','remote']){
  const health=new LinkHealth(0),mode=new LinkPulseMode();mode.activate();mode.accept();
  ack(health,0);ack(health,200);health.setPulseMode(true,210);
  if(side==='local')mode.pauseLocal();else mode.pauseRemote();
  health.setPulseMode(false,1000);assert.equal(health.direct(1000),false);
  let headers=0,chunks=0;
  // Creator has bound alias6; delayed guest preparation still has confirmed alias5.
  for(const now of [1000,1200]){
   const id=health.probe(now);
   const compact=unpackMessage(packMessage([1,5,mode.locallyPaused?12:8,id])) as number[];
   assert.notEqual(compact[1],6); // The creator correctly rejects it.
   if(mode.needsAssociationProbe(true)){
    const request=JSON.parse(JSON.stringify({type:'linkProbe',probeId:id})) as {type:string;probeId:number};
    const reply=JSON.parse(JSON.stringify({type:'linkPong',probeId:request.probeId})) as {type:string;probeId:number};
    assert.equal(health.acknowledge(reply.probeId,now+10),true);
   }
   if(health.direct(now+10)){headers++;chunks++;}
  }
  assert.equal(headers,1);assert.equal(chunks,1);
  assert.equal(mode.active,false);
  const replacement=new LinkPulseMode();assert.equal(replacement.needsAssociationProbe(false),true);
  replacement.activate();replacement.accept();assert.equal(replacement.needsAssociationProbe(true),false);
 }
});

test('direct-only path resumes on two fresh acknowledgements without relay quarantine',()=>{
 const h=new LinkHealth(0);assert.equal(h.direct(0),false);
 ack(h,0);assert.equal(h.direct(10),false);ack(h,200);assert.equal(h.direct(210),true);
 assert.equal(h.direct(811),false);assert.equal(h.acknowledge(9999,900),false);
 ack(h,1000);assert.equal(h.direct(1010),false);ack(h,1200);assert.equal(h.direct(1210),true);
 h.fail(1300);assert.equal(h.direct(1300),false);
});

test('three-second blackhole after long healthy uptime retains channel and recovers on fresh probes',()=>{
 const h=new LinkHealth(0);
 for(let t=0;t<=20000;t+=200){ack(h,t);assert.equal(h.shouldRestart(t+10),false);}
 for(let t=20200;t<=23000;t+=200){h.probe(t);assert.equal(h.shouldRestart(t),false);}
 assert.equal(h.direct(23000),false);
 ack(h,23200);assert.equal(h.direct(23210),false);assert.equal(h.shouldRestart(23210),false);
 ack(h,23400);assert.equal(h.direct(23410),true);assert.equal(h.shouldRestart(23410),false);
});

test('restart requires eight continuously unhealthy seconds, reset by recovered health',()=>{
 const h=new LinkHealth(0);assert.equal(h.shouldRestart(7999),false);assert.equal(h.shouldRestart(8000),true);
 // A replacement channel starts a new bounded attempt, not a retry on each tick.
 const replacement=new LinkHealth(8000);assert.equal(replacement.shouldRestart(8001),false);assert.equal(replacement.shouldRestart(15999),false);assert.equal(replacement.shouldRestart(16000),true);
 ack(replacement,16000);ack(replacement,16200);assert.equal(replacement.direct(16210),true);
 assert.equal(replacement.direct(16811),false);assert.equal(replacement.shouldRestart(24810),false);assert.equal(replacement.shouldRestart(24811),true);
});

test('expired duplicate and pre-failure probes cannot keep blackholed path healthy',()=>{
 const h=new LinkHealth(0),id=h.probe(0);
 assert.equal(h.acknowledge(id,-1),false);assert.equal(h.acknowledge(id,601),false);
 for(let t=0;t<2000;t+=10)h.probe(t);
 assert.equal(h.acknowledge(id,2000),false);assert.equal(h.direct(2000),false);
 const current=h.probe(2000);assert.equal(h.acknowledge(current,2001),true);assert.equal(h.acknowledge(current,2002),false);
 const old=h.probe(2010);h.fail(2020);assert.equal(h.acknowledge(old,2030),false);assert.equal(h.direct(2030),false);
});


test('pulse mode preserves fresh acknowledgement time and never revives expired evidence',()=>{
 const h=new LinkHealth(0);ack(h,0);ack(h,200);h.setPulseMode(true,300);
 assert.equal(h.direct(2710),true);assert.equal(h.direct(2711),false);
 h.setPulseMode(true,3000);assert.equal(h.direct(3000),false);
 h.acknowledgePulse(3100);assert.equal(h.direct(3100),false);
 h.acknowledgePulse(4100);assert.equal(h.direct(4100),true);
 h.fail(4200);h.acknowledgePulse(4300);assert.equal(h.direct(4300),false);h.acknowledgePulse(5300);assert.equal(h.direct(5300),true);
 h.setPulseMode(false,5400);assert.equal(h.direct(5901),false);
 const expired=new LinkHealth(0);ack(expired,0);ack(expired,200);expired.setPulseMode(true,900);assert.equal(expired.direct(900),false);
 expired.acknowledgePulse(1000);assert.equal(expired.direct(1000),false);expired.acknowledgePulse(2000);assert.equal(expired.direct(2000),true);
});


test('pause is irreversible within an alias and late application proof cannot reactivate it',()=>{
 for(const side of ['local','remote']){
  const mode=new LinkPulseMode();assert.equal(mode.accept(),false);assert.equal(mode.active,false);
  assert.equal(mode.activate(),true);assert.equal(mode.accept(),true);assert.equal(mode.active,true);
  if(side==='local')mode.pauseLocal();else mode.pauseRemote();
  assert.equal(mode.active,false);assert.equal(mode.activated,false);assert.equal(mode.paused,true);assert.equal(mode.locallyPaused,side==='local');
  assert.equal(mode.activate(),false);assert.equal(mode.accept(),false);assert.equal(mode.active,false);
  const replacement=new LinkPulseMode();assert.equal(replacement.activate(),true);assert.equal(replacement.accept(),true);assert.equal(replacement.active,true);
 }
});
