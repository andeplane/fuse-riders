import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalPrediction, interpolateWorld } from '../src/online/prediction.js';
import { HostSession } from '../src/online/host-session.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
function fixture(){const room=new HostSession('h',defaultRoomSettings(),{token:()=>crypto.randomUUID()});room.command('h',{type:'join',name:'Host'});room.command('p',{type:'join',name:'P'});room.command('h',{type:'action',action:'start'});for(let i=0;i<60;i++)room.advance();return {...room.snapshot(),tick:room.game.tick,round:1};}
test('local steering responds on next frame without waiting for an acknowledgement',()=>{
  let now=0;const predictor=new LocalPrediction(()=>now),state=fixture();predictor.accept(state,'h',-1);const original=state.players.find(p=>p.id==='h')!;
  predictor.input(0,false,true);now=16;const first=predictor.render(state,'h').players.find(p=>p.id==='h')!;
  assert.ok(first.angle>original.angle);assert.ok(Math.hypot(first.x-original.x,first.y-original.y)>0);
  now=32;assert.ok(predictor.render(state,'h').players.find(p=>p.id==='h')!.angle>first.angle);
});
test('confirmed death overrides predictions immediately and reconnect acknowledgements discard old inputs',()=>{
  let now=0;const predictor=new LocalPrediction(()=>now),state=fixture();predictor.accept(state,'h',-1);predictor.input(0,true,false);now=100;
  const dead={...state,players:state.players.map(p=>({...p,alive:false}))};predictor.accept(dead,'h',0);assert.deepEqual(predictor.render(dead,'h'),dead);
  assert.equal(predictor.ackMs,100);
});
test('remote interpolation never reverses a confirmed death or interpolates across a portal',()=>{
  const a=fixture(),b=structuredClone(a);b.players[0]!.x+=100;b.players[0]!.alive=false;
  assert.equal(interpolateWorld(a,b,.5).players[0]!.alive,false);
  b.players[0]!.alive=true;b.players[0]!.portalCooldownUntilTick+=20;
  assert.equal(interpolateWorld(a,b,.5).players[0]!.x,b.players[0]!.x);
});

test('a stalled connection cannot extrapolate the rider forever',()=>{
  let now=0;const predictor=new LocalPrediction(()=>now),state=fixture();predictor.accept(state,'h',-1);
  for(now=16;now<1000;now+=16)predictor.render(state,'h');
  const frozen=predictor.render(state,'h').players[0]!;
  now=10000;const later=predictor.render(state,'h').players[0]!;
  assert.ok(Math.hypot(later.x-frozen.x,later.y-frozen.y)<.01);
});
