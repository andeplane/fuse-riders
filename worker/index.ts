interface Env { ROOMS: DurableObjectNamespace; ASSETS: Fetcher; TURN_KEY_ID?:string; TURN_API_TOKEN?:string }
interface Identity { id:string;host:boolean;window:number;count:number }
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const secret=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
async function peerId(token:string):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].slice(0,12).map(n=>n.toString(16).padStart(2,'0')).join('');}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.headers.get('Origin') && request.headers.get('Origin')!==url.origin)return json({error:'Origin denied'},403);
    if(url.pathname==='/api/rooms'&&request.method==='POST') {
      const code=secret().slice(0,10).toUpperCase(),token=secret();
      const room=env.ROOMS.get(env.ROOMS.idFromName(code));
      const result=await room.fetch(new Request(`${url.origin}/initialize`,{method:'POST',body:JSON.stringify({token})}));
      if(!result.ok)return result;
      return json({code,token},201);
    }
    const match=url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{10})\/(ws|ice)$/);
    if(match)return env.ROOMS.get(env.ROOMS.idFromName(match[1]!)).fetch(request);
    if(url.pathname.startsWith('/api/'))return json({error:'Not found'},404);
    return env.ASSETS.fetch(request);
  }
};
export class SignalRoom {
  constructor(private ctx:DurableObjectState,private env:Env){}
  async fetch(request:Request):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==='/initialize'){
      if(await this.ctx.storage.get('host'))return json({error:'Room exists'},409);
      const body=await request.json() as {token:string};
      await this.ctx.storage.put('host',body.token);
      await this.ctx.storage.setAlarm(Date.now()+24*60*60*1000);
      return json({ok:true});
    }
    const host=await this.ctx.storage.get<string>('host');if(!host)return json({error:'Room expired or not found'},404);
    const token=url.searchParams.get('token')??'';
    if(!/^[a-f0-9]{64}$/.test(token))return json({error:'Invalid identity'},401);
    const id=await peerId(token);
    if(url.pathname.endsWith('/ice')){
      if(!this.ctx.getWebSockets().some(ws=>(ws.deserializeAttachment() as Identity).id===id))return json({error:'Join the room first'},403);
      if(!this.env.TURN_KEY_ID||!this.env.TURN_API_TOKEN)return json({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],relayConfigured:false});
      const response=await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${this.env.TURN_KEY_ID}/credentials/generate-ice-servers`,{method:'POST',headers:{Authorization:`Bearer ${this.env.TURN_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({ttl:3600})});
      if(!response.ok)return json({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],relayConfigured:false});
      const body=await response.json() as {iceServers:unknown};return json({iceServers:body.iceServers,relayConfigured:true});
    }
    if(request.headers.get('Upgrade')!=='websocket')return json({error:'WebSocket required'},426);
    const sockets=this.ctx.getWebSockets();
    if(sockets.length>=12&&!sockets.some(ws=>(ws.deserializeAttachment() as Identity).id===id))return json({error:'Room connection limit'},429);
    for(const ws of sockets)if((ws.deserializeAttachment() as Identity).id===id)ws.close(4001,'Reconnected elsewhere');
    const pair=new WebSocketPair();const client=pair[0],server=pair[1];
    this.ctx.acceptWebSocket(server);server.serializeAttachment({id,host:token===host,window:Date.now(),count:0} satisfies Identity);
    server.send(JSON.stringify({type:'welcome',id,hostId:await peerId(host),peers:this.ctx.getWebSockets().filter(ws=>ws!==server).map(ws=>(ws.deserializeAttachment() as Identity).id)}));
    this.broadcast({type:'peer',id,online:true},server);
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer):void {
    if(typeof raw!=='string'||raw.length>200000){ws.close(1009,'Too large');return;}
    const identity=ws.deserializeAttachment() as Identity;
    if(Date.now()-identity.window>1000){identity.window=Date.now();identity.count=0;}
    if(++identity.count>100){ws.close(1008,'Rate limit');return;}ws.serializeAttachment(identity);
    let message:{type:string;to?:string;data?:unknown};try{message=JSON.parse(raw);}catch{return;}
    if(!['signal','relay'].includes(message.type)||typeof message.to!=='string')return;
    const target=this.ctx.getWebSockets().find(peer=>(peer.deserializeAttachment() as Identity).id===message.to);
    if(!target)return;
    const targetIdentity=target.deserializeAttachment() as Identity;
    // Only host-to-peer edges are valid. A joiner cannot send commands as another player.
    if(!identity.host&&!targetIdentity.host)return;
    target.send(JSON.stringify({type:message.type,from:identity.id,data:message.data}));
  }
  webSocketClose(ws:WebSocket):void {this.broadcast({type:'peer',id:(ws.deserializeAttachment() as Identity).id,online:false},ws);}
  webSocketError(ws:WebSocket):void {this.webSocketClose(ws);}
  private broadcast(message:unknown,except?:WebSocket){for(const ws of this.ctx.getWebSockets())if(ws!==except)try{ws.send(JSON.stringify(message));}catch{}}
  async alarm():Promise<void>{
    if(this.ctx.getWebSockets().length){await this.ctx.storage.setAlarm(Date.now()+60*60*1000);return;}
    await this.ctx.storage.deleteAll();
  }
}
