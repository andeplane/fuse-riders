/** Public deployed HTTP/WSS smoke. No ADC, gcloud token or room bearer token is logged. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { isAuthorityGrant, type AuthorityGrant } from 'fuse-network-fe';
interface Frame {type?:string;[key:string]:unknown}
interface Check {name:string;milliseconds:number}
export interface PublicSmokeOptions {origin:string;browserOrigin?:string;allowLoopback?:boolean;timeoutMs?:number}
export interface PublicSmokeReport {date:string;origin:string;passed:boolean;checks:Check[];failedCheck?:string;errorType?:string;limits:string;cleanup:string}
function validateOrigin(raw:string,allowLoopback=false):string {const u=new URL(raw);assert.equal(u.origin,raw);assert.ok(u.protocol==='https:'||(allowLoopback&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)));return u.origin;}
class Peer {
 readonly socket:WebSocket;frames:Frame[]=[];overflow=false;closed?:number;private listeners=new Set<()=>void>();
 constructor(url:string,origin:string,private timeout:number){this.socket=new WebSocket(url,{origin,handshakeTimeout:timeout,maxPayload:64_000});this.socket.on('message',raw=>{if(this.frames.length>=256){this.overflow=true;this.socket.close(1009,'Harness history full');this.notify();return;}try{this.frames.push(JSON.parse(raw.toString()));}catch{}this.notify();});this.socket.on('close',code=>{this.closed=code;this.notify();});this.socket.on('error',()=>{});}
 private notify(){for(const listener of this.listeners)listener();}
 wait<T>(inspect:()=>T|undefined):Promise<T>{return new Promise((resolve,reject)=>{const finish=(value?:T,error?:Error)=>{clearTimeout(timer);this.listeners.delete(check);if(error)reject(error);else resolve(value!);};const check=()=>{const value=inspect();if(value!==undefined)finish(value);else if(this.closed!==undefined)finish(undefined,new Error('Socket closed'));};const timer=setTimeout(()=>finish(undefined,new Error('Frame deadline')),this.timeout);this.listeners.add(check);check();});}
 frame(type:string,predicate:(f:Frame)=>boolean=()=>true){return this.wait(()=>this.frames.find(f=>f.type===type&&predicate(f)));}
 send(frame:unknown){if(this.socket.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(frame));}
 async close(){if(this.closed!==undefined)return;this.socket.close();try{await this.wait(()=>this.closed);}catch{this.socket.terminate();}}
}
export async function runPublicSmoke(options:PublicSmokeOptions):Promise<PublicSmokeReport>{
 const origin=validateOrigin(options.origin,options.allowLoopback),browserOrigin=validateOrigin(options.browserOrigin??'https://andeplane.github.io',options.allowLoopback),timeout=options.timeoutMs??25_000;
 const peers:Peer[]=[],checks:Check[]=[];let createdRoom:{code:string;token:string}|undefined;let current='health and readiness',start=performance.now(),heartbeat:ReturnType<typeof setInterval>|undefined;
 const report:PublicSmokeReport={date:new Date().toISOString(),origin,passed:false,checks,limits:'Public HTTPS/WSS and synthetic SDP only. Proves provider-backed room transactions and subscription creation with the deployed identity, not its exact email, cross-instance PubSub routing, real RTC, Pages or physical phones.',cleanup:'No room created; all test sockets are closed.'};
 const checked=(next:string)=>{checks.push({name:current,milliseconds:Math.round(performance.now()-start)});start=performance.now();current=next;};
 const request=(path:string,init:RequestInit={})=>fetch(origin+path,{...init,headers:{Origin:browserOrigin,...init.headers},signal:AbortSignal.timeout(timeout)});
 const open=(code:string,token:string)=>{const u=new URL(`/api/rooms/${code}/ws`,origin);u.protocol=u.protocol==='https:'?'wss:':'ws:';u.searchParams.set('token',token);const peer=new Peer(u.href,browserOrigin,timeout);peers.push(peer);return peer;};
 try{
  for(const path of ['/api/health','/api/ready']){const response=await request(path);assert.equal(response.status,200);assert.equal((await response.json() as {ok:boolean}).ok,true);}
  checked('CORS denies foreign origin and supports Pages preflight');
  assert.equal((await request('/api/rooms',{method:'POST',headers:{Origin:'https://denied.invalid'}})).status,403);
  const preflight=await request('/api/rooms',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),browserOrigin);
  checked('anonymous room creation backed by deployed database identity');
  const response=await request('/api/rooms',{method:'POST'});assert.equal(response.status,201);assert.equal(response.headers.get('Access-Control-Allow-Origin'),browserOrigin);const room=await response.json() as {code:string;token:string};createdRoom=room;assert.match(room.code,/^[A-Z]{2}[0-9]{2}$/);assert.match(room.token,/^[a-f0-9]{64}$/);
  checked('host WSS admission creates provider subscription and authority');
  const host=open(room.code,room.token),welcome=await host.frame('welcome');assert.equal(welcome.protocol,2);assert.ok(isAuthorityGrant(welcome.grant));let grant:AuthorityGrant=welcome.grant;
  heartbeat=setInterval(()=>host.send({type:'time',id:'heartbeat',sentAt:performance.now(),renew:grant}),750);
  checked('guest admission and membership notification');
  const guestToken=randomBytes(32).toString('hex'),guest=open(room.code,guestToken),guestWelcome=await guest.frame('welcome');assert.equal(guestWelcome.hostId,welcome.hostId);assert.notEqual(guestWelcome.id,welcome.id);await host.frame('peer',f=>f.connectionId===guestWelcome.connectionId);
  checked('joined identity ICE endpoint');
  assert.equal((await request(`/api/rooms/${room.code}/ice?token=invalid`)).status,401);const ice=await request(`/api/rooms/${room.code}/ice?token=${guestToken}`);assert.equal(ice.status,200);assert.equal((await ice.json() as {relayConfigured:boolean}).relayConfigured,false);
  checked('bounded SDP round trip rejects gameplay-shaped signalling');
  host.send({type:'signal',to:guestWelcome.id,targetConnectionId:guestWelcome.connectionId,data:{type:'world',sentinel:'must-not-route'}});
  const offer={description:{type:'offer',sdp:'v=0\r\ns=public-smoke\r\n'}};host.send({type:'signal',to:guestWelcome.id,targetConnectionId:guestWelcome.connectionId,data:offer});const signal=await guest.frame('signal');assert.equal(signal.connectionId,welcome.connectionId);assert.deepEqual(signal.data,offer);
  guest.send({type:'signal',to:welcome.id,targetConnectionId:welcome.connectionId,data:{description:{type:'answer',sdp:'v=0\r\ns=public-answer\r\n'}}});await host.frame('signal');
  checked('gameplay relay rejected explicitly');host.send({type:'relay',to:guestWelcome.id,data:{type:'world'}});assert.match(String((await host.frame('error')).error),/WebRTC/);assert.equal(guest.frames.some(f=>f.type==='relay'),false);
  checked('identity-only transactional authority renewal');
  host.send({type:'time',id:'verify-renew',sentAt:1,renew:{incarnation:grant.incarnation,epoch:grant.epoch,holder:grant.holder,grantId:grant.grantId}});const time=await host.frame('time',f=>f.id==='verify-renew');assert.equal(time.sentAt,1);assert.ok(isAuthorityGrant(time.grant));assert.equal(time.grant.grantId,grant.grantId);assert.ok(time.grant.expiresAt>=grant.expiresAt);grant=time.grant;
  checked('host replacement advances fenced authority and closes old socket');
  clearInterval(heartbeat);heartbeat=undefined;const replacement=open(room.code,room.token),next=await replacement.frame('welcome');assert.ok(isAuthorityGrant(next.grant));assert.equal(next.grant.epoch,grant.epoch+1);assert.equal(next.grant.holder,next.connectionId);assert.ok(next.grant.validFrom>=grant.expiresAt+250);assert.equal(await host.wait(()=>host.closed),4001);
  checked('host-only explicit room end');assert.equal((await request(`/api/rooms/${room.code}/end`,{method:'POST',headers:{Authorization:`Bearer ${guestToken}`}})).status,403);assert.equal((await request(`/api/rooms/${room.code}/end`,{method:'POST',headers:{Authorization:`Bearer ${room.token}`}})).status,200);
  assert.equal(peers.some(peer=>peer.overflow),false);checked('complete');report.passed=true;
 }catch(error){report.failedCheck=current;report.errorType=error instanceof Error?error.name:'UnknownError';}
 finally{if(heartbeat)clearInterval(heartbeat);if(createdRoom){try{const ended=await request(`/api/rooms/${createdRoom.code}/end`,{method:'POST',headers:{Authorization:`Bearer ${createdRoom.token}`}});report.cleanup=ended.ok?'Test room explicitly ended; expired metadata and creation-limit record await TTL cleanup. All sockets closed.':'Room end was not confirmed; sockets closed and host reconnect grace bounds its lifetime.';}catch{report.cleanup='Room end was not confirmed; sockets closed and host reconnect grace bounds its lifetime.';}}await Promise.all(peers.map(peer=>peer.close()));}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try {const origin=process.env.CLOUD_RUN_ORIGIN;if(!origin)throw new Error('CLOUD_RUN_ORIGIN required');
 const report=await runPublicSmoke({origin});await mkdir('artifacts',{recursive:true});await writeFile('artifacts/cloud-public-smoke.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;}catch{console.error('Public smoke configuration or artifact write failed; check HTTPS origin and local output permissions.');process.exitCode=1;}
}
