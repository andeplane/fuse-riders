import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMEPLAY_BUFFER_LIMIT, LinkSendGate, PROBE_BUFFER_LIMIT, type LinkDrainReason, type SendChannelFacts } from '../src/online/link-send-gate.js';
const open=(bufferedAmount=0):SendChannelFacts=>({readyState:'open',bufferedAmount});

test('healthy open channel under the buffer limit is permitted for gameplay and probes',()=>{
 const gate=new LinkSendGate();
 assert.equal(gate.draining,false);assert.equal(gate.permits(open(),GAMEPLAY_BUFFER_LIMIT),true);assert.equal(gate.permits(open(GAMEPLAY_BUFFER_LIMIT-1),GAMEPLAY_BUFFER_LIMIT),true);
 assert.equal(gate.permits(open(GAMEPLAY_BUFFER_LIMIT),GAMEPLAY_BUFFER_LIMIT),false);assert.equal(gate.permits(open(PROBE_BUFFER_LIMIT),PROBE_BUFFER_LIMIT),false);
 assert.equal(gate.permits(undefined,GAMEPLAY_BUFFER_LIMIT),false);
 for(const readyState of ['connecting','closing','closed'] as const)assert.equal(gate.permits({readyState,bufferedAmount:0},GAMEPLAY_BUFFER_LIMIT),false);
});

test('a closing, failed or offline signal recorded before the DOM readyState changes blocks the send',()=>{
 for(const reason of ['closing','closed','error','failed','offline'] as LinkDrainReason[]){
  const gate=new LinkSendGate();
  // The channel still reports "open": this is the WebKit window where the transport is already gone.
  gate.drainFrom(reason,1000);
  assert.equal(gate.permits(open(),GAMEPLAY_BUFFER_LIMIT),false,reason);assert.equal(gate.permits(open(),PROBE_BUFFER_LIMIT),false,reason);
  assert.equal(gate.draining,true);assert.equal(gate.reason,reason);assert.equal(gate.drainedAt,1000);
 }
});

test('draining is monotonic: the first signal is kept and later ones cannot revive the link',()=>{
 const gate=new LinkSendGate();gate.drainFrom('offline',10);gate.drainFrom('closed',20);
 assert.equal(gate.reason,'offline');assert.equal(gate.drainedAt,10);assert.equal(gate.permits(open(),GAMEPLAY_BUFFER_LIMIT),false);
});

test('a replacement link gets a fresh gate so the retired link cannot poison it',()=>{
 const old=new LinkSendGate(),replacement=new LinkSendGate();old.drainFrom('offline',5);
 assert.equal(old.permits(open(),GAMEPLAY_BUFFER_LIMIT),false);assert.equal(replacement.draining,false);assert.equal(replacement.permits(open(),GAMEPLAY_BUFFER_LIMIT),true);
});
