import test from 'node:test';
import assert from 'node:assert/strict';
import { PredictionClock,RemoteWorldBuffer } from '../src/online/prediction.js';
import { HostSession } from '../src/online/host-session.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import type { TickClockSample } from '../src/online/prediction-contract.js';
function fixture(){let now=0;const clock=new PredictionClock(()=>now);const scope={matchId:'m',round:1,controlEpoch:'c'};return{clock,set:(value:number)=>{now=value;},sample:(at:number,rtt=10,patch:Partial<TickClockSample>={})=>{now=at;return clock.observe({scope,localSentAt:at-rtt,localReceivedAt:at,authorityTick:at/50,paused:false,...patch});}};}
test('one validated nearby probe qualifies immediately; high RTT restores conservative delay',()=>{const f=fixture();assert.equal(f.clock.presentationDelayTicks(),2);f.sample(0);assert.equal(f.clock.presentationDelayTicks(),0.5);f.sample(500,40.001);assert.equal(f.clock.presentationDelayTicks(),2);});
test('stale, paused and explicit reset lose qualification; rejected samples do not extend freshness',()=>{
 for(const change of ['stale','paused','reset','backwards'] as const){const f=fixture();f.sample(1000);assert.equal(f.clock.presentationDelayTicks(),0.5);
 if(change==='stale'){for(const at of [1400,1800]){f.set(at);f.clock.presentationDelayTicks();}assert.equal(f.clock.observe({scope:{matchId:'m',round:1,controlEpoch:'c'},localSentAt:990,localReceivedAt:1000,authorityTick:20,paused:false}),false);f.set(2001);}
 if(change==='paused')f.sample(1100,10,{paused:true});if(change==='reset')f.clock.reset();if(change==='backwards')f.set(999);
 assert.equal(f.clock.presentationDelayTicks(),2,change);
 }
});
test('regional60ms never qualifies and a fresh scope is independently classified',()=>{const f=fixture();for(const at of [0,500,1000])f.sample(at,60);assert.equal(f.clock.presentationDelayTicks(),2);f.sample(1500,40);assert.equal(f.clock.presentationDelayTicks(),0.5);f.sample(2000,60,{scope:{matchId:'m',round:2,controlEpoch:'new'}});assert.equal(f.clock.presentationDelayTicks(),2);f.sample(2500,30,{scope:{matchId:'m',round:2,controlEpoch:'new'}});assert.equal(f.clock.presentationDelayTicks(),0.5);});
test('half-tick presentation never rewinds or extrapolates; missing clock remains newest only',()=>{const session=new HostSession('host',defaultRoomSettings(),{token:()=>crypto.randomUUID()});const a={...session.snapshot(),tick:10,round:1},b={...a,tick:14};const buffer=new RemoteWorldBuffer();buffer.push(a,'m');buffer.push(b,'m');assert.equal(buffer.render(13,2)!.tick,11);assert.equal(buffer.render(13,0.5)!.tick,12.5);assert.equal(buffer.render(13,2)!.tick,12.5);assert.equal(buffer.render(100,0.5)!.tick,14);assert.equal(buffer.render(undefined,2)!.tick,14);buffer.push({...a,tick:0,round:2},'new');assert.equal(buffer.render(2,0.5)!.tick,0);});
test('clock discontinuity clears the old clock even when observed before rendering',()=>{const f=fixture();f.sample(1000);f.set(1400);f.clock.presentationDelayTicks();assert.equal(f.sample(1000),false);assert.equal(f.clock.diagnostics(),undefined);assert.equal(f.clock.presentationDelayTicks(),2);f.sample(1500);assert.equal(f.clock.presentationDelayTicks(),0.5);});
test('rejected excessive RTT cancels fast classification and exact40ms boundary qualifies',()=>{const f=fixture();f.sample(0,40);assert.equal(f.clock.presentationDelayTicks(),0.5);assert.equal(f.sample(100,600),false);assert.equal(f.clock.presentationDelayTicks(),2);f.sample(200,40.001);assert.equal(f.clock.presentationDelayTicks(),2);});
test('clock diagnostics are read-only and cannot refresh a sample or mutate its scope',()=>{const f=fixture();assert.equal(f.clock.diagnostics(),undefined);f.sample(1000);f.set(1100);const d=f.clock.diagnostics()!;assert.equal(d.rttMs,10);assert.equal(d.sampleAgeMs,100);d.scope.round=99;f.set(1200);assert.equal(f.clock.diagnostics()!.scope.round,1);assert.equal(f.clock.diagnostics()!.sampleAgeMs,200);});

test('empty and invalid clock observations cannot enable fast presentation',()=>{const f=fixture();assert.equal(f.sample(0,NaN),false);assert.equal(f.clock.presentationDelayTicks(),2);assert.equal(f.sample(0,-1),false);assert.equal(f.clock.presentationDelayTicks(),2);});
