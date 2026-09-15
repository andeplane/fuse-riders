import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomStore, RoomError, peerId, parseRoomRecord, type RoomDatabase, type RoomRecord, type RoomStoreDependencies } from '../src/service/room-store.js';
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
function fixture(makeStore:(database:RoomDatabase,dependencies:RoomStoreDependencies)=>RoomStore=(database,dependencies)=>new RoomStore(database,dependencies)){
  let now=1000,n=0;const database=new Database(),network=new Map<string,Bus>(),aBus=new Bus(network,'a'),bBus=new Bus(network,'b');
  const deps={now:()=>now,id:()=>`id-${++n}`,error:()=>{}};const store=makeStore(database,deps);
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

test('signalling permits any current member pair and denies self, foreign room and replaced target scopes',async()=>{
  const f=fixture(),{hostConnection,guestConnection,guest}=await joined(f);const extra=new Socket(),extraId=await f.a.connect(CODE,'c'.repeat(64),extra);
  await f.b.receive(guestConnection,signal(peerId('c'.repeat(64)),extraId));assert.equal(extra.frames('signal').length,1,'guest-to-guest signalling carries the mesh');
  await f.b.receive(guestConnection,signal(peerId(GUEST),guestConnection));assert.equal(guest.frames('signal').length,0,'no self signalling');
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
  await f.a.receive(hostConnection,signal(peerId(GUEST),guestConnection));f.advance(10_001);await f.aBus.flush();assert.equal(guest.frames('signal').length,1);
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

test('short-code transactional collisions preserve the live room and retry only bounded conflicts',async()=>{
 const f=fixture();await f.store.create('AB42',HOST);const original=await f.store.get('AB42');let attempts=0;assert.equal(await f.store.createAvailable(GUEST,()=>++attempts===1?'AB42':'CD34'),'CD34');assert.equal(attempts,2);assert.deepEqual(await f.store.get('AB42'),original);
 attempts=0;await assert.rejects(f.store.createAvailable(GUEST,()=>{attempts++;return 'AB42';}),error=>error instanceof RoomError&&error.status===503);assert.equal(attempts,12);assert.deepEqual(await f.store.get('AB42'),original);
});
test('guest keepalives never extend host-session lifetime and exact expiry rejects admission',async()=>{
 const f=fixture();await f.store.create('AB42',HOST);await f.store.admit('AB42',HOST,'a');const guest=await f.store.admit('AB42',GUEST,'b');const deadline=guest.room.expiresAt;
 for(let i=0;i<4;i++){f.advance(20_000);assert.equal((await f.store.time('AB42',guest.member,undefined)).expiresAt,deadline);}
 f.advance(10_000);await assert.rejects(f.store.get('AB42'),/expired/);await assert.rejects(f.store.time('AB42',guest.member,undefined),/expired/);await assert.rejects(f.store.admit('AB42',HOST,'a'),/expired/);
});
test('only the current host extends reconnect grace and replacement close cannot shorten it',async()=>{
 const f=fixture();await f.store.create('AB42',HOST);const first=await f.store.admit('AB42',HOST,'a');f.advance(20_000);const renewed=await f.store.time('AB42',first.member,first.room.grant);assert.equal(renewed.expiresAt,111_000);
 f.advance(5000);await f.store.leave('AB42',first.member);assert.equal((await f.store.get('AB42')).expiresAt,116_000);f.advance(5000);const next=await f.store.admit('AB42',HOST,'b');assert.equal(next.room.expiresAt,121_000);await f.store.leave('AB42',first.member);assert.equal((await f.store.get('AB42')).expiresAt,121_000);
});
test('host end is authorized, immediate and cannot end a reused code with an old capability',async()=>{
 const f=fixture();const {host,guest,hostConnection}=await joined(f);const original=await f.store.get(CODE),member=original.members[peerId(HOST)]!;await assert.rejects(f.store.end(CODE,GUEST),error=>error instanceof RoomError&&error.status===403);await f.store.end(CODE,HOST);await f.store.end(CODE,HOST);await assert.rejects(f.store.get(CODE),/expired/);assert.ok(host.closes.length);assert.ok(guest.closes.length);
 const newHost='c'.repeat(64);await f.store.create(CODE,newHost);const replacement=await f.store.admit(CODE,newHost,'a');assert.notEqual(replacement.room.incarnation,original.incarnation);await assert.rejects(f.store.end(CODE,HOST),error=>error instanceof RoomError&&error.status===403);await f.store.leave(CODE,member);assert.deepEqual(await f.store.get(CODE),replacement.room);assert.ok(hostConnection);
});
test('cached signalling refuses expired rooms before asynchronous TTL deletion',async()=>{const f=fixture();const {guest,guestConnection,hostConnection}=await joined(f);for(let i=0;i<4;i++){f.advance(20_000);await f.b.receive(guestConnection,JSON.stringify({type:'time',id:i,sentAt:i}));}f.advance(10_000);await f.b.receive(guestConnection,signal(peerId(HOST),hostConnection));assert.ok(guest.closes.length);assert.equal(f.bBus.published.length,0);});

test('gateway expiry timer closes silent sockets without depending on TTL deletion or traffic',async()=>{
 const f=fixture();let now=1000,cancelled=0,callback:()=>void=()=>{};
 const store=new RoomStore(f.database,{now:()=>now,id:()=>crypto.randomUUID()});await store.create('AB42',HOST);
 const gateway=new RoomGateway('timed',store,f.bBus,{now:()=>now,id:()=>crypto.randomUUID(),error:()=>{},schedule:(fn,delay)=>{assert.equal(delay,90_000);callback=fn;return()=>{cancelled++;};}});
 const socket=new Socket();await gateway.connect('AB42',HOST,socket);now=91_000;callback();await new Promise(resolve=>setImmediate(resolve));assert.equal(socket.closes.at(-1)?.reason,'Room expired');await gateway.stop();assert.ok(cancelled>0);
});

test('delayed old-incarnation heartbeat or read cannot roll back a reused room view',async()=>{
 for(const mode of ['time','get'] as const){
  let release:()=>void=()=>{},ready:()=>void=()=>{};const waiting=new Promise<void>(resolve=>{ready=resolve;});let block=false;
  class DelayedStore extends RoomStore{
   private async barrier(kind:typeof mode){if(block&&kind===mode){block=false;ready();await new Promise<void>(resolve=>{release=resolve;});}}
   override async time(...args:Parameters<RoomStore['time']>){const result=await super.time(...args);await this.barrier('time');return result;}
   override async get(...args:Parameters<RoomStore['get']>){const result=await super.get(...args);await this.barrier('get');return result;}
  }
  const f=fixture((db,deps)=>new DelayedStore(db,deps));const {hostConnection}=await joined(f);block=true;
  const pending=f.a.receive(hostConnection,mode==='time'?JSON.stringify({type:'time',id:'late',sentAt:0}):signal(peerId(GUEST),'force-authoritative-read'));await waiting;
  await f.store.end(CODE,HOST);await f.store.create(CODE,'c'.repeat(64));const replacement=new Socket();await f.a.connect(CODE,'c'.repeat(64),replacement);release();await pending;assert.equal(replacement.closes.length,0);assert.equal(replacement.frames('welcome').length,1);await f.a.stop();await f.b.stop();
 }
});
test('delayed old admission cannot replace a newly observed room incarnation',async()=>{
 let release:()=>void=()=>{},ready:()=>void=()=>{},block=false;const waiting=new Promise<void>(resolve=>{ready=resolve;});
 class DelayedStore extends RoomStore{override async admit(...args:Parameters<RoomStore['admit']>){const result=await super.admit(...args);if(block){block=false;ready();await new Promise<void>(resolve=>{release=resolve;});}return result;}}
 const f=fixture((db,deps)=>new DelayedStore(db,deps));await joined(f);block=true;const old=new Socket();const pending=f.a.connect(CODE,HOST,old);await waiting;await f.store.end(CODE,HOST);await f.store.create(CODE,'c'.repeat(64));const fresh=new Socket();await f.b.connect(CODE,'c'.repeat(64),fresh);release();await assert.rejects(pending,/ended during admission/);assert.equal(fresh.closes.length,0);assert.equal(old.frames('welcome').length,0);await f.a.stop();await f.b.stop();
});
test('cancelled metadata watch callbacks cannot mutate a recreated room view',async()=>{
 const f=fixture();const {hostConnection}=await joined(f);f.database.delay=true;const room=await f.store.get(CODE);await f.store.time(CODE,room.members[peerId(HOST)]!,room.grant);await f.store.end(CODE,HOST);await f.a.disconnect(hostConnection);await f.b.stop();await f.store.create(CODE,'c'.repeat(64));const fresh=new Socket();await f.a.connect(CODE,'c'.repeat(64),fresh);f.database.flush();assert.equal(fresh.closes.length,0);await f.a.stop();
});
test('direct new admission rotates an active old watch before its delayed callbacks arrive',async()=>{const f=fixture();await joined(f);f.database.delay=true;const room=await f.store.get(CODE);await f.store.time(CODE,room.members[peerId(HOST)]!,room.grant);await f.store.end(CODE,HOST);await f.store.create(CODE,'c'.repeat(64));const fresh=new Socket();await f.a.connect(CODE,'c'.repeat(64),fresh);f.database.flush();assert.equal(fresh.closes.length,0);assert.equal(fresh.frames('welcome').length,1);await f.a.stop();await f.b.stop();});
