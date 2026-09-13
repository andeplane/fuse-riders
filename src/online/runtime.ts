import { HostSession, type RoomCommand } from './host-session.js';
import { PeerTransport } from './peer-transport.js';
import { WorldDecoder, WorldEncoder, type WorldFrame } from './world-codec.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import type { RoomSettings } from '../shared/room-settings.js';
import type { GameEvent } from '../shared/protocol.js';
interface Callbacks { state:(snapshot:ViewSnapshot,settings:RoomSettings,ack:number,matchId:string)=>void;event:(event:GameEvent,matchId:string,round:number,tick:number)=>void;status:(text:string)=>void;ready:(id:string,host:boolean)=>void }
export class RoomRuntime {
  private session?:HostSession;
  private peers=new Set<string>();
  private encoders=new Map<string,WorldEncoder>();
  private generations=new Map<string,number>();
  private lastResync=0;
  private decoder=new WorldDecoder();
  private lastState=performance.now();
  private interval?:ReturnType<typeof setInterval>;
  private lastTick=performance.now();
  private accumulator=0;
  private announced=false;
  private recovering=false;
  private lastPausedPublish=0;
  readonly transport:PeerTransport;
  constructor(private code:string,token:string,settings:RoomSettings,private callbacks:Callbacks){
    this.transport=new PeerTransport(code,token,{
      welcome:(id,hostId)=>{
        if(id===hostId&&!this.session){
          this.session=new HostSession(id,settings,{token:()=>crypto.randomUUID()});
          try{const checkpoint=localStorage.getItem(`fuse-checkpoint-${code}`);if(checkpoint){const restored=this.session.restore(checkpoint);this.recovering=restored&&this.session.game.phase!=='lobby';if(!restored)this.callbacks.status('Saved game is incompatible or damaged — a fresh lobby is ready');}}catch{}
        }
        this.decoder.reset();this.callbacks.ready(id,id===hostId);
        if(id!==hostId)this.transport.send(hostId,{type:'resync'});
      },
      peer:(id,online)=>{
        if(online){this.peers.add(id);this.encoders.delete(id);if(id===this.transport.hostId&&!this.session){this.decoder.reset();this.transport.send(id,{type:'resync'});}}
        else{this.peers.delete(id);this.encoders.delete(id);this.session?.disconnect(id);}
      },
      message:(id,data)=>this.receive(id,data),status:callbacks.status,
      revoked:()=>{clearInterval(this.interval);this.session?.clear();this.session=undefined;this.callbacks.status('This host tab was replaced — use the newer tab');},
      authorityChanged:()=>{this.decoder.reset();this.encoders.clear();this.session?.clear();this.accumulator=0;},
    });
  }
  start(){this.transport.connect();this.interval=setInterval(()=>this.tick(),10);}
  private receive(id:string,raw:unknown):void {
    if(!raw||typeof raw!=='object')return;
    const data=raw as {type:string;command?:RoomCommand;frame?:WorldFrame;settings?:RoomSettings;ack?:Record<string,number>;event?:GameEvent;error?:string;paused?:boolean;matchId?:string;round?:number;tick?:number};
    if(this.session){
      if(data.type==='command'){const error=this.session.command(id,data.command);if(data.command?.type!=='input')this.save();if(error)this.transport.send(id,{type:'error',error});this.peers.add(id);}
      if(data.type==='resync'){this.peers.add(id);this.encoders.delete(id);}
      return;
    }
    if(id!==this.transport.hostId)return;
    if(data.type==='world'&&data.frame&&data.settings){
      const result=this.decoder.decode(data.frame);
      if(result.status!=='accepted'){if((result.status==='needsBaseline'||result.status==='invalid')&&performance.now()-this.lastResync>=500){this.lastResync=performance.now();this.transport.send(id,{type:'resync'});}return;}
      const snapshot=result.state;
      this.lastState=performance.now();
    this.callbacks.state({...snapshot,tick:data.frame.tick,round:data.frame.round},data.settings,data.ack?.[this.transport.id]??-1,data.frame.matchId);
      if(data.paused)this.callbacks.status('Paused — host is in the background');
    }else if(data.type==='event'&&data.event)this.callbacks.event(data.event,data.matchId??'',data.round??0,data.tick??0);
    else if(data.type==='error')this.callbacks.status(data.error??'Room error');
  }
  command(command:RoomCommand):boolean {
    if(!this.transport.authorityPermitted()){this.callbacks.status('Waiting for room authority — try again when connected');return false;}
    if(this.session){const error=this.session.command(this.transport.id,command);if(command.type!=='input')this.save();if(error)this.callbacks.status(error);return !error;}
    return this.transport.send(this.transport.hostId,{type:'command',command});
  }
  private tick():void {
    const now=performance.now(),elapsed=now-this.lastTick;this.lastTick=now;
    if(!this.transport.authorityPermitted()){this.accumulator=0;this.session?.clear();this.callbacks.status('Paused — confirming room authority');return;}
    if(!this.session){if(now-this.lastState>2000)this.callbacks.status('Waiting for host — reconnecting');return;}
    if(this.recovering){
      if(this.session.game.phase==='lobby'||[...this.session.game.players.values()].filter(player=>player.alive).every(player=>player.connected))this.recovering=false;
      else{this.accumulator=0;if(now-this.lastPausedPublish>=500){this.publish(true);this.lastPausedPublish=now;}this.callbacks.status('Recovered game paused — waiting for riders to rejoin, or reset to main menu');return;}
    }
    this.accumulator+=Math.min(elapsed,100);
    if(document.hidden){
      if(!this.announced){this.publish(true);this.announced=true;}this.accumulator=0;this.session.clear();return;
    }
    this.announced=false;
    while(this.accumulator>=50){
      this.accumulator-=50;
      for(const event of this.session.advance()){
        const {matchId,round,tick}=this.session.game;this.callbacks.event(event,matchId,round,tick);for(const id of this.peers)this.transport.send(id,{type:'event',event,matchId,round,tick});
      }
      if(this.session.game.tick%2===0)this.publish(false);
    }
  }
  private publish(paused:boolean):void {
    const session=this.session!;const game=session.game;const snapshot=session.snapshot();const ack=session.acknowledgements();
    if(game.tick%20===0||paused)try{localStorage.setItem(`fuse-checkpoint-${this.code}`,session.checkpoint());}catch{}
    this.callbacks.state({...snapshot,tick:game.tick,round:game.round},session.settings,ack[this.transport.id]??-1,game.matchId);
    for(const id of this.peers){
      let encoder=this.encoders.get(id);const fresh=!encoder;if(!encoder){const generation=(this.generations.get(id)??0)+1;this.generations.set(id,generation);encoder=new WorldEncoder(generation);this.encoders.set(id,encoder);}
      const frame=encoder.encode(snapshot,game.matchId,game.round,game.tick,fresh||game.tick%300===0);
      if(!this.transport.send(id,{type:'world',frame,settings:session.settings,ack,paused}))this.encoders.delete(id);
    }
  }
  private save(){if(this.session)try{localStorage.setItem(`fuse-checkpoint-${this.code}`,this.session.checkpoint());}catch{}}
  stop(){this.save();clearInterval(this.interval);this.transport.close();}
}
