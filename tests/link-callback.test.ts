import test from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentLinkCallback } from '../src/online/link-callback.js';
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
