import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../src/online/host-session.js';
import { ControllerSender, ControllerView, stripSnapshot, type ControllerStatus } from '../src/online/controller-status.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';

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
  assert.ok(sent<=2,`${sent} statuses over 40 ticks of movement from ${before}`);
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
test('stripSnapshot keeps everything the phone shows',()=>{
  const s=room();const snapshot=s.snapshot(),stripped=stripSnapshot(snapshot);
  const {portalPair:_portal,players:_players,...rest}=snapshot;
  assert.deepEqual({...stripped,players:undefined},{...rest,players:undefined,bombs:[],blasts:[],pickups:[]});
  assert.deepEqual(stripped.players.map(p=>({...p,trail:undefined})),snapshot.players.map(p=>({...p,trail:undefined})));
});
