import test from 'node:test';
import assert from 'node:assert/strict';
import { LinkHealth } from '../src/online/link-health.js';
test('direct path requires repeated real acknowledgements and recovery dwell',()=>{
 const h=new LinkHealth(0);assert.equal(h.direct(0),false);
 for(let t=200;t<=2000;t+=200){const id=h.probe(t);assert.equal(h.acknowledge(id,t+10),true);assert.equal(h.direct(t+10),t>=2000);}
 assert.equal(h.direct(2611),false);
 assert.equal(h.acknowledge(9999,2700),false);
 for(let t=2800;t<4600;t+=200){const id=h.probe(t);h.acknowledge(id,t+10);assert.equal(h.direct(t+10),false);}
 const id=h.probe(4700);h.acknowledge(id,4710);assert.equal(h.direct(4710),true);
 h.fail(4800);assert.equal(h.direct(4800),false);
});
test('expired duplicate and delayed probes cannot keep blackholed path healthy',()=>{
 const h=new LinkHealth(0),id=h.probe(0);
 assert.equal(h.acknowledge(id,-1),false);assert.equal(h.acknowledge(id,601),false);
 for(let t=0;t<2000;t+=10)h.probe(t);
 assert.equal(h.acknowledge(id,2000),false);assert.equal(h.direct(2000),false);
 const current=h.probe(2000);assert.equal(h.acknowledge(current,2001),true);assert.equal(h.acknowledge(current,2002),false);
});
