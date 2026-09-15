import { handleRoomSocketClose } from './room-socket-close.js';
import { isCurrentLinkCallback } from './link-callback.js';
import { LinkHealth } from './link-health.js';
import { GAMEPLAY_BUFFER_LIMIT, LinkSendGate, PROBE_BUFFER_LIMIT } from './link-send-gate.js';
import { apiUrl } from './endpoints.js';
import { AuthorityClock, isAuthorityGrant, type AuthorityGrant } from './authority.js';
import { ICE_FETCH_TIMEOUT_MS, IceConfig } from './ice-config.js';
import { candidateType, sameCertificate } from './ice-signal.js';
import { RemoteSignal } from './remote-signal.js';
import { LinkRestartPolicy } from './link-restart.js';
import { explainLink, type LinkDiagnostic } from './link-diagnostics.js';
import { decodeFast, encodeFast, hashText, FAST_MESSAGE_BYTES } from './wire.js';
export interface TransportCallbacks {
  welcome:(id:string,hostId:string)=>void;
  peer:(id:string,online:boolean)=>void;
  message:(id:string,data:unknown)=>void;
  status:(status:string)=>void;
  revoked?:()=>void;
  ended?:()=>void;
  /** The link is unrecoverable for this page: the transport is closed and the notice must stay on screen. */
  terminated?:(status:string)=>void;
  authorityChanged?:()=>void;
}
interface Link { pc:RTCPeerConnection;channel?:RTCDataChannel;fast?:RTCDataChannel;remote:RemoteSignal;health:LinkHealth;gate:LinkSendGate;restart:LinkRestartPolicy;createdAt:number;local:Partial<Record<string,number>>;remoteTypes:Partial<Record<string,number>>;counts:{offersOut:number;offersIn:number;answersOut:number;answersIn:number;candidatesOut:number;relayFailed:number};lastFailure?:string }
const RESTART_ATTEMPTS=4;
const FAST_CHANNEL='fast';
export class PeerTransport {
  id='';hostId='';connectionId='';sentBytes=0;
  grant?:AuthorityGrant;
  private authorityClock=new AuthorityClock(()=>performance.now());
  private connections=new Map<string,string>();
  private probes=new Map<number,number>();
  private nextProbe=0;
  private readyScope='';
  private timeInterval?:ReturnType<typeof setInterval>;
  private healthInterval?:ReturnType<typeof setInterval>;
  private readonly visibility=()=>{this.authorityClock.invalidate();if(!document.hidden)this.sampleTime();};
  authorityPermitted():boolean{return !!this.grant&&(this.id!==this.hostId||this.grant.holder===this.connectionId)&&this.authorityClock.permits(this.grant);}
  private acceptGrant(raw:unknown):void {
    if(!isAuthorityGrant(raw))return;
    const previous=this.grant;
    if(previous&&previous.incarnation===raw.incarnation&&(raw.epoch<previous.epoch||(raw.epoch===previous.epoch&&raw.expiresAt<previous.expiresAt)))return;
    const changed=!previous||previous.incarnation!==raw.incarnation||previous.epoch!==raw.epoch;
    this.grant=raw;
    if(changed){this.received.clear();this.callbacks.authorityChanged?.();}
  }
  private sampleTime(renew=true):void {
    if(this.stopped||this.socket?.readyState!==WebSocket.OPEN)return;
    const id=++this.nextProbe,sentAt=performance.now();this.probes.set(id,sentAt);
    for(const [key,at] of this.probes)if(sentAt-at>4000)this.probes.delete(key);
    try{this.socket.send(JSON.stringify({type:'time',id,sentAt,...(renew&&this.id===this.hostId&&this.grant?{renew:this.grant}:{})}));}catch{}
  }
  private socket?:WebSocket;
  private links=new Map<string,Link>();
  // Macrotask deferral that background timer throttling cannot delay (a throttled setTimeout would pong a
  // screen-off phone a second late, fail LinkHealth and force-re-offer a healthy channel every 8 s).
  private readonly deferred:Array<()=>void>=[];
  private readonly deferPort=(()=>{const channel=new MessageChannel();channel.port1.onmessage=()=>this.deferred.shift()?.();return channel.port2;})();
  private defer(task:()=>void):void{this.deferred.push(task);this.deferPort.postMessage(null);}
  private seq=0;
  private stopped=false;
  private retry?:ReturnType<typeof setTimeout>;
  private ice=new IceConfig();
  private relayOnly=new URLSearchParams(location.search).has('relay');
  constructor(readonly code:string,readonly token:string,private callbacks:TransportCallbacks){}
  connect():void {
    this.authorityClock.invalidate();
    if(!this.healthInterval)this.healthInterval=setInterval(()=>this.checkLinks(),200);
    if(!this.timeInterval){this.timeInterval=setInterval(()=>this.sampleTime(),2000);document.addEventListener('visibilitychange',this.visibility);}
    const url=new URL(apiUrl(`/api/rooms/${this.code}/ws`));url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('token',this.token);
    const ws=new WebSocket(url);this.socket=ws;
    ws.onmessage=async event=>{
      if(ws!==this.socket)return;
      try {
        const message=JSON.parse(event.data);
        if(message.type==='welcome'){
          if(message.protocol!==2||typeof message.connectionId!=='string'){this.terminate('Game protocol changed — reload this page');this.close();return;}
          this.received.clear();
          // Peers that left while our socket was down never produce a peer-offline message; reconcile against the roster first.
          const roster=new Set<string>(message.peers.map((peer:{id:string})=>peer.id));
          for(const id of this.connections.keys())if(!roster.has(id))this.callbacks.peer(id,false);
          for(const link of this.links.values())link.pc.close();this.links.clear();this.connections.clear();
          this.id=message.id;this.hostId=message.hostId;this.connectionId=message.connectionId;this.readyScope='';
          for(const peer of message.peers)this.connections.set(peer.id,peer.connectionId);
          this.acceptGrant(message.grant);this.sampleTime();
          // Offers and signals can arrive during this fetch; link() awaits the ICE config so no peer connection is built without STUN (#27).
          await this.ice.load(signal=>fetch(apiUrl(`/api/rooms/${this.code}/ice?token=${this.token}`),{signal}).then(response=>response.json()),AbortSignal.timeout(ICE_FETCH_TIMEOUT_MS));
          this.callbacks.status('Connected · checking room authority');
          if(this.id===this.hostId)for(const peer of message.peers){this.callbacks.peer(peer.id,true);await this.offer(peer.id);}
        }else if(message.type==='time'){
          const sent=this.probes.get(message.id);if(sent===undefined||sent!==message.sentAt)return;
          this.probes.delete(message.id);this.acceptGrant(message.grant);this.authorityClock.synchronize(sent,message.serviceTime);
          if(this.id===this.hostId&&this.grant&&message.serviceTime>=this.grant.expiresAt){ws.close(4000,'Authority lease expired');return;}
          const scope=`${this.connectionId}:${this.grant?.epoch}`;
          if(this.authorityPermitted()&&this.readyScope!==scope){this.readyScope=scope;this.callbacks.welcome(this.id,this.hostId);this.callbacks.status('Room authority confirmed');}
        }else if(message.type==='authority'){this.acceptGrant(message.grant);this.sampleTime(false);
        }else if(message.type==='peer'){
          if(typeof message.connectionId!=='string')return;
          if(message.online){
            const previous=this.connections.get(message.id);
            this.connections.set(message.id,message.connectionId);
            if(previous!==message.connectionId){this.links.get(message.id)?.pc.close();this.links.delete(message.id);this.received.delete(message.id);}
            this.callbacks.peer(message.id,true);if(this.id===this.hostId)await this.offer(message.id);
          }else if(this.connections.get(message.id)===message.connectionId){
            // The service is the membership authority (ADR035): the connection is retired even if the RTC channel still reads "open".
            this.links.get(message.id)?.gate.drain();
            this.connections.delete(message.id);this.callbacks.peer(message.id,false);this.links.get(message.id)?.pc.close();this.links.delete(message.id);
          }
        }else if(message.type==='signal'&&this.connections.get(message.from)===message.connectionId)await this.signal(message.from,message.data);

      }catch(error){this.callbacks.status(`Connection recovery: ${error instanceof Error?error.message:'invalid frame'}`);}
    };
    ws.onclose=event=>{
      if(ws!==this.socket)return;
      handleRoomSocketClose(event.code,{stopped:()=>this.stopped,stop:()=>this.close(),revoked:()=>this.callbacks.revoked?.(),ended:()=>this.callbacks.ended?.(),status:this.callbacks.status,terminated:message=>this.terminate(message),retry:()=>{this.retry=setTimeout(()=>this.connect(),1500);}});
    };
    ws.onerror=()=>ws.close();
  }
  private relay(type:string,to:string,data:unknown):boolean {
    if(this.socket?.readyState!==WebSocket.OPEN||this.socket.bufferedAmount>256000)return false;
    try{this.socket.send(JSON.stringify({type,to,targetConnectionId:this.connections.get(to),data}));return true;}catch{return false;}
  }
  /** Resolves undefined when the socket epoch changed while waiting for the ICE config: that signal belongs to the old admission. */
  private async link(id:string,restart?:LinkRestartPolicy):Promise<Link|undefined> {
    const existing=this.links.get(id);if(existing)return existing;
    const socket=this.socket;
    const iceServers=await this.ice.iceServers();
    if(socket!==this.socket||this.stopped)return undefined;
    const concurrent=this.links.get(id);if(concurrent)return concurrent;
    const pc=new RTCPeerConnection({iceServers});
    const now=performance.now();
    const link:Link={pc,remote:new RemoteSignal(pc),health:new LinkHealth(now),gate:new LinkSendGate(),restart:restart??new LinkRestartPolicy(now,RESTART_ATTEMPTS),createdAt:now,local:{},remoteTypes:{},counts:{offersOut:0,offersIn:0,answersOut:0,answersIn:0,candidatesOut:0,relayFailed:0}};this.links.set(id,link);
    pc.onicecandidate=event=>{
      if(!isCurrentLinkCallback(this.links.get(id),link)||!event.candidate)return;
      const type=candidateType(event.candidate.candidate);link.local[type]=(link.local[type]??0)+1;
      if(this.relay('signal',id,{candidate:event.candidate.toJSON()}))link.counts.candidatesOut++;else link.counts.relayFailed++;
    };
    pc.ondatachannel=event=>{if(!isCurrentLinkCallback(this.links.get(id),link)){event.channel.close();return;}if(event.channel.label===FAST_CHANNEL)this.fastChannel(id,link,event.channel);else this.channel(id,link,event.channel);};
    pc.onconnectionstatechange=()=>{
      if(!isCurrentLinkCallback(this.links.get(id),link))return;
      if(pc.connectionState==='connected')this.callbacks.status('Direct peer link connected');
      // "disconnected" may recover through fresh probes (ADR035); only terminal states drain the link.
      if(pc.connectionState==='failed'||pc.connectionState==='closed')link.gate.drain();
      if(pc.connectionState==='failed'||pc.connectionState==='disconnected'){link.health.fail(performance.now());this.callbacks.status(`Direct connection interrupted — ${this.explain(id)}`);}
    };
    pc.oniceconnectionstatechange=()=>{
      if(!isCurrentLinkCallback(this.links.get(id),link))return;
      if(pc.iceConnectionState==='failed'||pc.iceConnectionState==='closed')link.gate.drain();
    };
    return link;
  }
  private channel(id:string,link:Link,channel:RTCDataChannel):void {
    link.channel=channel;
    channel.onmessage=event=>{if(!isCurrentLinkCallback(this.links.get(id),link,channel))return;if(typeof event.data!=='string'||event.data.length>200000){channel.close();return;}try{this.receive(id,JSON.parse(event.data),true);}catch{}};
    channel.onopen=()=>{if(isCurrentLinkCallback(this.links.get(id),link,channel))this.callbacks.status('Direct peer link connected');};
    channel.onclosing=()=>{if(isCurrentLinkCallback(this.links.get(id),link,channel))link.gate.drain();};
    channel.onclose=()=>{if(isCurrentLinkCallback(this.links.get(id),link,channel))link.gate.drain();};
    channel.onerror=event=>{event.preventDefault();if(!isCurrentLinkCallback(this.links.get(id),link,channel))return;link.gate.drain();this.callbacks.status('Direct connection failed · retrying');};
  }
  /** Unordered, no retransmission: every packet restates recent entries, so a lost one costs nothing and never stalls
   * the reliable channel. Loss of this channel itself is harmless: sends fall back to the reliable channel. */
  private fastChannel(id:string,link:Link,channel:RTCDataChannel):void {
    link.fast=channel;channel.binaryType='arraybuffer';
    channel.onmessage=event=>{if(this.links.get(id)!==link||link.fast!==channel||!(event.data instanceof ArrayBuffer))return;this.receiveFast(id,event.data);};
    const drop=()=>{if(link.fast===channel)link.fast=undefined;};
    channel.onclosing=drop;channel.onclose=drop;channel.onerror=event=>{event.preventDefault();drop();};
  }
  /** Bytes on the fast channel carry only the authority fence; the link itself names sender and receiver. */
  private receiveFast(id:string,bytes:ArrayBuffer):void {
    const envelope=decodeFast(bytes),grant=this.grant;
    if(!envelope||!grant||!this.authorityPermitted()||envelope.epoch!==grant.epoch||envelope.incarnation!==hashText(grant.incarnation)||!this.connections.has(id))return;
    const seen=this.received.get(id)??new Set<number>();if(seen.has(envelope.id))return;
    seen.add(envelope.id);if(seen.size>1000)seen.delete(seen.values().next().value!);this.received.set(id,seen);
    this.callbacks.message(id,envelope.data);
  }
  /** `force` replaces a drained link with a fresh RTCPeerConnection and gate; the restart budget carries over. */
  private async offer(id:string,force=false):Promise<void>{
    if(this.relayOnly)return;
    const old=this.links.get(id);if(!force&&old?.channel?.readyState==='open')return;if(old){old.pc.close();this.links.delete(id);}
    const link=await this.link(id,force?old?.restart:undefined);if(!link||link.channel)return;this.channel(id,link,link.pc.createDataChannel('game'));this.fastChannel(id,link,link.pc.createDataChannel(FAST_CHANNEL,{ordered:false,maxRetransmits:0}));
    await link.pc.setLocalDescription(await link.pc.createOffer());if(!isCurrentLinkCallback(this.links.get(id),link))return;
    if(this.relay('signal',id,{description:link.pc.localDescription}))link.counts.offersOut++;else link.counts.relayFailed++;
  }
  /** Same RTCPeerConnection, new ICE credentials; the guest recognises the unchanged DTLS certificate and answers on its existing connection. */
  private async restartIce(id:string,link:Link):Promise<void>{
    const attempt=link.restart.begin(performance.now());
    try{
      await link.pc.setLocalDescription(await link.pc.createOffer({iceRestart:true}));
      if(!isCurrentLinkCallback(this.links.get(id),link)||!link.restart.complete(attempt))return;
      if(this.relay('signal',id,{description:link.pc.localDescription}))link.counts.offersOut++;else link.counts.relayFailed++;
    }catch(error){link.lastFailure=`restart: ${error instanceof Error?error.name:'error'}`;link.restart.complete(attempt);}
  }
  private async signal(id:string,data:{description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit}):Promise<void>{
    if(this.relayOnly)return;
    const previous=this.links.get(id);
    if(data.description?.type==='offer'&&previous&&!sameCertificate(previous.pc.remoteDescription?.sdp,data.description.sdp??'')){previous.pc.close();this.links.delete(id);}
    const link=await this.link(id);if(!link)return;
    try{
      if(data.description){
        if(data.description.type==='offer')link.counts.offersIn++;else link.counts.answersIn++;
        await link.remote.describe(data.description);
        if(!isCurrentLinkCallback(this.links.get(id),link))return;
        if(data.description.type==='offer'){
          await link.pc.setLocalDescription(await link.pc.createAnswer());if(!isCurrentLinkCallback(this.links.get(id),link))return;
          if(this.relay('signal',id,{description:link.pc.localDescription}))link.counts.answersOut++;else link.counts.relayFailed++;
        }
      }else if(data.candidate){
        const type=candidateType(data.candidate.candidate);link.remoteTypes[type]=(link.remoteTypes[type]??0)+1;
        await link.remote.candidate(data.candidate);
      }
    }catch(error){link.lastFailure=`${data.description?data.description.type:'candidate'}: ${error instanceof Error?error.name:'error'}`;}
  }
  private received=new Map<string,Set<number>>();
  private receive(id:string,envelope:{id:number;data:unknown;incarnation:string;epoch:number;sender:string;receiver:string},direct=false):void {
    if(!envelope||!Number.isSafeInteger(envelope.id)||!this.authorityPermitted()||envelope.incarnation!==this.grant?.incarnation||envelope.epoch!==this.grant?.epoch||envelope.sender!==this.connections.get(id)||(id===this.hostId&&envelope.sender!==this.grant?.holder)||envelope.receiver!==this.connectionId)return;
    if(envelope.data&&typeof envelope.data==='object'){
      const probe=envelope.data as {type?:string;probeId?:number};
      if(probe.type==='linkProbe'||probe.type==='linkPong'){
        if(!direct||!Number.isSafeInteger(probe.probeId))return;
        if(probe.type==='linkPong')this.links.get(id)?.health.acknowledge(probe.probeId!,performance.now());
        else{
          // libwebrtc delivers the probe before the closing state change that follows it (WebKit posts OnMessage, then
          // OnStateChange). Answering inside this onmessage task would hand the pong to an already-dead transport, so
          // defer one macrotask: the queued state-change task runs first and readyState plus the gate refuse the send.
          const link=this.links.get(id),probeId=probe.probeId!;
          if(link)this.defer(()=>{if(isCurrentLinkCallback(this.links.get(id),link))this.sendDirectProbe(id,{type:'linkPong',probeId});});
        }
        return;
      }
    }
    const seen=this.received.get(id)??new Set<number>();if(seen.has(envelope.id))return;
    seen.add(envelope.id);if(seen.size>1000)seen.delete(seen.values().next().value!);this.received.set(id,seen);
    this.callbacks.message(id,envelope.data);
  }
  /** `fast` prefers the unreliable channel; the caller's data must be safe to lose and to reorder. */
  send(id:string,data:unknown,fast=false):boolean {
    if(this.stopped||!this.authorityPermitted()||!this.connections.has(id))return false;
    const link=this.links.get(id),messageId=++this.seq;
    if(fast&&!document.hidden&&link&&!link.gate.draining&&link.fast?.readyState==='open'&&link.fast.bufferedAmount<PROBE_BUFFER_LIMIT){
      const bytes=encodeFast({id:messageId,epoch:this.grant!.epoch,incarnation:hashText(this.grant!.incarnation),data});
      if(bytes.byteLength<=FAST_MESSAGE_BYTES){this.sentBytes+=bytes.byteLength;try{link.fast.send(bytes.slice().buffer as ArrayBuffer);return true;}catch{}}
    }
    const envelope={id:messageId,data,incarnation:this.grant!.incarnation,epoch:this.grant!.epoch,sender:this.connectionId,receiver:this.connections.get(id)!};this.sentBytes+=new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
    if(!document.hidden&&!this.relayOnly&&link?.gate.permits(link.channel,GAMEPLAY_BUFFER_LIMIT)&&link.health.direct(performance.now())){
      try{link.channel!.send(JSON.stringify(envelope));return true;}catch{}
    }
    return false;
  }
  private sendDirectProbe(id:string,data:{type:string;probeId:number}):void {
    const link=this.links.get(id);
    if(!this.authorityPermitted()||!link?.gate.permits(link.channel,PROBE_BUFFER_LIMIT))return;
    try{link.channel!.send(JSON.stringify({id:++this.seq,data,incarnation:this.grant!.incarnation,epoch:this.grant!.epoch,sender:this.connectionId,receiver:this.connections.get(id)}));}catch{}
  }
  private checkLinks():void {
    if(this.stopped||document.hidden||!this.authorityPermitted())return;
    const now=performance.now();
    for(const [id,link] of this.links){
      this.sendDirectProbe(id,{type:'linkProbe',probeId:link.health.probe(now)});
      if(link.health.direct(now)){link.restart.healthy(now);continue;}
      // A down socket cannot carry the restart offer; do not burn the budget on it.
      if(!link.health.shouldRestart(now)||this.id!==this.hostId||this.socket?.readyState!==WebSocket.OPEN||!link.restart.due(now))continue;
      if(link.gate.draining){
        // The gate is monotonic: a drained link never sends again, so an in-place ICE restart could not recover it.
        const attempt=link.restart.begin(now);
        void this.offer(id,true).catch(error=>{link.lastFailure=`recreate: ${error instanceof Error?error.name:'error'}`;}).finally(()=>{link.restart.complete(attempt);});
      }else void this.restartIce(id,link);
    }
  }
  /** Terminal for this page: report it as a notice the room runtime keeps on screen over recurring status. */
  private terminate(status:string):void{if(this.callbacks.terminated)this.callbacks.terminated(status);else this.callbacks.status(status);}
  close():void{this.stopped=true;this.deferred.length=0;this.authorityClock.invalidate();clearInterval(this.timeInterval);clearInterval(this.healthInterval);document.removeEventListener('visibilitychange',this.visibility);clearTimeout(this.retry);this.socket?.close();for(const link of this.links.values())link.pc.close();this.links.clear();}
  private summary(id:string,link:Link,now:number):LinkDiagnostic {
    return{peer:id===this.hostId?'host':'guest',local:link.local,remote:link.remoteTypes,gathering:link.pc.iceGatheringState,ice:link.pc.iceConnectionState,connection:link.pc.connectionState,signaling:link.pc.signalingState,channel:link.gate.draining?'drained':link.channel?.readyState??'none',
      sctp:link.pc.sctp?.state,signalling:{...link.remote.counts,...link.counts},restarts:{attempts:link.restart.attempts,max:link.restart.max,exhausted:link.restart.exhausted},healthy:link.health.direct(now),ageMs:now-link.createdAt,lastFailure:link.lastFailure};
  }
  /** Why the link to `id` is not carrying gameplay, for header status; redacted. */
  explain(id:string):string {
    if(this.socket?.readyState!==WebSocket.OPEN)return 'room service connection down — reconnecting';
    if(!this.hostId)return 'waiting for room admission';
    const link=this.links.get(id);
    if(!link)return id===this.hostId?'no offer received from host — signalling never delivered the offer':'no link yet';
    return explainLink(this.summary(id,link,performance.now()));
  }
  /** Redacted per-link diagnostics including the selected candidate pair from getStats. */
  async diagnostics():Promise<{links:LinkDiagnostic[];ice:{servers:number;source:string};socket:string}>{
    const links:LinkDiagnostic[]=[];const now=performance.now();
    for(const [id,link] of this.links){
      const summary=this.summary(id,link,now);
      try{
        const report=await link.pc.getStats();
        report.forEach(stat=>{
          if(stat.type==='transport'&&typeof stat.dtlsState==='string')summary.dtls=stat.dtlsState;
          if(stat.type==='candidate-pair'&&(stat.nominated||stat.state==='succeeded')&&!summary.selected){const local=report.get(stat.localCandidateId),remote=report.get(stat.remoteCandidateId);summary.selected={local:local?.candidateType??'?',remote:remote?.candidateType??'?',protocol:local?.protocol??'?'};}
        });
      }catch{}
      links.push(summary);
    }
    const socketStates=['connecting','open','closing','closed'];
    return{links,ice:{servers:this.ice.servers.length,source:this.ice.source},socket:socketStates[this.socket?.readyState??3]??'closed'};
  }
  async stats():Promise<{direct:number;relayed:number;buffered:number;authority:{reason:string;roundTripMs?:number}}>{
    let direct=0,relayed=0,buffered=this.socket?.bufferedAmount??0;
    for(const link of this.links.values()){
      buffered+=link.channel?.bufferedAmount??0;
      if(link.channel?.readyState!=='open')continue;
      const report=await link.pc.getStats();let usesRelay=false;
      report.forEach(stat=>{if(stat.type==='candidate-pair'&&stat.state==='succeeded'){const local=report.get(stat.localCandidateId);const remote=report.get(stat.remoteCandidateId);if(local?.candidateType==='relay'||remote?.candidateType==='relay')usesRelay=true;}});
      if(usesRelay)relayed++;else direct++;
    }
    return{direct,relayed,buffered,authority:this.authorityClock.diagnostics()};
  }
}
