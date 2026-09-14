import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRuntime,type LocalRuntimeDependencies } from '../src/online/local-runtime.js';
import type { Callbacks } from '../src/online/runtime.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';

function fixture(){
  let now=0,hidden=false,nextToken=0,timer:(()=>void)|undefined,visibility:(()=>void)|undefined,cancelled=0;
  const states:Parameters<Callbacks['state']>[]=[],clocks:Parameters<NonNullable<Callbacks['clock']>>[0][]=[],ready:string[]=[],statuses:string[]=[];
  const dependencies:LocalRuntimeDependencies={now:()=>now,hidden:()=>hidden,token:()=>`local-${++nextToken}`,humanName:'Player',schedule:callback=>{timer=callback;return()=>{timer=undefined;cancelled++;};},onVisibilityChange:callback=>{visibility=callback;return()=>{visibility=undefined;cancelled++;};}};
  const settings={...defaultRoomSettings(),mode:'shared' as const};
  const runtime=new LocalRuntime(settings,{state:(...args)=>states.push(args),clock:sample=>clocks.push(sample),ready:id=>ready.push(id),status:s=>statuses.push(s),event:()=>{}},dependencies);
  return{runtime,settings,states,clocks,ready,statuses,step:(ms=50)=>{now+=ms;timer?.();},hide:(value:boolean)=>{hidden=value;visibility?.();},jump:(value:number)=>{now=value;timer?.();},cancelled:()=>cancelled,staleTimer:()=>timer};
}
test('solo starts one human and four AI without browser services, ready only on start',async()=>{
  const f=fixture();assert.deepEqual(f.ready,[]);assert.equal(f.runtime.command({type:'action',action:'start'}),false);
  f.runtime.start();f.runtime.start();assert.deepEqual(f.ready,['solo']);
  const [state,settings]=f.states.at(-1)!;
  assert.equal(state.players.length,5);assert.equal(state.players.find(p=>p.id==='solo')!.name,'Player');
  assert.equal(state.players.filter(p=>p.id.startsWith('bot:')).length,4);assert.equal(state.phase,'countdown');
  assert.equal(settings.mode,'devices');assert.equal(f.settings.mode,'shared');
  assert.deepEqual(await f.runtime.transport.stats(),{direct:0,relayed:0,buffered:0});assert.equal(f.runtime.transport.sentBytes,0);
  f.runtime.stop();
});
test('fixed ticks publish the ordinary game and matching zero-RTT motion clock',()=>{
  const f=fixture();f.runtime.start();f.step(49);assert.equal(f.states.at(-1)![0].tick,0);f.step(1);assert.equal(f.states.at(-1)![0].tick,1);
  for(let i=0;i<70;i++)f.step();
  const state=f.states.at(-1)![0],motion=f.states.at(-1)![4]!,clock=f.clocks.at(-1)!;
  assert.equal(state.phase,'playing');assert.equal(motion.tick,state.tick);assert.equal(clock.localSentAt,clock.localReceivedAt);assert.equal(clock.authorityTick,state.tick);assert.equal(clock.paused,false);
  assert.equal(f.runtime.command({type:'input',scope:motion.scope,intendedTick:state.tick+1,seq:0,left:true,right:false,bomb:false}),true);
  f.step();assert.equal(f.states.at(-1)![4]!.held.left,true);f.runtime.stop();
});
test('visibility suspension clears held controls and old scope, with no hidden catch-up',()=>{
  const f=fixture();f.runtime.start();for(let i=0;i<65;i++)f.step();
  const before=f.states.at(-1)!,scope=before[4]!.scope;
  f.runtime.command({type:'input',scope,intendedTick:before[0].tick+1,seq:0,left:true,right:false,bomb:true,bombAction:'press'});f.step();
  f.hide(true);const paused=f.states.at(-1)!;assert.equal(paused[4]!.held.left,false);assert.equal(f.clocks.at(-1)!.paused,true);
  f.step(60000);assert.equal(f.states.at(-1)![0].tick,paused[0].tick);
  assert.equal(f.runtime.command({type:'input',scope,intendedTick:paused[0].tick+1,seq:1,left:true,right:false,bomb:false}),false);
  f.hide(false);assert.equal(f.states.at(-1)![0].tick,paused[0].tick);f.step(49);assert.equal(f.states.at(-1)![0].tick,paused[0].tick);f.step(1);assert.equal(f.states.at(-1)![0].tick,paused[0].tick+1);
  assert.equal(f.runtime.command({type:'input',scope,intendedTick:paused[0].tick+2,seq:1,left:true,right:false,bomb:false}),false);f.runtime.stop();
});
test('lobby settings and rematch use ordinary commands, stop disposes callbacks',()=>{
  const f=fixture();f.runtime.start();assert.equal(f.runtime.command({type:'action',action:'lobby'}),true);assert.equal(f.states.at(-1)![0].phase,'lobby');
  assert.equal(f.runtime.command({type:'settings',settings:{...defaultRoomSettings(),mode:'shared',length:2}}),true);assert.equal(f.states.at(-1)![1].mode,'devices');assert.equal(f.states.at(-1)![1].length,2);
  assert.equal(f.runtime.command({type:'action',action:'start'}),true);assert.equal(f.states.at(-1)![0].phase,'countdown');
  assert.equal(f.runtime.command({type:'action',action:'rematch'}),false); // Same phase rule as online.
  const stale=f.staleTimer()!,count=f.states.length;f.runtime.stop();f.runtime.stop();assert.equal(f.cancelled(),2);stale();f.step();assert.equal(f.states.length,count);
  assert.equal(f.runtime.command({type:'action',action:'start'}),false);
});
