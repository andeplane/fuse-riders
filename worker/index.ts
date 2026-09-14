import { generateRoomCode, reserveRoomCode, ROOM_RECONNECT_GRACE_MS } from '../src/shared/room-code.js';
import { reserveAuthority, renewAuthority, type AuthorityGrant, type GrantIdentity } from '../src/online/authority.js';
import { DEFAULT_ICE_SERVERS } from '../src/online/ice-config.js';
import { validSignal } from '../src/service/signal.js';

export interface RoomSocket {
  send(data:string):void;
  close(code?:number,reason?:string):void;
  serializeAttachment(value:unknown):void;
  deserializeAttachment():unknown;
}
export interface RoomStorage {
  get<T>(key:string):Promise<T|undefined>;
  put<T>(key:string,value:T):Promise<void>;
  setAlarm(at:number):Promise<void>;
  deleteAll():Promise<void>;
  delete(key:string):Promise<boolean>;
  transaction<T>(callback:(storage:RoomStorage)=>Promise<T>):Promise<T>;
}
export interface RoomContext { storage:RoomStorage;getWebSockets():RoomSocket[];acceptWebSocket(socket:RoomSocket):void }
interface RoomStub { fetch(request:Request):Promise<Response> }
interface Env {
  ROOMS:{idFromName(name:string):unknown;get(id:unknown):RoomStub};
  ASSETS:{fetch(request:Request):Promise<Response>};
  TURN_KEY_ID?:string;TURN_API_TOKEN?:string;
}
interface Identity { id:string;connectionId:string;host:boolean;window:number;count:number;bytes:number }
interface Membership { [id:string]:string }
export interface RoomDependencies {
  now:()=>number;
  token:()=>string;
  pair:()=>{client:RoomSocket;server:RoomSocket};
  upgrade:(client:RoomSocket)=>Response;
  fetch:typeof fetch;
}
const defaults:RoomDependencies={
  now:()=>Date.now(),token:()=>crypto.randomUUID(),
  pair:()=>{const Pair=(globalThis as unknown as {WebSocketPair:new()=>{0:RoomSocket;1:RoomSocket}}).WebSocketPair;const pair=new Pair();return{client:pair[0],server:pair[1]};},
  upgrade:client=>new Response(null,{status:101,webSocket:client} as ResponseInit),fetch:(...args)=>fetch(...args),
};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const secret=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
async function peerId(token:string):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].slice(0,12).map(n=>n.toString(16).padStart(2,'0')).join('');}
function identity(socket:RoomSocket):Identity|undefined {
  const value=socket.deserializeAttachment();
  if(!value||typeof value!=='object')return;
  const candidate=value as Identity;
  if(typeof candidate.id==='string'&&typeof candidate.connectionId==='string'&&typeof candidate.host==='boolean')return candidate;
}
function grantIdentity(value:unknown):value is GrantIdentity {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const item=value as Record<string,unknown>;
  return ['incarnation','holder','grantId'].every(key=>typeof item[key]==='string'&&item[key].length>0&&item[key].length<=128)
    &&typeof item.epoch==='number'&&Number.isSafeInteger(item.epoch)&&item.epoch>0;
}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Origin denied'},403);
    if(url.pathname==='/api/rooms'&&request.method==='POST') {
      const rate=env.ROOMS.get(env.ROOMS.idFromName(`rate:${await peerId(request.headers.get('CF-Connecting-IP')??'local')}`));
      const allowance=await rate.fetch(new Request(`${url.origin}/create-limit`,{method:'POST'}));if(!allowance.ok)return allowance;
      const token=secret();
      try{const code=await reserveRoomCode(async candidate=>{const room=env.ROOMS.get(env.ROOMS.idFromName(candidate));const result=await room.fetch(new Request(`${url.origin}/initialize`,{method:'POST',body:JSON.stringify({token})}));if(result.status===409)return false;if(!result.ok)throw new Error('Room initialization failed');return true;},generateRoomCode);
      return code?json({code,token},201):json({error:'Room codes busy; please try again'},503);}catch{return json({error:'Room service unavailable'},503);}
    }
    const match=url.pathname.match(/^\/api\/rooms\/([A-Z]{2}[0-9]{2}|[A-Z0-9]{10})\/(ws|ice|end)$/);
    if(match)return env.ROOMS.get(env.ROOMS.idFromName(match[1]!)).fetch(request);
    if(url.pathname.startsWith('/api/'))return json({error:'Not found'},404);
    return env.ASSETS.fetch(request);
  }
};
export class SignalRoom {
  constructor(private ctx:RoomContext,private env:Env,private dependencies:RoomDependencies=defaults){}
  async fetch(request:Request):Promise<Response>{
    const url=new URL(request.url),now=this.dependencies.now();
    if(url.pathname==='/create-limit'){
      const count=await this.ctx.storage.transaction(async storage=>{
        const hour=Math.floor(now/3600000),previous=await storage.get<{hour:number;count:number}>('rate');
        const count=previous?.hour===hour?previous.count+1:1;
        if(count<=30){await storage.put('rate',{hour,count});await storage.setAlarm(now+3600000);}return count;
      });
      return count>30?json({error:'Room creation limit reached; try later'},429):json({ok:true});
    }
    if(url.pathname==='/initialize'){
      let body:unknown;try{body=await request.json();}catch{return json({error:'Invalid initialization'},400);}
      const token=(body as {token?:unknown}|null)?.token;
      if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return json({error:'Invalid identity'},400);
      const incarnation=this.dependencies.token();
      const initialized=await this.ctx.storage.transaction(async storage=>{
        const deadline=await storage.get<number>('expiresAt');if(await storage.get('host')&&(deadline===undefined||deadline>now))return false;
        await storage.delete('authority');
        await storage.put('host',token);await storage.put('incarnation',incarnation);await storage.put('connections',{});
        await storage.put('expiresAt',now+ROOM_RECONNECT_GRACE_MS);await storage.setAlarm(now+ROOM_RECONNECT_GRACE_MS);return true;
      });
      return initialized?json({ok:true}):json({error:'Room exists'},409);
    }
    const host=await this.ctx.storage.get<string>('host');if(!host)return this.expiredResponse(request);
    if(url.pathname.endsWith('/end')&&request.method==='POST'){
      const capability=request.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
      const ended=await this.ctx.storage.transaction(async storage=>{if(await storage.get<string>('host')!==capability)return false;await storage.put('expiresAt',now);await storage.setAlarm(now);return true;});
      if(!ended)return json({error:'Only the host can end this room'},403);for(const socket of this.ctx.getWebSockets())socket.close(4004,'Room ended');return json({ok:true});
    }
    if(await this.expired(now))return this.expiredResponse(request);
    const token=url.searchParams.get('token')??'';
    if(!/^[a-f0-9]{64}$/.test(token))return json({error:'Invalid identity'},401);
    const id=await peerId(token);
    if(url.pathname.endsWith('/ice')){
      const members=await this.ctx.storage.get<Membership>('connections')??{};
      if(!this.currentSockets(members).some(ws=>identity(ws)?.id===id))return json({error:'Join the room first'},403);
      if(!this.env.TURN_KEY_ID||!this.env.TURN_API_TOKEN)return json({iceServers:DEFAULT_ICE_SERVERS,relayConfigured:false});
      const response=await this.dependencies.fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${this.env.TURN_KEY_ID}/credentials/generate-ice-servers`,{method:'POST',headers:{Authorization:`Bearer ${this.env.TURN_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({ttl:3600})});
      if(!response.ok)return json({iceServers:DEFAULT_ICE_SERVERS,relayConfigured:false});
      const body=await response.json() as {iceServers:unknown};return json({iceServers:body.iceServers,relayConfigured:true});
    }
    if(request.headers.get('Upgrade')!=='websocket')return json({error:'WebSocket required'},426);
    const connectionId=this.dependencies.token(),hostId=await peerId(host),newIncarnation=this.dependencies.token(),grantId=this.dependencies.token();
    const admission=await this.ctx.storage.transaction(async storage=>{
      if((await storage.get<number>('expiresAt')??0)<=this.dependencies.now()||await storage.get<string>('host')!==host)return;
      const members=await storage.get<Membership>('connections')??{};
      // A room created on a phone must retain its creator's connection slot
      // even when invitations are opened before the creator connects.
      const capacity=token===host||members[hostId]?6:5;
      if(Object.keys(members).length>=capacity&&!members[id])return;
      // Existing v1 rooms require a fresh incarnation on their first v2 connection.
      const incarnation=await storage.get<string>('incarnation')??newIncarnation;
      await storage.put('incarnation',incarnation);
      let grant=await storage.get<AuthorityGrant>('authority');
      if(token===host){grant=reserveAuthority(grant,incarnation,connectionId,grantId,this.dependencies.now());await storage.put('authority',grant);await storage.put('expiresAt',this.dependencies.now()+ROOM_RECONNECT_GRACE_MS);await storage.setAlarm(this.dependencies.now()+ROOM_RECONNECT_GRACE_MS);}
      members[id]=connectionId;await storage.put('connections',members);return{members,grant};
    });
    if(!admission)return json({error:'Room connection limit (5 players and TV)'},429);
    for(const ws of this.ctx.getWebSockets())if(identity(ws)?.id===id)ws.close(4001,'Reconnected elsewhere');
    const {client,server}=this.dependencies.pair();
    this.ctx.acceptWebSocket(server);server.serializeAttachment({id,connectionId,host:token===host,window:now,count:0,bytes:0} satisfies Identity);
    const peers=this.currentSockets(admission.members).filter(ws=>ws!==server).map(ws=>{const peer=identity(ws)!;return{id:peer.id,connectionId:peer.connectionId};});
    server.send(JSON.stringify({type:'welcome',protocol:2,id,hostId,connectionId,peers,grant:admission.grant}));
    this.broadcast({type:'peer',id,connectionId,online:true},admission.members,server);
    if(token===host)this.broadcast({type:'authority',grant:admission.grant},admission.members);
    return this.dependencies.upgrade(client);
  }
  async webSocketMessage(ws:RoomSocket,raw:string|ArrayBuffer):Promise<void> {
    if(typeof raw!=='string'||raw.length>200000){ws.close(1009,'Too large');return;}
    const sender=identity(ws);if(!sender){ws.close(4001,'Identity expired');return;}
    const members=await this.ctx.storage.get<Membership>('connections')??{};
    if(members[sender.id]!==sender.connectionId){ws.close(4001,'Reconnected elsewhere');return;}
    const now=this.dependencies.now();if(await this.expired(now)){ws.close(4004,'Room expired');return;}
    if(now-sender.window>=1000){sender.window=now;sender.count=0;sender.bytes=0;}
    sender.count++;sender.bytes+=new TextEncoder().encode(raw).byteLength;
    // Signalling is bounded per member; ordinary game actions never use this socket.
    if(sender.count>(sender.host?400:100)||sender.bytes>(sender.host?2_000_000:256_000)){ws.close(1008,'Rate limit');return;}ws.serializeAttachment(sender);
    let message:Record<string,unknown>;try{const decoded:unknown=JSON.parse(raw);if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))return;message=decoded as Record<string,unknown>;}catch{return;}
    if(message.type==='time'){
      if(!((typeof message.id==='string'&&message.id.length>0&&message.id.length<=64)||(typeof message.id==='number'&&Number.isSafeInteger(message.id)&&message.id>=0))||typeof message.sentAt!=='number'||!Number.isFinite(message.sentAt)||message.sentAt<0)return;
      const result=await this.ctx.storage.transaction(async storage=>{
        const currentMembers=await storage.get<Membership>('connections')??{};
        if(currentMembers[sender.id]!==sender.connectionId||(await storage.get<number>('expiresAt')??0)<=this.dependencies.now())return;
        if(sender.host){await storage.put('expiresAt',this.dependencies.now()+ROOM_RECONNECT_GRACE_MS);await storage.setAlarm(this.dependencies.now()+ROOM_RECONNECT_GRACE_MS);}
        let grant=await storage.get<AuthorityGrant>('authority'),renewed=false;
        if(sender.host&&grant&&grant.holder===sender.connectionId&&grantIdentity(message.renew)){
          const update=renewAuthority(grant,message.renew,this.dependencies.now());
          if(update){grant=update;renewed=true;await storage.put('authority',grant);}
        }
        return{grant,renewed,members:currentMembers};
      });
      if(!result)return;
      ws.send(JSON.stringify({type:'time',id:message.id,sentAt:message.sentAt,serviceTime:this.dependencies.now(),grant:result.grant}));
      if(result.renewed)this.broadcast({type:'authority',grant:result.grant},result.members);
      return;
    }
    // Public gameplay is direct WebRTC only; WSS is coordination/signalling.
    if(message.type!=='signal'||typeof message.to!=='string'||!validSignal(message.data))return;
    const target=this.currentSockets(members).find(peer=>identity(peer)?.id===message.to);if(!target)return;
    const targetIdentity=identity(target)!;
    if(message.targetConnectionId!==undefined&&message.targetConnectionId!==targetIdentity.connectionId)return;
    // ADR041 permits same-room guest pairs to establish direct WebRTC links.
    try{target.send(JSON.stringify({type:message.type,from:sender.id,connectionId:sender.connectionId,data:message.data}));}catch{}
  }
  async webSocketClose(ws:RoomSocket):Promise<void> {
    const departed=identity(ws);if(!departed)return;
    const members=await this.ctx.storage.transaction(async storage=>{
      const members=await storage.get<Membership>('connections')??{};
      if(members[departed.id]!==departed.connectionId)return;
      delete members[departed.id];await storage.put('connections',members);const deadline=await storage.get<number>('expiresAt');if(departed.host&&deadline!==undefined&&deadline>this.dependencies.now()){await storage.put('expiresAt',this.dependencies.now()+ROOM_RECONNECT_GRACE_MS);await storage.setAlarm(this.dependencies.now()+ROOM_RECONNECT_GRACE_MS);}return members;
    });
    if(members)this.broadcast({type:'peer',id:departed.id,connectionId:departed.connectionId,online:false},members,ws);
  }
  async webSocketError(ws:RoomSocket):Promise<void>{await this.webSocketClose(ws);}
  private currentSockets(members:Membership):RoomSocket[]{return this.ctx.getWebSockets().filter(ws=>{const peer=identity(ws);return !!peer&&members[peer.id]===peer.connectionId;});}
  private broadcast(message:unknown,members:Membership,except?:RoomSocket){for(const ws of this.currentSockets(members))if(ws!==except)try{ws.send(JSON.stringify(message));}catch{}}
  private expiredResponse(request:Request):Response{
    if(request.headers.get('Upgrade')!=='websocket')return json({error:'Room expired or not found'},404);
    const {client,server}=this.dependencies.pair();this.ctx.acceptWebSocket(server);server.close(4004,'Room ended or expired');return this.dependencies.upgrade(client);
  }
  private async expired(now:number):Promise<boolean>{
    const deadline=await this.ctx.storage.get<number>('expiresAt');
    if(deadline!==undefined)return deadline<=now;
    // Legacy rooms acquire a bounded grace period on their first upgraded request.
    await this.ctx.storage.put('expiresAt',now+ROOM_RECONNECT_GRACE_MS);await this.ctx.storage.setAlarm(now+ROOM_RECONNECT_GRACE_MS);return false;
  }
  async alarm():Promise<void>{
    const deadline=await this.ctx.storage.get<number>('expiresAt');
    if(deadline!==undefined&&deadline>this.dependencies.now()){await this.ctx.storage.setAlarm(deadline);return;}
    for(const socket of this.ctx.getWebSockets())socket.close(4004,'Room expired');await this.ctx.storage.deleteAll();
  }
}
