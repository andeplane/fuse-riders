import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../src/online/host-session.js';
import { ControllerSender, ControllerView, STATUS_HEARTBEAT_TICKS, type ControllerStatus } from '../src/online/controller-status.js';
import { encodeFast, packFast, unpackFast } from '../src/online/wire.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';

function fixture(){
  const host=new HostSession('host',{...defaultRoomSettings(),mode:'shared'},{token:()=>'ctl',captureActions:true});
  host.command('host',{type:'join',name:'Host'});host.command('phone',{type:'join',name:'Phone'});host.command('host',{type:'bot',action:'add'});
  const sender=new ControllerSender(),view=new ControllerView();const wire:ControllerStatus[]=[];
  const publish=()=>sender.publish(host,'phone',false,m=>{wire.push(JSON.parse(JSON.stringify(m)) as ControllerStatus);return true;});
  const drain=()=>wire.splice(0).map(m=>view.receive(m.state||m.motion!==undefined||m.settings?m:unpackFast(packFast(m),()=>undefined),'phone'));
  return {host,sender,view,wire,publish,drain};
}
test('a controller phone gets the stripped state only when it changes and a small heartbeat in between',()=>{
  const f=fixture();f.publish();const [first]=f.wire;assert.ok(first!.state&&first!.settings&&first!.matchId);
  assert.deepEqual(first!.state!.bombs,[]);assert.ok(first!.state!.players.every(p=>p.trail.length===0));
  const [frame]=f.drain();assert.ok(frame);assert.equal(frame!.snapshot.phase,'lobby');assert.equal(frame!.settings.mode,'shared');
  f.host.command('host',{type:'action',action:'start'});
  let full=0,beats=0,bytes=0;
  for(let i=0;i<100;i++){
    f.host.advance();f.publish();
    for(const m of f.wire){if(m.state)full++;else{beats++;bytes+=encodeFast({id:1,epoch:1,incarnation:1,data:packFast(m)}).byteLength;}}
    for(const frame of f.drain()){assert.ok(frame);assert.equal(frame!.snapshot.tick,f.host.game.tick);}
  }
  assert.ok(full<=3,`full states during countdown and early play: ${full}`);
  assert.ok(beats>=100/STATUS_HEARTBEAT_TICKS-full-1&&beats<=100/STATUS_HEARTBEAT_TICKS+1,`heartbeats: ${beats}`);
  assert.ok(bytes/beats<=28,`heartbeat bytes: ${bytes/beats}`);
});
test('heartbeats move only the phone\'s own rider, carry the ledger forward, and a stale heartbeat is ignored',()=>{
  const f=fixture();f.publish();f.drain();f.host.command('host',{type:'action',action:'start'});
  for(let i=0;i<65;i++){f.host.advance();f.publish();f.drain();}
  f.host.command('phone',{type:'input',scope:f.host.controlScope('phone')!,intendedTick:f.host.game.tick+1,seq:0,left:true,right:false,bomb:false});
  for(let i=0;i<STATUS_HEARTBEAT_TICKS+1;i++){f.host.advance();f.publish();}
  const lastPos=f.wire.filter(m=>m.pos).at(-1)!.pos!;
  const frames=f.drain().filter(Boolean);const last=frames.at(-1)!;
  const me=last.snapshot.players.find(p=>p.id==='phone')!,bot=last.snapshot.players.find(p=>p.id.startsWith('bot:'))!;
  assert.equal(me.x,lastPos[0]);assert.ok(Math.abs(me.x-f.host.game.players.get('phone')!.x)<8*STATUS_HEARTBEAT_TICKS);assert.notEqual(bot.x,f.host.game.players.get(bot.id)!.x,'other riders are not tracked');
  assert.equal(last.motion?.tick,last.snapshot.tick,'the ledger is carried forward to the heartbeat tick');assert.deepEqual(last.motion?.held,{left:true,right:false});
  assert.equal(f.view.receive({type:'status',tick:last.snapshot.tick-10,ack:-1,paused:false},'phone'),undefined);
});
test('malformed status is rejected and nothing renders before a full state',()=>{
  const view=new ControllerView();
  assert.equal(view.receive({type:'status',tick:5,ack:-1,paused:false,pos:[1,2]},'phone'),undefined);
  for(const bad of [null,{type:'status'},{type:'status',tick:-1,ack:-1,paused:false},{type:'status',tick:1,ack:-1,paused:false,state:{},matchId:'m',round:1,settings:defaultRoomSettings()},{type:'status',tick:1,ack:-1,paused:false,settings:{bad:true}},{type:'status',tick:1,ack:-1,paused:false,pos:[NaN,1]},{type:'status',tick:1,ack:-1,paused:false,motion:{}}])assert.equal(view.receive(bad,'phone'),undefined);
  const f=fixture();f.publish();assert.ok(view.receive(f.wire[0],'phone'));
});
test('matchOver status includes the recap statistics the phone opens',()=>{
  const f=fixture();f.host.command('host',{type:'settings',settings:{...defaultRoomSettings(),mode:'shared',match:'rounds',length:1}});f.publish();f.drain();
  f.host.command('host',{type:'action',action:'start'});
  for(let i=0;i<2500&&f.host.game.phase!=='matchOver';i++){f.host.advance();if(f.host.game.phase==='playing'&&i===80)for(const p of f.host.game.players.values())if(p.id!=='host')p.alive=false;}
  f.publish();const frame=f.drain().at(-1)!;assert.equal(frame!.snapshot.phase,'matchOver');assert.ok(frame!.snapshot.matchStats.length>=2);assert.ok(frame!.snapshot.leaderboard.length>=2);
});
