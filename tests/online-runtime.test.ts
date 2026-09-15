import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRuntime, HASH_LAG_TICKS, ABSENT_MS, SILENCE_MS, type RoomRuntimeDependencies } from '../src/online/runtime.js';
import { TICK_MS } from '../src/online/rollback.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import type { RoomCommand } from '../src/online/host-session.js';
import type { HostSession } from '../src/online/host-session.js';
import type { ControllerView } from '../src/online/controller-status.js';
import type { PeerTransport, TransportCallbacks } from '../src/online/peer-transport.js';

/** Everything RoomRuntime asks of a transport; the room is driven by hand instead of over data channels. */
class FakeTransport {
  id=''; hostId='';
  readonly sent:{to:string;data:unknown}[]=[];
  callbacks!:TransportCallbacks;
  /** A link that refuses a message — hidden tab, draining buffer — the way a real one does. */
  block?:(data:unknown)=>boolean;
  send(to:string,data:unknown){if(this.block?.(data))return false;this.sent.push({to,data});return true;}
  authorityPermitted(){return true;}
  connect(){}
  close(){}
  explain(){return 'direct';}
}
interface Room {runtime:RoomRuntime;fake:FakeTransport;status:string[];tick():void}
function room(id:string,hostId:string,clock:{now:number}):Room {
  const fake=new FakeTransport();fake.id=id;fake.hostId=hostId;
  const status:string[]=[];
  const dependencies:RoomRuntimeDependencies={now:()=>clock.now,hidden:()=>false,transport:callbacks=>{fake.callbacks=callbacks;return fake as unknown as PeerTransport;}};
  const runtime=new RoomRuntime('CODE','token',defaultRoomSettings(),{state:()=>{},event:()=>{},status:text=>status.push(text),ready:()=>{}},dependencies);
  fake.callbacks.welcome(id,hostId);
  return {runtime,fake,status,tick:()=>(runtime as unknown as {tick():void}).tick()};
}
const internals=(runtime:RoomRuntime)=>runtime as unknown as {
  session?:HostSession;
  sim?:{tick:number;gaps():[string,number][];hashAt(tick:number):string|undefined};
  controllerView:ControllerView;
  mismatches:number[];
  requestResync(force?:boolean):void;
};
const shared=(mode:'shared'|'devices'):RoomCommand=>({type:'settings',settings:{...defaultRoomSettings(),mode}});
const baselines=(r:Room)=>r.fake.sent.filter(s=>(s.data as {type?:string}).type==='baseline').length;

/** A host and one guest wired together, with each direction of the link switchable. */
function pair(){
  const clock={now:0};
  const host=room('host','host',clock),guest=room('guest','host',clock);
  host.fake.callbacks.peer('guest',true);
  const deliver=(up:boolean,down:boolean)=>{
    if(down)for(const {to,data} of host.fake.sent.splice(0))if(to==='guest')guest.fake.callbacks.message('host',data);
    if(up)for(const {to,data} of guest.fake.sent.splice(0))if(to==='host')host.fake.callbacks.message('guest',data);
  };
  const run=(ticks:number,up=true,down=true)=>{for(let i=0;i<ticks;i++){clock.now+=TICK_MS;host.tick();guest.tick();deliver(up,down);}};
  host.runtime.command({type:'join',name:'Host'});guest.runtime.command({type:'join',name:'Guest'});
  run(8);
  host.runtime.command({type:'action',action:'start'});
  run(60);
  return {host,guest,clock,run};
}

test('a resync keeps a joined guest playing: the baseline carries its own stream and its input keeps flowing',()=>{
  const {host,guest,run}=pair();
  assert.deepEqual(guest.runtime.held('guest'),{left:false,right:false},'the guest folds its own rider');
  guest.runtime.command({type:'input',left:true,right:false,bomb:false});
  run(10);
  assert.deepEqual(host.runtime.held('guest'),{left:true,right:false},'the host folded the held steer');
  const before=internals(guest.runtime).sim;
  internals(guest.runtime).requestResync(true);
  run(4);
  assert.notEqual(internals(guest.runtime).sim,before,'the baseline carried our own stream, so it installed at all');
  assert.equal(guest.status.filter(text=>text.includes('Rebuilding the game state')).length,0,'and was never refused');
  assert.deepEqual(guest.runtime.held('guest'),{left:true,right:false},'with our own held steer intact');
  assert.deepEqual(internals(guest.runtime).sim!.gaps(),[],'and left no gap in our own log to chase');
  guest.runtime.command({type:'input',left:false,right:true,bomb:false});
  run(10);
  assert.deepEqual(host.runtime.held('guest'),{left:false,right:true},'input after the baseline still reaches the host');
  assert.deepEqual(guest.runtime.held('guest'),{left:false,right:true});
  assert.ok(!guest.status.some(text=>text.includes('out of sync')),guest.status.join(' | '));
});

test('a guest restates its held controls once the host stops treating it as absent',()=>{
  const {host,guest,run}=pair();
  guest.runtime.command({type:'input',left:true,right:false,bomb:false});
  run(10);
  assert.deepEqual(host.runtime.held('guest'),{left:true,right:false});
  run(30,false);
  assert.deepEqual(host.runtime.held('guest'),{left:false,right:false},'absence zeroed the folded steer');
  run(10);
  guest.runtime.command({type:'input',left:true,right:false,bomb:false}); // the controller's 50 ms held-control resend
  run(10);
  assert.deepEqual(host.runtime.held('guest'),{left:true,right:false},'the guest re-encoded what it still holds');
});

test('a burst of late input rewinds the host without any replica reporting a mismatch',()=>{
  const {host,guest,run}=pair();
  for(let i=0;i<6;i++){guest.runtime.command({type:'input',left:i%2===0,right:i%2===1,bomb:false});run(2,false);}
  run(80);
  const g=internals(guest.runtime),h=internals(host.runtime);
  assert.deepEqual(g.mismatches,[],'a hash of the tick just simulated would have read as divergence here');
  const tick=Math.floor(Math.min(g.sim!.tick,h.session!.sim.tick)/4)*4-HASH_LAG_TICKS+4;
  const hash=g.sim!.hashAt(tick);
  assert.ok(hash,`the guest ring still holds tick ${tick}`);
  assert.equal(hash,h.session!.sim.hashAt(tick),`the two folds agree at tick ${tick}`);
  assert.ok(!guest.status.some(text=>text.includes('out of sync')),guest.status.join(' | '));
});

test('a resync storm gets one baseline per peer per half second',()=>{
  const clock={now:0},host=room('host','host',clock);
  host.fake.callbacks.peer('guest',true);host.fake.sent.splice(0);
  for(let i=0;i<5;i++)host.fake.callbacks.message('guest',{type:'resync'});
  assert.equal(baselines(host),1,'five asks in the same millisecond rebuild the state once');
  clock.now+=600;host.fake.callbacks.message('guest',{type:'resync'});
  assert.equal(baselines(host),2);
});

test('a phone switched back to devices folds again instead of chasing its own log forever',()=>{
  const {host,guest,run}=pair();
  guest.runtime.command({type:'input',left:true,right:false,bomb:false});
  run(10);
  host.runtime.command(shared('shared'));
  run(10);
  assert.equal(internals(guest.runtime).sim,undefined,'a shared-TV phone drops its simulation');
  guest.runtime.command({type:'input',left:false,right:true,bomb:false});
  run(10);
  host.runtime.command(shared('devices'));
  run(10);
  assert.ok(internals(guest.runtime).sim,'the mode-switch baseline restarted the fold');
  assert.deepEqual(internals(guest.runtime).sim!.gaps(),[],'and the phone is not reporting a gap in its own log');
  guest.runtime.command({type:'input',left:true,right:false,bomb:false});
  run(10);
  assert.deepEqual(host.runtime.held('guest'),{left:true,right:false},'its input still reaches the host');
  assert.deepEqual(guest.runtime.held('guest'),{left:true,right:false});
});

test('a resync while a phone is a controller leaves it a controller, not a frozen replica',()=>{
  const {host,guest,run}=pair();
  host.runtime.command(shared('shared'));
  run(10);
  assert.equal(internals(guest.runtime).sim,undefined);
  // An authority epoch change: every guest drops its view and asks the host for a fresh one.
  guest.fake.callbacks.authorityChanged!();
  run(30);
  assert.equal(internals(guest.runtime).sim,undefined,'the phone is a controller again');
  assert.equal(internals(guest.runtime).controllerView.ready,true,'showing a status the host keeps refreshing');
});

test('a phone stays a controller until the baseline that restarts its fold is actually sent',()=>{
  const {host,guest,run}=pair();
  host.runtime.command(shared('shared'));
  run(10);
  assert.equal(internals(guest.runtime).sim,undefined);
  host.fake.block=data=>(data as {type?:string}).type==='baseline';
  host.runtime.command(shared('devices'));
  run(20);
  assert.equal(internals(guest.runtime).sim,undefined,'no baseline landed, so there is no fold to restart');
  assert.equal(internals(guest.runtime).controllerView.ready,true,'and the phone is still shown a live status');
  host.fake.block=undefined;
  run(20);
  assert.ok(internals(guest.runtime).sim,'the retry restarts it');
});

test('a held charge survives a second of lost uplink and the release still fires',()=>{
  const {host,guest,run}=pair();
  const bombs=()=>[...internals(host.runtime).session!.game.bombs.values()].filter(b=>b.ownerId==='guest').length;
  guest.runtime.command({type:'input',left:false,right:false,bomb:true,bombAction:'press'});run(60);
  const before=guest.fake.sent.length;run(10);
  assert.ok(guest.fake.sent.length-before>=10,'a held control keeps a packet going out every tick');
  assert.ok(ABSENT_MS>SILENCE_MS);
  run(Math.ceil(SILENCE_MS/TICK_MS)+10,false,true);
  assert.equal(internals(host.runtime).session!.game.players.get('guest')!.connected,true,'a second of silence is not absence');
  guest.runtime.command({type:'input',left:false,right:false,bomb:false,bombAction:'release'});run(5);
  assert.equal(bombs(),1,'the release matched the charge the fold still held');
});
