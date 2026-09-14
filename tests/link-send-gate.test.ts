import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMEPLAY_BUFFER_LIMIT, LinkSendGate, PROBE_BUFFER_LIMIT, permitsFastControl, type SendChannelFacts } from '../src/online/link-send-gate.js';
const open=(bufferedAmount=0):SendChannelFacts=>({readyState:'open',bufferedAmount});

test('deferred fast health replies recheck visibility and both lanes without depending on reliable backlog',()=>{
 for(const change of ['hidden','stopped','reliable-close','fast-close','reliable-drain','fast-drain'] as const){
  const fast=open(),reliable=open(GAMEPLAY_BUFFER_LIMIT),fastGate=new LinkSendGate(),reliableGate=new LinkSendGate();
  let hidden=false,stopped=false,sends=0;
  const reply=()=>{if(permitsFastControl(stopped,hidden,fast,fastGate,reliable,reliableGate))sends++;};
  reply();assert.equal(sends,1);
  if(change==='hidden')hidden=true;
  else if(change==='stopped')stopped=true;
  else if(change==='reliable-close')reliable.readyState='closing';
  else if(change==='fast-close')fast.readyState='closed';
  else if(change==='reliable-drain')reliableGate.drain();
  else fastGate.drain();
  reply();assert.equal(sends,1,change);
 }
 assert.equal(permitsFastControl(false,false,open(),new LinkSendGate(),undefined,new LinkSendGate()),false);
 assert.equal(permitsFastControl(false,false,open(PROBE_BUFFER_LIMIT),new LinkSendGate(),open(),new LinkSendGate()),false);
});

test('healthy open channel under the buffer limit is permitted for gameplay and probes',()=>{
 const gate=new LinkSendGate();
 assert.equal(gate.draining,false);assert.equal(gate.permits(open(),GAMEPLAY_BUFFER_LIMIT),true);assert.equal(gate.permits(open(GAMEPLAY_BUFFER_LIMIT-1),GAMEPLAY_BUFFER_LIMIT),true);
 assert.equal(gate.permits(open(GAMEPLAY_BUFFER_LIMIT),GAMEPLAY_BUFFER_LIMIT),false);assert.equal(gate.permits(open(PROBE_BUFFER_LIMIT),PROBE_BUFFER_LIMIT),false);
 assert.equal(gate.permits(undefined,GAMEPLAY_BUFFER_LIMIT),false);
 for(const readyState of ['connecting','closing','closed'] as const)assert.equal(gate.permits({readyState,bufferedAmount:0},GAMEPLAY_BUFFER_LIMIT),false);
});

test('a closing signal recorded before the DOM readyState changes blocks gameplay and probe sends',()=>{
 const gate=new LinkSendGate();const channel=open();
 assert.equal(gate.permits(channel,PROBE_BUFFER_LIMIT),true);
 // The channel still reports "open": this is the WebKit window where the transport is already gone.
 gate.drain();
 assert.equal(gate.permits(channel,GAMEPLAY_BUFFER_LIMIT),false);assert.equal(gate.permits(channel,PROBE_BUFFER_LIMIT),false);assert.equal(gate.draining,true);
 gate.drain();assert.equal(gate.permits(channel,GAMEPLAY_BUFFER_LIMIT),false);
});


test('bulk transfer idle permission requires an open, fully drained, undrained action channel',()=>{
 const gate=new LinkSendGate();
 assert.equal(gate.permitsIdle(undefined),false);
 for(const readyState of ['connecting','closing','closed'] as const)assert.equal(gate.permitsIdle({readyState,bufferedAmount:0}),false);
 assert.equal(gate.permitsIdle(open(1)),false);
 assert.equal(gate.permitsIdle(open(GAMEPLAY_BUFFER_LIMIT)),false);
 assert.equal(gate.permitsIdle(open()),true);
 gate.drain();assert.equal(gate.permitsIdle(open()),false);
});
