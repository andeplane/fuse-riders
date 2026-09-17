import test from 'node:test';
import assert from 'node:assert/strict';
import { LinkHealth } from '../src/link-health.js';
function ack(health:LinkHealth,sent:number,received=sent+10){assert.equal(health.acknowledge(health.probe(sent),received),true);}

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
