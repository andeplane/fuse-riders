import { createHash } from 'node:crypto';
import { isAuthorityGrant, reserveAuthority, renewAuthority, type AuthorityGrant, type GrantIdentity } from '../online/authority.js';

export interface Member { id:string;connectionId:string;gatewayId:string;host:boolean;expiresAt:number }
export interface RoomRecord { version:2;code:string;incarnation:string;hostHash:string;hostId:string;expiresAt:number;revision:number;members:Record<string,Member>;grant?:AuthorityGrant }
export interface RoomDatabase {
  read(code:string):Promise<RoomRecord|undefined>;
  transact<T>(code:string,operation:(current:RoomRecord|undefined)=>{room?:RoomRecord;result:T}):Promise<T>;
  watch(code:string,listener:(room:RoomRecord|undefined)=>void,failed:(error:Error)=>void):()=>void;
  allowance(key:string,now:number,limit:number):Promise<boolean>;
}
export interface RoomStoreDependencies { now:()=>number;id:()=>string }
export const CONNECTION_TTL_MS=30_000;
export const ROOM_TTL_MS=24*60*60*1000;
export const digest=(token:string):string=>createHash('sha256').update(token).digest('hex');
export const peerId=(token:string):string=>digest(token).slice(0,24);
export const validToken=(token:string):boolean=>/^[a-f0-9]{64}$/.test(token);
export const validCode=(code:string):boolean=>/^[A-Z0-9]{10}$/.test(code);
export class RoomError extends Error { constructor(readonly status:number,message:string){super(message);} }
const clone=(room:RoomRecord):RoomRecord=>structuredClone(room);
function live(room:RoomRecord|undefined,now:number):RoomRecord { if(!room||room.expiresAt<=now)throw new RoomError(404,'Room expired or not found');return clone(room); }
function prune(room:RoomRecord,now:number):void {for(const [id,member] of Object.entries(room.members))if(member.expiresAt<=now)delete room.members[id];}
export class RoomStore {
  constructor(readonly database:RoomDatabase,private dependencies:RoomStoreDependencies){}
  async create(code:string,token:string):Promise<void>{
    if(!validCode(code)||!validToken(token))throw new RoomError(400,'Invalid room identity');
    const incarnation=this.dependencies.id();
    await this.database.transact(code,current=>{
      const now=this.dependencies.now();if(current&&current.expiresAt>now)throw new RoomError(409,'Room exists');
      return{room:{version:2,code,incarnation,hostHash:digest(token),hostId:peerId(token),expiresAt:now+ROOM_TTL_MS,revision:1,members:{}},result:undefined};
    });
  }
  async admit(code:string,token:string,gatewayId:string):Promise<{room:RoomRecord;member:Member}>{
    if(!validCode(code)||!validToken(token))throw new RoomError(401,'Invalid identity');
    const connectionId=this.dependencies.id(),grantId=this.dependencies.id(),id=peerId(token);
    return this.database.transact(code,current=>{
      const now=this.dependencies.now(),room=live(current,now);prune(room,now);
      const host=digest(token)===room.hostHash,capacity=host||room.members[room.hostId]?6:5;
      if(Object.keys(room.members).length>=capacity&&!room.members[id])throw new RoomError(429,'Room full (five players and TV)');
      const member:Member={id,connectionId,gatewayId,host,expiresAt:now+CONNECTION_TTL_MS};
      room.members[id]=member;room.revision++;room.expiresAt=now+ROOM_TTL_MS;
      if(host)room.grant=reserveAuthority(room.grant,room.incarnation,connectionId,grantId,now);
      return{room,result:{room:clone(room),member}};
    });
  }
  async time(code:string,member:Member,renew:GrantIdentity|undefined):Promise<RoomRecord>{
    return this.database.transact(code,current=>{
      const now=this.dependencies.now(),room=live(current,now);
      if(room.members[member.id]?.connectionId!==member.connectionId)throw new RoomError(409,'Reconnected elsewhere');
      const stored=room.members[member.id];if(stored.expiresAt<=now)throw new RoomError(410,'Connection lease expired');
      if(member.host&&renew&&room.grant){const updated=renewAuthority(room.grant,renew,now);if(updated)room.grant=updated;}
      stored.expiresAt=now+CONNECTION_TTL_MS;room.expiresAt=now+ROOM_TTL_MS;room.revision++;
      return{room,result:clone(room)};
    });
  }
  async leave(code:string,member:Member):Promise<void>{
    await this.database.transact(code,current=>{
      if(!current||current.members[member.id]?.connectionId!==member.connectionId)return{result:undefined};
      const room=clone(current);delete room.members[member.id];room.revision++;return{room,result:undefined};
    });
  }
  async get(code:string):Promise<RoomRecord>{return live(await this.database.read(code),this.dependencies.now());}
}
/** Runtime boundary: reject incompatible/corrupt stored metadata before authority decisions. */
export function parseRoomRecord(raw:unknown):RoomRecord|undefined {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
  const r=raw as Record<string,unknown>,members=r.members;
  if(r.version!==2||typeof r.code!=='string'||!validCode(r.code)||typeof r.incarnation!=='string'||r.incarnation.length>128||typeof r.hostHash!=='string'||!/^[a-f0-9]{64}$/.test(r.hostHash)||typeof r.hostId!=='string'||!/^[a-f0-9]{24}$/.test(r.hostId)||typeof r.expiresAt!=='number'||!Number.isFinite(r.expiresAt)||r.expiresAt<0||!Number.isSafeInteger(r.revision)||Number(r.revision)<1||!members||typeof members!=='object'||Array.isArray(members)||Object.keys(members).length>6||(r.grant!==undefined&&!isAuthorityGrant(r.grant)))return;
  for(const [id,value] of Object.entries(members)){
    if(!value||typeof value!=='object')return;const m=value as Record<string,unknown>;
    if(id!==m.id||!/^[a-f0-9]{24}$/.test(id)||!['connectionId','gatewayId'].every(key=>typeof m[key]==='string'&&m[key].length>0&&m[key].length<=128)||typeof m.host!=='boolean'||m.host!==(id===r.hostId)||typeof m.expiresAt!=='number'||!Number.isFinite(m.expiresAt)||m.expiresAt<0)return;
  }
  if(r.grant!==undefined&&(r.grant as AuthorityGrant).incarnation!==r.incarnation)return;
  return r as unknown as RoomRecord;
}


export function isGrantIdentity(raw:unknown):raw is GrantIdentity {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
  const v=raw as Record<string,unknown>;
  return ['incarnation','holder','grantId'].every(k=>typeof v[k]==='string'&&v[k].length>0&&v[k].length<=128)&&Number.isSafeInteger(v.epoch)&&Number(v.epoch)>0;
}
