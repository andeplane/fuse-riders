import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../src/online/host-session.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { applyOperation, canonical, replayHash, validOperation, ActionJournal, type ReplayState } from '../src/shared/action-log.js';
import { createGame, SLOT_COLORS } from '../src/shared/game.js';
import { encodeGameState, decodeGameState } from '../src/online/checkpoint.js';
import { sin, cos, atan2, hypot2 } from '../src/shared/deterministic-math.js';

function fixture(){let id=0;const host=new HostSession('host',defaultRoomSettings(),{token:()=>`replay-${++id}`,captureActions:true});host.command('host',{type:'join',name:'Host'});host.command('guest',{type:'join',name:'Guest'});return host;}
const wire=<T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;

test('accepted host actions replay complete lifecycle, bots, timeout cancellation and resets',()=>{
  const host=fixture();const replica:ReplayState=structuredClone(host.journal.state);let seq=host.journal.sequence;
  const compare=()=>{const ops=host.journal.since(seq)!;for(const op of ops){assert.ok(validOperation(op));applyOperation(replica,wire(op));}seq=host.journal.sequence;assert.equal(canonical(replica),canonical(host.journal.state));assert.equal(replayHash(replica),replayHash(host.journal.state));};
  for(let i=0;i<3;i++)host.command('host',{type:'bot',action:'add'});
  host.command('host',{type:'action',action:'start'});compare();
  for(let tick=0;tick<1500;tick++){
    if(tick===65)host.command('guest',{type:'input',scope:host.controlScope('guest')!,intendedTick:host.game.tick+1,seq:0,left:true,right:false,bomb:true,bombAction:'press'});
    if(tick===85)host.disconnect('guest');
    if(tick===90)host.command('guest',{type:'join',name:'Guest'});
    host.advance();compare();
  }
  host.command('host',{type:'action',action:'lobby'});compare();
  host.command('guest',{type:'avatar',avatarId:'robot'});host.command('host',{type:'settings',settings:{...host.settings,length:1}});host.command('host',{type:'bot',action:'remove',id:'bot:1'});compare();
  host.command('host',{type:'action',action:'start'});compare();
  for(let tick=0;tick<2000&&host.game.phase!=='matchOver';tick++){host.advance();compare();}
  assert.equal(host.game.phase,'matchOver');host.command('host',{type:'action',action:'rematch'});compare();
});
test('replica game checkpoint preserves connected and charging state without host recovery sanitization',()=>{
  const host=fixture();host.command('host',{type:'action',action:'start'});for(let i=0;i<65;i++)host.advance();
  host.command('guest',{type:'input',scope:host.controlScope('guest')!,intendedTick:66,seq:0,left:true,right:false,bomb:true,bombAction:'press'});host.advance();
  assert.equal(host.game.players.get('guest')!.bombChargeStartedTick,66);
  assert.equal(canonical(decodeGameState(encodeGameState(host.game))),canonical(host.game));
  assert.equal(decodeGameState('{}'),undefined);assert.equal(decodeGameState('{'),undefined);assert.equal(decodeGameState(' '.repeat(2_000_001)),undefined);
  const corrupted=JSON.parse(encodeGameState(host.game));corrupted.nextBombId=-1;assert.equal(decodeGameState(JSON.stringify(corrupted)),undefined);
});
test('steady held input records only changes; bomb edges never persist into later ticks',()=>{
  const host=fixture();host.command('host',{type:'action',action:'start'});for(let i=0;i<65;i++)host.advance();
  const before=host.journal.sequence;
  for(let i=0;i<8;i++){host.command('guest',{type:'input',scope:host.controlScope('guest')!,intendedTick:host.game.tick+1,seq:i,left:true,right:false,bomb:true});host.advance();}
  const records=host.journal.since(before)!;assert.equal(records.filter(op=>op[0]===0&&op[2].some(c=>c[0]===1)).length,1);
  assert.equal(host.game.players.get('guest')!.bombChargeStartedTick,66);
  for(let i=0;i<10;i++)host.advance();assert.equal(host.game.players.get('guest')!.bombChargeStartedTick,undefined);
});
test('malformed operations are rejected and the journal is bounded',()=>{
  for(const v of [null,{},[],[9],[0,1,[[0,1,8,null,[]]]],[0,1,[[0,1,0,[2,0],[]]]],[1,{}],[2,''],[3,'x',3],[4,{}],[5,2,''],[6,'x','bad']])assert.equal(validOperation(v),false);
  const journal=new ActionJournal(createGame('m'),true);for(let i=0;i<450;i++)journal.advance(new Map());assert.equal(journal.since(0),undefined);assert.equal(journal.since(451),undefined);assert.equal(journal.since(-1),undefined);assert.equal(journal.since(450)!.length,0);
  const replica:ReplayState={game:createGame('m'),held:new Map()};assert.throws(()=>applyOperation(replica,[0,5,[]]),/Noncontiguous/);
});
test('signed-zero headings and arena-coordinate bomb targets survive checkpoint suffix replay',()=>{
  const host=fixture();host.command('host',{type:'action',action:'start'});for(let i=0;i<65;i++)host.advance();
  const player=host.game.players.get('guest')!;player.angle=-0;player.targetBombArmed=true;player.bombChargeStartedTick=host.game.tick;player.bombTarget={x:700,y:400};
  const restored=decodeGameState(encodeGameState(host.game));assert.ok(restored);assert.ok(Object.is(restored.players.get('guest')!.angle,-0));assert.deepEqual(restored.players.get('guest')!.bombTarget,{x:700,y:400});
  const replay:ReplayState={game:restored,held:structuredClone(host.journal.state.held)};const sequence=host.journal.sequence;
  for(let i=0;i<20;i++)host.advance();for(const op of host.journal.since(sequence)!)applyOperation(replay,op);assert.equal(canonical(replay),canonical(host.journal.state));
  assert.notEqual(canonical(-0),canonical(0));
});
test('host refuses a new historical identity before replay/checkpoint capacity is exceeded',()=>{
  const host=fixture();for(let i=0;i<126;i++){assert.equal(host.command(`visitor-${i}`,{type:'join',name:'Visitor'}),undefined);host.disconnect(`visitor-${i}`);}
  const before=canonical(host.journal.state);assert.match(host.command('overflow',{type:'join',name:'Overflow'})!,/fresh room/);assert.equal(canonical(host.journal.state),before);assert.ok(decodeGameState(encodeGameState(host.game)));
  assert.equal(validOperation([1,{id:'new',name:'New',slot:2,color:'#wrong',avatarId:'robot'}]),false);assert.equal(validOperation([1,{id:'new',name:'x'.repeat(21),slot:2,color:SLOT_COLORS[2]}]),false);
});
test('signed-zero local aim is normalized before action capture',()=>{
  const host=fixture();host.command('host',{type:'action',action:'start'});for(let i=0;i<65;i++)host.advance();
  host.command('guest',{type:'input',scope:host.controlScope('guest')!,intendedTick:66,seq:0,left:false,right:false,bomb:true,bombAction:'press',aim:{x:-0,y:.5}});host.advance();
  assert.ok(Object.is(host.journal.state.held.get(1)!.aim![0],0));assert.equal(validOperation([0,67,[[1,67,0,[-0,.5],[]]]]),false);
});
test('action changes carry full applied ticks across sparse input and bomb transitions',()=>{
  const host=fixture();host.command('host',{type:'action',action:'start'});for(let i=0;i<65;i++)host.advance();
  const replica:ReplayState=structuredClone(host.journal.state);const sequence=host.journal.sequence;
  for(let tick=66;tick<=72;tick++){
    if(tick===66||tick===70)host.command('guest',{type:'input',scope:host.controlScope('guest')!,intendedTick:tick,seq:tick-66,left:tick===66,right:false,bomb:tick===66,bombAction:tick===66?'press':'release'});
    host.advance();
  }
  const ops=wire(host.journal.since(sequence)!);assert.ok(ops.every(validOperation));
  const changes=ops.flatMap(op=>op[0]===0?op[2].filter(c=>c[0]===1):[]);
  assert.deepEqual(changes.map(c=>c[1]),[66,70]);assert.deepEqual(changes.map(c=>c[4].map(b=>b[0])),[[0],[1]]);
  for(const op of ops)applyOperation(replica,op);assert.equal(canonical(replica),canonical(host.journal.state));
  assert.equal(host.game.players.get('guest')!.bombChargeStartedTick,undefined);assert.equal([...host.game.bombs.values()].filter(b=>b.ownerId==='guest').length,1);
});
test('absolute action ticks replay independently of previous held timestamps',()=>{
  const host=fixture();host.game.tick=72_000;
  host.journal.advance(new Map([['guest',{left:true,right:false,bomb:false}]]));
  const baseline:ReplayState=structuredClone(host.journal.state);const otherHistory:ReplayState=structuredClone(baseline);
  otherHistory.held.get(1)!.at=1;
  const sequence=host.journal.sequence;
  host.journal.advance(new Map([['guest',{left:false,right:true,bomb:false}]]));
  const operation=wire(host.journal.since(sequence)![0]!);assert.ok(validOperation(operation));assert.equal(operation[0],0);
  if(operation[0]!==0)return;
  assert.equal(operation[1],72_002);assert.equal(operation[2].find(c=>c[0]===1)![1],72_002);
  applyOperation(baseline,operation);applyOperation(otherHistory,operation);assert.equal(canonical(baseline),canonical(otherHistory));assert.equal(canonical(baseline),canonical(host.journal.state));
});
test('deterministic math tracks native math within a few ulp and is engine independent',()=>{
  for(let i=-50;i<=50;i++){const x=i*0.37;
    assert.ok(Math.abs(sin(x)-Math.sin(x))<1e-12);assert.ok(Math.abs(cos(x)-Math.cos(x))<1e-12);
    assert.ok(Math.abs(atan2(x,1.3)-Math.atan2(x,1.3))<1e-12);assert.ok(Math.abs(hypot2(x,1.3)-Math.hypot(x,1.3))<1e-9);
  }
  assert.equal(hypot2(3,4),5);
});
