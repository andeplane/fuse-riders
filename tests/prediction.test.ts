import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalPrediction, interpolateWorld, RemoteWorldBuffer, PredictionClock } from '../src/online/prediction.js';
import type { AppliedMotionState } from '../src/online/prediction-contract.js';
import { HostSession } from '../src/online/host-session.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { advanceRiderPose } from '../src/shared/rider-motion.js';
import { drunkHeadingOffset } from '../src/shared/drunk.js';
function fixture(){const room=new HostSession('h',defaultRoomSettings(),{token:()=>crypto.randomUUID()});room.command('h',{type:'join',name:'Host'});room.command('p',{type:'join',name:'P'});room.command('h',{type:'action',action:'start'});for(let i=0;i<60;i++)room.advance();return {...room.snapshot(),tick:room.game.tick,round:1};}
function ledger(tick:number):AppliedMotionState{return {scope:{matchId:'match',round:1,controlEpoch:'c'},tick,appliedSeq:-1,appliedTick:tick,held:{left:false,right:false},results:[],motion:{seed:31,drunkStartedTick:0,drunkUntilTick:0,drunkHeadingOffset:0}};}
function setup(){let now=0;const state=fixture(),motion=ledger(state.tick),predictor=new LocalPrediction(()=>now);predictor.accept(state,'h',-1,motion,'authority');predictor.observeClock({scope:motion.scope,localSentAt:0,localReceivedAt:0,authorityTick:state.tick,paused:false});return {state,motion,predictor,time:(n:number)=>{now=n;}};}
test('local steering responds next frame using a partial step which never changes fixed replay',()=>{
 const {state,predictor,time}=setup(),original=state.players[0]!;assert.ok(predictor.input(0,false,true));time(16);const first=predictor.render(state,'h').players[0]!;assert.notEqual(first.angle,original.angle);
 const expected=advanceRiderPose({...original,drunkHeadingOffset:0},{left:false,right:true},{distance:7.5,turn:.14,drunkHeadingOffset:0});
 for(const hz of [30,60,120]){for(let n=0;n<200;n+=1000/hz){time(n);predictor.render(state,'h');}assert.deepEqual(predictor.predict(state.tick+1),expected);}
});
test('acknowledged held turn replays exactly with no pending events, including drunk offset',()=>{
 const {state,motion,predictor}=setup();motion.held={left:true,right:false};motion.appliedSeq=4;motion.motion.drunkStartedTick=state.tick-10;motion.motion.drunkUntilTick=state.tick+80;motion.motion.drunkHeadingOffset=.1;
 predictor.accept(state,'h',4,motion,'authority');let expected={...state.players[0]!,drunkHeadingOffset:.1};
 for(let tick=state.tick+1;tick<=state.tick+4;tick++)expected={...expected,...advanceRiderPose(expected,motion.held,{distance:7.5,turn:.14,drunkHeadingOffset:drunkHeadingOffset(31,'h',tick,state.tick-10,state.tick+80)})};
 const actual=predictor.predict(state.tick+4)!;assert.ok(Math.hypot(actual.x-expected.x,actual.y-expected.y)<1e-6);assert.equal(actual.angle,expected.angle);
});
test('fresh-input age neutralizes held controls at tick ten',()=>{const {state,motion,predictor}=setup();motion.held={left:true,right:false};motion.appliedTick=state.tick-9;predictor.accept(state,'h',0,motion,'authority');assert.equal(predictor.predict(state.tick+1)!.angle,state.players[0]!.angle);});
test('press and release scheduled for same tick uses latest sample, received ack cannot retire either',()=>{const {state,predictor}=setup();predictor.input(0,true,false);predictor.input(1,false,false);predictor.accept(state,'h',1,ledger(state.tick),'authority');assert.equal(predictor.predict(state.tick+1)!.angle,state.players[0]!.angle);});
test('mismatched snapshot and application tick rejected atomically',()=>{const {state,motion,predictor}=setup();const before=predictor.predict(state.tick+2);assert.equal(predictor.accept({...state,tick:state.tick+1},'h',4,motion,'authority'),false);assert.deepEqual(predictor.predict(state.tick+2),before);assert.equal(predictor.accept(state,'h',4,{...motion,results:[{seq:4,status:'applied',appliedTick:state.tick+1}]},'authority'),false);});
test('applied result retires pending but continues authoritative held input',()=>{const {state,motion,predictor,time}=setup();predictor.input(0,true,false);time(100);const pose=predictor.predict(state.tick+2)!;const confirmed={...state,tick:state.tick+2,players:state.players.map(p=>p.id==='h'?{...p,...pose}:p)};predictor.accept(confirmed,'h',0,{...motion,tick:confirmed.tick,appliedSeq:0,appliedTick:state.tick+1,held:{left:true,right:false},results:[{seq:0,status:'applied',appliedTick:state.tick+1}]},'authority');assert.equal(predictor.ackMs,100);assert.notEqual(predictor.predict(confirmed.tick+1)!.angle,pose.angle);assert.ok(predictor.correction<1e-6);});
test('death and portal reset local motion and epoch invalidates timing',()=>{const {state,motion,predictor,time}=setup();predictor.input(0,true,false);time(100);const dead={...state,players:state.players.map(p=>({...p,alive:false}))};predictor.accept(dead,'h',0,motion,'authority');assert.equal(predictor.render(state,'h').players[0]!.alive,false);const portal={...state,players:state.players.map(p=>({...p,x:800,portalCooldownUntilTick:99}))};predictor.accept(portal,'h',0,motion,'authority');assert.equal(predictor.predict(state.tick)!.x,800);predictor.accept(state,'h',0,motion,'new-authority');
 // The epoch discards the old authority's timing, but the new authority alone refuses its own inputs (#65).
 assert.equal(predictor.clock.estimate(motion.scope),undefined);
 const afterEpoch=predictor.input(1,true,false);assert.ok(afterEpoch);assert.equal(afterEpoch.intendedTick,state.tick+1,'scheduled from the new authority snapshot, never from the discarded clock');});
test('clock retains conservative send sampled bounds and rejects pause stale and invalid RTT',()=>{let now=100;const c=new PredictionClock(()=>now),scope=ledger(1).scope;assert.equal(c.observe({scope,localSentAt:0,localReceivedAt:100,authorityTick:20,paused:false}),true);assert.deepEqual(c.estimate(),{lower:20,upper:22,tick:21});assert.equal(c.observe({scope,localSentAt:110,localReceivedAt:100,authorityTick:20,paused:false}),false);now=700;assert.equal(c.estimate(),undefined);assert.equal(c.observe({scope,localSentAt:700,localReceivedAt:700,authorityTick:30,paused:true}),false);assert.equal(c.estimate(),undefined);now=800;assert.ok(c.observe({scope,localSentAt:800,localReceivedAt:800,authorityTick:30,paused:false}));assert.equal(c.estimate()!.tick,30);});
test('remote buffer uses coherent past state and fractional ticks without portal chords',()=>{const a=fixture(),b=structuredClone(a);b.tick+=2;b.players[0]!.x+=100;b.players[0]!.portalCooldownUntilTick+=20;const mid=interpolateWorld(a,b,.5);assert.equal(mid.tick,a.tick+1);assert.equal(mid.players[0]!.x,a.players[0]!.x);const buffer=new RemoteWorldBuffer();buffer.push(a,'a');buffer.push(b,'a');assert.equal(buffer.render(a.tick+3)!.tick,a.tick+1);assert.equal(buffer.render(a.tick+2)!.tick,a.tick+1);assert.equal(buffer.render(a.tick+100)!.tick,b.tick);buffer.push({...a,tick:1},'b');assert.equal(buffer.render(3)!.tick,1);});
test('spectator clock advances fractional render ticks without a player seat and resets scope',()=>{let now=0;const clock=new PredictionClock(()=>now),scope=ledger(1).scope,a=fixture(),b={...a,tick:a.tick+2},buffer=new RemoteWorldBuffer();buffer.push(a,'a');buffer.push(b,'a');clock.observe({scope,localSentAt:0,localReceivedAt:0,authorityTick:b.tick,paused:false});assert.equal(buffer.render(clock.estimate()!.tick)!.tick,a.tick);now=25;assert.equal(buffer.render(clock.estimate()!.tick)!.tick,a.tick+.5);const predictor=new LocalPrediction(()=>now);predictor.observeClock({scope,localSentAt:25,localReceivedAt:25,authorityTick:b.tick,paused:false});predictor.resetExternalScope();assert.equal(predictor.clock.estimate(),undefined);});
test('presentation connector is bounded and never mutates confirmed trails',()=>{const {state,predictor,time}=setup();const length=state.players[0]!.trail.length;predictor.input(1,false,true);time(100);const shown=predictor.render(state,'h').players[0]!;assert.equal(state.players[0]!.trail.length,length);assert.equal(shown.trail.length,length+1);const last=shown.trail.at(-1)!;assert.ok(Math.hypot(last.x2-last.x1,last.y2-last.y1)<=40);});
test('inactive snapshots do not invent movement correction or smoothing offsets',()=>{for(const phase of ['countdown','roundOver','lobby','matchOver'] as const){const {state,motion,predictor}=setup();const inactive={...state,phase};predictor.accept(inactive,'h',-1,motion,'authority');const next={...inactive,tick:inactive.tick+2};predictor.accept(next,'h',-1,{...motion,tick:next.tick},'authority');assert.equal(predictor.correction,0,phase);assert.equal(predictor.render(next,'h').players[0]!.x,inactive.players[0]!.x);}});
test('slow round trip or lagging snapshot never rejects input locally; host admission and the four-tick lead cap bound it (#15)',()=>{
 let now=0;const state=fixture(),motion=ledger(state.tick),predictor=new LocalPrediction(()=>now),neutral=new LocalPrediction(()=>now);
 for(const p of [predictor,neutral])p.accept(state,'h',-1,motion,'authority');
 // 300 ms probe: six ticks of uncertainty, estimate nine ticks past a snapshot that is already stale.
 now=300;for(const p of [predictor,neutral])assert.ok(p.observeClock({scope:motion.scope,localSentAt:0,localReceivedAt:300,authorityTick:state.tick+6,paused:false}));
 const scheduled=predictor.input(0,true,false);assert.ok(scheduled);assert.equal(scheduled.intendedTick,state.tick+10);
 assert.deepEqual(predictor.predict(state.tick+4),neutral.predict(state.tick+4),'preview never advances past the base window');
 const later={...state,tick:state.tick+9};predictor.accept(later,'h',-1,{...motion,tick:later.tick},'authority');
 assert.equal(predictor.diagnostics().pending,1);assert.notEqual(predictor.predict(later.tick+2)!.angle,later.players[0]!.angle,'the input replays once the base reaches its tick');
});
test('transport-refused and stale inputs never count toward the bound; overflow drops the backlog instead of blocking (#20)',()=>{
 const {state,motion,predictor}=setup();
 for(let seq=0;seq<300;seq++){assert.ok(predictor.input(seq,true,false));predictor.discard(seq);}
 assert.equal(predictor.diagnostics().pending,0);
 for(let seq=300;seq<428;seq++)assert.ok(predictor.input(seq,true,false));
 assert.equal(predictor.diagnostics().pending,128);
 assert.ok(predictor.input(428,true,false));assert.equal(predictor.diagnostics().pending,1);
 for(let seq=429;seq<440;seq++)assert.ok(predictor.input(seq,true,false));
 const later={...state,tick:state.tick+20};assert.ok(predictor.accept(later,'h',-1,{...motion,tick:later.tick},'authority'));
 assert.equal(predictor.diagnostics().pending,0,'inputs behind the host window are pruned');
 assert.ok(predictor.input(440,true,false));assert.equal(predictor.render(later,'h').players[0]!.alive,true);
});
test('overflow first drops inputs behind the host window and only clears a fully fresh backlog (#15 follow-up)',()=>{
 let now=0;const state=fixture(),motion=ledger(state.tick),predictor=new LocalPrediction(()=>now);predictor.accept(state,'h',-1,motion,'authority');
 now=10;assert.ok(predictor.observeClock({scope:motion.scope,localSentAt:10,localReceivedAt:10,authorityTick:state.tick-10,paused:false}));
 for(let seq=0;seq<100;seq++)assert.equal(predictor.input(seq,true,false)!.intendedTick,state.tick-9);
 now=20;assert.ok(predictor.observeClock({scope:motion.scope,localSentAt:20,localReceivedAt:20,authorityTick:state.tick,paused:false}));
 for(let seq=100;seq<128;seq++)assert.equal(predictor.input(seq,true,false)!.intendedTick,state.tick+1);
 assert.equal(predictor.diagnostics().pending,128);
 assert.ok(predictor.input(128,true,false));assert.equal(predictor.diagnostics().pending,29,'stale entries go first, fresh ones survive');
 for(let seq=129;seq<228;seq++)assert.ok(predictor.input(seq,true,false));
 assert.equal(predictor.diagnostics().pending,128);
 assert.ok(predictor.input(228,true,false));assert.equal(predictor.diagnostics().pending,1,'a full fresh backlog is dropped as a whole');
 assert.equal(predictor.diagnostics().estimate?.tick,state.tick);
});

test('a lost clock limits the preview but never the send (#65)',()=>{
 let now=0;const state=fixture(),motion=ledger(state.tick),predictor=new LocalPrediction(()=>now);
 predictor.accept(state,'h',-1,motion,'authority');
 assert.ok(predictor.observeClock({scope:motion.scope,localSentAt:0,localReceivedAt:0,authorityTick:state.tick,paused:false}));
 // Probes stop answering while snapshots keep arriving: past the four-second sample age no estimate survives.
 now=4500;const fresh={...state,tick:state.tick+90};
 assert.ok(predictor.accept(fresh,'h',-1,{...motion,tick:fresh.tick},'authority'));
 assert.equal(predictor.clock.estimate(motion.scope),undefined,'the clock is gone');
 now=4525;
 const scheduled=predictor.input(0,true,false);
 assert.ok(scheduled,'a lost clock must not swallow the input; only the host may refuse it');
 assert.equal(scheduled.intendedTick,fresh.tick+1,'scheduled from the newest authoritative tick and its age');
 assert.deepEqual(scheduled.scope,motion.scope);
 const rider=(snapshot:ReturnType<typeof fixture>)=>snapshot.players.find(player=>player.id==='h')!;
 assert.equal(predictor.render(fresh,'h').players.find(player=>player.id==='h')!.angle,rider(fresh).angle,'no invented preview motion without a clock');
});
