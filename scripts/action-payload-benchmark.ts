import {writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {HostSession} from '../src/online/host-session.js';
import {WorldEncoder} from '../src/online/world-codec.js';
import {ActionSender,ActionReceiver,packMessage,unpackMessage,type ActionMessage} from '../src/online/action-replication.js';
import {defaultRoomSettings} from '../src/shared/room-settings.js';
const results=[];
for(const seed of [100,701,99]){
 let identity=0;const host=new HostSession('host',defaultRoomSettings(),{token:()=>`benchmark-${seed}-${++identity}`,captureActions:true});
 for(let i=0;i<5;i++)host.command('host',{type:'bot',action:'add'});host.command('host',{type:'action',action:'start'});
 const encoder=new WorldEncoder(1),sender=new ActionSender(),receiver=new ActionReceiver();let actionBytes=0,actionRecordsBytes=0,snapshotBytes=0,sequence=host.journal.sequence;
 for(let i=0;i<2400;i++){
   if(host.game.phase==='matchOver')host.command('host',{type:'action',action:'rematch'});host.advance();
   const meta={settings:host.settings,ack:host.acknowledgements()['bot:1']??-1,paused:false,motion:host.appliedMotion('bot:1')};
   // Same representative incarnation/connection identifier widths for both real envelope formats.
   const envelope=(data:unknown)=>({id:i,data,incarnation:'11111111-1111-1111-1111-111111111111',epoch:1,sender:'22222222-2222-2222-2222-222222222222',receiver:'33333333-3333-3333-3333-333333333333'});
   const frame=encoder.encode(host.snapshot(),host.game.matchId,host.game.round,host.game.tick);
   snapshotBytes+=Buffer.byteLength(JSON.stringify(envelope({type:'world',frame,settings:host.settings,ack:{'bot:1':meta.ack},paused:false,motion:meta.motion})));
   const wire:ActionMessage[]=[];sender.publish(host.journal,meta,i*50,m=>{actionBytes+=packMessage(envelope(m)).byteLength;wire.push(unpackMessage(packMessage(m)) as ActionMessage);return true;});
   for(const m of wire){const result=receiver.receive(m,i*50);if('receipt'in result&&result.receipt)sender.receive(result.receipt);if(result.status==='resync'||result.status==='failed')throw new Error(`Replay failed at ${host.game.tick}`);}
   actionRecordsBytes+=packMessage(host.journal.since(sequence)).byteLength;sequence=host.journal.sequence;
 }
 results.push({seed,seconds:120,ticks:2400,actionRecordsBytes,actionDownlinkBytes:actionBytes,snapshotDeltaDownlinkBytes:snapshotBytes,actionRecordsBytesPerSecond:actionRecordsBytes/120,actionDownlinkBytesPerSecond:actionBytes/120,snapshotDeltaDownlinkBytesPerSecond:snapshotBytes/120,reductionPercent:100*(1-actionBytes/snapshotBytes)});
}
await mkdir('artifacts',{recursive:true});const report={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).length>0,method:'Same five-bot host state,120seconds per seed,20Hz. Real WorldEncoder JSON delta vs real ActionSender MessagePack for one full-view player, including representative outer envelope, settings, prediction metadata and initial baselines. No loss/backpressure. Counts host downlink application bytes only; excludes upstream inputs, receipts, clock probes, signalling, authoritative effects and protocol/wire headers. Action records alone are a separate subset, not total traffic.',results};await writeFile('artifacts/action-payload-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(report);
