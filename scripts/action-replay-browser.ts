import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { HostSession } from '../src/online/host-session.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { replayHash, canonical, applyOperation, type ReplayState, type GameOperation } from '../src/shared/action-log.js';
import { packCheckpoint, packMessage, ActionReceiver } from '../src/online/action-replication.js';

await mkdir('artifacts',{recursive:true});
const fixture = (seed:number,weapons=false) => {
  let identity=0;const host=new HostSession('host',defaultRoomSettings(),{token:()=>`trace-${seed}-${++identity}`,captureActions:true});
  let initial=[...packCheckpoint(host.journal,{settings:host.settings,ack:-1,paused:false})];
  for(let i=0;i<5;i++)host.command('host',{type:'bot',action:'add'});
  host.command('host',{type:'action',action:'start'});
  if(weapons){
    for(let i=0;i<65;i++)host.advance();
    const players=[...host.game.players.values()];
    players[0]!.gunArmed=true;players[1]!.shellArmed=true;players[2]!.targetBombArmed=true;players[3]!.tripleShotArmed=true;players[4]!.fiveShotArmed=true;
    for(const player of players){player.invulnerableUntilTick=host.game.tick+200;player.bombReadyAtTick=0;}
    host.game.portalPair={id:'fixture-portal',gates:[{x:300,y:300,halfLength:45},{x:900,y:500,halfLength:45}],expiresAtTick:host.game.tick+600};
    players[0]!.x=300;players[0]!.y=300;
    initial=[...packCheckpoint(host.journal,{settings:host.settings,ack:-1,paused:false})];
  }
  const frames:{operations:GameOperation[];hash:string;tick:number;from:number}[]=[];
  let sequence=weapons?host.journal.sequence:0,actionBytes=0,fullBytes=0;const eventCounts:Record<string,number>={};
  for(let i=0;i<2400;i++){
    if(host.game.phase==='matchOver')host.command('host',{type:'action',action:'rematch'});
    for(const event of host.advance())eventCounts[event.type]=(eventCounts[event.type]??0)+1;
    const operations=host.journal.since(sequence)!;
    frames.push({operations,hash:replayHash(host.journal.state),tick:host.game.tick,from:sequence});sequence=host.journal.sequence;
    actionBytes+=packMessage(operations).byteLength;fullBytes+=Buffer.byteLength(JSON.stringify(host.snapshot()));
  }
  return {initial,frames,settings:host.settings,summary:{seed,weapons,ticks:frames.length,actionBytes,fullSnapshotBytes:fullBytes,eventCounts}};
};
const fixtures=[fixture(100),fixture(701),fixture(99,true)];
const bundle=await build({stdin:{contents:`import {ActionReceiver} from './src/online/action-replication.ts'; import {canonical} from './src/shared/action-log.ts';
globalThis.runReplay = (fixture) => {
 const receiver=new ActionReceiver();const begin=performance.now();
 const baseline=receiver.receive({type:'actionChunk',generation:1,index:0,total:1,bytes:new Uint8Array(fixture.initial)},0);
 if(baseline.status!=='accepted')return {error:'baseline '+baseline.status};
 for(const [index,frame] of fixture.frames.entries()){
   const result=receiver.receive({type:'actionBatch',generation:1,...frame,meta:{settings:fixture.settings,ack:-1,paused:false}},index*50);
   if(result.status!=='accepted'){receiver.receive({type:'actionBatch',generation:1,...frame,hash:null,meta:{settings:fixture.settings,ack:-1,paused:false}},index*50);return {error:result.status,index,tick:frame.tick,hashMismatches:receiver.hashMismatches,actual:canonical(receiver.state)};}
 }
 return {ticks:fixture.frames.length,elapsedMs:performance.now()-begin,hashMismatches:receiver.hashMismatches};
};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
const script=bundle.outputFiles[0]!.text;
const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><title>Offline action replay verification</title>');});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();assert.ok(address&&typeof address!=='string');
const results:Record<string,unknown[]>={};
try{
  for(const [name,engine] of [['chromium',chromium],['webkit',webkit]] as const){
    const browser=await engine.launch({headless:true});
    try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${address.port}`);await page.addScriptTag({content:script});results[name]=[];
      for(const trace of fixtures){const result:Record<string,unknown>=await page.evaluate(data=>{const run=(globalThis as unknown as {runReplay:(v:unknown)=>{error?:string}}).runReplay;return run(data);},trace);if(result.error){const receiver=new ActionReceiver();receiver.receive({type:'actionChunk',generation:1,index:0,total:1,bytes:new Uint8Array(trace.initial)},0);const expected:ReplayState=structuredClone(receiver.state!);for(const frame of trace.frames.slice(0,Number(result.index)+1))for(const op of frame.operations)applyOperation(expected,op);const differences:unknown[]=[];const compare=(a:unknown,b:unknown,path:string):void=>{if(a&&b&&typeof a==='object'&&typeof b==='object'){const aa=a as Record<string,unknown>,bb=b as Record<string,unknown>;for(const k of new Set([...Object.keys(aa),...Object.keys(bb)]))compare(aa[k],bb[k],path+'.'+k);}else if(a!==b&&differences.length<8)differences.push({path,expected:a,actual:b});};compare(JSON.parse(canonical(expected)),JSON.parse(String(result.actual)),'');result.differences=differences;delete result.actual;}results[name].push(result);console.log(name,trace.summary.seed,result);}
    }finally{await browser.close();}
  }
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
const report={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).length>0,method:'Three host-recorded five-bot 2400-tick traces (one explicit weapon/portal checkpoint), actual MessagePack checkpoint and action receiver, canonical comparison at every committed transaction. Desktop headless engines; not physical phones.',fixtures:fixtures.map(v=>v.summary),results};
await writeFile('artifacts/action-replay-browser.json',JSON.stringify(report,null,2)+'\n');
assert.ok(Object.values(results).flat().every(v=>!(v as {error?:string}).error),'Cross-engine replay must match every committed transaction');
