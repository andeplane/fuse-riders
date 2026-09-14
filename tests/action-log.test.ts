import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../src/online/host-session.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { applyOperation, canonical, replayHash, validOperation, ActionJournal, type ReplayState } from '../src/shared/action-log.js';
import { createGame, SLOT_COLORS } from '../src/shared/game.js';
import { encodeGameState, decodeGameState } from '../src/online/checkpoint.js';
import { ActionSender, ActionReceiver, packMessage, unpackMessage, type ActionMessage, type ActionMetadata, type ActionReceipt } from '../src/online/action-replication.js';

function fixture(){let id=0;const host=new HostSession('host',defaultRoomSettings(),{token:()=>`replay-${++id}`,captureActions:true});host.command('host',{type:'join',name:'Host'});host.command('guest',{type:'join',name:'Guest'});return host;}
const meta=(host:HostSession):ActionMetadata=>({settings:host.settings,ack:host.acknowledgements().guest??-1,paused:false,motion:host.appliedMotion('guest')});
test('accepted host actions replay complete lifecycle, bots, timeout cancellation and resets',()=>{
  const host=fixture();const replica:ReplayState=structuredClone(host.journal.state);let seq=host.journal.sequence;
  const compare=()=>{const ops=host.journal.since(seq)!;for(const op of ops){assert.ok(validOperation(op));applyOperation(replica,unpackMessage(packMessage(op)) as typeof op);}seq=host.journal.sequence;assert.equal(canonical(replica),canonical(host.journal.state));};
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
  for(let i=0;i<8;i++){host.command('guest',{type:'input',scope:host.controlScope('guest')!,intendedTick:host.game.tick+1,seq:i,left:true,right:false,bomb:true,...(i===0?{bombAction:'press' as const}:{})});host.advance();}
  const records=host.journal.since(before)!;assert.equal(records.filter(op=>op[0]===0&&op[2].some(c=>c[0]===1)).length,1);
  assert.equal(host.game.players.get('guest')!.bombChargeStartedTick,66);
  for(let i=0;i<10;i++)host.advance();assert.equal(host.game.players.get('guest')!.bombChargeStartedTick,undefined);
});
test('MessagePack tuples and malformed operations are bounded',()=>{
  assert.equal(packMessage([7,1,0]).byteLength,4);
  for(const v of [null,{},[],[9],[0,1,[[0,1,8,null,[]]]],[0,1,[[0,1,0,[2,0],[]]]],[1,{}],[2,''],[3,'x',3],[4,{}],[5,2,''],[6,'x','bad']])assert.equal(validOperation(v),false);
  assert.throws(()=>unpackMessage(new Uint8Array(2_000_001)));
  const journal=new ActionJournal(createGame('m'),true);for(let i=0;i<450;i++)journal.advance(new Map());assert.equal(journal.since(0),undefined);assert.equal(journal.since(451),undefined);assert.equal(journal.since(-1),undefined);assert.equal(journal.since(450)!.length,0);
});

test('real encoded sender/receiver: duplicate, dropped and reordered batches repair without divergent commit',()=>{
  const host=fixture(),sender=new ActionSender(),receiver=new ActionReceiver();let time=0;let wire:ActionMessage[]=[];
  const send=(m:ActionMessage)=>{wire.push(unpackMessage(packMessage(m)) as ActionMessage);return true;};
  const deliver=()=>{for(const m of wire.splice(0)){const result=receiver.receive(m,time);if('receipt'in result&&result.receipt)sender.receive(result.receipt);if(result.status==='accepted')assert.equal(replayHash(result.state),replayHash(host.journal.state));}};
  sender.publish(host.journal,meta(host),time,send);deliver();assert.ok(receiver.state);
  host.command('host',{type:'action',action:'start'});host.advance();time+=50;sender.publish(host.journal,meta(host),time,send);const lost=wire.splice(0);
  host.advance();time+=50;sender.publish(host.journal,meta(host),time,send);deliver();
  const before=replayHash(receiver.state!);for(const m of lost)assert.equal(receiver.receive(m,time).status,'stale');assert.equal(replayHash(receiver.state!),before);
  host.advance();time+=50;sender.publish(host.journal,meta(host),time,send);const batch=wire[0]!;deliver();assert.equal(receiver.receive(batch,time).status,'accepted');assert.equal(replayHash(receiver.state!),replayHash(host.journal.state));
  assert.equal(receiver.receive({...batch,generation:999},time).status,'resync');assert.equal(replayHash(receiver.state!),replayHash(host.journal.state));
});
test('invalid transaction and repeated hash mismatch never replace healthy state; fresh baseline repairs',()=>{
  const host=fixture(),sender=new ActionSender(),receiver=new ActionReceiver();const wire:ActionMessage[]=[];
  sender.publish(host.journal,meta(host),0,m=>{wire.push(m);return true;});
  for(const m of wire){const result=receiver.receive(m,0);if('receipt'in result&&result.receipt)sender.receive(result.receipt);}
  const healthy=replayHash(receiver.state!);const gen=(wire[0]!).generation;
  assert.equal(receiver.receive({type:'actionBatch',generation:gen,from:host.journal.sequence,tick:1,operations:[[0,1,[[0,999,0,null,[]]]]],hash:null,meta:meta(host)},10).status,'resync');assert.equal(replayHash(receiver.state!),healthy);
  const bad={type:'actionBatch',generation:gen,from:host.journal.sequence,tick:0,operations:[],hash:'0000000000000000',meta:meta(host)};
  assert.equal(receiver.receive(bad,20).status,'resync');assert.equal(receiver.receive(bad,30).status,'resync');assert.equal(receiver.receive(bad,40).status,'failed');assert.equal(replayHash(receiver.state!),healthy);
  receiver.reset();sender.requestBaseline();wire.length=0;sender.publish(host.journal,meta(host),50,m=>{wire.push(m);return true;});for(const m of wire)receiver.receive(m,50);assert.equal(replayHash(receiver.state!),healthy);
});
test('checkpoint chunk loss, reordering, corruption and timeout are bounded',()=>{
  const host=fixture();host.command('host',{type:'action',action:'start'});for(let i=0;i<75;i++)host.advance();
  const sender=new ActionSender(),receiver=new ActionReceiver();const wire:ActionMessage[]=[];sender.publish(host.journal,meta(host),0,m=>{wire.push(m);return true;});
  const first=wire[0]!;assert.equal(first.type,'actionChunk');if(first.type!=='actionChunk')return;
  assert.equal(receiver.receive({...first,total:999},0).status,'resync');
  assert.equal(receiver.receive({...first,generation:2,bytes:new Uint8Array([0])},0).status,first.total===1?'resync':'waiting');
  receiver.reset();for(const m of [...wire].reverse()){const r=receiver.receive(m,0);if(r.status==='accepted')sender.receive(r.receipt);}
  if(!receiver.state){sender.publish(host.journal,meta(host),50,m=>{receiver.receive(m,50);return true;});}
  assert.equal(replayHash(receiver.state!),replayHash(host.journal.state));
  assert.equal(receiver.receive(first,100).status,'stale');
  const receipt:ActionReceipt={type:'actionReceipt',generation:first.generation,sequence:99999};sender.receive(receipt);
});

test('decoder rejects nested allocation bombs before decoding and accepts ordinary envelopes',()=>{
  for(const bytes of [new Uint8Array([...Array(100).fill(0x91),0]),new Uint8Array([0xdc,4,1]),new Uint8Array([0xde,1,1]),new Uint8Array([0x81,0xa1,97]),new Uint8Array([0xc7,0,0]),new Uint8Array([0xc1]),new Uint8Array([0,0])])assert.throws(()=>unpackMessage(bytes));
  // Individually legal containers whose cumulative declared capacity exceeds the budget.
  const wide=packMessage(Array.from({length:30},()=>Array(1000).fill(0)));assert.throws(()=>unpackMessage(wide));
  const envelope={epoch:1,from:'host',to:'guest',data:[null,true,false,-200,65536,1.5,'hello',new Uint8Array([1,2])]};assert.deepEqual(unpackMessage(packMessage(envelope)),envelope);
});

test('checkpoint and action identity validation agree, including history bounds and legal slot reuse',()=>{
  const host=fixture();const sender=new ActionSender(),receiver=new ActionReceiver();let sequence=host.journal.sequence;
  sender.publish(host.journal,meta(host),0,m=>{receiver.receive(m,0);return true;});const healthy=canonical(receiver.state);
  const identity={id:'new',name:'New',slot:2,color:'#wrong',avatarId:'robot'};
  assert.equal(validOperation([1,identity]),false);assert.equal(validOperation([1,{...identity,color:host.game.players.get('host')!.color,name:'x'.repeat(21)}]),false);
  for(let i=0;i<126;i++){
    host.journal.apply([1,{id:`history-${i}`,name:'History',slot:2,color:SLOT_COLORS[2]}]);host.journal.apply([2,`history-${i}`]);
    const operations=host.journal.since(sequence)!;assert.ok(operations.every(validOperation));
    assert.equal(receiver.receive({type:'actionBatch',generation:1,from:sequence,tick:0,operations,hash:replayHash(host.journal.state),meta:meta(host)},i).status,'accepted');sequence=host.journal.sequence;
  }
  assert.ok(decodeGameState(encodeGameState(host.game)));const atLimit=canonical(receiver.state);
  host.journal.apply([1,{id:'overflow',name:'Overflow',slot:2,color:SLOT_COLORS[2]}]);host.journal.apply([2,'overflow']);
  assert.equal(decodeGameState(encodeGameState(host.game)),undefined);
  assert.equal(receiver.receive({type:'actionBatch',generation:1,from:sequence,tick:0,operations:host.journal.since(sequence),hash:null,meta:meta(host)},200).status,'resync');assert.equal(canonical(receiver.state),atLimit);
  assert.notEqual(atLimit,healthy);
});

test('newer checkpoint generations cannot erase same-tick accepted lifecycle operations',()=>{
  const host=fixture(),sender=new ActionSender(),receiver=new ActionReceiver();const initial:ActionMessage[]=[];
  sender.publish(host.journal,meta(host),0,m=>{initial.push(m);const r=receiver.receive(m,0);if('receipt'in r&&r.receipt)sender.receive(r.receipt);return true;});
  // Receipt processing in a real transport is asynchronous, after queued send completes.
  for(const m of initial){const r=receiver.receive(m,1);if('receipt'in r&&r.receipt)sender.receive(r.receipt);}
  host.command('guest',{type:'avatar',avatarId:'robot'});const wire:ActionMessage[]=[];sender.publish(host.journal,meta(host),10,m=>{wire.push(m);return true;});for(const m of wire)assert.equal(receiver.receive(m,10).status,'accepted');
  const healthy=canonical(receiver.state);for(const m of initial)assert.equal(receiver.receive({...m,generation:2},20).status,'resync');assert.equal(canonical(receiver.state),healthy);
  receiver.release();assert.equal(receiver.state,undefined);for(const m of initial)assert.equal(receiver.receive(m,30).status,'stale');sender.requestBaseline();wire.length=0;sender.publish(host.journal,meta(host),40,m=>{wire.push(m);return true;});for(const m of wire)receiver.receive(m,40);assert.equal(canonical(receiver.state),healthy);
});

test('hash comparison survives backpressure precisely on twentieth ticks',()=>{
  const host=fixture(),sender=new ActionSender(),receiver=new ActionReceiver();const queue:ActionMessage[]=[];const hashes:number[]=[];
  const send=(m:ActionMessage)=>{if(m.type==='actionBatch'&&m.tick%20===0)return false;queue.push(m);if(m.type==='actionBatch'&&m.hash)hashes.push(m.tick);return true;};
  const deliver=()=>{for(const m of queue.splice(0)){const r=receiver.receive(m,host.game.tick*50);assert.ok(r.status==='accepted'||r.status==='waiting');if('receipt'in r&&r.receipt)sender.receive(r.receipt);}};
  sender.publish(host.journal,meta(host),0,send);deliver();for(let i=0;i<90;i++){host.advance();sender.publish(host.journal,meta(host),host.game.tick*50,send);deliver();}
  assert.deepEqual(hashes,[21,41,61,81]);assert.equal(replayHash(receiver.state!),replayHash(host.journal.state));
});

test('missing middle checkpoint chunk times out, throttled pump recovers with a fresh generation',()=>{
  const host=fixture();host.command('host',{type:'action',action:'start'});for(let i=0;i<100;i++)host.advance();
  // Legal retained trails force a multi-chunk baseline without relying on random long survival.
  for(const player of host.game.players.values())player.trail=Array.from({length:500},()=>({x1:100,y1:100,x2:101,y2:101,createdTick:1,expiresAtTick:500}));
  const sender=new ActionSender(),receiver=new ActionReceiver();let wire:ActionMessage[]=[];
  sender.publish(host.journal,meta(host),0,m=>{wire.push(m);return true;});assert.equal(wire.length,4);const first=wire[0]!;assert.equal(first.type,'actionChunk');if(first.type!=='actionChunk')return;assert.ok(first.total>4);
  for(const m of wire.filter((_,i)=>i!==1))assert.equal(receiver.receive(m,0).status,'waiting');
  wire=[];sender.publish(host.journal,meta(host),50,m=>{wire.push(m);return true;});for(const m of wire)receiver.receive(m,50);assert.equal(receiver.state,undefined);
  assert.equal(receiver.receive(first,5000).status,'resync');
  sender.publish(host.journal,meta(host),5001,()=>false); // bounded blocked send; pending transfer remains repairable
  for(let turn=0;turn<20&&!receiver.state;turn++){
    wire=[];sender.publish(host.journal,meta(host),5010+turn*50,m=>{wire.push(m);return true;});assert.ok(wire.length<=4);
    for(const m of [...wire].reverse()){const r=receiver.receive(m,5010+turn*50);if('receipt'in r&&r.receipt)sender.receive(r.receipt);}
  }
  assert.equal(replayHash(receiver.state!),replayHash(host.journal.state));assert.equal(receiver.receive(first,7000).status,'stale');
  for(let i=0;i<450;i++)host.advance();wire=[];sender.publish(host.journal,meta(host),30000,m=>{wire.push(m);return true;});assert.equal(wire[0]?.type,'actionChunk');
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
});


test('signed-zero local aim is normalized before MessagePack checkpoint and action capture',()=>{
  const host=fixture();host.command('host',{type:'action',action:'start'});for(let i=0;i<65;i++)host.advance();
  host.command('guest',{type:'input',scope:host.controlScope('guest')!,intendedTick:66,seq:0,left:false,right:false,bomb:true,bombAction:'press',aim:{x:-0,y:.5}});host.advance();
  assert.ok(Object.is(host.journal.state.held.get(1)!.aim![0],0));assert.equal(validOperation([0,67,[[1,1,0,[-0,.5],[]]]]),false);
  const sender=new ActionSender(),receiver=new ActionReceiver();let wire:ActionMessage[]=[];
  const transfer=(time:number)=>{wire=[];sender.publish(host.journal,meta(host),time,m=>{wire.push(unpackMessage(packMessage(m)) as ActionMessage);return true;});for(const m of wire){const r=receiver.receive(m,time);assert.equal(r.status,'accepted');if('receipt'in r&&r.receipt)sender.receive(r.receipt);}assert.equal(canonical(receiver.state),canonical(host.journal.state));};
  transfer(0);host.command('guest',{type:'input',scope:host.controlScope('guest')!,intendedTick:67,seq:1,left:false,right:false,bomb:false,bombAction:'release',aim:{x:.5,y:-0}});host.advance();transfer(50);
});
