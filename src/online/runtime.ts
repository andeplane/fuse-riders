import { KeyframeDelivery, AcceptedKeyframe, type KeyframeReceipt } from './keyframe-delivery.js';
import { recipientAcknowledgements } from './recipient-ack.js';
import { isShotTransition } from './shot-failure.js';
import { isAppliedMotionState, isInputControlScope } from './prediction-validation.js';
import { DeferredCommand } from './deferred-command.js';
import { TickProbes } from './tick-probes.js';
import type { AppliedMotionState, TickClockSample, InputControlScope } from './prediction-contract.js';
import { JoinRequest } from './join-request.js';
import { HostSession, type RoomCommand } from './host-session.js';
import { PeerTransport } from './peer-transport.js';
import { WorldDecoder, WorldEncoder, type WorldFrame } from './world-codec.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import type { RoomSettings } from '../shared/room-settings.js';
import type { GameEvent } from '../shared/protocol.js';
interface WorldEnvelope {type:'world';frame:WorldFrame;settings:RoomSettings;ack:Record<string,number>;paused:boolean;motion?:AppliedMotionState}
interface Callbacks { shotFailed?:()=>void;state:(snapshot:ViewSnapshot,settings:RoomSettings,ack:number,matchId:string,motion?:AppliedMotionState)=>void;clock?:(sample:TickClockSample)=>void;event:(event:GameEvent,matchId:string,round:number,tick:number)=>void;status:(text:string)=>void;ready:(id:string,host:boolean)=>void }
export class RoomRuntime {
  private session?:HostSession;
  private peers=new Set<string>();
  private encoders=new Map<string,WorldEncoder>();
  private generations=new Map<string,number>();
  private keyframes=new Map<string,KeyframeDelivery<WorldEnvelope>>();
  private acceptedKeyframe=new AcceptedKeyframe();
  private lastResync=0;
  private decoder=new WorldDecoder();
  private lastState=performance.now();
  private readonly deferredHost=new DeferredCommand<RoomCommand>();
  private readonly tickProbes=new TickProbes(()=>performance.now());
  private lastClockProbe=-Infinity;
  private lastMotionScope='';
  private interval?:ReturnType<typeof setInterval>;
  private lastTick=performance.now();
  private accumulator=0;
  private announced=false;
  private authorityActive=false;
  private recovering=false;
  private lastPausedPublish=0;
  private readonly joinRequest=new JoinRequest<Extract<RoomCommand,{type:'join'}>>();
  readonly transport:PeerTransport;
  constructor(private code:string,token:string,settings:RoomSettings,private callbacks:Callbacks){
    this.transport=new PeerTransport(code,token,{
      welcome:(id,hostId)=>{
        if(id===hostId&&!this.session){
          this.session=new HostSession(id,settings,{token:()=>crypto.randomUUID()});
          try{const checkpoint=localStorage.getItem(`fuse-checkpoint-${code}`);if(checkpoint){const restored=this.session.restore(checkpoint);this.recovering=restored&&this.session.game.phase!=='lobby';if(!restored)this.callbacks.status('Saved game is incompatible or damaged — a fresh lobby is ready');}}catch{}
        }
        this.decoder.reset();this.acceptedKeyframe.clear();this.keyframes.clear();this.encoders.clear();this.callbacks.ready(id,id===hostId);
        if(id!==hostId)this.transport.send(hostId,{type:'resync'});
      },
      peer:(id,online)=>{
        if(online){this.peers.add(id);this.encoders.delete(id);this.keyframes.delete(id);if(id===this.transport.hostId&&!this.session){this.decoder.reset();this.acceptedKeyframe.clear();this.transport.send(id,{type:'resync'});}}
        else{this.peers.delete(id);this.encoders.delete(id);this.keyframes.delete(id);this.session?.disconnect(id);}
      },
      message:(id,data)=>this.receive(id,data),status:callbacks.status,
      revoked:()=>{this.deferredHost.clear();clearInterval(this.interval);this.session?.clear();this.session=undefined;this.callbacks.status('This host tab was replaced — use the newer tab');},
      authorityChanged:()=>{this.deferredHost.clear();this.tickProbes.clear();this.decoder.reset();this.acceptedKeyframe.clear();this.keyframes.clear();this.encoders.clear();this.session?.clear();this.accumulator=0;},
    });
  }
  start(){this.transport.connect();this.interval=setInterval(()=>this.tick(),10);}
  private receive(id:string,raw:unknown):void {
    if(!raw||typeof raw!=='object')return;
    const data=raw as {type:string;command?:RoomCommand;frame?:WorldFrame;settings?:RoomSettings;ack?:Record<string,number>;event?:GameEvent;error?:string;shotRejected?:boolean;paused?:boolean;matchId?:string;round?:number;tick?:number;motion?:AppliedMotionState;probeId?:number;localSentAt?:number;authorityTick?:number;scope?:InputControlScope;receipt?:KeyframeReceipt};
    if(this.session){
      if(data.type==='tickProbe'&&Number.isSafeInteger(data.probeId)&&Number.isFinite(data.localSentAt)){
        const scope=this.session.controlScope(id)??{matchId:this.session.game.matchId,round:this.session.game.round,controlEpoch:`spectator:${this.transport.grant?.epoch}`};if(scope)this.transport.send(id,{type:'tickPong',probeId:data.probeId,localSentAt:data.localSentAt,authorityTick:this.session.game.tick+this.accumulator/50,paused:document.hidden||this.recovering||this.session.game.phase!=='playing',scope});return;
      }
      if(data.type==='command'){const error=this.session.command(id,data.command);if(data.command?.type!=='input')this.save();if(error)this.transport.send(id,{type:'error',error,...(isShotTransition(data.command)?{shotRejected:true}:{})});this.peers.add(id);}
      if(data.type==='worldReceipt'){this.keyframes.get(id)?.acknowledge(data.receipt);return;}
      if(data.type==='resync'){this.peers.add(id);if(!this.keyframes.get(id)?.waiting)this.encoders.delete(id);}
      return;
    }
    if(id!==this.transport.hostId)return;
    if(data.type==='tickPong'&&isInputControlScope(data.scope)){
      const sample=this.tickProbes.accept(data.probeId!,data.localSentAt!,data.authorityTick!,data.paused!,data.scope);if(sample)this.callbacks.clock?.(sample);return;
    }
    if(data.type==='world'&&data.frame&&data.settings){
      const duplicateReceipt=this.acceptedKeyframe.receipt(raw as WorldEnvelope);
      if(duplicateReceipt){this.transport.send(id,{type:'worldReceipt',receipt:duplicateReceipt});return;}
      const result=this.decoder.decode(data.frame);
      if(result.status!=='accepted'){if((result.status==='needsBaseline'||result.status==='invalid')&&performance.now()-this.lastResync>=500){this.lastResync=performance.now();this.transport.send(id,{type:'resync'});}return;}
      const snapshot=result.state;
      if(data.frame.base===0){this.acceptedKeyframe.remember(raw as WorldEnvelope);const receipt=this.acceptedKeyframe.receipt(raw as WorldEnvelope);if(receipt)this.transport.send(id,{type:'worldReceipt',receipt});}
      if(snapshot.players.some(player=>player.id===this.transport.id&&player.connected))this.joinRequest.confirm();
      this.lastState=performance.now();
      if(isAppliedMotionState(data.motion)){const scope=JSON.stringify(data.motion.scope);if(scope!==this.lastMotionScope){this.lastMotionScope=scope;this.lastClockProbe=-Infinity;}}
    this.callbacks.state({...snapshot,tick:data.frame.tick,round:data.frame.round},data.settings,data.ack?.[this.transport.id]??-1,data.frame.matchId,isAppliedMotionState(data.motion)&&data.motion.tick===data.frame.tick&&data.motion.scope.matchId===data.frame.matchId&&data.motion.scope.round===data.frame.round?data.motion:undefined);
      this.callbacks.status(data.paused?'Paused — host is in the background':'Connected · direct game link');
    }else if(data.type==='event'&&data.event)this.callbacks.event(data.event,data.matchId??'',data.round??0,data.tick??0);
    else if(data.type==='error'){this.callbacks.status(data.error??'Room error');if(data.shotRejected===true)this.callbacks.shotFailed?.();}
  }
  command(command:RoomCommand):boolean {
    if(command.type==='join'){this.joinRequest.request(command);return true;}
    if(!this.transport.authorityPermitted()){
      if(this.session&&['action','settings','bot'].includes(command.type)){this.deferredHost.offer(command,performance.now());this.callbacks.status('Applying when the room connection is confirmed');return true;}
      this.callbacks.status('Waiting for room authority — try again when connected');if(isShotTransition(command))this.callbacks.shotFailed?.();return false;
    }
    if(this.session){const error=this.session.command(this.transport.id,command);if(command.type!=='input')this.save();if(error){this.callbacks.status(error);if(isShotTransition(command))this.callbacks.shotFailed?.();}return !error;}
    const sent=this.transport.send(this.transport.hostId,{type:'command',command});
    if(!sent&&isShotTransition(command))this.callbacks.shotFailed?.();return sent;
  }
  private tick():void {
    const now=performance.now(),elapsed=now-this.lastTick;this.lastTick=now;
    const deferred=this.deferredHost.drain(now,this.transport.authorityPermitted());
    if(deferred.status==='ready')this.command(deferred.value);
    else if(deferred.status==='expired')this.callbacks.status('Room action timed out — please try again');
    if(!this.transport.authorityPermitted()){this.accumulator=0;if(this.authorityActive)this.session?.clear();this.authorityActive=false;this.callbacks.status('Paused — confirming room authority');return;}
    this.authorityActive=true;
    if(now-this.lastClockProbe>=500){
      this.lastClockProbe=now;
      if(this.session){const scope=this.session.controlScope(this.transport.id)??{matchId:this.session.game.matchId,round:this.session.game.round,controlEpoch:`spectator:${this.transport.grant?.epoch}`};if(scope)this.callbacks.clock?.({scope,localSentAt:now,localReceivedAt:now,authorityTick:this.session.game.tick+this.accumulator/50,paused:document.hidden||this.recovering||this.session.game.phase!=='playing'});}
      else this.transport.send(this.transport.hostId,{type:'tickProbe',...this.tickProbes.request()});
    }
    this.joinRequest.retry(now,true,command=>{
      if(this.session){const error=this.session.command(this.transport.id,command);this.joinRequest.confirm();if(error)this.callbacks.status(error);else this.save();}
      else this.transport.send(this.transport.hostId,{type:'command',command});
    });
    if(!this.session){if(now-this.lastState>2000)this.callbacks.status('Waiting for direct connection — retrying; check Wi-Fi or network access');return;}
    if(this.recovering){
      if(this.session.game.phase==='lobby'||[...this.session.game.players.values()].filter(player=>player.alive).every(player=>player.connected))this.recovering=false;
      else{this.accumulator=0;if(now-this.lastPausedPublish>=500){this.publish(true);this.lastPausedPublish=now;}this.callbacks.status('Recovered game paused — waiting for riders to rejoin, or reset to main menu');return;}
    }
    this.accumulator+=Math.min(elapsed,100);
    if(document.hidden){
      if(!this.announced){this.session.clear();this.publish(true);this.announced=true;}this.accumulator=0;return;
    }
    this.announced=false;
    while(this.accumulator>=50){
      this.accumulator-=50;
      for(const event of this.session.advance()){
        const {matchId,round,tick}=this.session.game;this.callbacks.event(event,matchId,round,tick);for(const id of this.peers)this.transport.send(id,{type:'event',event,matchId,round,tick});
      }
      this.publish(false);
    }
  }
  private publish(paused:boolean):void {
    const session=this.session!;const game=session.game;const snapshot=session.snapshot();const ack=session.acknowledgements();
    if(game.tick%20===0||paused)try{localStorage.setItem(`fuse-checkpoint-${this.code}`,session.checkpoint());}catch{}
    this.callbacks.state({...snapshot,tick:game.tick,round:game.round},session.settings,ack[this.transport.id]??-1,game.matchId,session.appliedMotion(this.transport.id));
    const scope=session.controlScope(this.transport.id)??{matchId:game.matchId,round:game.round,controlEpoch:`spectator:${this.transport.grant?.epoch}`};
    const at=performance.now();this.callbacks.clock?.({scope,localSentAt:at,localReceivedAt:at,authorityTick:game.tick+this.accumulator/50,paused:paused||game.phase!=='playing'});
    for(const id of this.peers){
      let delivery=this.keyframes.get(id);if(!delivery){delivery=new KeyframeDelivery<WorldEnvelope>();this.keyframes.set(id,delivery);}
      if(!delivery.matchesScope(game.matchId,game.round)){delivery.clear();this.encoders.delete(id);}
      const pending=delivery.pump(at,world=>this.transport.send(id,world));
      if(pending==='waiting')continue;if(pending==='expired')this.encoders.delete(id);
      let encoder=this.encoders.get(id);const fresh=!encoder;if(!encoder){const generation=(this.generations.get(id)??0)+1;this.generations.set(id,generation);encoder=new WorldEncoder(generation);this.encoders.set(id,encoder);}
      const frame=encoder.encode(snapshot,game.matchId,game.round,game.tick,fresh||game.tick%300===0);
      const world:WorldEnvelope={type:'world',frame,settings:session.settings,ack:recipientAcknowledgements(ack,id),paused,motion:session.appliedMotion(id)};
      if(frame.base===0){delivery.hold(world,at);delivery.pump(at,payload=>this.transport.send(id,payload));}
      else if(!this.transport.send(id,world))this.encoders.delete(id);
    }
  }
  private save(){if(this.session)try{localStorage.setItem(`fuse-checkpoint-${this.code}`,this.session.checkpoint());}catch{}}
  stop(){this.save();clearInterval(this.interval);this.transport.close();}
}
