export interface TransportCallbacks {
  welcome:(id:string,hostId:string)=>void;
  peer:(id:string,online:boolean)=>void;
  message:(id:string,data:unknown)=>void;
  status:(status:string)=>void;
}
interface Link { pc:RTCPeerConnection;channel?:RTCDataChannel;ice:RTCIceCandidateInit[];seen:Set<number> }
export class PeerTransport {
  id='';hostId='';
  private socket?:WebSocket;
  private links=new Map<string,Link>();
  private seq=0;
  private stopped=false;
  private retry?:ReturnType<typeof setTimeout>;
  private servers:RTCIceServer[]=[];
  private relayOnly=new URLSearchParams(location.search).has('relay');
  constructor(readonly code:string,readonly token:string,private callbacks:TransportCallbacks){}
  connect():void {
    const url=new URL(`/api/rooms/${this.code}/ws`,location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';url.searchParams.set('token',this.token);
    const ws=new WebSocket(url);this.socket=ws;
    ws.onmessage=async event=>{
      if(ws!==this.socket)return;
      try {
        const message=JSON.parse(event.data);
        if(message.type==='welcome'){
          this.received.clear();
          this.id=message.id;this.hostId=message.hostId;
          try{const response=await fetch(`/api/rooms/${this.code}/ice?token=${this.token}`);const ice=await response.json();this.servers=ice.iceServers??[];}catch{this.servers=[];}
          this.callbacks.welcome(this.id,this.hostId);this.callbacks.status('Connected · negotiating direct link');
          if(this.id===this.hostId)for(const peer of message.peers){this.callbacks.peer(peer,true);await this.offer(peer);}
        }else if(message.type==='peer'){
          if(message.online)this.received.delete(message.id);
          const active=this.links.get(message.id)?.channel?.readyState==='open';
          if(message.online||!active)this.callbacks.peer(message.id,message.online);
          if(message.online&&this.id===this.hostId)await this.offer(message.id);
          if(!message.online&&!active){this.links.get(message.id)?.pc.close();this.links.delete(message.id);}
        }else if(message.type==='signal')await this.signal(message.from,message.data);
        else if(message.type==='relay')this.receive(message.from,message.data);
      }catch(error){this.callbacks.status(`Connection recovery: ${error instanceof Error?error.message:'invalid frame'}`);}
    };
    ws.onclose=event=>{
      if(ws!==this.socket)return;
      this.callbacks.status(event.code===4001?'Room opened in another tab':'Signalling disconnected · retrying');
      if(!this.stopped&&event.code!==4001)this.retry=setTimeout(()=>this.connect(),1500);
    };
    ws.onerror=()=>ws.close();
  }
  private relay(type:string,to:string,data:unknown):boolean {
    if(this.socket?.readyState!==WebSocket.OPEN||this.socket.bufferedAmount>256000)return false;
    this.socket.send(JSON.stringify({type,to,data}));return true;
  }
  private link(id:string):Link {
    const existing=this.links.get(id);if(existing)return existing;
    const pc=new RTCPeerConnection({iceServers:this.servers});
    const link:Link={pc,ice:[],seen:new Set()};this.links.set(id,link);
    pc.onicecandidate=event=>{if(event.candidate)this.relay('signal',id,{candidate:event.candidate.toJSON()});};
    pc.ondatachannel=event=>this.channel(id,event.channel);
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState==='connected')this.callbacks.status('Direct peer link connected');
      if(pc.connectionState==='failed'||pc.connectionState==='disconnected')this.callbacks.status('Using secure relay · direct link recovering');
    };
    return link;
  }
  private channel(id:string,channel:RTCDataChannel):void {
    const link=this.link(id);link.channel=channel;
    channel.onmessage=event=>{try{this.receive(id,JSON.parse(event.data));}catch{}};
    channel.onopen=()=>this.callbacks.status('Direct peer link connected');
  }
  private async offer(id:string):Promise<void>{
    if(this.relayOnly)return;
    const old=this.links.get(id);if(old?.channel?.readyState==='open')return;if(old){old.pc.close();this.links.delete(id);}
    const link=this.link(id);this.channel(id,link.pc.createDataChannel('game'));
    await link.pc.setLocalDescription(await link.pc.createOffer());this.relay('signal',id,{description:link.pc.localDescription});
  }
  private async signal(id:string,data:{description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit}):Promise<void>{
    if(this.relayOnly)return;
    if(data.description?.type==='offer'){this.links.get(id)?.pc.close();this.links.delete(id);}
    const link=this.link(id);
    if(data.description){
      await link.pc.setRemoteDescription(data.description);
      for(const candidate of link.ice)await link.pc.addIceCandidate(candidate);link.ice=[];
      if(data.description.type==='offer'){await link.pc.setLocalDescription(await link.pc.createAnswer());this.relay('signal',id,{description:link.pc.localDescription});}
    }else if(data.candidate){if(link.pc.remoteDescription)await link.pc.addIceCandidate(data.candidate);else link.ice.push(data.candidate);}
  }
  private received=new Map<string,Set<number>>();
  private receive(id:string,envelope:{id:number;data:unknown}):void {
    if(!envelope||!Number.isSafeInteger(envelope.id))return;
    const seen=this.received.get(id)??new Set<number>();if(seen.has(envelope.id))return;
    seen.add(envelope.id);if(seen.size>1000)seen.delete(seen.values().next().value!);this.received.set(id,seen);
    this.callbacks.message(id,envelope.data);
  }
  send(id:string,data:unknown):boolean {
    const envelope={id:++this.seq,data};const channel=this.links.get(id)?.channel;
    if(!this.relayOnly&&channel?.readyState==='open'&&channel.bufferedAmount<64000){
      try{channel.send(JSON.stringify(envelope));return true;}catch{}
    }
    return this.relay('relay',id,envelope);
  }
  close():void{this.stopped=true;clearTimeout(this.retry);this.socket?.close();for(const link of this.links.values())link.pc.close();}
  async stats():Promise<{direct:number;relayed:number;buffered:number}>{
    let direct=0,relayed=0,buffered=this.socket?.bufferedAmount??0;
    for(const link of this.links.values()){
      buffered+=link.channel?.bufferedAmount??0;
      if(link.channel?.readyState!=='open')continue;
      const report=await link.pc.getStats();let usesRelay=false;
      report.forEach(stat=>{if(stat.type==='candidate-pair'&&stat.state==='succeeded'){const local=report.get(stat.localCandidateId);const remote=report.get(stat.remoteCandidateId);if(local?.candidateType==='relay'||remote?.candidateType==='relay')usesRelay=true;}});
      if(usesRelay)relayed++;else direct++;
    }
    return{direct,relayed,buffered};
  }
}
