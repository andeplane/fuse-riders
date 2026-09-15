import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRuntime, HASH_LAG_TICKS, type RoomRuntimeDependencies } from '../src/online/runtime.js';
import { TICK_MS } from '../src/online/rollback.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import type { HostSession } from '../src/online/host-session.js';
import type { PeerTransport, TransportCallbacks } from '../src/online/peer-transport.js';

/** Everything RoomRuntime asks of a transport; the room is driven by hand instead of over data channels. */
class FakeTransport {
  id=''; hostId='';
  readonly sent:{to:string;data:unknown}[]=[];
  callbacks!:TransportCallbacks;
  send(to:string,data:unknown){this.sent.push({to,data});return true;}
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
  mismatches:number[];
  requestResync(force?:boolean):void;
};
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
