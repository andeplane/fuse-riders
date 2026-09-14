import { handleRoomSocketClose } from './room-socket-close.js';
import { isCurrentLinkCallback } from './link-callback.js';
import { LinkHealth } from './link-health.js';
import { apiUrl } from './endpoints.js';
import { AuthorityClock, isAuthorityGrant, type AuthorityGrant } from './authority.js';
export interface TransportCallbacks {
  welcome:(id:string,hostId:string)=>void;
  peer:(id:string,online:boolean)=>void;
  message:(id:string,data:unknown)=>void;
  status:(status:string)=>void;
  revoked?:()=>void;
  ended?:()=>void;
  authorityChanged?:()=>void;
}
interface Link { pc:RTCPeerConnection;channel?:RTCDataChannel;ice:RTCIceCandidateInit[];seen:Set<number>;health:LinkHealth;restartAt:number;restarting:boolean }
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
          if(message.protocol!==2||typeof message.connectionId!=='string'){this.callbacks.status('Game protocol changed — reload this page');this.close();return;}
          this.received.clear();
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
          }else if(this.connections.get(message.id)===message.connectionId&&this.links.get(message.id)?.channel?.readyState!=='open'){
            this.connections.delete(message.id);this.callbacks.peer(message.id,false);this.links.get(message.id)?.pc.close();this.links.delete(message.id);
          }
        }else if(message.type==='signal'&&this.connections.get(message.from)===message.connectionId)await this.signal(message.from,message.data);

      }catch(error){this.callbacks.status(`Connection recovery: ${error instanceof Error?error.message:'invalid frame'}`);}
    };
    ws.onclose=event=>{
      if(ws!==this.socket)return;
      handleRoomSocketClose(event.code,{stopped:()=>this.stopped,stop:()=>this.close(),revoked:()=>this.callbacks.revoked?.(),ended:()=>this.callbacks.ended?.(),status:this.callbacks.status,retry:()=>{this.retry=setTimeout(()=>this.connect(),1500);}});
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
    const link:Link={pc,ice:[],seen:new Set(),health:new LinkHealth(performance.now()),restartAt:performance.now()+8000,restarting:false};this.links.set(id,link);
    pc.onicecandidate=event=>{if(!isCurrentLinkCallback(this.links.get(id),link))return;if(event.candidate)this.relay('signal',id,{candidate:event.candidate.toJSON()});};
    pc.ondatachannel=event=>{if(!isCurrentLinkCallback(this.links.get(id),link)){event.channel.close();return;}this.channel(id,event.channel);};
    pc.onconnectionstatechange=()=>{
      if(!isCurrentLinkCallback(this.links.get(id),link))return;
      if(pc.connectionState==='connected')this.callbacks.status('Direct peer link connected');
      if(pc.connectionState==='failed'||pc.connectionState==='disconnected'){link.health.fail(performance.now());this.callbacks.status('Direct connection interrupted · retrying');}
    };
    return link;
  }
  private channel(id:string,channel:RTCDataChannel):void {
    const link=this.link(id);link.channel=channel;
    channel.onmessage=event=>{if(!isCurrentLinkCallback(this.links.get(id),link,channel))return;if(typeof event.data!=='string'||event.data.length>200000){channel.close();return;}try{this.receive(id,JSON.parse(event.data),true);}catch{}};
    channel.onopen=()=>{if(isCurrentLinkCallback(this.links.get(id),link,channel))this.callbacks.status('Direct peer link connected');};
    channel.onerror=event=>{event.preventDefault();if(!isCurrentLinkCallback(this.links.get(id),link,channel))return;this.callbacks.status('Direct connection failed · retrying');};
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
        else this.sendDirectProbe(id,{type:'linkPong',probeId:probe.probeId!});
        return;
      }
    }
    const seen=this.received.get(id)??new Set<number>();if(seen.has(envelope.id))return;
    seen.add(envelope.id);if(seen.size>1000)seen.delete(seen.values().next().value!);this.received.set(id,seen);
    this.callbacks.message(id,envelope.data);
  }
  send(id:string,data:unknown):boolean {
    if(this.stopped||!this.authorityPermitted()||!this.connections.has(id))return false;
    const envelope={id:++this.seq,data,incarnation:this.grant!.incarnation,epoch:this.grant!.epoch,sender:this.connectionId,receiver:this.connections.get(id)!};this.sentBytes+=new TextEncoder().encode(JSON.stringify(envelope)).byteLength;const channel=this.links.get(id)?.channel;
    if(!document.hidden&&!this.relayOnly&&channel?.readyState==='open'&&this.links.get(id)!.health.direct(performance.now())&&channel.bufferedAmount<64000){
      try{channel.send(JSON.stringify(envelope));return true;}catch{}
    }
    return false;
  }
  private sendDirectProbe(id:string,data:{type:string;probeId:number}):void {
    const channel=this.links.get(id)?.channel;
    if(!this.authorityPermitted()||channel?.readyState!=='open'||channel.bufferedAmount>4096)return;
    try{channel.send(JSON.stringify({id:++this.seq,data,incarnation:this.grant!.incarnation,epoch:this.grant!.epoch,sender:this.connectionId,receiver:this.connections.get(id)}));}catch{}
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
  close():void{this.stopped=true;this.authorityClock.invalidate();clearInterval(this.timeInterval);clearInterval(this.healthInterval);document.removeEventListener('visibilitychange',this.visibility);clearTimeout(this.retry);this.socket?.close();for(const link of this.links.values())link.pc.close();this.links.clear();}
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
