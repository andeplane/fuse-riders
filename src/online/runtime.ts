import { authorityTransitionStatus } from './authority-status.js';
import { StatusNotices } from './status-notices.js';
import { AuthorityGrace } from './authority-grace.js';
import { ActionReceiver, ActionSender, type ActionMessage } from './action-replication.js';
import { replayHash } from '../shared/action-log.js';
import { toSnapshot } from '../shared/game.js';
import { isShotTransition } from './shot-failure.js';
import { isInputControlScope } from './prediction-validation.js';
import { DeferredCommand } from './deferred-command.js';
import { TickProbes } from './tick-probes.js';
import type { AppliedMotionState, TickClockSample, InputControlScope } from './prediction-contract.js';
import { JoinRequest } from './join-request.js';
import { HostSession, type RoomCommand } from './host-session.js';
import { PeerTransport } from './peer-transport.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import type { RoomSettings } from '../shared/room-settings.js';
import type { GameEvent } from '../shared/protocol.js';
export interface Callbacks { shotFailed?:()=>void;state:(snapshot:ViewSnapshot,settings:RoomSettings,ack:number,matchId:string,motion?:AppliedMotionState)=>void;clock?:(sample:TickClockSample)=>void;event:(event:GameEvent,matchId:string,round:number,tick:number)=>void;status:(text:string)=>void;ready:(id:string,host:boolean)=>void;ended?:()=>void }
export class RoomRuntime {
  private session?:HostSession;
  private peers=new Set<string>();
  private senders=new Map<string,ActionSender>();
  private lastResync=0;
  private readonly receiver=new ActionReceiver();
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
          this.session=new HostSession(id,settings,{token:()=>crypto.randomUUID(),captureActions:true});
          try{const checkpoint=localStorage.getItem(`fuse-checkpoint-${code}`);if(checkpoint){const restored=this.session.restore(checkpoint);this.recovering=restored&&this.session.game.phase!=='lobby';if(!restored)this.status.notice('Saved game is incompatible or damaged — a fresh lobby is ready');}}catch{}
        }
        this.receiver.reset();this.senders.clear();this.callbacks.ready(id,id===hostId);
        if(id!==hostId)this.transport.send(hostId,{type:'resync'});
      },
      peer:(id,online)=>{
        if(online){this.peers.add(id);this.senders.delete(id);if(id===this.transport.hostId&&!this.session){this.receiver.reset();this.transport.send(id,{type:'resync'});}}
        else{this.peers.delete(id);this.senders.delete(id);this.session?.disconnect(id);}
      },
      message:(id,data)=>this.receive(id,data),status:text=>this.status.recurring(text),
      ended:()=>{this.deferredHost.clear();this.joinRequest.confirm();clearInterval(this.interval);this.session?.clear();this.session=undefined;this.peers.clear();this.tickProbes.clear();this.receiver.reset();this.senders.clear();this.callbacks.ended?.();},
      revoked:()=>{this.deferredHost.clear();clearInterval(this.interval);this.interval=undefined;this.session?.clear();this.session=undefined;this.status.terminal('This host tab was replaced — use the newer tab');},
      // A protocol mismatch closes the transport; the tick interval has to stop too, or it would keep restating
      // connection status over the reload notice (#23).
      terminated:text=>{this.deferredHost.clear();this.joinRequest.confirm();clearInterval(this.interval);this.interval=undefined;this.status.terminal(text);},
      authorityChanged:()=>{this.deferredHost.clear();this.tickProbes.clear();this.receiver.reset();this.senders.clear();this.session?.clear();this.authorityGrace.reset();this.accumulator=0;},
    });
  }
  start(){this.transport.connect();this.interval=setInterval(()=>this.tick(),10);}
  private receive(id:string,raw:unknown):void {
    if(!raw||typeof raw!=='object')return;
    const data=raw as {type:string;command?:RoomCommand;event?:GameEvent;error?:string;transient?:boolean;shotRejected?:boolean;paused?:boolean;matchId?:string;round?:number;tick?:number;probeId?:number;localSentAt?:number;authorityTick?:number;scope?:InputControlScope};
    if(this.session){
      if(data.type==='tickProbe'&&Number.isSafeInteger(data.probeId)&&Number.isFinite(data.localSentAt)){
        const scope=this.session.controlScope(id)??{matchId:this.session.game.matchId,round:this.session.game.round,controlEpoch:`spectator:${this.transport.grant?.epoch}`};if(scope)this.transport.send(id,{type:'tickPong',probeId:data.probeId,localSentAt:data.localSentAt,authorityTick:this.session.game.tick+this.accumulator/50,paused:document.hidden||this.recovering||this.session.game.phase!=='playing',scope},true);return;
      }
      if(data.type==='command'){const error=this.session.command(id,data.command);if(data.command?.type!=='input')this.save();if(error)this.transport.send(id,{type:'error',error,...(data.command?.type==='input'?{transient:true}:{}),...(isShotTransition(data.command)?{shotRejected:true}:{})});this.peers.add(id);}
      if(data.type==='resync'){this.peers.add(id);this.senders.delete(id);}
      return;
    }
    if(id!==this.transport.hostId)return;
    if(data.type==='tickPong'&&isInputControlScope(data.scope)){
      const sample=this.tickProbes.accept(data.probeId!,data.localSentAt!,data.authorityTick!,data.paused!,data.scope);if(sample)this.callbacks.clock?.(sample);return;
    }
    if(data.type==='baseline'||data.type==='actions'){
      const result=this.receiver.receive(raw);
      if(result.status==='resync'){if(performance.now()-this.lastResync>=500){this.lastResync=performance.now();this.transport.send(id,{type:'resync'});}return;}
      if(result.status==='stale')return;
      const game=result.state.game,snapshot=toSnapshot(game),motion=result.meta.motion??undefined;
      if(snapshot.players.some(player=>player.id===this.transport.id&&player.connected))this.joinRequest.confirm();
      this.lastState=performance.now();
      if(motion){const scope=JSON.stringify(motion.scope);if(scope!==this.lastMotionScope){this.lastMotionScope=scope;this.lastClockProbe=-Infinity;}}
      this.callbacks.state({...snapshot,tick:game.tick,round:game.round},result.settings,result.meta.ack,game.matchId,motion);
      this.status.recurring(result.meta.paused?'Paused — host is in the background':'Connected · direct game link');
    }else if(data.type==='event'&&data.event)this.callbacks.event(data.event,data.matchId??'',data.round??0,data.tick??0);
    else if(data.type==='error'){const text=data.error??'Room error';if(data.transient===true)this.status.transient(text);else this.status.notice(text);if(data.shotRejected===true)this.callbacks.shotFailed?.();}
  }
  command(command:RoomCommand):boolean {
    if(command.type==='join'){this.joinRequest.request(command);return true;}
    if(!this.transport.authorityPermitted()){
      if(this.session&&['action','settings','bot'].includes(command.type)){this.deferredHost.offer(command,performance.now());this.status.notice('Applying when the room connection is confirmed');return true;}
      this.status.notice('Waiting for room authority — try again when connected');if(isShotTransition(command))this.callbacks.shotFailed?.();return false;
    }
    if(this.session){const error=this.session.command(this.transport.id,command);if(command.type!=='input')this.save();if(error){if(command.type==='input')this.status.transient(error);else this.status.notice(error);if(isShotTransition(command))this.callbacks.shotFailed?.();}return !error;}
    // Input restates full control state every packet, so it rides the unreliable channel; management stays reliable.
    const sent=this.transport.send(this.transport.hostId,{type:'command',command},command.type==='input');
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
      if(this.session){const scope=this.session.controlScope(this.transport.id)??{matchId:this.session.game.matchId,round:this.session.game.round,controlEpoch:`spectator:${this.transport.grant?.epoch}`};if(scope)this.callbacks.clock?.({scope,localSentAt:now,localReceivedAt:now,authorityTick:this.session.game.tick+this.accumulator/50,paused:document.hidden||this.recovering||this.session.game.phase!=='playing'});}
      else this.transport.send(this.transport.hostId,{type:'tickProbe',...this.tickProbes.request()},true);
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
    // Peers replay the host's committed operations; the hash is computed at most once per publish.
    let hashed:string|undefined;const hash=()=>hashed??=replayHash(session.journal.state);
    for(const id of this.peers){
      let sender=this.senders.get(id);if(!sender){sender=new ActionSender();this.senders.set(id,sender);}
      sender.publish(session.journal,session.settings,{ack:ack[id]??-1,paused,motion:session.appliedMotion(id)},hash,(message:ActionMessage)=>this.transport.send(id,message));
    }
  }
  private save(){if(this.session)try{localStorage.setItem(`fuse-checkpoint-${this.code}`,this.session.checkpoint());}catch{}}
  stop(){this.save();clearInterval(this.interval);this.transport.close();}
}
