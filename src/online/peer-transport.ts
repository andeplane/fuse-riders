import { handleRoomSocketClose } from './room-socket-close.js';
import { isCurrentLinkCallback } from './link-callback.js';
import { LinkHealth } from './link-health.js';
import { GAMEPLAY_BUFFER_LIMIT, LinkSendGate, PROBE_BUFFER_LIMIT } from './link-send-gate.js';
import { apiUrl } from './endpoints.js';
import { AuthorityClock, isAuthorityGrant, type AuthorityGrant } from './authority.js';
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
interface Link { pc:RTCPeerConnection;channel?:RTCDataChannel;ice:RTCIceCandidateInit[];seen:Set<number>;health:LinkHealth;gate:LinkSendGate;restartAt:number;restarting:boolean }
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
  private servers:RTCIceServer[]=[];
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
          try{const response=await fetch(apiUrl(`/api/rooms/${this.code}/ice?token=${this.token}`));const ice=await response.json();this.servers=ice.iceServers??[];}catch{this.servers=[];}
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
  private link(id:string):Link {
    const existing=this.links.get(id);if(existing)return existing;
    const pc=new RTCPeerConnection({iceServers:this.servers});
    const link:Link={pc,ice:[],seen:new Set(),health:new LinkHealth(performance.now()),gate:new LinkSendGate(),restartAt:performance.now()+8000,restarting:false};this.links.set(id,link);
    pc.onicecandidate=event=>{if(!isCurrentLinkCallback(this.links.get(id),link))return;if(event.candidate)this.relay('signal',id,{candidate:event.candidate.toJSON()});};
    pc.ondatachannel=event=>{if(!isCurrentLinkCallback(this.links.get(id),link)){event.channel.close();return;}this.channel(id,event.channel);};
    pc.onconnectionstatechange=()=>{
      if(!isCurrentLinkCallback(this.links.get(id),link))return;
      if(pc.connectionState==='connected')this.callbacks.status('Direct peer link connected');
      // "disconnected" may recover through fresh probes (ADR035); only terminal states drain the link.
      if(pc.connectionState==='failed'||pc.connectionState==='closed')link.gate.drain();
      if(pc.connectionState==='failed'||pc.connectionState==='disconnected'){link.health.fail(performance.now());this.callbacks.status('Direct connection interrupted · retrying');}
    };
    pc.oniceconnectionstatechange=()=>{
      if(!isCurrentLinkCallback(this.links.get(id),link))return;
      if(pc.iceConnectionState==='failed'||pc.iceConnectionState==='closed')link.gate.drain();
    };
    return link;
  }
  private channel(id:string,channel:RTCDataChannel):void {
    const link=this.link(id);link.channel=channel;
    channel.onmessage=event=>{if(!isCurrentLinkCallback(this.links.get(id),link,channel))return;if(typeof event.data!=='string'||event.data.length>200000){channel.close();return;}try{this.receive(id,JSON.parse(event.data),true);}catch{}};
    channel.onopen=()=>{if(isCurrentLinkCallback(this.links.get(id),link,channel))this.callbacks.status('Direct peer link connected');};
    channel.onclosing=()=>{if(isCurrentLinkCallback(this.links.get(id),link,channel))link.gate.drain();};
    channel.onclose=()=>{if(isCurrentLinkCallback(this.links.get(id),link,channel))link.gate.drain();};
    channel.onerror=event=>{event.preventDefault();if(!isCurrentLinkCallback(this.links.get(id),link,channel))return;link.gate.drain();this.callbacks.status('Direct connection failed · retrying');};
  }
  private async offer(id:string,force=false):Promise<void>{
    if(this.relayOnly)return;
    const old=this.links.get(id);if(!force&&old?.channel?.readyState==='open')return;if(old){old.pc.close();this.links.delete(id);}
    const link=this.link(id);this.channel(id,link.pc.createDataChannel('game'));
    await link.pc.setLocalDescription(await link.pc.createOffer());if(!isCurrentLinkCallback(this.links.get(id),link))return;this.relay('signal',id,{description:link.pc.localDescription});
  }
  private async signal(id:string,data:{description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit}):Promise<void>{
    if(this.relayOnly)return;
    if(data.description?.type==='offer'){this.links.get(id)?.pc.close();this.links.delete(id);}
    const link=this.link(id);
    if(data.description){
      await link.pc.setRemoteDescription(data.description);
      if(!isCurrentLinkCallback(this.links.get(id),link))return;
      for(const candidate of link.ice)await link.pc.addIceCandidate(candidate);link.ice=[];
      if(data.description.type==='offer'){await link.pc.setLocalDescription(await link.pc.createAnswer());if(!isCurrentLinkCallback(this.links.get(id),link))return;this.relay('signal',id,{description:link.pc.localDescription});}
    }else if(data.candidate){if(link.pc.remoteDescription)await link.pc.addIceCandidate(data.candidate);else if(link.ice.length<64)link.ice.push(data.candidate);}
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
  send(id:string,data:unknown):boolean {
    if(this.stopped||!this.authorityPermitted()||!this.connections.has(id))return false;
    const envelope={id:++this.seq,data,incarnation:this.grant!.incarnation,epoch:this.grant!.epoch,sender:this.connectionId,receiver:this.connections.get(id)!};this.sentBytes+=new TextEncoder().encode(JSON.stringify(envelope)).byteLength;const link=this.links.get(id);
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
      if(link.health.direct(now)){link.restartAt=now+8000;continue;}
      if(link.health.shouldRestart(now)&&this.id===this.hostId&&now>=link.restartAt&&!link.restarting){
        link.restarting=true;
        void this.offer(id,true).catch(()=>{link.restarting=false;link.restartAt=performance.now()+8000;});
      }
    }
  }
  /** Terminal for this page: report it as a notice the room runtime keeps on screen over recurring status. */
  private terminate(status:string):void{if(this.callbacks.terminated)this.callbacks.terminated(status);else this.callbacks.status(status);}
  close():void{this.stopped=true;this.deferred.length=0;this.authorityClock.invalidate();clearInterval(this.timeInterval);clearInterval(this.healthInterval);document.removeEventListener('visibilitychange',this.visibility);clearTimeout(this.retry);this.socket?.close();for(const link of this.links.values())link.pc.close();this.links.clear();}
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
