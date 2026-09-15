import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../src/online/host-session.js';
import { ActionReceiver, ActionSender, HASH_INTERVAL_TICKS, type ActionMessage, type ReceiveResult } from '../src/online/action-replication.js';
import { replayHash } from '../src/shared/action-log.js';
import { toSnapshot } from '../src/shared/game.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';

function fixture(){
  let id=0;const host=new HostSession('host',defaultRoomSettings(),{token:()=>`rep-${++id}`,captureActions:true});
  host.command('host',{type:'join',name:'Host'});host.command('guest',{type:'join',name:'Guest'});for(let i=0;i<2;i++)host.command('host',{type:'bot',action:'add'});
  const sender=new ActionSender(),receiver=new ActionReceiver();const wire:ActionMessage[]=[];let refuse:(m:ActionMessage)=>boolean=()=>false,deliver=true;
  const publish=(paused=false)=>{let hashed:string|undefined;sender.publish(host.journal,host.settings,{ack:host.acknowledgements().guest??-1,paused,motion:host.appliedMotion('guest')},()=>hashed??=replayHash(host.journal.state),m=>{if(refuse(m))return false;const copy=JSON.parse(JSON.stringify(m)) as ActionMessage;wire.push(copy);return true;});};
  const drain=()=>{const results:ReceiveResult[]=[];for(const m of wire.splice(0))if(deliver)results.push(receiver.receive(m));return results;};
  const view=()=>JSON.stringify(toSnapshot(receiver.state!.game));
  const truth=()=>JSON.stringify(toSnapshot(host.game));
  return {host,sender,receiver,wire,publish,drain,view,truth,refuse:(f:typeof refuse)=>{refuse=f;},deliver:(on:boolean)=>{deliver=on;}};
}
const isBaseline=(m:ActionMessage)=>m.type==='baseline';

test('a replica rebuilt from one baseline plus committed batches matches the host at every tick of a match with bots',()=>{
  const f=fixture();f.publish();assert.deepEqual(f.drain().map(r=>r.status),['accepted']);assert.equal(f.view(),f.truth());
  f.host.command('host',{type:'action',action:'start'});
  let baselines=0,hashes=0,fired=false;
  for(let tick=0;tick<600;tick++){
    if(tick===70)f.host.command('guest',{type:'input',scope:f.host.controlScope('guest')!,intendedTick:f.host.game.tick+1,seq:0,left:true,right:false,bomb:true,gesture:1});
    if(tick===90)f.host.command('guest',{type:'input',scope:f.host.controlScope('guest')!,intendedTick:f.host.game.tick+1,seq:1,left:false,right:false,bomb:false,gesture:1,bombAction:'release'});
    f.host.advance();f.publish();
    for(const m of f.wire){if(isBaseline(m))baselines++;else if(m.hash)hashes++;}
    for(const r of f.drain())assert.equal(r.status,'accepted',`tick ${tick}`);
    assert.equal(f.view(),f.truth(),`tick ${tick}`);
    if([...f.receiver.state!.game.bombs.values()].some(b=>b.ownerId==='guest'))fired=true;
  }
  assert.equal(baselines,0,'a healthy ordered stream never needs a second baseline');
  assert.ok(hashes>=600/HASH_INTERVAL_TICKS-1&&hashes<=600/HASH_INTERVAL_TICKS+1,`hash every ${HASH_INTERVAL_TICKS} ticks, got ${hashes}`);
  assert.ok(fired,'the guest shot replicated');
});
test('refused sends are retried from the same sequence without a baseline; a peer behind the journal gets one',()=>{
  const f=fixture();f.publish();f.drain();f.host.command('host',{type:'action',action:'start'});
  f.refuse(()=>true);for(let i=0;i<30;i++){f.host.advance();f.publish();}assert.equal(f.wire.length,0);
  f.refuse(()=>false);f.host.advance();f.publish();
  assert.equal(f.wire.length,1);assert.equal(f.wire[0]!.type,'actions');assert.equal((f.wire[0] as {ops:unknown[]}).ops.length,33,'start settings, start and 31 steps');
  assert.deepEqual(f.drain().map(r=>r.status),['accepted']);assert.equal(f.view(),f.truth());
  f.refuse(()=>true);for(let i=0;i<450;i++){f.host.advance();f.publish();}
  f.refuse(()=>false);f.host.advance();f.publish();
  assert.equal(f.wire[0]!.type,'baseline','history older than the journal forces a baseline');
  assert.deepEqual(f.drain().map(r=>r.status),['accepted']);assert.equal(f.view(),f.truth());
});
test('a lost batch makes the receiver ask for a baseline; a new sender repairs it; duplicates and old batches are stale',()=>{
  const f=fixture();f.publish();f.drain();f.host.command('host',{type:'action',action:'start'});
  f.host.advance();f.publish();const [first]=f.wire;f.drain();
  f.deliver(false);f.host.advance();f.publish();f.drain();f.deliver(true);
  f.host.advance();f.publish();assert.deepEqual(f.drain().map(r=>r.status),['resync']);
  assert.equal(f.receiver.receive(first).status,'stale','the last good state stays on screen until the baseline arrives');
  const fresh=new ActionSender();let hashed:string|undefined;
  fresh.publish(f.host.journal,f.host.settings,{ack:-1,paused:false},()=>hashed??=replayHash(f.host.journal.state),m=>{f.wire.push(JSON.parse(JSON.stringify(m)));return true;});
  assert.equal(f.wire[0]!.type,'baseline');assert.deepEqual(f.drain().map(r=>r.status),['accepted']);assert.equal(f.view(),f.truth());
  assert.equal(f.receiver.receive(first).status,'stale');assert.equal(f.view(),f.truth());
  f.host.advance();fresh.publish(f.host.journal,f.host.settings,{ack:-1,paused:false},()=>'',m=>{f.wire.push(JSON.parse(JSON.stringify(m)));return true;});
  const [batch]=f.wire;assert.deepEqual(f.drain().map(r=>r.status),['accepted']);assert.equal(f.receiver.receive(batch).status,'stale');assert.equal(f.view(),f.truth());
});
test('a diverged replica is caught by the periodic hash and asks for a baseline',()=>{
  const f=fixture();f.publish();f.drain();f.host.command('host',{type:'action',action:'start'});
  for(let i=0;i<5;i++){f.host.advance();f.publish();f.drain();}
  f.receiver.state!.game.players.get('guest')!.x+=1;
  let status='';for(let i=0;i<HASH_INTERVAL_TICKS+1&&status!=='resync';i++){f.host.advance();f.publish();status=f.drain()[0]!.status;}
  assert.equal(status,'resync');assert.equal(f.receiver.state,undefined);
});
test('malformed messages, wrong protocol and rolled-back baselines never replace healthy state',()=>{
  const f=fixture();f.publish();const [baseline]=f.wire as [ActionMessage];f.drain();const healthy=f.view();
  for(const bad of [null,{},{type:'actions'},{...baseline,protocol:99},{...baseline,hash:'0000000000000000'},{type:'actions',from:0,tick:0,ops:[[9]],hash:null,meta:{ack:-1,paused:false}},{type:'actions',from:0,tick:0,ops:[],hash:null,meta:{ack:'x',paused:false}}])assert.equal(f.receiver.receive(bad).status,'resync');
  assert.equal(f.view(),healthy);
  for(let i=0;i<3;i++){f.host.advance();f.publish();f.drain();}
  assert.equal(f.receiver.receive(baseline).status,'stale','an older baseline of the same match cannot roll the view back');assert.equal(f.view(),f.truth());
});
test('settings travel in the baseline and then only when they change; pause flags pass through',()=>{
  const f=fixture();f.publish();f.drain();
  f.host.advance();f.publish();assert.equal((f.wire[0] as {meta:{settings?:unknown}}).meta.settings,undefined);f.drain();
  f.host.command('host',{type:'settings',settings:{...defaultRoomSettings(),length:1}});f.host.advance();f.publish(true);
  const batch=f.wire[0] as unknown as {meta:{settings?:{length:number};paused:boolean}};assert.equal(batch.meta.settings?.length,1);assert.equal(batch.meta.paused,true);
  const [result]=f.drain();assert.equal(result!.status,'accepted');if(result!.status==='accepted')assert.equal(result!.settings.length,1);
  f.host.advance();f.publish();assert.equal((f.wire[0] as {meta:{settings?:unknown}}).meta.settings,undefined);
});
test('the movement ledger is sent only when it changes and the view carries it forward with the current tick',()=>{
  const f=fixture();f.publish();f.drain();f.host.command('host',{type:'action',action:'start'});
  let sent=0;const ticks:number[]=[];
  for(let i=0;i<30;i++){
    if(i===10)f.host.command('guest',{type:'input',scope:f.host.controlScope('guest')!,intendedTick:f.host.game.tick+1,seq:0,left:true,right:false,bomb:false});
    f.host.advance();f.publish();if((f.wire[0] as {meta:{motion?:unknown}}).meta.motion!==undefined)sent++;
    const [r]=f.drain();assert.equal(r!.status,'accepted');if(r!.status==='accepted'){assert.equal(r!.meta.motion?.tick,f.host.game.tick);ticks.push(r!.meta.motion!.appliedTick);}
  }
  assert.ok(sent<10,`ledger sent ${sent} times in 30 ticks`);assert.equal(ticks.at(-1),f.host.appliedMotion('guest')!.appliedTick);
  f.host.disconnect('guest');f.host.advance();f.publish();const [r]=f.drain();if(r!.status==='accepted')assert.equal(r!.meta.motion?.appliedSeq,-1,'a reset scope replaces the ledger');
});
