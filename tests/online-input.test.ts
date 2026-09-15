import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../src/online/host-session.js';
import { Simulation } from '../src/online/rollback.js';
import { StreamSender } from '../src/online/stream.js';
import { InputEdges } from '../src/online/input-edges.js';
import { decodeGameState } from '../src/online/checkpoint.js';
import { BombInputBuffer } from '../src/shared/bomb-input.js';
import { replayHash, type LogEntry, type ReplayState } from '../src/shared/action-log.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';

function playing(){const s=new HostSession('host',defaultRoomSettings(),{token:()=>'match'});s.command('host',{type:'join',name:'Host'});s.command('guest',{type:'join',name:'Guest'});s.command('host',{type:'action',action:'start'});s.advance();while(s.game.phase==='countdown')s.advance();return s;}
/** A guest's controller: edges numbered by its own sender, delivered whenever the test says. */
function guest(s:HostSession){const sender=new StreamSender(),edges=new InputEdges();return {sender,packet:(message:Parameters<InputEdges['edges']>[0]):LogEntry[]=>edges.edges(message).map(body=>sender.append(s.tick+1,body)),deliver:(entries:LogEntry[])=>s.ingest('guest',entries)};}
const bombs=(s:HostSession)=>[...s.game.bombs.values()].filter(b=>b.ownerId==='guest').length;

test('a press applies on the next tick and is never refused for timing',()=>{
  const s=playing();assert.equal(s.command('host',{type:'input',left:false,right:false,bomb:true,bombAction:'press'}),undefined);
  s.advance();assert.notEqual(s.game.players.get('host')!.bombChargeStartedTick,undefined);
  s.command('host',{type:'input',left:true,right:false,bomb:true});s.advance();assert.equal(s.sim.state.streams.get('host')!.flags,1);
  s.command('host',{type:'input',left:true,right:false,bomb:false,bombAction:'release'});s.advance();assert.equal([...s.game.bombs.values()].filter(b=>b.ownerId==='host').length,1);
});
test('hold fire, lose every packet for 1.5 seconds, release: the shot still fires, charged from the original press',()=>{
  const s=playing(),g=guest(s);
  const press=g.packet({left:false,right:false,bomb:true,bombAction:'press'});
  const pressTick=s.tick+1;
  for(let i=0;i<30;i++)s.advance();
  const release=g.packet({left:false,right:false,bomb:false,bombAction:'release'});
  assert.deepEqual(g.deliver([...press,...release]),{});
  s.advance();
  assert.equal(bombs(s),1);
  const bomb=[...s.game.bombs.values()].find(b=>b.ownerId==='guest')!;
  assert.ok(Math.hypot(bomb.x-bomb.launchX,bomb.y-bomb.launchY)>100,'a 30-tick charge, applied at its press tick by rewinding, launches far');
  assert.equal(s.game.players.get('guest')!.bombChargeStartedTick,undefined);
  void pressTick;
});
test('a press during the round transition is not lost',()=>{
  const s=new HostSession('host',defaultRoomSettings(),{token:()=>'match'});s.command('host',{type:'join',name:'Host'});s.command('guest',{type:'join',name:'Guest'});
  const g=guest(s);s.command('host',{type:'action',action:'start'});s.advance();
  while(s.game.phase==='countdown'&&s.game.phaseEndsAtTick!==undefined&&s.tick<s.game.phaseEndsAtTick-1)s.advance();
  const press=g.packet({left:false,right:false,bomb:true,bombAction:'press'});g.deliver(press);
  s.advance();s.advance();assert.equal(s.game.phase,'playing');
  for(let i=0;i<5;i++)s.advance();
  assert.notEqual(s.game.players.get('guest')!.bombChargeStartedTick,undefined,'the press survived the countdown-to-playing change');
  g.deliver(g.packet({left:false,right:false,bomb:false,bombAction:'release'}));s.advance();assert.equal(bombs(s),1);
});
test('guest entries are deduplicated, kept contiguous, repaired on request and re-numbered for relay',()=>{
  const s=playing(),g=guest(s);
  const a=g.packet({left:true,right:false,bomb:false}),b=g.packet({left:false,right:true,bomb:false});s.advance();const c=g.packet({left:false,right:false,bomb:false});
  assert.deepEqual(g.deliver([...b,...c]),{firstMissing:1},'a gap reports the first missing guest seq');
  s.advance();assert.equal(s.sim.state.streams.get('guest')!.flags,0,'nothing past the gap applies');
  assert.deepEqual(g.deliver([...a,...b]),{});s.advance();assert.equal(s.sim.state.streams.get('guest')!.flags,0);
  assert.deepEqual(s.senders.get('guest')!.retained.map(e=>e[0]),[1,2,3],'relay numbering is the host\'s and contiguous');
  assert.deepEqual(g.deliver([...a,...c]),{});assert.equal(s.senders.get('guest')!.retained.length,3,'duplicates are ignored');
  assert.deepEqual(g.deliver([[9,s.tick,10,'x','X',3,null] as LogEntry]),{},'management from a guest is ignored');assert.equal(s.game.players.size,2);
  s.reconnect('guest');const fresh=new StreamSender();const again=fresh.append(s.tick+1,[0,2]);g.deliver([again]);s.advance();
  assert.equal(s.sim.state.streams.get('guest')!.flags,2,'a reconnected guest restarts at seq 1 and is accepted');
});
test('a silent member is neutralized by presence and a between-rounds leave frees the seat',()=>{
  const s=playing(),g=guest(s);g.deliver(g.packet({left:true,right:false,bomb:true,bombAction:'press'}));s.advance();
  assert.equal(s.sim.state.streams.get('guest')!.flags,1);
  s.presence('guest',false);s.advance();
  assert.equal(s.game.players.get('guest')!.connected,false);assert.equal(s.sim.state.streams.get('guest')!.flags,0);assert.equal(s.game.players.get('guest')!.bombChargeStartedTick,undefined);
  s.presence('guest',true);s.advance();assert.equal(s.game.players.get('guest')!.connected,true);
  s.command('host',{type:'action',action:'lobby'});s.advance();s.disconnect('guest');s.advance();assert.equal(s.game.players.has('guest'),false);
});
test('a baseline installs into a fresh simulation that then matches the host tick for tick',()=>{
  const s=playing(),g=guest(s);s.command('host',{type:'bot',action:'add'});s.advance();
  g.deliver(g.packet({left:true,right:false,bomb:true,bombAction:'press'}));for(let i=0;i<5;i++)s.advance();
  const baseline=s.baseline('viewer');
  const game=decodeGameState(baseline.game)!;const state:ReplayState={game,pending:baseline.pending,streams:new Map()};
  for(const [member,,streamState] of baseline.streams)state.streams.set(member,{flags:streamState.flags,...(streamState.aim?{aim:streamState.aim}:{}),...(streamState.gesture===null?{}:{gesture:streamState.gesture}),bombs:BombInputBuffer.fromJSON(streamState.bombs)!});
  assert.equal(replayHash(state),baseline.hash);
  const view=new Simulation(state,'host');view.install(state,new Map(baseline.streams.map(([member,folded])=>[member,folded])));
  for(const [member,,,retained] of baseline.streams)for(const e of retained)view.insert(member,e);
  const before=s.tick;
  for(let i=0;i<40;i++){g.deliver(g.packet({left:i%2===0,right:i%2===1,bomb:i<20}));s.advance();}
  for(const [member,sender] of s.senders)for(const e of sender.retained)if(e[0]>(baseline.streams.find(([m])=>m===member)?.[1]??0))view.insert(member,e);
  assert.equal(view.advanceTo(s.tick,()=>{}).status,'ok');
  assert.equal(replayHash(view.state),s.hash(),`replica diverged between ${before} and ${s.tick}`);
});
