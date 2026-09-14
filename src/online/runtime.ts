import { REPLAY_RULES } from '../shared/action-log.js';
import { ActionSender, ActionReceiver, ACTION_VERSION } from './action-replication.js';
import { toSnapshot } from '../shared/game.js';
import { authorityTransitionStatus } from './authority-status.js';
import { StatusNotices } from './status-notices.js';
import { AuthorityGrace } from './authority-grace.js';
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
export interface Callbacks { shotFailed?:()=>void;state:(snapshot:ViewSnapshot,settings:RoomSettings,ack:number,matchId:string,motion?:AppliedMotionState)=>void;clock?:(sample:TickClockSample)=>void;event:(event:GameEvent,matchId:string,round:number,tick:number)=>void;status:(text:string)=>void;ready:(id:string,host:boolean)=>void;ended?:()=>void }
export class RoomRuntime {
  private readonly actionMode=new URLSearchParams(location.search).get('replication')==='actions';
  private readonly displayRole=new URLSearchParams(location.search).has('display');
  private readonly actionPeers=new Map<string,{sender:ActionSender;display:boolean;full:boolean;lastResync:number}>();
  private readonly actionReceiver=new ActionReceiver();
  private actionStopped=false;
  private actionNegotiated=false;
  private actionFull=false;
  private actionHelloStarted=-Infinity;
  private lastActionResync=-Infinity;
  get replicationDiagnostics(){return {mode:this.actionMode?'actions':'snapshots',acceptedBatches:this.actionReceiver.acceptedBatches,hashMismatches:this.actionReceiver.hashMismatches,replicaTick:this.actionReceiver.state?.game.tick??null,fullViewPeers:[...this.actionPeers.values()].filter(p=>p.full).length,controllerPeers:[...this.actionPeers.values()].filter(p=>!p.full).length,binarySentBytes:this.transport.binarySentBytes};}
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
  private readonly authorityGrace=new AuthorityGrace();
  private recovering=false;
  private lastPausedPublish=0;
  private readonly joinRequest=new JoinRequest<Extract<RoomCommand,{type:'join'}>>();
  readonly transport:PeerTransport;
  private readonly status:StatusNotices;
  constructor(private code:string,token:string,settings:RoomSettings,private callbacks:Callbacks){
    this.status=new StatusNotices(()=>performance.now(),text=>callbacks.status(text));
    this.transport=new PeerTransport(code,token,{
      welcome:(id,hostId)=>{
        if(id===hostId&&!this.session){
          this.session=new HostSession(id,settings,{token:()=>crypto.randomUUID(),captureActions:this.actionMode});
          try{const checkpoint=localStorage.getItem(`fuse-checkpoint-${code}`);if(checkpoint){const restored=this.session.restore(checkpoint);this.recovering=restored&&this.session.game.phase!=='lobby';if(!restored)this.status.notice('Saved game is incompatible or damaged — a fresh lobby is ready');}}catch{}
        }
        this.decoder.reset();this.acceptedKeyframe.clear();this.keyframes.clear();this.encoders.clear();this.actionReceiver.reset();this.actionPeers.clear();this.actionNegotiated=false;this.actionHelloStarted=-Infinity;this.callbacks.ready(id,id===hostId);
        if(id!==hostId)this.transport.send(hostId,{type:'resync'});
      },
      peer:(id,online)=>{
        if(online){this.peers.add(id);this.encoders.delete(id);this.keyframes.delete(id);if(id===this.transport.hostId&&!this.session){this.decoder.reset();this.acceptedKeyframe.clear();this.transport.send(id,{type:'resync'});}}
        else{this.actionPeers.delete(id);this.peers.delete(id);this.encoders.delete(id);this.keyframes.delete(id);this.session?.disconnect(id);}
      },
      message:(id,data)=>this.receive(id,data),status:text=>this.status.recurring(text),
      ended:()=>{this.deferredHost.clear();this.joinRequest.confirm();clearInterval(this.interval);this.session?.clear();this.session=undefined;this.peers.clear();this.tickProbes.clear();this.decoder.reset();this.acceptedKeyframe.clear();this.keyframes.clear();this.encoders.clear();this.actionReceiver.reset();this.actionPeers.clear();this.actionNegotiated=false;this.actionHelloStarted=-Infinity;this.callbacks.ended?.();},
      revoked:()=>{this.deferredHost.clear();clearInterval(this.interval);this.interval=undefined;this.session?.clear();this.session=undefined;this.status.terminal('This host tab was replaced — use the newer tab');},
      // A protocol mismatch closes the transport; the tick interval has to stop too, or it would keep restating
      // connection status over the reload notice (#23).
      terminated:text=>{this.deferredHost.clear();this.joinRequest.confirm();clearInterval(this.interval);this.interval=undefined;this.status.terminal(text);},
      authorityChanged:()=>{this.deferredHost.clear();this.tickProbes.clear();this.decoder.reset();this.acceptedKeyframe.clear();this.keyframes.clear();this.encoders.clear();this.actionReceiver.reset();this.actionPeers.clear();this.actionNegotiated=false;this.actionHelloStarted=-Infinity;this.session?.clear();this.authorityGrace.reset();this.accumulator=0;},
    });
  }
  start(){this.transport.connect();this.interval=setInterval(()=>this.tick(),10);}
  private receive(id:string,raw:unknown):void {
    if(!raw||typeof raw!=='object')return;
    const data=raw as {type:string;command?:RoomCommand;frame?:WorldFrame;settings?:RoomSettings;ack?:Record<string,number>;event?:GameEvent;error?:string;transient?:boolean;shotRejected?:boolean;paused?:boolean;matchId?:string;round?:number;tick?:number;motion?:AppliedMotionState;probeId?:number;localSentAt?:number;authorityTick?:number;scope?:InputControlScope;receipt?:KeyframeReceipt};
    if(this.actionMode&&id===this.transport.hostId&&!this.session&&data.type==='actionUnsupported'){this.actionStopped=true;this.status.terminal('Action replay protocol unavailable — reload every participant with the same build');return;}
    if(this.session){
      if(data.type==='actionHello'){
        const hello=raw as {version?:number;rules?:string;display?:boolean};
        if(!this.actionMode||hello.version!==ACTION_VERSION||hello.rules!==REPLAY_RULES||typeof hello.display!=='boolean'){this.transport.send(id,{type:'actionUnsupported'});return;}
        this.transport.send(id,{type:'actionWelcome',version:ACTION_VERSION,rules:REPLAY_RULES,full:hello.display||this.session.settings.mode==='devices'});
        const old=this.actionPeers.get(id);
        if(!old){this.actionPeers.set(id,{sender:new ActionSender(),display:hello.display,full:hello.display||this.session.settings.mode==='devices',lastResync:-Infinity});this.encoders.delete(id);this.keyframes.delete(id);}
        return;
      }
      if(data.type==='actionReceipt'){this.actionPeers.get(id)?.sender.receive(raw);return;}
      if(data.type==='actionResync'){const peer=this.actionPeers.get(id);if(peer&&performance.now()-peer.lastResync>=500){peer.lastResync=performance.now();peer.sender.requestBaseline();}return;}
      if(data.type==='tickProbe'&&Number.isSafeInteger(data.probeId)&&Number.isFinite(data.localSentAt)){
        const scope=this.session.controlScope(id)??{matchId:this.session.game.matchId,round:this.session.game.round,controlEpoch:`spectator:${this.transport.grant?.epoch}`};if(scope)this.transport.send(id,{type:'tickPong',probeId:data.probeId,localSentAt:data.localSentAt,authorityTick:this.session.game.tick+this.accumulator/50,paused:document.hidden||this.recovering||this.session.game.phase!=='playing',scope});return;
      }
      if(data.type==='command'){const error=this.session.command(id,data.command);if(data.command?.type!=='input')this.save();if(error)this.transport.send(id,{type:'error',error,...(data.command?.type==='input'?{transient:true}:{}),...(isShotTransition(data.command)?{shotRejected:true}:{})});this.peers.add(id);}
      if(data.type==='worldReceipt'){this.keyframes.get(id)?.acknowledge(data.receipt);return;}
      if(data.type==='resync'){this.peers.add(id);if(!this.keyframes.get(id)?.waiting)this.encoders.delete(id);}
      return;
    }
    if(id!==this.transport.hostId)return;
    if(this.actionMode&&data.type==='actionWelcome'){const welcome=raw as {version?:number;rules?:string;full?:boolean};if(welcome.version===ACTION_VERSION&&welcome.rules===REPLAY_RULES&&typeof welcome.full==='boolean'){this.actionNegotiated=true;this.actionFull=welcome.full;if(!welcome.full)this.actionReceiver.release();}return;}
    if(this.actionMode&&this.actionNegotiated&&this.actionFull&&!this.actionStopped&&(data.type==='actionChunk'||data.type==='actionBatch')){
      const now=performance.now(),result=this.actionReceiver.receive(raw,now);
      if('receipt'in result&&result.receipt)this.transport.send(id,result.receipt,true);
      if(result.status==='accepted'){
        const {state,meta}=result,snapshot=toSnapshot(state.game);
        if(snapshot.players.some(player=>player.id===this.transport.id&&player.connected))this.joinRequest.confirm();
        this.lastState=now;this.callbacks.state({...snapshot,tick:state.game.tick,round:state.game.round},meta.settings,meta.ack,state.game.matchId,meta.motion??undefined);
        this.status.recurring(meta.paused?'Paused — host is in the background':'Connected · experimental action replay');
      }else if(result.status==='failed'){this.actionStopped=true;this.status.terminal('Action replay diverged repeatedly — reload to recover');}
      else if(result.status==='resync'&&now-this.lastActionResync>=500){this.lastActionResync=now;this.transport.send(id,{type:'actionResync'},true);this.status.recurring('Repairing action replay — waiting for a checkpoint');}
      return;
    }
    if(data.type==='tickPong'&&isInputControlScope(data.scope)){
      const sample=this.tickProbes.accept(data.probeId!,data.localSentAt!,data.authorityTick!,data.paused!,data.scope);if(sample)this.callbacks.clock?.(sample);return;
    }
    if(data.type==='world'&&data.frame&&data.settings){
      if(this.actionMode&&(!this.actionNegotiated||this.actionFull||this.actionStopped))return;
      if(this.actionMode&&!(raw as {controller?:boolean}).controller)return;
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
      this.status.recurring(data.paused?'Paused — host is in the background':'Connected · direct game link');
    }else if(data.type==='event'&&data.event)this.callbacks.event(data.event,data.matchId??'',data.round??0,data.tick??0);
    else if(data.type==='error'){const text=data.error??'Room error';if(data.transient===true)this.status.transient(text);else this.status.notice(text);if(data.shotRejected===true)this.callbacks.shotFailed?.();}
  }
  command(command:RoomCommand):boolean {
    if(this.actionStopped){if(isShotTransition(command))this.callbacks.shotFailed?.();return false;}
    if(command.type==='join'){this.joinRequest.request(command);return true;}
    if(!this.transport.authorityPermitted()){
      if(this.session&&['action','settings','bot'].includes(command.type)){this.deferredHost.offer(command,performance.now());this.status.notice('Applying when the room connection is confirmed');return true;}
      this.status.notice('Waiting for room authority — try again when connected');if(isShotTransition(command))this.callbacks.shotFailed?.();return false;
    }
    if(this.session){const error=this.session.command(this.transport.id,command);if(command.type!=='input')this.save();if(error){if(command.type==='input')this.status.transient(error);else this.status.notice(error);if(isShotTransition(command))this.callbacks.shotFailed?.();}return !error;}
    const sent=this.transport.send(this.transport.hostId,{type:'command',command});
    if(!sent&&isShotTransition(command))this.callbacks.shotFailed?.();return sent;
  }
  private tick():void {
    const now=performance.now(),elapsed=now-this.lastTick;this.lastTick=now;
    const permitted=this.transport.authorityPermitted();
    const transitionStatus=authorityTransitionStatus(this.authorityActive,permitted);
    if(transitionStatus)this.status.recurring(transitionStatus);
    this.status.refresh();
    const deferred=this.deferredHost.drain(now,permitted);
    if(deferred.status==='ready')this.command(deferred.value);
    else if(deferred.status==='expired')this.status.notice('Room action timed out — please try again');
    // A non-permitted clock pauses advancing at once; seats keep their control scope through a bounded gap (#48).
    if(this.authorityGrace.clearSeats(now,permitted))this.session?.clear();
    if(!permitted){this.accumulator=0;this.authorityActive=false;return;}
    this.authorityActive=true;
    if(now-this.lastClockProbe>=500){
      this.lastClockProbe=now;
      if(this.actionMode&&!this.session&&!this.actionStopped){if(this.actionHelloStarted===-Infinity)this.actionHelloStarted=now;if(!this.actionNegotiated&&now-this.actionHelloStarted>5000){this.actionStopped=true;this.status.terminal('Action replay handshake timed out — reload every participant with the same build');}else this.transport.send(this.transport.hostId,{type:'actionHello',version:ACTION_VERSION,rules:REPLAY_RULES,display:this.displayRole});}
      if(this.session){const scope=this.session.controlScope(this.transport.id)??{matchId:this.session.game.matchId,round:this.session.game.round,controlEpoch:`spectator:${this.transport.grant?.epoch}`};if(scope)this.callbacks.clock?.({scope,localSentAt:now,localReceivedAt:now,authorityTick:this.session.game.tick+this.accumulator/50,paused:document.hidden||this.recovering||this.session.game.phase!=='playing'});}
      else this.transport.send(this.transport.hostId,{type:'tickProbe',...this.tickProbes.request()});
    }
    this.joinRequest.retry(now,true,command=>{
      if(this.session){const error=this.session.command(this.transport.id,command);this.joinRequest.confirm();if(error)this.status.notice(error);else this.save();}
      else this.transport.send(this.transport.hostId,{type:'command',command});
    });
    if(!this.session){if(now-this.lastState>2000)this.status.recurring(`Waiting for direct connection — ${this.transport.explain(this.transport.hostId)}`);return;}
    if(this.recovering){
      if(this.session.game.phase==='lobby'||[...this.session.game.players.values()].filter(player=>player.alive).every(player=>player.connected))this.recovering=false;
      else{this.accumulator=0;if(now-this.lastPausedPublish>=500){this.publish(true);this.lastPausedPublish=now;}this.status.recurring('Recovered game paused — waiting for riders to rejoin, or reset to main menu');return;}
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
      const actionPeer=this.actionPeers.get(id);
      if(actionPeer){
        const full=actionPeer.display||session.settings.mode==='devices';
        if(full!==actionPeer.full){this.transport.send(id,{type:'actionWelcome',version:ACTION_VERSION,rules:REPLAY_RULES,full});actionPeer.full=full;actionPeer.sender.requestBaseline();this.encoders.delete(id);this.keyframes.delete(id);}
        if(full){actionPeer.sender.publish(session.journal,{settings:session.settings,ack:ack[id]??-1,paused,motion:session.appliedMotion(id)},at,message=>this.transport.send(id,message,true));continue;}
      }
      const peerSnapshot=actionPeer?{...snapshot,players:snapshot.players.map(player=>({...player,x:player.id===id?player.x:0,y:player.id===id?player.y:0,angle:0,trail:[]})),bombs:[],blasts:[],pickups:[],portalPair:undefined}:snapshot;
      let delivery=this.keyframes.get(id);if(!delivery){delivery=new KeyframeDelivery<WorldEnvelope>();this.keyframes.set(id,delivery);}
      if(!delivery.matchesScope(game.matchId,game.round)){delivery.clear();this.encoders.delete(id);}
      const pending=delivery.pump(at,world=>this.transport.send(id,world,!!actionPeer));
      if(pending==='waiting')continue;if(pending==='expired')this.encoders.delete(id);
      let encoder=this.encoders.get(id);if(!encoder){const generation=(this.generations.get(id)??0)+1;this.generations.set(id,generation);encoder=new WorldEncoder(generation);this.encoders.set(id,encoder);}
      // A fresh encoder keyframes itself. On one ordered reliable channel a delta chain cannot drift, and a broken chain already resyncs, so a periodic re-baseline only buys a ~30 KB burst plus a receipt wait that blocks every delta to that peer (#61).
      const frame=encoder.encode(peerSnapshot,game.matchId,game.round,game.tick);
      const world:WorldEnvelope & {controller?:boolean}={type:'world',...(actionPeer?{controller:true}:{}),frame,settings:session.settings,ack:recipientAcknowledgements(ack,id),paused,motion:session.appliedMotion(id)};
      if(frame.base===0){delivery.hold(world,at);delivery.pump(at,payload=>this.transport.send(id,payload,!!actionPeer));}
      else if(!this.transport.send(id,world,!!actionPeer))this.encoders.delete(id);
    }
  }
  private save(){if(this.session)try{localStorage.setItem(`fuse-checkpoint-${this.code}`,this.session.checkpoint());}catch{}}
  stop(){this.save();clearInterval(this.interval);this.transport.close();}
}
