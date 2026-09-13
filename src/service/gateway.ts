import { RoomError, RoomStore, isGrantIdentity, type RoomRecord, type Member } from './room-store.js';
import { BUS_FRAME_TTL_MS, type RoomBus, type RoutedMessage } from './room-bus.js';
export interface GatewaySocket {send(raw:string):void;close(code:number,reason:string):void;bufferedAmount:number}
export interface GatewayDependencies {now:()=>number;id:()=>string;error:(kind:string,error:unknown)=>void}
interface Client {room:string;member:Member;socket:GatewaySocket;window:number;count:number;bytes:number;chain:Promise<void>;pending:number}
interface View {room:RoomRecord;stop:()=>void}
export type GatewayState='idle'|'starting'|'ready'|'draining'|'failed';
/** Local sockets only; Firestore owns membership and the addressed bus reaches other processes. */
export class RoomGateway {
  private clients=new Map<string,Client>();
  private views=new Map<string,View>();
  private lifecycle:Promise<void>=Promise.resolve();
  private stateValue:GatewayState='idle';
  private seen=new Map<string,number>();
  constructor(readonly id:string,readonly store:RoomStore,private bus:RoomBus,private deps:GatewayDependencies){}
  get state():GatewayState{return this.stateValue;}
  get connections():number{return this.clients.size;}
  private serial<T>(operation:()=>Promise<T>):Promise<T>{const result=this.lifecycle.then(operation,operation);this.lifecycle=result.then(()=>{},()=>{});return result;}
  async connect(code:string,token:string,socket:GatewaySocket):Promise<string>{
    return this.serial(async()=>{
      if(this.stateValue==='failed')await this.drain();
      if(this.stateValue!=='ready'){
        this.stateValue='starting';
        try{await this.bus.start(message=>this.deliver(message),error=>this.fail('bus',error));this.stateValue='ready';}
        catch(error){this.stateValue='failed';throw error;}
      }
      let admission:Awaited<ReturnType<RoomStore['admit']>>;
      try{admission=await this.store.admit(code,token,this.id);}catch(error){if(this.clients.size===0)await this.drain();throw error;}
      const {room,member}=admission,client:Client={room:code,member,socket,window:this.deps.now(),count:0,bytes:0,chain:Promise.resolve(),pending:0};
      this.clients.set(member.connectionId,client);
      this.send(client,{type:'welcome',protocol:2,id:member.id,hostId:room.hostId,connectionId:member.connectionId,peers:Object.values(room.members).filter(p=>p.connectionId!==member.connectionId&&p.expiresAt>this.deps.now()).map(p=>({id:p.id,connectionId:p.connectionId})),grant:room.grant});
      if(this.views.has(code))this.observe(code,room);
      else{
        const view:View={room,stop:()=>{}};this.views.set(code,view);
        view.stop=this.store.database.watch(code,current=>this.observe(code,current),error=>this.fail('metadata',error));
      }
      return member.connectionId;
    });
  }
  receive(connectionId:string,raw:string):Promise<void>{
    const client=this.clients.get(connectionId);if(!client)return Promise.resolve();
    const bytes=Buffer.byteLength(raw);
    if(bytes>32_000){client.socket.close(1009,'Message too large');return Promise.resolve();}
    const now=this.deps.now();if(now-client.window>=1000){client.window=now;client.count=0;client.bytes=0;}
    if(++client.count>(client.member.host?400:100)||(client.bytes+=bytes)>(client.member.host?2_000_000:256_000)||++client.pending>64){client.socket.close(1008,'Rate limit');void this.disconnect(connectionId);return Promise.resolve();}
    const result=client.chain.then(()=>this.handle(client,raw));
    client.chain=result.catch(error=>{this.deps.error('message',error);client.socket.close(error instanceof RoomError&&error.status===409?4001:4000,'Room connection interrupted');void this.disconnect(connectionId);}).finally(()=>{client.pending--;});
    return client.chain;
  }
  private async handle(client:Client,raw:string):Promise<void>{
    if(this.stateValue!=='ready'||!this.clients.has(client.member.connectionId))return;
    let data:unknown;try{data=JSON.parse(raw);}catch{return;}
    if(!data||typeof data!=='object'||Array.isArray(data))return;const m=data as Record<string,unknown>;
    const room=this.views.get(client.room)?.room;
    if(!room||room.members[client.member.id]?.connectionId!==client.member.connectionId||room.members[client.member.id].expiresAt<=this.deps.now())throw new RoomError(409,'Connection replaced');
    if(m.type==='time'){
      if(!((typeof m.id==='string'&&m.id.length>0&&m.id.length<=64)||(Number.isSafeInteger(m.id)&&Number(m.id)>=0))||typeof m.sentAt!=='number'||!Number.isFinite(m.sentAt)||m.sentAt<0)return;
      const current=await this.store.time(client.room,client.member,isGrantIdentity(m.renew)?m.renew:undefined);
      this.observe(client.room,current);
      this.send(client,{type:'time',id:m.id,sentAt:m.sentAt,serviceTime:this.deps.now(),grant:current.grant});return;
    }
    if(m.type==='relay'){this.send(client,{type:'error',error:'Direct WebRTC connection required; retry the connection'});return;}
    if(m.type!=='signal'||typeof m.to!=='string')return;
    if(!validSignal(m.data))return;
    let current=room,target=current.members[m.to];
    // Only a connection transition needs an authoritative metadata refresh; no database read per input.
    if(!target||(m.targetConnectionId!==undefined&&target.connectionId!==m.targetConnectionId)){current=await this.store.get(client.room);this.observe(client.room,current);target=current.members[m.to];}
    if(!target||target.expiresAt<=this.deps.now()||(m.targetConnectionId!==undefined&&m.targetConnectionId!==target.connectionId)||(!client.member.host&&!target.host)||current.members[client.member.id]?.connectionId!==client.member.connectionId)return;
    const routed:RoutedMessage={id:this.deps.id(),code:client.room,incarnation:current.incarnation,destination:target.gatewayId,from:client.member,to:target,expiresAt:this.deps.now()+BUS_FRAME_TTL_MS,wire:{type:'signal',from:client.member.id,connectionId:client.member.connectionId,data:m.data}};
    if(target.gatewayId===this.id)await this.deliver(routed);else await this.bus.publish(routed);
  }
  private observe(code:string,room:RoomRecord|undefined):void{
    const view=this.views.get(code);if(!view)return;
    if(room&&room.revision<=view.room.revision&&room.incarnation===view.room.incarnation)return;
    const previous=view.room;
    if(room)view.room=room;
    for(const client of this.clients.values())if(client.room===code){
      if(!room||room.incarnation!==previous.incarnation||room.members[client.member.id]?.connectionId!==client.member.connectionId){client.socket.close(4001,'Reconnected elsewhere');void this.disconnect(client.member.connectionId);continue;}
      for(const old of Object.values(previous.members))if(old.id!==client.member.id&&!room.members[old.id])this.send(client,{type:'peer',id:old.id,connectionId:old.connectionId,online:false});
      for(const next of Object.values(room.members))if(next.id!==client.member.id&&previous.members[next.id]?.connectionId!==next.connectionId)this.send(client,{type:'peer',id:next.id,connectionId:next.connectionId,online:true});
      if(JSON.stringify(previous.grant)!==JSON.stringify(room.grant))this.send(client,{type:'authority',grant:room.grant});
    }
  }
  async deliver(message:RoutedMessage):Promise<void>{
    if(this.stateValue!=='ready'||message.destination!==this.id||message.expiresAt<=this.deps.now())return;
    const client=this.clients.get(message.to.connectionId);if(!client||client.room!==message.code||client.member.id!==message.to.id)return;
    for(const [id,expires] of this.seen)if(expires<=this.deps.now())this.seen.delete(id);
    if(this.seen.has(message.id))return;
    if(this.seen.size>=4096){this.fail('bus-overflow',new Error('Deduplication capacity'));return;}
    let room=this.views.get(message.code)?.room;
    if(!room||room.incarnation!==message.incarnation)return;
    if(room.members[message.from.id]?.connectionId!==message.from.connectionId){room=await this.store.get(message.code);this.observe(message.code,room);}
    if(room.incarnation!==message.incarnation||room.members[message.from.id]?.connectionId!==message.from.connectionId||room.members[message.to.id]?.connectionId!==message.to.connectionId||(!message.from.host&&!message.to.host))return;
    this.seen.set(message.id,message.expiresAt);
    // observe above sends peer connection replacement before this source's first frame.
    this.send(client,message.wire);
  }
  async disconnect(connectionId:string):Promise<void>{
    return this.serial(async()=>{
      const client=this.clients.get(connectionId);if(!client)return;this.clients.delete(connectionId);
      try{await this.store.leave(client.room,client.member);}catch(error){this.deps.error('leave',error);}
      if(![...this.clients.values()].some(c=>c.room===client.room)){this.views.get(client.room)?.stop();this.views.delete(client.room);}
      if(this.clients.size===0)await this.drain();
    });
  }
  private send(client:Client,message:unknown):void{
    if(client.socket.bufferedAmount>256_000){client.socket.close(1013,'Slow connection — reconnect');void this.disconnect(client.member.connectionId);return;}
    try{client.socket.send(JSON.stringify(message));}catch(error){this.deps.error('socket-send',error);void this.disconnect(client.member.connectionId);}
  }
  private fail(kind:string,error:Error):void{this.stateValue='failed';this.deps.error(kind,error);for(const client of this.clients.values()){client.socket.close(1012,'Room relay restarting');void this.disconnect(client.member.connectionId);}}
  private async drain():Promise<void>{this.stateValue='draining';try{await this.bus.stop();}catch(error){this.deps.error('bus-stop',error);}this.seen.clear();this.stateValue='idle';}
  async stop():Promise<void>{for(const client of this.clients.values())client.socket.close(1001,'Service restarting');for(const id of [...this.clients.keys()])await this.disconnect(id);if(this.stateValue!=='idle')await this.drain();}
}


function validSignal(raw:unknown):boolean {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
  const signal=raw as Record<string,unknown>;
  if(Object.keys(signal).length!==1)return false;
  if(signal.description&&typeof signal.description==='object'){
    const d=signal.description as Record<string,unknown>;
    return ['offer','answer'].includes(String(d.type))&&typeof d.sdp==='string'&&d.sdp.length<=30_000&&Object.keys(d).every(k=>['type','sdp'].includes(k));
  }
  if(signal.candidate&&typeof signal.candidate==='object'){
    const c=signal.candidate as Record<string,unknown>;
    return typeof c.candidate==='string'&&c.candidate.length<=2048&&Object.keys(c).every(k=>['candidate','sdpMid','sdpMLineIndex','usernameFragment'].includes(k))&&(c.sdpMid==null||typeof c.sdpMid==='string')&&(c.sdpMLineIndex==null||(Number.isSafeInteger(c.sdpMLineIndex)&&Number(c.sdpMLineIndex)>=0))&&(c.usernameFragment==null||typeof c.usernameFragment==='string');
  }
  return false;
}
