import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthorityClock, LEASE_GUARD_MS, reserveAuthority, renewAuthority, type AuthorityGrant } from '../src/online/authority.js';
import { AUTHORITY_GRACE_MS, AuthorityGrace } from '../src/online/authority-grace.js';
import { HostSession, type RoomCommand } from '../src/online/host-session.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';

type Input=Extract<RoomCommand,{type:'input'}>;
const SERVICE_OFFSET=1_000_000,SAMPLE_PERIOD_MS=2000,TICK_MS=10;
/**
 * Host authority under injected local and service clocks, in the runtime's decision order (#48): permits() alone
 * fences advancing; the grace only decides when seats lose their control scope. Inputs that arrive while the clock
 * is not permitted never reach the session because the transport refuses them, so the harness delivers none.
 */
class Harness {
  local:number;
  readonly clock=new AuthorityClock(()=>this.local);
  grant:AuthorityGrant=reserveAuthority(undefined,'room','host','grant',SERVICE_OFFSET);
  readonly grace=new AuthorityGrace();
  readonly session:HostSession;
  clears=0;deniedTicks=0;sampling=true;renewing=true;
  private accumulator=0;
  private nextSample:number;
  constructor(local=100){
    this.local=local;this.nextSample=local;
    const s=new HostSession('host',defaultRoomSettings(),{token:()=>'injected'});
    s.command('host',{type:'join',name:'Host'});s.command('guest',{type:'join',name:'Guest'});s.command('host',{type:'action',action:'start'});
    while(s.game.phase==='countdown')s.advance();this.session=s;
  }
  /** One WSS time round trip; like the runtime's sampleTime(), the host renews its lease with each sample. */
  sample(rttMs=20):void{
    const sent=this.local-rttMs,service=SERVICE_OFFSET+this.local-rttMs/2;
    if(this.renewing)this.grant=renewAuthority(this.grant,this.grant,service)??this.grant;
    assert.equal(this.clock.synchronize(sent,service),true);
  }
  permitted():boolean{return this.clock.permits(this.grant);}
  /** Runs `ms` of 10 ms runtime ticks. */
  run(ms:number):void{
    for(const end=this.local+ms;this.local<end;){
      this.local+=TICK_MS;
      if(this.sampling&&this.local>=this.nextSample){this.nextSample+=SAMPLE_PERIOD_MS;this.sample();}
      const permitted=this.permitted();
      if(this.grace.clearSeats(this.local,permitted)){this.clears++;this.session.clear();}
      if(!permitted){this.accumulator=0;this.deniedTicks++;continue;}
      this.accumulator+=TICK_MS;
      while(this.accumulator>=50){this.accumulator-=50;this.session.advance();}
    }
  }
  /** The tick loop did not run at all: a main-thread stall. */
  stall(ms:number):void{this.local+=ms;}
  /** Runs until the clock stops permitting; returns the local time of the first denied tick. */
  untilDenied():number{const denied=this.deniedTicks;while(this.deniedTicks===denied)this.run(TICK_MS);return this.local;}
  /** Riders drive straight from spawn; a round change would clear seats on its own, so every scenario must end inside round 1. */
  stillRoundOne():void{assert.equal(this.session.game.phase,'playing');assert.equal(this.session.game.round,1);}
  input(seq:number,scope:Input['scope'],patch:Partial<Input>={}):Input{return{type:'input',scope,intendedTick:this.session.game.tick+1,seq,left:true,right:false,bomb:false,...patch};}
}

test('a host stall over the clock threshold pauses advancing but keeps seat scopes; queued and old-scope inputs still apply',()=>{
  const h=new Harness();h.run(1000);assert.equal(h.deniedTicks,0);
  const scope=h.session.controlScope('guest')!,tick=h.session.game.tick;
  assert.equal(h.session.command('guest',h.input(1,scope,{intendedTick:tick+2})),undefined);
  h.stall(600);h.run(TICK_MS);
  assert.equal(h.permitted(),false);assert.equal(h.deniedTicks,1);assert.equal(h.clock.diagnostics().reason,'stale-or-suspended');
  let denied=1;
  while(!h.permitted()){
    h.run(TICK_MS);denied++;
    assert.equal(h.session.game.tick,tick,'no advance while the clock is not permitted');
    assert.deepEqual(h.session.controlScope('guest'),scope,'seat scope survives the gap');
    assert.ok(denied*TICK_MS<AUTHORITY_GRACE_MS,'the next sample re-certifies the lease inside the grace');
  }
  assert.ok(denied>1,'the pause outlived the stall itself: permission returns only with the next sample');
  assert.equal(h.clears,0);assert.equal(h.session.game.tick,tick);
  h.run(100);
  const motion=h.session.appliedMotion('guest')!;
  assert.equal(motion.appliedSeq,1);assert.equal(motion.appliedTick,tick+2);assert.deepEqual(motion.held,{left:true,right:false});
  assert.equal(h.session.command('guest',h.input(2,scope,{left:false,right:true})),undefined);
  h.run(50);assert.equal(h.session.appliedMotion('guest')!.appliedSeq,2);h.stillRoundOne();
});

test('a single time sample above the lease guard pauses for one sample period without rotating seat scopes',()=>{
  const h=new Harness();h.run(1000);const scope=h.session.controlScope('guest')!;
  h.sampling=false;
  h.sample(LEASE_GUARD_MS+50);h.run(TICK_MS);
  assert.equal(h.permitted(),false);assert.deepEqual(h.clock.diagnostics(),{reason:'uncertainty',roundTripMs:LEASE_GUARD_MS+50});
  const paused=h.session.game.tick;
  h.run(SAMPLE_PERIOD_MS-TICK_MS);
  assert.equal(h.session.game.tick,paused);assert.equal(h.clears,0);assert.deepEqual(h.session.controlScope('guest'),scope);
  h.sample();h.run(TICK_MS);assert.equal(h.permitted(),true);
  assert.equal(h.session.command('guest',h.input(1,scope)),undefined);
  h.run(50);assert.equal(h.session.appliedMotion('guest')!.appliedSeq,1);h.stillRoundOne();
});

test('continuous non-permission beyond the grace clears seats exactly once; a fresh certification re-arms it',()=>{
  const h=new Harness();h.run(1000);const scope=h.session.controlScope('guest')!;
  h.sampling=false;
  const deniedAt=h.untilDenied(),paused=h.session.game.tick;
  assert.equal(h.clock.diagnostics().reason,'stale-or-suspended');
  while(h.clears===0){
    assert.ok(h.local-deniedAt<AUTHORITY_GRACE_MS);assert.deepEqual(h.session.controlScope('guest'),scope);
    h.run(TICK_MS);assert.equal(h.session.game.tick,paused);
  }
  assert.equal(h.local-deniedAt,AUTHORITY_GRACE_MS);
  assert.notDeepEqual(h.session.controlScope('guest'),scope);
  assert.match(h.session.command('guest',h.input(1,scope))!,/scope/);
  h.run(2000);assert.equal(h.clears,1);assert.equal(h.session.game.tick,paused);
  h.sample();h.run(TICK_MS);assert.equal(h.permitted(),true);
  const fresh=h.session.controlScope('guest')!;
  assert.equal(h.session.command('guest',h.input(2,fresh)),undefined);h.run(50);assert.equal(h.session.appliedMotion('guest')!.appliedSeq,2);
  h.stall(600);const again=h.untilDenied();h.run(AUTHORITY_GRACE_MS);
  assert.equal(h.clears,2);assert.notDeepEqual(h.session.controlScope('guest'),fresh);assert.ok(h.local-again>=AUTHORITY_GRACE_MS);h.stillRoundOne();
});

test('a lease that actually lapses under a healthy clock stops advancing at once and clears seats after the grace',()=>{
  const h=new Harness(7000);h.renewing=false;h.run(1000);const scope=h.session.controlScope('guest')!;
  const deniedAt=h.untilDenied(),paused=h.session.game.tick;
  assert.equal(h.clock.diagnostics().reason,'outside-lease');
  assert.ok(Math.abs(deniedAt-(h.grant.expiresAt-SERVICE_OFFSET))<=50,'denied when the conservative interval reaches expiresAt');
  h.run(AUTHORITY_GRACE_MS-TICK_MS);assert.equal(h.clears,0);assert.deepEqual(h.session.controlScope('guest'),scope);
  h.run(TICK_MS);assert.equal(h.clears,1);assert.notDeepEqual(h.session.controlScope('guest'),scope);
  h.run(3000);assert.equal(h.session.game.tick,paused);assert.equal(h.clears,1);h.stillRoundOne();
});

test('AuthorityGrace fires once per outage, only after prior permission, and reset() scopes it to one authority',()=>{
  const g=new AuthorityGrace();
  for(let now=0;now<10_000;now+=10)assert.equal(g.clearSeats(now,false),false);
  assert.equal(g.clearSeats(10_000,true),false);
  assert.equal(g.clearSeats(10_010,false),false);assert.equal(g.clearSeats(10_010+AUTHORITY_GRACE_MS-10,false),false);
  assert.equal(g.clearSeats(10_010+AUTHORITY_GRACE_MS,false),true);assert.equal(g.clearSeats(20_000,false),false);
  assert.equal(g.clearSeats(20_010,true),false);assert.equal(g.clearSeats(20_020,false),false);assert.equal(g.clearSeats(20_030,true),false);
  assert.equal(g.clearSeats(20_030+AUTHORITY_GRACE_MS,false),false);assert.equal(g.clearSeats(20_030+2*AUTHORITY_GRACE_MS,false),true);
  g.clearSeats(30_000,true);g.reset();
  for(let now=30_010;now<40_000;now+=10)assert.equal(g.clearSeats(now,false),false);
  assert.equal(g.clearSeats(40_000,true),false);assert.equal(g.clearSeats(40_010,false),false);assert.equal(g.clearSeats(40_010+AUTHORITY_GRACE_MS,false),true);
});
