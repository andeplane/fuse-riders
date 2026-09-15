import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRuntime, type LocalRuntimeDependencies } from '../src/online/local-runtime.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import type { Callbacks } from '../src/online/runtime.js';
import type { ViewSnapshot } from '../src/client/snapshot-stream.js';

function fixture(){
  let now=0,hidden=false;const timers:(()=>void)[]=[];let visibility:(()=>void)|undefined;
  const states:Parameters<Callbacks['state']>[]=[];const statuses:string[]=[];const events:string[]=[];
  const dependencies:LocalRuntimeDependencies={now:()=>now,hidden:()=>hidden,token:()=>'solo-match',schedule:callback=>{timers.push(callback);return()=>{timers.splice(timers.indexOf(callback),1);};},onVisibilityChange:callback=>{visibility=callback;return()=>{visibility=undefined;};},humanName:'  Tester  '};
  const runtime=new LocalRuntime({...defaultRoomSettings(),mode:'shared'},{state:(...args)=>states.push(args),status:text=>statuses.push(text),event:event=>events.push(event.type),ready:()=>{}},dependencies);
  const advance=(ms:number)=>{now+=ms;for(const timer of [...timers])timer();};
  const latest=():ViewSnapshot=>states.at(-1)![0];
  return {runtime,advance,latest,states,statuses,events,setHidden:(value:boolean)=>{hidden=value;visibility?.();},me:()=>latest().players.find(p=>p.id==='solo')!};
}
test('solo starts a devices-mode match with four AI riders and applies a press on the next tick',()=>{
  const f=fixture();f.runtime.start();
  assert.equal(f.statuses[0],'Solo · you and four AI riders');assert.equal(f.latest().players.length,5);assert.equal(f.latest().players.find(p=>p.id==='solo')!.name,'Tester');
  assert.equal(f.states.at(-1)![1].mode,'devices','solo never renders as a shared-TV controller');
  while(f.latest().phase==='countdown')f.advance(50);
  const tick=f.latest().tick;
  assert.equal(f.runtime.command({type:'input',left:false,right:false,bomb:true,bombAction:'press'}),true);
  f.advance(50);assert.equal(f.latest().tick,tick+1);assert.notEqual(f.me().bombChargeStartedTick,undefined,'the press applied on the very next tick');
  assert.equal(f.runtime.command({type:'input',left:false,right:false,bomb:false,bombAction:'release'}),true);f.advance(50);
  assert.equal(f.me().bombChargeStartedTick,undefined);assert.ok(f.events.includes('bombPlaced'));
  assert.ok(f.runtime.render(),'a frame is available between ticks');
});
test('hidden solo pauses ticks and refuses input until it is visible again',()=>{
  const f=fixture();f.runtime.start();const tick=f.latest().tick;
  f.setHidden(true);f.advance(500);assert.equal(f.latest().tick,tick);
  assert.equal(f.runtime.command({type:'input',left:true,right:false,bomb:false}),false);
  f.setHidden(false);f.advance(100);assert.ok(f.latest().tick>tick);
  assert.equal(f.runtime.command({type:'settings',settings:{...defaultRoomSettings(),mode:'shared',length:1}}),true);assert.equal(f.states.at(-1)![1].mode,'devices');
  f.runtime.stop();const after=f.latest().tick;f.advance(200);assert.equal(f.latest().tick,after);
});
