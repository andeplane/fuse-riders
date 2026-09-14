import test from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentLinkCallback, isCurrentPulseCallback } from '../src/online/link-callback.js';
import { LinkHealth } from '../src/online/link-health.js';
interface TestLink {channel:object;health:LinkHealth;connectionId:string}
const link=(at:number):TestLink=>({channel:{},health:new LinkHealth(at),connectionId:'same-service-connection'});
test('queued retired-channel pongs cannot certify a new RTC link whose probe IDs restarted',()=>{
 const old=link(0),replacement=link(100),oldChannel=old.channel;let current:TestLink|undefined=old;
 const queuedPong=(id:number,at:number)=>{if(isCurrentLinkCallback(current,old,oldChannel))current!.health.acknowledge(id,at);};
 assert.equal(old.health.probe(0),1);assert.equal(old.health.probe(10),2);current=replacement;
 assert.equal(replacement.health.probe(100),1);assert.equal(replacement.health.probe(110),2);queuedPong(1,120);queuedPong(2,130);assert.equal(replacement.health.direct(130),false);
 assert.equal(replacement.health.acknowledge(1,140),true);assert.equal(replacement.health.acknowledge(2,150),true);assert.equal(replacement.health.direct(150),true);current=undefined;assert.equal(isCurrentLinkCallback(current,replacement),false);
});
test('a replaced channel on the same live link cannot update state or expose stale errors',()=>{
 const current=link(0),oldChannel=current.channel;assert.equal(isCurrentLinkCallback(current,current,oldChannel),true);current.channel={};assert.equal(isCurrentLinkCallback(current,current,oldChannel),false);assert.equal(isCurrentLinkCallback(current,current,current.channel),true);
});
test('retired peer callbacks cannot replace the current data channel even with identical service identity',()=>{
 const old=link(0),current=link(100),original=current.channel;let staleClosed=false;
 const queuedChannelEvent=()=>{if(!isCurrentLinkCallback(current,old)){staleClosed=true;return;}current.channel={};};queuedChannelEvent();assert.equal(current.channel,original);assert.equal(staleClosed,true);
});

test('pulse proof is scoped to the captured active binding and two live undrained channels',()=>{
 const make=()=>({channel:{readyState:'open'},fast:{readyState:'open'},fastBinding:{segment:7},gate:{draining:false},fastGate:{draining:false}});
 const old=make(),replacement=make(),binding=old.fastBinding,fast=old.fast;
 assert.equal(isCurrentPulseCallback(old,old,fast,binding,true),true);
 assert.equal(isCurrentPulseCallback(replacement,old,fast,binding,true),false);
 assert.equal(isCurrentPulseCallback(undefined,old,fast,binding,true),false);
 assert.equal(isCurrentPulseCallback(old,old,fast,binding,false),false);
 old.fastBinding={segment:7};assert.equal(isCurrentPulseCallback(old,old,fast,binding,true),false);old.fastBinding=binding;
 old.fast={readyState:'open'};assert.equal(isCurrentPulseCallback(old,old,fast,binding,true),false);old.fast=fast;
 for(const lane of ['channel','fast'] as const){old[lane].readyState='closed';assert.equal(isCurrentPulseCallback(old,old,fast,binding,true),false);old[lane].readyState='open';}
 for(const lane of ['gate','fastGate'] as const){old[lane].draining=true;assert.equal(isCurrentPulseCallback(old,old,fast,binding,true),false);old[lane].draining=false;}
});
