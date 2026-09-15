import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../src/online/host-session.js';
import { ControllerSender, ControllerView, stripSnapshot, type ControllerStatus } from '../src/online/controller-status.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { ARENA_WIDTH } from '../src/shared/game.js';
import type { GameSnapshot } from '../src/shared/protocol.js';

function room(){const s=new HostSession('host',defaultRoomSettings(),{token:()=>'match',botRandom:()=>0.5});s.command('host',{type:'join',name:'Host'});s.command('phone',{type:'join',name:'Phone'});s.command('host',{type:'bot',action:'add'});s.advance();return s;}
const statuses=(s:HostSession,sender:ControllerSender)=>{const out:ControllerStatus[]=[];sender.publish(s,m=>{out.push(m);return true;});return out;};

test('a phone gets a status only when something it shows changes, never for positions alone',()=>{
  const s=room(),sender=new ControllerSender(),view=new ControllerView();
  const first=statuses(s,sender);assert.equal(first.length,1);assert.ok(view.receive(first[0]));
  assert.equal(statuses(s,sender).length,0,'nothing changed');
  s.command('host',{type:'action',action:'start'});s.advance();
  assert.equal(statuses(s,sender).length,1,'phase changed');
  while(s.game.phase==='countdown')s.advance();
  let sent=0;const before=s.tick;
  for(let i=0;i<40;i++){s.command('host',{type:'input',left:true,right:false,bomb:false});s.advance();sent+=statuses(s,sender).length;}
  assert.equal(sent,1,`${sent} statuses over 40 ticks of movement from ${before}`);
  for(const status of statuses(s,sender))assert.ok(view.receive(status));
  s.command('phone',{type:'input',left:false,right:false,bomb:true,bombAction:'press'});s.advance();
  const charging=statuses(s,sender);assert.equal(charging.length,1,'the phone\'s own charge is shown');
  const frame=view.receive(charging[0])!;
  assert.deepEqual([frame.snapshot.bombs,frame.snapshot.blasts,frame.snapshot.pickups,frame.snapshot.portalPair],[[],[],[],undefined]);
  assert.ok(frame.snapshot.players.every(p=>p.trail.length===0));
  assert.notEqual(frame.snapshot.players.find(p=>p.id==='phone')!.bombChargeStartedTick,undefined);
  s.command('host',{type:'settings',settings:{...defaultRoomSettings(),mode:'shared'}});s.advance();
  const changed=statuses(s,sender);assert.equal(changed.length,1);assert.equal(view.receive(changed[0])!.settings.mode,'shared');
  const refused=new ControllerSender();refused.publish(s,()=>false);assert.equal(statuses(s,refused).length,1,'a refused send is retried');
});
test('a status is validated in full before any of it replaces the view',()=>{
  const s=room(),view=new ControllerView();
  const [status]=statuses(s,new ControllerSender());
  assert.equal(view.heartbeat(5,'phone',[1,2,3]),undefined,'nothing to show before the first status');
  const frame=view.receive(status)!;assert.equal(frame.settings.mode,'devices');assert.equal(frame.matchId,'match');
  const poisoned={...status!,settings:{...status!.settings,mode:'shared'},state:{...status!.state,players:[...status!.state.players,{id:'x'}]}};
  assert.equal(view.receive(poisoned),undefined);
  assert.equal(view.heartbeat(status!.tick,'phone',null)!.settings.mode,'devices','the rejected settings did not leak');
  for(const bad of [null,7,{type:'status'},{...status!,tick:-1},{...status!,matchId:''},{...status!,round:1.5},{...status!,settings:{mode:'nope'}},{...status!,state:{...status!.state,phase:'flying'}}])assert.equal(view.receive(bad),undefined,JSON.stringify(bad).slice(0,60));
});
test('heartbeats move the view forward and place the phone\'s own rider; stale ones are ignored',()=>{
  const s=room(),view=new ControllerView();
  const [status]=statuses(s,new ControllerSender());const tick=status!.tick;
  view.receive(status);
  const moved=view.heartbeat(tick+5,'phone',[10,20,0.5])!;
  assert.equal(moved.snapshot.tick,tick+5);
  const me=moved.snapshot.players.find(p=>p.id==='phone')!,other=moved.snapshot.players.find(p=>p.id==='host')!;
  assert.deepEqual([me.x,me.y,me.angle],[10,20,0.5]);assert.notDeepEqual([other.x,other.y],[10,20]);
  assert.equal(view.heartbeat(tick+2,'phone',[0,0,0]),undefined,'older than the view');
  assert.deepEqual(view.heartbeat(tick+6,'phone',null)!.snapshot.players.find(p=>p.id==='phone')!.x,10,'no position keeps the last one');
  view.reset();assert.equal(view.ready,false);assert.equal(view.heartbeat(tick+7,'phone',null),undefined);
});
test('a status behind a heartbeat keeps its content without walking the frame tick backwards',()=>{
  const s=room(),view=new ControllerView();
  const [status]=statuses(s,new ControllerSender());const tick=status!.tick;
  view.receive(status);
  assert.equal(view.heartbeat(tick+10,'phone',null)!.snapshot.tick,tick+10);
  const late=view.receive({...status!,round:3})!;
  assert.equal(late.snapshot.tick,tick+10,'a status delayed behind heartbeats must not rewind the frame');
  assert.equal(late.snapshot.round,3,'but its content is the newer one');
});
test('a heartbeat position outside the arena range leaves the view alone',()=>{
  const s=room(),view=new ControllerView();
  const [status]=statuses(s,new ControllerSender());const tick=status!.tick;
  const placed=view.receive(status)!.snapshot.players.find(p=>p.id==='phone')!;
  for(const pos of [[ARENA_WIDTH+1001,10,0],[10,-1001,0],[10,10,Math.PI*3],[NaN,10,0]] as [number,number,number][])
    assert.equal(view.heartbeat(tick+1,'phone',pos),undefined,JSON.stringify(pos));
  const kept=view.heartbeat(tick+1,'phone',null)!.snapshot.players.find(p=>p.id==='phone')!;
  assert.deepEqual([kept.x,kept.y,kept.angle],[placed.x,placed.y,placed.angle],'a refused position never reached the view');
  assert.deepEqual(view.heartbeat(tick+2,'phone',[ARENA_WIDTH+1000,-1000,Math.PI*2])!.snapshot.players.find(p=>p.id==='phone')!.x,ARENA_WIDTH+1000,'the edge of the range is still accepted');
});
/** stripSnapshot only bites when the fields it drops are actually present; a lobby snapshot carries none of them. */
const populated=(snapshot:GameSnapshot):GameSnapshot=>({...snapshot,
  phase:'playing',
  players:snapshot.players.map((p,i)=>({...p,trail:[{x1:i,y1:i,x2:i+1,y2:i+1,createdTick:1,expiresAtTick:99}]})),
  bombs:[{id:1,ownerId:'host',launchX:1,launchY:2,x:3,y:4,launchedTick:1,landsAtTick:9,explodeAtTick:11,blastRange:80,flightPath:[{x:1,y:2,angle:0}]}],
  blasts:[{bombId:1,circle:{x:3,y:4,radius:80},expiresAtTick:12}],
  pickups:[{id:2,type:'star',x:5,y:6,expiresAtTick:99}],
  portalPair:{id:'portal',gates:[{x:7,y:8,halfLength:40},{x:9,y:10,halfLength:40}],expiresAtTick:99},
});
test('stripSnapshot drops the arena geometry a phone never draws, and nothing else',()=>{
  const full=populated(room().snapshot()),stripped=stripSnapshot(full);
  assert.ok(full.bombs.length&&full.blasts.length&&full.pickups.length&&full.portalPair&&full.players.every(p=>p.trail.length),'the fixture carries every stripped field');
  assert.deepEqual([stripped.bombs,stripped.blasts,stripped.pickups,stripped.portalPair],[[],[],[],undefined]);
  assert.ok(stripped.players.every(p=>p.trail.length===0));
  const {bombs:_b,blasts:_l,pickups:_k,portalPair:_o,players:_players,...rest}=full;
  const blanked={bombs:undefined,blasts:undefined,pickups:undefined,players:undefined};
  assert.deepEqual({...stripped,...blanked},{...rest,...blanked});
  assert.deepEqual(stripped.players.map(p=>({...p,trail:undefined})),full.players.map(p=>({...p,trail:undefined})),'everything else about a rider survives');
});
