import test from 'node:test';
import assert from 'node:assert/strict';
import { SignalRoom, type RoomContext, type RoomDependencies, type RoomSocket, type RoomStorage } from '../worker/index.js';
import type { AuthorityGrant } from '../src/online/authority.js';

class MemoryStorage implements RoomStorage {
  private values=new Map<string,unknown>();
  private queue:Promise<unknown>=Promise.resolve();
  alarm=0;
  async get<T>(key:string):Promise<T|undefined>{return structuredClone(this.values.get(key)) as T|undefined;}
  async put<T>(key:string,value:T):Promise<void>{this.values.set(key,structuredClone(value));}
  async setAlarm(at:number):Promise<void>{this.alarm=at;}
  async deleteAll():Promise<void>{this.values.clear();}
  transaction<T>(callback:(storage:RoomStorage)=>Promise<T>):Promise<T>{
    const result=this.queue.then(async()=>{const before=structuredClone(this.values);try{return await callback(this);}catch(error){this.values=before;throw error;}});
    this.queue=result.catch(()=>undefined);return result;
  }
}
class Socket implements RoomSocket {
  private attachment:unknown;
  readonly messages:Record<string,unknown>[]=[];
  readonly closes:{code?:number;reason?:string}[]=[];
  send(raw:string):void{this.messages.push(JSON.parse(raw) as Record<string,unknown>);}
  close(code?:number,reason?:string):void{this.closes.push({code,reason});}
  serializeAttachment(value:unknown):void{this.attachment=structuredClone(value);}
  deserializeAttachment():unknown{return structuredClone(this.attachment);}
  last(type:string):Record<string,unknown>|undefined{return this.messages.filter(message=>message.type===type).at(-1);}
}
const hostToken='a'.repeat(64),guestToken='b'.repeat(64);
async function fixture(){
  let now=1000,nonce=0;
  const storage=new MemoryStorage(),sockets:Socket[]=[];
  const ctx:RoomContext={storage,getWebSockets:()=>sockets,acceptWebSocket:socket=>{assert.ok(socket instanceof Socket);sockets.push(socket);}};
  const env:ConstructorParameters<typeof SignalRoom>[1]={ROOMS:{idFromName:name=>name,get:()=>({fetch:async()=>Response.json({})})},ASSETS:{fetch:async()=>new Response('assets')}};
  const dependencies:RoomDependencies={now:()=>now,token:()=>`nonce-${++nonce}`,pair:()=>({client:new Socket(),server:new Socket()}),upgrade:()=>new Response('upgraded'),fetch:async()=>Response.json({})};
  const room=new SignalRoom(ctx,env,dependencies);
  const initialize=()=>room.fetch(new Request('https://game.test/initialize',{method:'POST',body:JSON.stringify({token:hostToken})}));
  assert.equal((await initialize()).status,200);
  const join=async(token:string)=>{const result=await room.fetch(new Request(`https://game.test/api/rooms/AAAAAAAAAA/ws?token=${token}`,{headers:{Upgrade:'websocket'}}));assert.equal(result.status,200);return sockets.at(-1)!;};
  const time=async(socket:Socket,renew?:AuthorityGrant)=>{await room.webSocketMessage(socket,JSON.stringify({type:'time',id:'clock-1',sentAt:12.5,...(renew?{renew}:{})}));return socket.last('time')!;};
  return{room,storage,sockets,join,time,initialize,rehydrate:()=>new SignalRoom(ctx,env,dependencies),advance:(ms:number)=>{now+=ms;},now:()=>now};
}
function grant(socket:Socket):AuthorityGrant{return socket.last('welcome')!.grant as AuthorityGrant;}

test('Worker persists an incarnation and allocates authority to the current host connection only',async()=>{
  const f=await fixture(),guest=await f.join(guestToken);
  assert.equal(guest.last('welcome')!.grant,undefined);
  const host=await f.join(hostToken),welcome=host.last('welcome')!,lease=grant(host);
  assert.equal(welcome.protocol,2);assert.equal(lease.holder,welcome.connectionId);assert.equal(lease.epoch,1);
  assert.equal(lease.incarnation,await f.storage.get('incarnation'));
  assert.equal(lease.validFrom,f.now());assert.equal(lease.expiresAt,f.now()+10000);
  assert.deepEqual(welcome.peers,[{id:guest.last('welcome')!.id,connectionId:guest.last('welcome')!.connectionId}]);
  assert.deepEqual(guest.last('authority')!.grant,lease);
  assert.equal((await f.initialize()).status,409);
});

test('Worker fences host replacement and delayed close without overlapping lease validity',async()=>{
  const f=await fixture(),old=await f.join(hostToken),guest=await f.join(guestToken),before=grant(old);
  f.advance(500);const replacement=await f.join(hostToken),next=grant(replacement);
  assert.equal(next.epoch,before.epoch+1);assert.notEqual(next.holder,before.holder);
  assert.equal(next.validFrom,before.expiresAt+250);assert.equal(next.expiresAt,next.validFrom+10000);
  assert.equal(old.closes.at(-1)!.code,4001);
  const count=guest.messages.length;await f.room.webSocketClose(old);assert.equal(guest.messages.length,count);
  await f.room.webSocketMessage(old,JSON.stringify({type:'time',id:1,sentAt:0,renew:before}));
  assert.equal(old.last('time'),undefined);assert.deepEqual(await f.storage.get('authority'),next);
  await f.time(replacement,next);assert.deepEqual(await f.storage.get('authority'),next,'reserved future grant cannot renew early');
});

test('Worker renews only an active exact grant from its current host, with authenticated clock echo',async()=>{
  const f=await fixture(),host=await f.join(hostToken),guest=await f.join(guestToken),initial=grant(host);
  f.advance(3000);
  await f.time(guest,initial);assert.deepEqual(await f.storage.get('authority'),initial);
  await f.time(host,{...initial,grantId:'wrong'});assert.deepEqual(await f.storage.get('authority'),initial);
  const response=await f.time(host,initial),renewed=response.grant as AuthorityGrant;
  assert.equal(response.id,'clock-1');assert.equal(response.sentAt,12.5);assert.equal(response.serviceTime,f.now());
  assert.equal(renewed.expiresAt,f.now()+10000);assert.equal(renewed.epoch,initial.epoch);assert.equal(renewed.grantId,initial.grantId);
  assert.deepEqual(guest.last('authority')!.grant,renewed);
  f.advance(10000);await f.time(host,renewed);assert.deepEqual(await f.storage.get('authority'),renewed,'expired authority cannot renew');
});

test('Worker routes only current authenticated endpoints and includes source connection scope',async()=>{
  const f=await fixture(),host=await f.join(hostToken),oldGuest=await f.join(guestToken),other=await f.join('c'.repeat(64));
  const freshGuest=await f.join(guestToken),hostId=host.last('welcome')!.id,guestId=freshGuest.last('welcome')!.id;
  const payload={type:'command',command:{type:'join',name:'Player'}};
  const send=(socket:Socket,to:unknown,targetConnectionId?:unknown)=>f.room.webSocketMessage(socket,JSON.stringify({type:'relay',to,targetConnectionId,data:payload}));
  await send(oldGuest,hostId);assert.equal(host.last('relay'),undefined);
  await send(other,guestId);assert.equal(freshGuest.last('relay'),undefined,'guest-to-guest routing denied');
  await send(host,guestId,oldGuest.last('welcome')!.connectionId);assert.equal(freshGuest.last('relay'),undefined,'old target scope denied');
  await send(freshGuest,hostId,host.last('welcome')!.connectionId);
  assert.deepEqual(host.last('relay'),{type:'relay',from:guestId,connectionId:freshGuest.last('welcome')!.connectionId,data:payload});
  await f.room.webSocketClose(oldGuest);
  await send(host,guestId,freshGuest.last('welcome')!.connectionId);assert.ok(freshGuest.last('relay'));
  await f.room.webSocketClose(freshGuest);
  assert.deepEqual(host.last('peer'),{type:'peer',id:guestId,connectionId:freshGuest.last('welcome')!.connectionId,online:false});
});

test('Worker serializes simultaneous host reservations and retains fencing through hibernation state',async()=>{
  const f=await fixture();await Promise.all([f.join(hostToken),f.join(hostToken)]);
  const welcomeGrants=f.sockets.map(socket=>grant(socket)).sort((a,b)=>a.epoch-b.epoch);
  assert.equal(welcomeGrants.length,2);assert.equal(welcomeGrants[0]!.epoch,1);assert.equal(welcomeGrants[1]!.epoch,2);
  assert.equal(welcomeGrants[1]!.validFrom,welcomeGrants[0]!.expiresAt+250);
  assert.deepEqual(await f.storage.get('authority'),welcomeGrants[1]);
  const restored=f.rehydrate(),current=f.sockets.find(socket=>socket.last('welcome')!.connectionId===welcomeGrants[1]!.holder)!;
  await restored.webSocketMessage(current,JSON.stringify({type:'time',id:'rehydrated',sentAt:0}));
  assert.deepEqual(current.last('time')!.grant,welcomeGrants[1]);
});

test('Worker rejects malformed clock requests and bounds six active memberships while permitting replacement',async()=>{
  const f=await fixture(),host=await f.join(hostToken);
  for(const raw of ['null','[]','{',JSON.stringify({type:'time',id:{},sentAt:0}),JSON.stringify({type:'time',id:1,sentAt:-1})])await f.room.webSocketMessage(host,raw);
  assert.equal(host.last('time'),undefined);
  for(const digit of ['b','c','d','e','f'])await f.join(digit.repeat(64));
  const denied=await f.room.fetch(new Request(`https://game.test/api/rooms/AAAAAAAAAA/ws?token=${'1'.repeat(64)}`,{headers:{Upgrade:'websocket'}}));
  assert.equal(denied.status,429);await f.join(guestToken);
  assert.equal(Object.keys((await f.storage.get<Record<string,string>>('connections'))!).length,6);
});

test('Worker reserves creator capacity when invitees arrive before the host',async()=>{
  const f=await fixture();
  for(const digit of ['b','c','d','e','f'])await f.join(digit.repeat(64));
  const denied=await f.room.fetch(new Request(`https://game.test/api/rooms/AAAAAAAAAA/ws?token=${'1'.repeat(64)}`,{headers:{Upgrade:'websocket'}}));
  assert.equal(denied.status,429);
  const host=await f.join(hostToken);assert.equal(grant(host).epoch,1);
  assert.equal(Object.keys((await f.storage.get<Record<string,string>>('connections'))!).length,6);
});
