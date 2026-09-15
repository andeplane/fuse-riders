// Wire bytes per second of committed action replication per full-view recipient on the fast channel
// (MessagePack tuples plus the 4-field fast envelope): five AI riders, 30 simulated seconds after 5 s warmup.
import { HostSession } from '../src/online/host-session.js';
import { ActionSender, type ActionMessage } from '../src/online/action-replication.js';
import { encodeFast, hashText, packFast } from '../src/online/wire.js';
import { replayHash } from '../src/shared/action-log.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
const host=new HostSession('host',defaultRoomSettings(),{token:()=>'bench',captureActions:true});
host.command('host',{type:'join',name:'Host'});for(let i=0;i<4;i++)host.command('host',{type:'bot',action:'add'});host.command('host',{type:'action',action:'start'});
const sender=new ActionSender();let id=0,bytes=0,batches=0,baselineBytes=0;
const publish=()=>{let hashed:string|undefined;sender.publish(host.journal,host.settings,{ack:-1,paused:false,motion:host.appliedMotion('host')},()=>hashed??=replayHash(host.journal.state),(m:ActionMessage)=>{if(m.type==='baseline')baselineBytes+=new TextEncoder().encode(JSON.stringify(m)).byteLength;else{bytes+=encodeFast({id:++id,epoch:1,incarnation:hashText('incarnation'),data:packFast(m)}).byteLength;batches++;}return true;});};
for(let tick=0;tick<100;tick++){host.advance();publish();}
bytes=0;batches=0;
for(let tick=0;tick<600;tick++){host.advance();publish();}
console.log(JSON.stringify({date:new Date().toISOString(),method:'host plus four AI riders, MessagePack action batches with fast envelope and change-only motion ledger, 30 measured simulated seconds after 5 s warmup, excludes DTLS/SCTP/IP headers',baselineBytes,batches,bytesPerSecond:Math.round(bytes/30),bytesPerBatch:Math.round(bytes/batches)},null,2));
