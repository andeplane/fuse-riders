import { packMessage, unpackMessage } from './action-replication.js';
import { FAST_PACKET_BYTES, decodeDirectPacket, DIRECT_VERSION } from './direct-stream.js';
import { DirectIngress, type FastPermissions } from './direct-ingress.js';
import { BOUND_CONTROL_BYTES, isBoundControl, isBoundPause } from './direct-control.js';
import { uint32 } from '../shared/direct-input.js';
import { handleRoomSocketClose } from './room-socket-close.js';
import { isCurrentLinkCallback, isCurrentPulseCallback } from './link-callback.js';
import { decodeHeartbeat, isHeartbeat, type HeartbeatResult } from './direct-heartbeat.js';
import { LinkHealth, LinkPulseMode } from './link-health.js';
import { GAMEPLAY_BUFFER_LIMIT, LinkSendGate, PROBE_BUFFER_LIMIT, permitsFastControl, permitsAggregate, COORDINATION_BUFFER_LIMIT, CHECKPOINT_BUFFER_LIMIT } from './link-send-gate.js';
import { apiUrl } from './endpoints.js';
import { AuthorityClock, isAuthorityGrant, type AuthorityGrant } from './authority.js';
import { ICE_FETCH_TIMEOUT_MS, IceConfig } from './ice-config.js';
import { candidateType, sameCertificate } from './ice-signal.js';
import { RemoteSignal } from './remote-signal.js';
import { LinkRestartPolicy } from './link-restart.js';
import { explainLink, type LinkDiagnostic } from './link-diagnostics.js';
export interface TransportCallbacks {
  welcome:(id:string,hostId:string)=>void;
  peer:(id:string,online:boolean)=>void;
  message:(id:string,data:unknown)=>void;
  fast?:(id:string,data:Uint8Array)=>HeartbeatResult|void;
  paused?:(id:string,segment:number)=>void;
  /** A new RTC association needs a fresh reliable capability/segment handshake. */
  linkReset?:(id:string)=>void;
  status:(status:string)=>void;
  revoked?:()=>void;
  ended?:()=>void;
  /** The link is unrecoverable for this page: the transport is closed and the notice must stay on screen. */
  terminated?:(status:string)=>void;
  authorityChanged?:()=>void;
}
interface PauseNotice { segment:number;probeId:number;epoch:number;incarnation:string;sender:string;receiver:string;deferred:boolean }
interface Link { pendingPause?:PauseNotice;pc:RTCPeerConnection;channel?:RTCDataChannel;fast?:RTCDataChannel;fastGate:LinkSendGate;fastBinding?:{segment:number;remoteConfirmed:boolean;pulse:LinkPulseMode;epoch:number;incarnation:string;sender:string;receiver:string};ingress:DirectIngress;remote:RemoteSignal;health:LinkHealth;gate:LinkSendGate;restart:LinkRestartPolicy;createdAt:number;local:Partial<Record<string,number>>;remoteTypes:Partial<Record<string,number>>;counts:{offersOut:number;offersIn:number;answersOut:number;answersIn:number;candidatesOut:number;relayFailed:number};lastFailure?:string }
export interface PeerTransportOptions { mesh?:boolean }
const RESTART_ATTEMPTS=4;
export class PeerTransport {
  binarySentBytes=0;
  fastSentBytes=0;
  id='';hostId='';connectionId='';sentBytes=0;
  grant?:AuthorityGrant;
  private authorityClock=new AuthorityClock(()=>performance.now());
  private connections=new Map<string,string>();
  connectionOf(id:string):string|undefined { return id===this.id?this.connectionId||undefined:this.connections.get(id); }
  members():string[] { return this.id?[this.id,...this.connections.keys()]:[]; }
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
    if(changed){
      this.received.clear();
      // Compact aliases may restart in a new service epoch only on fresh RTC associations.
      if(previous){const retired=[...this.links.values()];this.links.clear();for(const link of retired){link.gate.drain();link.fastGate.drain();link.pc.close();}}
      this.callbacks.authorityChanged?.();
      if(previous)for(const id of this.connections.keys())if(this.initiates(id))void this.offer(id).catch(()=>this.callbacks.status('Restoring direct links'));
    }
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
  constructor(readonly code:string,readonly token:string,private callbacks:TransportCallbacks,private options:PeerTransportOptions={}){}
  private initiates(id:string):boolean {return this.options.mesh?this.id<id:this.id===this.hostId;}
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
          // Membership is synchronous admission state, independent of slow ICE/SDP setup.
          if(this.options.mesh||this.id===this.hostId)for(const peer of message.peers)this.callbacks.peer(peer.id,true);
          // Offers and signals can arrive during this fetch; link() awaits the ICE config so no peer connection is built without STUN (#27).
          await this.ice.load(signal=>fetch(apiUrl(`/api/rooms/${this.code}/ice?token=${this.token}`),{signal}).then(response=>response.json()),AbortSignal.timeout(ICE_FETCH_TIMEOUT_MS));
          if(ws!==this.socket||this.stopped||this.connectionId!==message.connectionId)return;
          this.callbacks.status('Connected · checking room authority');
          if(this.options.mesh||this.id===this.hostId)for(const peer of message.peers){
            if(ws!==this.socket||this.stopped||this.connectionId!==message.connectionId)return;
            if(this.connections.get(peer.id)!==peer.connectionId)continue;
            if(this.initiates(peer.id))await this.offer(peer.id);
          }
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
            this.callbacks.peer(message.id,true);if(this.initiates(message.id))await this.offer(message.id);
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
    const socket=this.socket,localConnection=this.connectionId,remoteConnection=this.connections.get(id);
    if(!remoteConnection)return;
    const iceServers=await this.ice.iceServers();
    if(socket!==this.socket||this.stopped||this.connectionId!==localConnection||this.connections.get(id)!==remoteConnection)return undefined;
    const concurrent=this.links.get(id);if(concurrent)return concurrent;
    const pc=new RTCPeerConnection({iceServers});
    const now=performance.now();
    const link:Link={pc,fastGate:new LinkSendGate(),ingress:new DirectIngress(now),remote:new RemoteSignal(pc),health:new LinkHealth(now),gate:new LinkSendGate(),restart:restart??new LinkRestartPolicy(now,RESTART_ATTEMPTS),createdAt:now,local:{},remoteTypes:{},counts:{offersOut:0,offersIn:0,answersOut:0,answersIn:0,candidatesOut:0,relayFailed:0}};this.links.set(id,link);
    this.callbacks.linkReset?.(id);
    pc.onicecandidate=event=>{
      if(!isCurrentLinkCallback(this.links.get(id),link)||!event.candidate)return;
      const type=candidateType(event.candidate.candidate);link.local[type]=(link.local[type]??0)+1;
      if(this.relay('signal',id,{candidate:event.candidate.toJSON()}))link.counts.candidatesOut++;else link.counts.relayFailed++;
    };
    pc.ondatachannel=event=>{if(!isCurrentLinkCallback(this.links.get(id),link)){event.channel.close();return;}this.channel(id,link,event.channel);};
    pc.onconnectionstatechange=()=>{
      if(!isCurrentLinkCallback(this.links.get(id),link))return;
      if(pc.connectionState==='connected')this.callbacks.status('Direct peer link connected');
      // "disconnected" may recover through fresh probes (ADR035); only terminal states drain the link.
      if(pc.connectionState==='failed'||pc.connectionState==='closed'){link.gate.drain();link.fastGate.drain();}
      if(pc.connectionState==='failed'||pc.connectionState==='disconnected'){link.health.fail(performance.now());this.callbacks.status(`Direct connection interrupted — ${this.explain(id)}`);}
    };
    pc.oniceconnectionstatechange=()=>{
      if(!isCurrentLinkCallback(this.links.get(id),link))return;
      if(pc.iceConnectionState==='failed'||pc.iceConnectionState==='closed'){link.gate.drain();link.fastGate.drain();}
    };
    return link;
  }
  private channel(id:string,link:Link,channel:RTCDataChannel):void {
    if(channel.label==='actions'&&this.options.mesh){this.fastChannel(id,link,channel);return;}
    if(channel.label!=='game'||link.channel||!channel.ordered||channel.maxRetransmits!==null||channel.maxPacketLifeTime!==null){channel.close();return;}
    link.channel=channel;
    channel.binaryType='arraybuffer';
    channel.onmessage=event=>{
      if(!isCurrentLinkCallback(this.links.get(id),link,channel))return;
      try{
        if(event.data instanceof ArrayBuffer){
          if(event.data.byteLength>200000){channel.close();return;}
          const decoded=unpackMessage(new Uint8Array(event.data));
          if(Array.isArray(decoded)) {
            if (isBoundPause(decoded)) {
              const now = performance.now();
              if (!link.ingress.packet(event.data.byteLength, now) || link.ingress.flow('probe', 0, now) === 'limited') { link.gate.drain(); link.fastGate.drain(); channel.close(); this.callbacks.status('Direct pause flow exceeded its rate limit — retrying'); return; }
              if (this.fastBound(id, link) && decoded[1] === link.fastBinding!.segment && !link.gate.draining && !link.fastGate.draining) this.receivePause(id, link, decoded[1], now);
              return;
            }
            if(event.data.byteLength<=BOUND_CONTROL_BYTES&&isBoundControl(decoded)&&this.fastBound(id,link)&&link.fastBinding!.remoteConfirmed&&!link.gate.draining&&!link.fastGate.draining&&decoded[1]===link.fastBinding!.segment)this.callbacks.message(id,decoded);
          }else this.receive(id,decoded as Parameters<PeerTransport['receive']>[1],true);
        }
        else if(typeof event.data==='string'&&event.data.length<=200000)this.receive(id,JSON.parse(event.data),true);
        else channel.close();
      }catch{}
    };
    channel.onopen=()=>{if(isCurrentLinkCallback(this.links.get(id),link,channel))this.callbacks.status('Direct peer link connected');};
    const drain=()=>{link.gate.drain();link.fastGate.drain();};
    channel.onclosing=()=>{if(isCurrentLinkCallback(this.links.get(id),link,channel))drain();};
    channel.onclose=()=>{if(isCurrentLinkCallback(this.links.get(id),link,channel))drain();};
    channel.onerror=event=>{event.preventDefault();if(!isCurrentLinkCallback(this.links.get(id),link,channel))return;drain();this.callbacks.status('Direct connection failed · retrying');};
  }
  /** Compact aliases are installed only by a validated reliable bootstrap/handshake. */
  bindFast(id:string,segment:number,permissions:FastPermissions):boolean {
    const link=this.links.get(id),grant=this.grant,sender=this.connections.get(id);
    if(!this.options.mesh||!link||!grant||!sender||!this.authorityPermitted()||!uint32(segment)||segment===0)return false;
    const previous=link.fastBinding;
    if(previous&&segment<=previous.segment)return segment===previous.segment&&this.fastBound(id,link)&&link.ingress.bind(segment,permissions,performance.now());
    if(!link.ingress.bind(segment,permissions,performance.now()))return false;
    link.health.setPulseMode(false,performance.now());
    link.fastBinding={segment,remoteConfirmed:false,pulse:new LinkPulseMode(),epoch:grant.epoch,incarnation:grant.incarnation,sender,receiver:this.connectionId};return true;
  }
  private fastBound(id:string,link:Link):boolean {
    const binding=link.fastBinding;
    return !!binding&&this.authorityPermitted()&&binding.epoch===this.grant?.epoch&&binding.incarnation===this.grant?.incarnation&&binding.sender===this.connections.get(id)&&binding.receiver===this.connectionId;
  }
  private fastSegment(bytes:Uint8Array):number|undefined {
    if(bytes.byteLength>FAST_PACKET_BYTES)return;
    try {
      const packet=decodeDirectPacket(bytes);if(packet)return packet[1];
      const pulse=decodeHeartbeat(bytes);if(pulse)return pulse[1];
      const v=unpackMessage(bytes);
      if(Array.isArray(v)&&v.length===4&&v[0]===DIRECT_VERSION&&uint32(v[1])&&v[1]>0&&uint32(v[2])&&(v[2]<5||v[2]===8||v[2]===9||v[2]===12)&&uint32(v[3]))return v[1];
    }catch{}
  }
  private fastChannel(id:string,link:Link,channel:RTCDataChannel):void {
    if(link.fast||channel.ordered||channel.maxRetransmits!==0){channel.close();return;}
    link.fast=channel;channel.binaryType='arraybuffer';
    const current=()=>isCurrentLinkCallback(this.links.get(id),link)&&link.fast===channel;
    const drain=()=>{link.fastGate.drain();link.gate.drain();};
    channel.onmessage=event=>{
      if(!current())return;
      const now=performance.now();
      if(!(event.data instanceof ArrayBuffer)||!link.ingress.packet(event.data.byteLength,now)){drain();channel.close();this.callbacks.status('Direct action link exceeded its size/rate limit — retrying');return;}
      const bytes=new Uint8Array(event.data);
      if(!this.fastBound(id,link)||this.fastSegment(bytes)!==link.fastBinding!.segment)return;
      const control=unpackMessage(bytes) as unknown[];
      const admission=isHeartbeat(control)?link.ingress.heartbeat(control[5][0],control[5][1],now):link.ingress.flow(control.length===5?'action':control[2]===8||control[2]===9||control[2]===12?'probe':'receipt',control[2] as number,now);
      if(admission==='unauthorized')return;
      if(admission==='limited'){drain();channel.close();this.callbacks.status('Direct action flow exceeded its rate limit — retrying');return;}
      if(control.length===4&&(control[2]===8||control[2]===9||control[2]===12)){
        link.fastBinding!.remoteConfirmed=true;
        if(control[2]===12){const binding=link.fastBinding!;this.receivePause(id,link,control[1] as number,now);if(!current()||link.fastBinding!==binding||!this.fastBound(id,link))return;}
        const segment=control[1] as number,probeId=control[3] as number;
        if(control[2]===9)link.health.acknowledge(probeId,now);
        else this.defer(()=>{if(current())this.sendFastProbe(id,9,probeId,segment);});
        return;
      }
      const binding=link.fastBinding!,activated=binding.pulse.activated;
      if(isHeartbeat(control)&&binding.pulse.paused)return;
      const proof=this.callbacks.fast?.(id,bytes);
      if(isHeartbeat(control)&&proof?.status==='accepted'&&isCurrentPulseCallback(this.links.get(id),link,channel,binding,activated)&&this.fastBound(id,link)){
        if(!binding.pulse.accept())return;link.health.setPulseMode(true,performance.now());
        if(proof.acknowledged)link.health.acknowledgePulse(performance.now());
      }
    };
    channel.onclosing=channel.onclose=()=>{if(current())drain();};
    channel.onerror=event=>{event.preventDefault();if(current()){drain();this.callbacks.status('Direct action link interrupted — retrying');}};
  }
  activatePulse(id:string,segment:number):boolean {
    const link=this.links.get(id);
    if(!link||!this.flushPause(id,link)||!this.boundReady(id)||link.fastBinding!.segment!==segment)return false;
    return link.fastBinding!.pulse.activate();
  }
  deactivatePulse(id:string,segment:number):void {
    const link=this.links.get(id);
    if(!link||!this.fastBound(id,link)||link.fastBinding!.segment!==segment)return;
    const first = !link.fastBinding!.pulse.locallyPaused, now = performance.now();
    link.fastBinding!.pulse.pauseLocal();link.health.setPulseMode(false,now);
    if(first&&!link.pendingPause) {
      const { epoch, incarnation, sender, receiver } = link.fastBinding!;
      const probeId = link.health.probe(now);
      const pause:PauseNotice = { segment, probeId, epoch, incarnation, sender, receiver, deferred:true };
      link.pendingPause = pause;
      // Pause receipt can precede WebKit's queued closing notification. Freeze
      // immediately, but let that notification drain the gates before responding.
      this.defer(()=>{
        if(this.links.get(id)!==link||link.pendingPause!==pause||epoch!==this.grant?.epoch||incarnation!==this.grant?.incarnation||sender!==this.connections.get(id)||receiver!==this.connectionId)return;
        pause.deferred=false;
        this.sendFastProbe(id,12,probeId,segment);
        this.flushPause(id,link);
      });
    }
  }
  sendPulse(id:string,bytes:Uint8Array):boolean {
    const link=this.links.get(id),pulse=decodeHeartbeat(bytes);
    if(!link||!pulse||!this.fastBound(id,link)||!link.fastBinding!.pulse.activated||pulse[1]!==link.fastBinding!.segment||!permitsFastControl(this.stopped,document.hidden,link.fast,link.fastGate,link.channel,link.gate))return false;
    try{link.fast!.send(new Uint8Array(bytes));this.fastSentBytes+=bytes.byteLength;this.sentBytes+=bytes.byteLength;return true;}catch{return false;}
  }
  sendFast(id:string,bytes:Uint8Array):boolean {
    const link=this.links.get(id);
    if(!link||!this.fastReady(id)||this.fastSegment(bytes)!==link.fastBinding!.segment)return false;
    try{link.fast!.send(new Uint8Array(bytes));this.fastSentBytes+=bytes.byteLength;this.sentBytes+=bytes.byteLength;return true;}catch{return false;}
  }
  fastReady(id:string):boolean {
    const link=this.links.get(id);
    return !this.stopped&&!document.hidden&&!!link&&this.fastBound(id,link)&&link.fastGate.permits(link.fast,16_000)&&link.health.direct(performance.now());
  }
  /** Compact ordered control has the same alias/association gates, plus confirmed remote binding. */
  boundReady(id:string):boolean {
    const link=this.links.get(id);
    return !!link&&this.fastReady(id)&&link.fastBinding!.remoteConfirmed&&link.gate.permits(link.channel,GAMEPLAY_BUFFER_LIMIT);
  }
  sendBound(id:string,tuple:unknown[]):boolean {
    const link=this.links.get(id);
    if(!link||!this.flushPause(id,link)||!isBoundControl(tuple)||!this.boundReady(id)||tuple[1]!==link!.fastBinding!.segment)return false;
    const bytes=packMessage(tuple);if(bytes.byteLength>BOUND_CONTROL_BYTES||!permitsAggregate(this.links.values(),bytes.byteLength,COORDINATION_BUFFER_LIMIT))return false;
    try {link!.channel!.send(new Uint8Array(bytes));this.binarySentBytes+=bytes.byteLength;this.sentBytes+=bytes.byteLength;return true;}catch{return false;}
  }
  /** `force` replaces a drained link with a fresh RTCPeerConnection and gate; the restart budget carries over. */
  private async offer(id:string,force=false):Promise<void>{
    if(this.relayOnly)return;
    const old=this.links.get(id);if(!force&&old?.channel)return;if(force&&old){old.pc.close();this.links.delete(id);}
    const link=await this.link(id,force?old?.restart:undefined);if(!link||link.channel)return;this.channel(id,link,link.pc.createDataChannel('game'));
    if(this.options.mesh)this.channel(id,link,link.pc.createDataChannel('actions',{ordered:false,maxRetransmits:0}));
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
    if(this.options.mesh&&data.description?.type==='offer'&&this.initiates(id))return;
    const previous=this.links.get(id);
    if(data.description?.type==='offer'&&previous&&!sameCertificate(previous.pc.remoteDescription?.sdp,data.description.sdp??'')){previous.pc.close();this.links.delete(id);}
    const link=await this.link(id);if(!link||!isCurrentLinkCallback(this.links.get(id),link))return;
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
          if(link)this.defer(()=>{if(isCurrentLinkCallback(this.links.get(id),link))this.sendDirectProbe(id,{type:'linkPong',probeId},false);});
        }
        return;
      }
    }
    const seen=this.received.get(id)??new Set<number>();if(seen.has(envelope.id))return;
    seen.add(envelope.id);if(seen.size>1000)seen.delete(seen.values().next().value!);this.received.set(id,seen);
    this.callbacks.message(id,envelope.data);
  }
  /** Bulk lifecycle data yields to queued action traffic, even before segment aliases bind. */
  sendCheckpoint(id:string,data:unknown):boolean {
    const link=this.links.get(id);
    return !!link&&link.fastGate.permitsIdle(link.fast)&&this.sendEnvelope(id,data,true,CHECKPOINT_BUFFER_LIMIT);
  }
  send(id:string,data:unknown,binary=false):boolean {
    return this.sendEnvelope(id,data,binary,COORDINATION_BUFFER_LIMIT);
  }
  private sendEnvelope(id:string,data:unknown,binary:boolean,bufferLimit:number):boolean {
    if(this.stopped||!this.authorityPermitted()||!this.connections.has(id))return false;
    const pendingLink=this.links.get(id);if(pendingLink&&!this.flushPause(id,pendingLink))return false;
    const envelope={id:++this.seq,data,incarnation:this.grant!.incarnation,epoch:this.grant!.epoch,sender:this.connectionId,receiver:this.connections.get(id)!};const encoded=binary?new Uint8Array(packMessage(envelope)):JSON.stringify(envelope);this.sentBytes+=typeof encoded==='string'?new TextEncoder().encode(encoded).byteLength:encoded.byteLength;const link=this.links.get(id);
    const bytes=typeof encoded==='string'?new TextEncoder().encode(encoded).byteLength:encoded.byteLength;
    if(!document.hidden&&!this.relayOnly&&link?.gate.permits(link.channel,GAMEPLAY_BUFFER_LIMIT)&&link.health.direct(performance.now())&&permitsAggregate(this.links.values(),bytes,bufferLimit)){
      try{if(typeof encoded==='string')link.channel!.send(encoded);else{link.channel!.send(encoded);this.binarySentBytes+=encoded.byteLength;}return true;}catch{}
    }
    return false;
  }
  private receivePause(id:string,link:Link,segment:number,now:number):void {
    const binding=link.fastBinding!;
    binding.pulse.pauseRemote();link.health.setPulseMode(false,now);
    this.callbacks.paused?.(id,segment);
  }
  /** Reliable pause precedes later management even when the alias already changed. */
  private flushPause(id:string,link:Link):boolean {
    const pause=link.pendingPause;if(!pause)return true;
    if(this.links.get(id)!==link||pause.epoch!==this.grant?.epoch||pause.incarnation!==this.grant?.incarnation||pause.sender!==this.connections.get(id)||pause.receiver!==this.connectionId){link.pendingPause=undefined;return false;}
    if(pause.deferred||this.stopped||document.hidden||!this.authorityPermitted()||link.fastGate.draining||!link.gate.permits(link.channel,PROBE_BUFFER_LIMIT))return false;
    const bytes=packMessage([DIRECT_VERSION,pause.segment,12,pause.probeId]);
    try { link.channel!.send(new Uint8Array(bytes));this.binarySentBytes+=bytes.byteLength;this.sentBytes+=bytes.byteLength; }
    catch { return false; }
    if(this.links.get(id)!==link||link.pendingPause!==pause)return false;
    link.pendingPause=undefined;return true;
  }
  private sendFastProbe(id:string,kind:8|9|12,probeId:number,segment:number):boolean {
    const link=this.links.get(id);
    if(!link||!this.fastBound(id,link)||link.fastBinding!.segment!==segment||!permitsFastControl(this.stopped,document.hidden,link.fast,link.fastGate,link.channel,link.gate))return false;
    const bytes=packMessage([DIRECT_VERSION,segment,kind,probeId]);
    try{link.fast!.send(new Uint8Array(bytes));this.fastSentBytes+=bytes.byteLength;this.sentBytes+=bytes.byteLength;return true;}catch{return false;}
  }
  private sendDirectProbe(id:string,data:{type:string;probeId:number},allowFast=true):void {
    const link=this.links.get(id);
    if(allowFast&&link&&this.fastBound(id,link)&&link.fast?.readyState==='open'){
      this.sendFastProbe(id,link.fastBinding!.pulse.locallyPaused?12:8,data.probeId,link.fastBinding!.segment);
      // During pause the remote may have moved to a new alias before our header ACK can be sent.
      if(!link.fastBinding!.pulse.needsAssociationProbe(link.fastBinding!.remoteConfirmed))return;
    }
    if(this.stopped||document.hidden||!this.authorityPermitted()||!link?.gate.permits(link.channel,PROBE_BUFFER_LIMIT)||link.fastGate.draining)return;
    try{const encoded=JSON.stringify({id:++this.seq,data,incarnation:this.grant!.incarnation,epoch:this.grant!.epoch,sender:this.connectionId,receiver:this.connections.get(id)});link.channel!.send(encoded);this.sentBytes+=new TextEncoder().encode(encoded).byteLength;}catch{}
  }
  private checkLinks():void {
    if(this.stopped||document.hidden||!this.authorityPermitted())return;
    const now=performance.now();
    for(const [id,link] of this.links){
      this.flushPause(id,link);
      if(this.links.get(id)!==link)return;
      if(!link.fastBinding?.pulse.active)this.sendDirectProbe(id,{type:'linkProbe',probeId:link.health.probe(now)});
      if(link.health.direct(now)){link.restart.healthy(now);continue;}
      // A down socket cannot carry the restart offer; do not burn the budget on it.
      if(!link.health.shouldRestart(now)||!this.initiates(id)||this.socket?.readyState!==WebSocket.OPEN||!link.restart.due(now))continue;
      if(link.gate.draining||link.fastGate.draining){
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
      buffered+=(link.channel?.bufferedAmount??0)+(link.fast?.bufferedAmount??0);
      if(link.channel?.readyState!=='open')continue;
      const report=await link.pc.getStats();let usesRelay=false;
      report.forEach(stat=>{if(stat.type==='candidate-pair'&&stat.state==='succeeded'){const local=report.get(stat.localCandidateId);const remote=report.get(stat.remoteCandidateId);if(local?.candidateType==='relay'||remote?.candidateType==='relay')usesRelay=true;}});
      if(usesRelay)relayed++;else direct++;
    }
    return{direct,relayed,buffered,authority:this.authorityClock.diagnostics()};
  }
}
