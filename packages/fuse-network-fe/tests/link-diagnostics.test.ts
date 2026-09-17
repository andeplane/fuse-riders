import test from 'node:test';
import assert from 'node:assert/strict';
import { explainLink, formatLinkDiagnostics, type LinkDiagnostic } from '../src/link-diagnostics.js';
const base=(over:Partial<LinkDiagnostic>={}):LinkDiagnostic=>({peer:'host',local:{host:2,srflx:1},remote:{host:1,srflx:1},gathering:'complete',ice:'checking',connection:'connecting',signaling:'stable',channel:'connecting',
  signalling:{descriptions:1,candidates:2,applied:2,buffered:0,rejected:0,dropped:0,offersOut:0,offersIn:1,answersOut:1,answersIn:0,candidatesOut:3,relayFailed:0},restarts:{attempts:0,max:4,exhausted:false},healthy:false,ageMs:1000,...over});

test('the reason names the first missing step in the direct-link pipeline',()=>{
  assert.equal(explainLink(base({healthy:true})),'direct link healthy');
  assert.match(explainLink(base({connection:'connected',channel:'connecting',dtls:'connecting'})),/data channel connecting.*DTLS connecting/);
  assert.match(explainLink(base({connection:'connected',channel:'open',local:{host:1}})),/connected — waiting for gameplay probe/,'a connected LAN link without srflx is not a STUN failure');
  assert.match(explainLink(base({signalling:{...base().signalling,offersIn:0}})),/never delivered the offer/);
  assert.match(explainLink(base({peer:'guest',signalling:{...base().signalling,offersOut:0}})),/offer not sent yet/);
  assert.match(explainLink(base({local:{host:2}})),/no reflexive candidate from STUN/);
  assert.match(explainLink(base({local:{host:1},gathering:'new'})),/ICE checking, gathering new/,'nothing gathered yet is not a STUN verdict');
  assert.match(explainLink(base({peer:'guest',signalling:{...base().signalling,offersOut:1,answersIn:0}})),/never delivered the answer/);
  assert.match(explainLink(base({remote:{end:1}})),/no remote candidates/);
  assert.match(explainLink(base({remote:{host:3}})),/peer sent no reflexive candidate/);
  assert.match(explainLink(base({ice:'failed'})),/symmetric NAT\/CGNAT.*no TURN/);
  assert.match(explainLink(base({connection:'failed'})),/symmetric NAT/);
  assert.match(explainLink(base({ageMs:9000})),/still checking after 9s/);
  assert.match(explainLink(base({restarts:{attempts:4,max:4,exhausted:true}})),/gave up after 4 ICE restarts/);
});

test('the panel text is redacted and complete',()=>{
  const text=formatLinkDiagnostics([base({selected:{local:'srflx',remote:'srflx',protocol:'udp'},dtls:'connected',sctp:'connected',lastFailure:'answer: InvalidStateError'})],{servers:2,source:'service'},'open');
  for(const expected of ['STUN servers: 2 (service)','room service: open','link 1 (host)','local host×2 srflx×1','remote host×1 srflx×1','pair srflx→srflx/udp','dtls connected','sctp connected','offers 0↑ 1↓','answers 1↑ 0↓','candidates 3↑ 2↓','restarts 0/4','last failure: answer: InvalidStateError'])assert.ok(text.includes(expected),expected);
  assert.doesNotMatch(text,/\d+\.\d+\.\d+\.\d+|\.local|token|room=/);
  assert.match(formatLinkDiagnostics([],{servers:2,source:'default'},'connecting'),/no peer links yet/);
});
