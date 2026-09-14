import test from 'node:test';
import assert from 'node:assert/strict';
import { PredictionClock,RemoteWorldBuffer } from '../src/online/prediction.js';
import { HostSession } from '../src/online/host-session.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import type { TickClockSample } from '../src/online/prediction-contract.js';
function fixture(){let now=0;const clock=new PredictionClock(()=>now);const scope={matchId:'m',round:1,controlEpoch:'c'};return{clock,set:(value:number)=>{now=value;},sample:(at:number,rtt=10,patch:Partial<TickClockSample>={})=>{now=at;return clock.observe({scope,localSentAt:at-rtt,localReceivedAt:at,authorityTick:at/50,paused:false,...patch});}};}
test('three fresh accepted nearby probes qualify; high RTT immediately restores conservative delay',()=>{const f=fixture();f.sample(0);assert.equal(f.clock.presentationDelayTicks(),2);f.sample(500);assert.equal(f.clock.presentationDelayTicks(),2);f.sample(1000);assert.equal(f.clock.presentationDelayTicks(),1);f.sample(1500,21);assert.equal(f.clock.presentationDelayTicks(),2);});
test('stale, paused, changed scope and reset lose qualification; invalid samples do not extend it',()=>{
 for(const change of ['stale','paused','scope','reset','backwards','gap'] as const){const f=fixture();f.sample(0);f.sample(500);f.sample(1000);assert.equal(f.clock.presentationDelayTicks(),1);
 if(change==='stale'){f.set(1400);f.clock.presentationDelayTicks();f.set(1800);f.clock.presentationDelayTicks();assert.equal(f.sample(1000),false);f.set(2001);}
 if(change==='paused')f.sample(1100,10,{paused:true});if(change==='scope')f.sample(1100,10,{scope:{matchId:'m',round:2,controlEpoch:'new'}});if(change==='reset')f.clock.reset();if(change==='backwards')f.set(999);if(change==='gap')f.sample(2001);
 assert.equal(f.clock.presentationDelayTicks(),2,change);
 }
});
test('regional probes never qualify and stale nearby history requires three new observations',()=>{const f=fixture();for(let at=0;at<=2000;at+=500)f.sample(at,80);assert.equal(f.clock.presentationDelayTicks(),2);f.sample(2500);f.sample(3000);f.sample(3500);assert.equal(f.clock.presentationDelayTicks(),1);f.sample(5001);assert.equal(f.clock.presentationDelayTicks(),2);f.sample(5500);assert.equal(f.clock.presentationDelayTicks(),2);f.sample(6000);assert.equal(f.clock.presentationDelayTicks(),1);});
test('changing presentation delay never rewinds or extrapolates and missing clock keeps newest fallback',()=>{const session=new HostSession('host',defaultRoomSettings(),{token:()=>crypto.randomUUID()});const a={...session.snapshot(),tick:10,round:1},b={...a,tick:14};const buffer=new RemoteWorldBuffer();buffer.push(a,'m');buffer.push(b,'m');assert.equal(buffer.render(13,2)!.tick,11);assert.equal(buffer.render(13,1)!.tick,12);assert.equal(buffer.render(13,2)!.tick,12);assert.equal(buffer.render(100,1)!.tick,14);assert.equal(buffer.render(undefined,2)!.tick,14);buffer.push({...a,tick:0,round:2},'new');assert.equal(buffer.render(2,1)!.tick,0);});

test('a clock jump detected by observe before rendering cannot retain nearby qualification',()=>{const f=fixture();f.sample(0);f.sample(500);f.sample(1000);f.set(1400);assert.equal(f.clock.presentationDelayTicks(),1);f.sample(1200);assert.equal(f.clock.presentationDelayTicks(),2);f.sample(1700);assert.equal(f.clock.presentationDelayTicks(),2);f.sample(2200);assert.equal(f.clock.presentationDelayTicks(),1);f.sample(2900);assert.equal(f.clock.presentationDelayTicks(),2);});

test('a rejected excessive RTT still cancels nearby classification',()=>{const f=fixture();f.sample(0);f.sample(500);f.sample(1000);assert.equal(f.clock.presentationDelayTicks(),1);assert.equal(f.sample(1100,600),false);assert.equal(f.clock.presentationDelayTicks(),2);});
