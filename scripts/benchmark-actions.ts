// Fast-channel bytes per second one full view receives from the host: five riders (host plus four AI), 30 simulated seconds after a 5 s warmup.
import { HostSession } from '../src/online/host-session.js';
import { encodeFast, hashText, packFast } from '../src/online/wire.js';
import { HASH_INTERVAL_TICKS } from '../src/online/runtime.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
const host=new HostSession('host',defaultRoomSettings(),{token:()=>'bench'});
host.command('host',{type:'join',name:'Host'});for(let i=0;i<4;i++)host.command('host',{type:'bot',action:'add'});host.command('host',{type:'action',action:'start'});
let id=0,bytes=0,packets=0;
const publish=()=>{const tick=host.tick;const streams=[...host.senders].map(([member,sender])=>({member:hashText(member),lastSeq:sender.lastSeq,entries:sender.next()}));bytes+=encodeFast({id:++id,epoch:1,incarnation:hashText('incarnation'),data:packFast({type:'streams',tick,sentAt:tick*50,echoSentAt:tick*50-40,hash:tick%HASH_INTERVAL_TICKS===0?host.hash():null,streams})}).byteLength;packets++;};
for(let tick=0;tick<100;tick++){host.advance();publish();}
bytes=0;packets=0;
for(let tick=0;tick<600;tick++){host.advance();publish();}
console.log(JSON.stringify({date:new Date().toISOString(),method:'host plus four AI riders; one MessagePack stream packet per tick to one guest, fast envelope included, DTLS/SCTP/IP headers excluded; 30 measured simulated seconds after a 5 s warmup',packets,bytesPerSecond:Math.round(bytes/30),bytesPerPacket:Math.round(bytes/packets)},null,2));
