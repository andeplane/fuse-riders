// Bytes per second of committed action replication per full-view recipient: five AI riders, 30 simulated seconds after 5 s warmup.
import { HostSession } from '../src/online/host-session.js';
import { ActionSender, type ActionMessage } from '../src/online/action-replication.js';
import { replayHash } from '../src/shared/action-log.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
const host=new HostSession('host',defaultRoomSettings(),{token:()=>'bench',captureActions:true});
host.command('host',{type:'join',name:'Host'});for(let i=0;i<4;i++)host.command('host',{type:'bot',action:'add'});host.command('host',{type:'action',action:'start'});
const sender=new ActionSender();let bytes=0,batches=0,baselineBytes=0;
const publish=()=>{let hashed:string|undefined;sender.publish(host.journal,host.settings,{ack:-1,paused:false,motion:host.appliedMotion('host')},()=>hashed??=replayHash(host.journal.state),(m:ActionMessage)=>{const size=new TextEncoder().encode(JSON.stringify(m)).byteLength;if(m.type==='baseline')baselineBytes+=size;else{bytes+=size;batches++;}return true;});};
for(let tick=0;tick<100;tick++){host.advance();publish();}
bytes=0;batches=0;
for(let tick=0;tick<600;tick++){host.advance();publish();}
console.log(JSON.stringify({date:new Date().toISOString(),method:'host plus four AI riders, JSON action batches with per-recipient motion ledger, 30 measured simulated seconds after 5 s warmup, application bytes excluding transport envelope',baselineBytes,batches,bytesPerSecond:Math.round(bytes/30),bytesPerBatch:Math.round(bytes/batches)},null,2));
