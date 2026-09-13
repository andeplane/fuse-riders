import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomStore, RoomError, peerId, parseRoomRecord, type RoomDatabase, type RoomRecord } from '../src/service/room-store.js';
import { RoomGateway, type GatewaySocket } from '../src/service/gateway.js';
import { parseRoutedMessage, type RoomBus, type RoutedMessage } from '../src/service/room-bus.js';

class Database implements RoomDatabase {
  rooms=new Map<string,RoomRecord>();
  listeners=new Map<string,Set<(room:RoomRecord|undefined)=>void>>();
  queued:(()=>void)[]=[];delay=false;retry=false;
  private chain:Promise<void>=Promise.resolve();
  async read(code:string){return structuredClone(this.rooms.get(code));}
  async transact<T>(code:string,operation:(current:RoomRecord|undefined)=>{room?:RoomRecord;result:T}):Promise<T>{
    const work=this.chain.then(()=>{
      if(this.retry)operation(structuredClone(this.rooms.get(code)));
      const next=operation(structuredClone(this.rooms.get(code)));
      if(next.room){this.rooms.set(code,structuredClone(next.room));for(const listener of this.listeners.get(code)??[]){const room=structuredClone(next.room);const notify=()=>listener(room);if(this.delay)this.queued.push(notify);else notify();}}
      return next.result;
    });this.chain=work.then(()=>{},()=>{});return work;
  }
  watch(code:string,listener:(room:RoomRecord|undefined)=>void){const set=this.listeners.get(code)??new Set();set.add(listener);this.listeners.set(code,set);return()=>{set.delete(listener);};}
  async allowance(){return true;}
  flush(){for(const notify of this.queued.splice(0))notify();}
}
class Bus implements RoomBus {
  receive?:(message:RoutedMessage)=>Promise<void>;failed?:(error:Error)=>void;started=0;stopped=0;published:RoutedMessage[]=[];delayed=false;queued:RoutedMessage[]=[];
  constructor(private network:Map<string,Bus>,readonly id:string){network.set(id,this);}
  async start(receive:(message:RoutedMessage)=>Promise<void>,failed:(error:Error)=>void){this.receive=receive;this.failed=failed;this.started++;}
  async publish(message:RoutedMessage){this.published.push(structuredClone(message));if(this.delayed)this.queued.push(message);else await this.network.get(message.destination)?.receive?.(structuredClone(message));}
  async stop(){this.receive=undefined;this.stopped++;}
  async flush(){for(const message of this.queued.splice(0))await this.network.get(message.destination)?.receive?.(structuredClone(message));}
}
class Socket implements GatewaySocket {
  bufferedAmount=0;messages:Record<string,unknown>[]=[];closes:{code:number;reason:string}[]=[];
  send(raw:string){this.messages.push(JSON.parse(raw));}
  close(code:number,reason:string){this.closes.push({code,reason});}
  frames(type:string){return this.messages.filter(m=>m.type===type);}
}
const HOST='a'.repeat(64),GUEST='b'.repeat(64),CODE='AABBCCDDEE';
function fixture(){
  let now=1000,n=0;const database=new Database(),network=new Map<string,Bus>(),aBus=new Bus(network,'a'),bBus=new Bus(network,'b');
  const deps={now:()=>now,id:()=>`id-${++n}`,error:()=>{}};const store=new RoomStore(database,deps);
  const a=new RoomGateway('a',store,aBus,deps),b=new RoomGateway('b',store,bBus,deps);
  return{database,store,a,b,aBus,bBus,advance:(ms:number)=>{now+=ms;}};
}
async function joined(f:ReturnType<typeof fixture>){await f.store.create(CODE,HOST);const host=new Socket(),guest=new Socket();const hostConnection=await f.a.connect(CODE,HOST,host),guestConnection=await f.b.connect(CODE,GUEST,guest);return{host,guest,hostConnection,guestConnection};}
const signal=(to:string,target:string,sdp='v=0')=>JSON.stringify({type:'signal',to,targetConnectionId:target,data:{description:{type:'offer',sdp}}});

test('service transaction retries keep one logical connection/grant and fenced replacement',async()=>{
  const f=fixture();f.database.retry=true;await f.store.create(CODE,HOST);
  const first=await f.store.admit(CODE,HOST,'a'),second=await f.store.admit(CODE,HOST,'b');
  assert.equal(first.room.grant?.epoch,1);assert.equal(second.room.grant?.epoch,2);
  assert.equal(second.room.grant?.validFrom,first.room.grant!.expiresAt+250);
  await f.store.leave(CODE,first.member);
  assert.equal((await f.store.get(CODE)).members[first.member.id].connectionId,second.member.connectionId);
  await assert.rejects(f.store.time(CODE,first.member,first.room.grant),/Reconnected/);
});

test('service reserves creator slot and atomically bounds concurrent admission',async()=>{
  const f=fixture();await f.store.create(CODE,HOST);
  const attempts=await Promise.allSettled(Array.from({length:7},(_,i)=>f.store.admit(CODE,(i+1).toString(16).repeat(64),'b')));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,5);
  const host=await f.store.admit(CODE,HOST,'a');assert.equal(Object.keys(host.room.members).length,6);
  f.advance(30_001);const next=await f.store.admit(CODE,GUEST,'b');assert.equal(Object.keys(next.room.members).length,1);
});

test('two gateways advertise actual remote members and route only signalling',async()=>{
  const f=fixture(),{host,guest,hostConnection,guestConnection}=await joined(f);
  assert.equal(guest.frames('welcome')[0].hostId,peerId(HOST));assert.equal(host.frames('peer').at(-1)?.connectionId,guestConnection);
  await f.a.receive(hostConnection,signal(peerId(GUEST),guestConnection));
  assert.equal(f.aBus.published.length,1);assert.equal(guest.frames('signal').length,1);assert.equal(guest.frames('signal')[0].connectionId,hostConnection);
  await f.a.receive(hostConnection,JSON.stringify({type:'relay',to:peerId(GUEST),data:{game:'must not enter pubsub'}}));
  assert.equal(f.aBus.published.length,1);assert.match(String(host.frames('error').at(-1)?.error),/WebRTC/);assert.equal(guest.frames('relay').length,0);
  await f.a.receive(hostConnection,JSON.stringify({type:'signal',to:peerId(GUEST),data:{type:'world',bombs:[]}}));assert.equal(f.aBus.published.length,1);
});

test('signalling denies guest-to-guest, foreign room and replaced target scopes',async()=>{
  const f=fixture(),{hostConnection,guestConnection,guest}=await joined(f);const extra=new Socket(),extraId=await f.a.connect(CODE,'c'.repeat(64),extra);
  await f.b.receive(guestConnection,signal(peerId('c'.repeat(64)),extraId));assert.equal(extra.frames('signal').length,0);
  await f.a.receive(hostConnection,signal(peerId(GUEST),'obsolete'));assert.equal(guest.frames('signal').length,0);
  const packet:RoutedMessage={id:'bad',code:'OTHERROOM0',incarnation:'wrong',destination:'b',from:{id:peerId(HOST),connectionId:hostConnection,gatewayId:'a',host:true,expiresAt:9999},to:{id:peerId(GUEST),connectionId:guestConnection,gatewayId:'b',host:false,expiresAt:9999},expiresAt:9999,wire:{type:'signal',from:peerId(HOST),connectionId:hostConnection,data:{}}};
  await f.b.deliver(packet);assert.equal(guest.frames('signal').length,0);
});

test('fast bus after delayed metadata emits new source membership before SDP',async()=>{
  const f=fixture(),{host,guestConnection}=await joined(f);f.database.delay=true;
  const replacement=new Socket(),newGuest=await f.b.connect(CODE,GUEST,replacement);
  const before=host.messages.length;
  await f.b.receive(newGuest,signal(peerId(HOST),String(host.frames('welcome')[0].connectionId)));
  const after=host.messages.slice(before);assert.equal(after[0].type,'peer');assert.equal(after[0].connectionId,newGuest);assert.equal(after[1].type,'signal');
  f.database.flush();assert.equal(host.frames('peer').at(-1)?.connectionId,newGuest);
  await f.b.disconnect(guestConnection);assert.equal((await f.store.get(CODE)).members[peerId(GUEST)].connectionId,newGuest);
});

test('expired and duplicate bus packets never repeat SDP; old replacement source is rejected',async()=>{
  const f=fixture(),{hostConnection,guestConnection,guest}=await joined(f);f.aBus.delayed=true;
  await f.a.receive(hostConnection,signal(peerId(GUEST),guestConnection));const packet=f.aBus.published[0];
  await f.b.deliver(packet);await f.b.deliver(packet);assert.equal(guest.frames('signal').length,1);
  await f.a.receive(hostConnection,signal(peerId(GUEST),guestConnection));f.advance(2001);await f.aBus.flush();assert.equal(guest.frames('signal').length,1);
  const newHost=new Socket();await f.a.connect(CODE,HOST,newHost);await f.b.deliver({...packet,id:'old-source',expiresAt:100_000});assert.equal(guest.frames('signal').length,1);
});

test('time renewals preserve exact authority and stale close cannot revoke replacement',async()=>{
  const f=fixture(),{host,hostConnection}=await joined(f);const grant=host.frames('welcome')[0].grant;
  f.advance(1000);await f.a.receive(hostConnection,JSON.stringify({type:'time',id:1,sentAt:25,renew:grant}));
  const response=host.frames('time')[0];assert.equal(response.sentAt,25);assert.equal(response.serviceTime,2000);assert.ok(response.grant);
  const next=new Socket();const nextId=await f.b.connect(CODE,HOST,next);assert.equal(host.closes.at(-1)?.code,4001);
  await f.a.disconnect(hostConnection);assert.equal((await f.store.get(CODE)).grant?.holder,nextId);
});

test('idle teardown and immediate rejoin serialize a new subscription before admission',async()=>{
  const f=fixture();await f.store.create(CODE,HOST);const first=await f.a.connect(CODE,HOST,new Socket());
  const leave=f.a.disconnect(first),join=f.a.connect(CODE,HOST,new Socket());await leave;const next=await join;
  assert.notEqual(next,first);assert.equal(f.aBus.started,2);assert.equal(f.aBus.stopped,1);assert.equal(f.a.state,'ready');await f.a.stop();assert.equal(f.a.state,'idle');assert.equal(f.aBus.stopped,2);
});

test('bus failure and slow receiver fail explicitly without keeping hidden relay queues',async()=>{
  const f=fixture(),{host,guest,hostConnection,guestConnection}=await joined(f);
  guest.bufferedAmount=300_000;await f.a.receive(hostConnection,signal(peerId(GUEST),guestConnection));assert.equal(guest.closes.at(-1)?.code,1013);
  f.aBus.failed?.(new Error('bus unavailable'));assert.equal(host.closes.at(-1)?.code,1012);
  await f.a.disconnect(hostConnection);await f.b.disconnect(guestConnection);assert.equal(f.a.state,'idle');
});

test('runtime metadata and bus schemas reject corrupt scope and gameplay frames',async()=>{
  const f=fixture();await f.store.create(CODE,HOST);const room=await f.store.get(CODE);assert.ok(parseRoomRecord(room));
  for(const bad of [null,[],{}, {...room,version:1},{...room,expiresAt:Infinity},{...room,members:{bad:{}}}])assert.equal(parseRoomRecord(bad),undefined);
  assert.equal(parseRoutedMessage({}),undefined);assert.equal(parseRoutedMessage({id:'i',code:CODE,incarnation:'inc',destination:'b',expiresAt:99,from:{id:'a',connectionId:'ac',gatewayId:'a',host:true,expiresAt:99},to:{id:'b',connectionId:'bc',gatewayId:'b',host:false,expiresAt:99},wire:{type:'relay',from:'a',connectionId:'ac',data:{}}}),undefined);
  await assert.rejects(f.store.admit(CODE,'bad','a'),(error:unknown)=>error instanceof RoomError&&error.status===401);
});

test('v2 renewal accepts GrantIdentity without timestamps at the actual JSON boundary',async()=>{
  const f=fixture(),{host,hostConnection}=await joined(f);const room=await f.store.get(CODE),grant=room.grant!;
  const identity={incarnation:grant.incarnation,epoch:grant.epoch,holder:grant.holder,grantId:grant.grantId};
  f.advance(3000);await f.a.receive(hostConnection,JSON.stringify({type:'time',id:1,sentAt:50,renew:identity}));
  const renewed=host.frames('time')[0].grant;assert.ok(renewed&&typeof renewed==='object');assert.equal((renewed as {expiresAt:number}).expiresAt,grant.expiresAt+3000);
});

test('failed bus is drained before a queued new connection can mark it ready',async()=>{
  const f=fixture(),{hostConnection}=await joined(f);
  // Queue admission before failure enqueues its disconnect cleanup.
  const joining=f.a.connect(CODE,'d'.repeat(64),new Socket());f.aBus.failed?.(new Error('receive stream failed'));
  const connection=await joining;assert.equal(f.aBus.started,2);assert.ok(f.aBus.stopped>=1);assert.equal(f.a.state,'ready');
  await f.a.disconnect(hostConnection);await f.a.disconnect(connection);await f.b.stop();
});
