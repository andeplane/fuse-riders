import { authorityTransitionStatus } from './authority-status.js';
import { StatusNotices } from './status-notices.js';
import { HostSession, type BaselineMessage, type RoomCommand } from './host-session.js';
import { PeerTransport } from './peer-transport.js';
import { Simulation, TickClock, TICK_MS } from './rollback.js';
import { StreamSender } from './stream.js';
import { InputEdges } from './input-edges.js';
import { hashText, packFast, unpackFast, type StreamPacket } from './wire.js';
import { decodeGameState } from './checkpoint.js';
import { interpolateWorld } from './interpolate.js';
import { BombInputBuffer } from '../shared/bomb-input.js';
import { replayHash, validEntry, REPLAY_RULES, type LogEntry, type ReplayState } from '../shared/action-log.js';
import { toSnapshot } from '../shared/game.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import { uuid } from '../shared/uuid.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import type { GameEvent } from '../shared/protocol.js';

export interface Callbacks { state:(snapshot:ViewSnapshot,settings:RoomSettings,matchId:string)=>void;event:(event:GameEvent,matchId:string,round:number,tick:number)=>void;status:(text:string)=>void;ready:(id:string,host:boolean)=>void;ended?:()=>void }
/** A member silent this long is logged absent by the host; a host silent this long freezes its views. */
export const SILENCE_MS=1000;
export const HASH_INTERVAL_TICKS=20;
const REPAIR_INTERVAL_MS=250,RESYNC_INTERVAL_MS=2000,JOIN_RETRY_MS=2000;

/**
 * The host authors and folds; every full view folds the same log to its own clock and rolls back when an entry
 * arrives late. There is no admission window: a press applies on the next local tick and is never refused for timing.
 */
export class RoomRuntime {
  private session?:HostSession;
  private peers=new Set<string>();
  private lastHeard=new Map<string,number>();
  private peerSentAt=new Map<string,number>();
  private lastRepairSent=new Map<string,number>();
  // Guest side.
  private sim?:Simulation;
  private readonly clock=new TickClock(()=>performance.now());
  private own=new StreamSender();
  private readonly edges=new InputEdges();
  private readonly members=new Map<number,string>();
  private hostSentAt:number|null=null;
  private hostHeardAt=-Infinity;
  private lastResync=-Infinity;
  private pendingHash?:{tick:number;hash:string;lastSeq:Map<string,number>};
  private mismatches:number[]=[];
  private pendingJoin?:{command:Extract<RoomCommand,{type:'join'}>;sentAt:number};
  private settings:RoomSettings;
  // Presentation.
  private previous?:ViewSnapshot;
  private current?:ViewSnapshot;
  private interval?:ReturnType<typeof setInterval>;
  private lastTick=performance.now();
  private accumulator=0;
  private sendAccumulator=0;
  private announced=false;
  private authorityActive=false;
  private recovering=false;
  private lastPausedPublish=0;
  readonly transport:PeerTransport;
  private readonly status:StatusNotices;
  constructor(private code:string,token:string,settings:RoomSettings,private callbacks:Callbacks){
    this.settings=settings;
    this.status=new StatusNotices(()=>performance.now(),text=>callbacks.status(text));
    this.transport=new PeerTransport(code,token,{
      welcome:(id,hostId)=>{
        if(id===hostId&&!this.session){
          this.session=new HostSession(id,settings,{token:uuid});
          try{const checkpoint=localStorage.getItem(`fuse-checkpoint-${code}`);if(checkpoint){const restored=this.session.restore(checkpoint);this.recovering=restored&&this.session.game.phase!=='lobby';if(!restored)this.status.notice('Saved game is incompatible or damaged — a fresh lobby is ready');}}catch{}
        }
        this.resetView();this.callbacks.ready(id,id===hostId);
        if(id!==hostId)this.requestResync(true);
      },
      peer:(id,online)=>{
        if(online){this.peers.add(id);this.session?.reconnect(id);this.lastHeard.set(id,performance.now());if(id===this.transport.hostId&&!this.session){this.resetView();this.requestResync(true);}}
        else{this.peers.delete(id);this.lastHeard.delete(id);this.session?.disconnect(id);}
      },
      message:(id,data)=>this.receive(id,data),status:text=>this.status.recurring(text),
      ended:()=>{clearInterval(this.interval);this.session=undefined;this.peers.clear();this.resetView();this.callbacks.ended?.();},
      revoked:()=>{clearInterval(this.interval);this.interval=undefined;this.session=undefined;this.status.terminal('This host tab was replaced — use the newer tab');},
      terminated:text=>{clearInterval(this.interval);this.interval=undefined;this.status.terminal(text);},
      authorityChanged:()=>{this.resetView();this.accumulator=0;},
    });
  }
  private resetView():void {this.sim=undefined;this.members.clear();this.own=new StreamSender();this.edges.reset();this.clock.reset();this.pendingHash=undefined;this.hostSentAt=null;this.hostHeardAt=-Infinity;this.previous=undefined;this.current=undefined;}
  start(){this.transport.connect();this.interval=setInterval(()=>this.tick(),10);}
  /** The interpolated world for this frame: the last two simulated ticks at the fractional clock. */
  render():ViewSnapshot|undefined {
    if(!this.current)return undefined;
    const fraction=this.session?this.accumulator/TICK_MS:Math.max(0,Math.min(1,this.clock.tick()-this.current.tick));
    return interpolateWorld(this.previous,this.current,fraction);
  }
  private requestResync(force=false):void {
    const now=performance.now();if(!force&&now-this.lastResync<RESYNC_INTERVAL_MS)return;
    this.lastResync=now;this.transport.send(this.transport.hostId,{type:'resync'});
  }
  private receive(id:string,raw:unknown):void {
    if(Array.isArray(raw)){const message=unpackFast(raw);if(message)this.receiveFast(id,message);return;}
    if(!raw||typeof raw!=='object')return;
    const data=raw as {type:string;command?:RoomCommand;error?:string;transient?:boolean};
    if(this.session){
      if(data.type==='command'){const error=this.session.command(id,data.command);if(data.command?.type!=='input')this.save();if(error)this.transport.send(id,{type:'error',error,...(data.command?.type==='input'?{transient:true}:{})});this.peers.add(id);this.heard(id);}
      if(data.type==='resync'){this.peers.add(id);this.heard(id);this.transport.send(id,this.session.baseline(id));}
      return;
    }
    if(id!==this.transport.hostId)return;
    if(data.type==='baseline'){this.installBaseline(raw as BaselineMessage);this.hostHeardAt=performance.now();}
    else if(data.type==='error'){const text=data.error??'Room error';if(data.transient===true)this.status.transient(text);else this.status.notice(text);}
  }
  private heard(id:string):void {this.lastHeard.set(id,performance.now());this.session?.presence(id,true);}
  private receiveFast(id:string,message:ReturnType<typeof unpackFast>&object):void {
    const now=performance.now(),session=this.session;
    if(session){
      if(message.type==='repair'){const member=[...session.senders.keys()].find(m=>hashText(m)===message.member);const sender=member?session.senders.get(member):undefined;if(!member||!sender)return;const entries=sender.since(message.firstMissingSeq).slice(0,32);this.transport.send(id,packFast({type:'streams',tick:session.tick+this.accumulator/TICK_MS,sentAt:now,echoSentAt:this.peerSentAt.get(id)??null,hash:null,streams:[{member:message.member,lastSeq:sender.lastSeq,entries}]}),true);return;}
      const own=message.streams.find(s=>s.member===hashText(id));if(!own)return;
      this.peerSentAt.set(id,message.sentAt);this.heard(id);
      const {firstMissing}=session.ingest(id,own.entries);
      if(firstMissing!==undefined&&now-(this.lastRepairSent.get(id)??-Infinity)>=REPAIR_INTERVAL_MS){this.lastRepairSent.set(id,now);this.transport.send(id,packFast({type:'repair',member:own.member,firstMissingSeq:firstMissing}),true);}
      return;
    }
    if(id!==this.transport.hostId)return;
    if(message.type==='repair'){if(message.member!==hashText(this.transport.id))return;this.transport.send(id,packFast({type:'streams',tick:this.clock.tick(),sentAt:now,echoSentAt:this.hostSentAt,hash:null,streams:[{member:message.member,lastSeq:this.own.lastSeq,entries:this.own.since(message.firstMissingSeq).slice(0,32)}]}),true);return;}
    this.hostHeardAt=now;this.hostSentAt=message.sentAt;
    this.clock.observe(message.tick,message.echoSentAt===null?0:Math.max(0,now-message.echoSentAt));
    const sim=this.sim;if(!sim)return;
    const lastSeq=new Map<string,number>();
    for(const stream of message.streams){
      for(const entry of stream.entries)if(entry[2]===10)this.members.set(hashText(entry[3] as string),entry[3] as string);
      const member=this.members.get(stream.member);if(!member||member===this.transport.id)continue;
      lastSeq.set(member,stream.lastSeq);
      for(const entry of stream.entries){if(sim.insert(member,entry)==='invalid'){this.requestResync();return;}}
    }
    if(message.hash!==null)this.pendingHash={tick:Math.floor(message.tick),hash:message.hash,lastSeq};
    for(const [member,firstMissing] of sim.gaps()){
      if(now-(this.lastRepairSent.get(member)??-Infinity)<REPAIR_INTERVAL_MS)continue;
      this.lastRepairSent.set(member,now);this.transport.send(id,packFast({type:'repair',member:hashText(member),firstMissingSeq:firstMissing}),true);
    }
  }
  private installBaseline(message:BaselineMessage):void {
    try {
      if(message.rules!==REPLAY_RULES||!Number.isSafeInteger(message.tick)||typeof message.game!=='string'||!Array.isArray(message.streams)||message.streams.length>8||typeof message.hash!=='string')return;
      const pending=parseRoomSettings(message.pending),game=decodeGameState(message.game);if(!pending||!game||game.tick!==message.tick)return;
      const state:ReplayState={game,pending,streams:new Map()};const folded=new Map<string,number>(),retained:[string,LogEntry[]][]=[];
      for(const raw of message.streams){
        if(!Array.isArray(raw)||raw.length!==4)return;const [member,position,streamState,entries]=raw;
        if(typeof member!=='string'||!member||member.length>128||!Number.isSafeInteger(position)||position<0||!streamState||typeof streamState!=='object'||!Array.isArray(entries)||entries.length>512||!entries.every(validEntry))return;
        const bombs=BombInputBuffer.fromJSON(streamState.bombs);if(!bombs||!Number.isSafeInteger(streamState.flags)||streamState.flags<0||streamState.flags>3)return;
        const aim=streamState.aim;if(aim!==null&&!(aim&&typeof aim==='object'&&[aim.x,aim.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1)))return;
        if(streamState.gesture!==null&&!Number.isSafeInteger(streamState.gesture))return;
        state.streams.set(member,{flags:streamState.flags,...(aim?{aim:{x:aim.x,y:aim.y}}:{}),...(streamState.gesture===null?{}:{gesture:streamState.gesture}),bombs});
        folded.set(member,position);retained.push([member,entries as LogEntry[]]);this.members.set(hashText(member),member);
      }
      if(replayHash(state)!==message.hash)return;
      this.members.set(hashText(this.transport.hostId),this.transport.hostId);this.members.set(hashText(this.transport.id),this.transport.id);
      if(!this.sim)this.sim=new Simulation(state,this.transport.hostId);else this.sim.install(state,folded);
      for(const [member,entries] of retained)for(const entry of entries)this.sim.insert(member,entry);
      this.settings=pending;this.publishView();
    }catch{/* a malformed baseline is ignored; the next resync asks again */}
  }
  command(command:RoomCommand):boolean {
    if(command.type==='join'){this.pendingJoin={command,sentAt:-Infinity};return true;}
    if(!this.transport.authorityPermitted()){this.status.notice('Waiting for room authority — try again when connected');return false;}
    if(this.session){const error=this.session.command(this.transport.id,command);if(command.type!=='input')this.save();if(error){if(command.type==='input')this.status.transient(error);else this.status.notice(error);}return !error;}
    if(command.type==='input'){
      const sim=this.sim;if(!sim)return false;
      const base=Math.floor(this.clock.tick());
      for(const body of this.edges.edges(command)){const entry=this.own.append(Math.min(Math.max(base+1,this.own.lastTick),base+3),body);sim.insert(this.transport.id,entry,true);}
      this.sendOwn(performance.now());return true;
    }
    if(command.type==='avatar'){const sim=this.sim;if(!sim)return false;const entry=this.own.append(Math.floor(this.clock.tick())+1,[5,command.avatarId]);sim.insert(this.transport.id,entry,true);this.sendOwn(performance.now());return true;}
    return this.transport.send(this.transport.hostId,{type:'command',command});
  }
  private sendOwn(now:number):void {
    if(!this.sim||!this.own.retained.length&&this.own.lastSeq===0)return;
    this.transport.send(this.transport.hostId,packFast({type:'streams',tick:this.clock.tick(),sentAt:now,echoSentAt:this.hostSentAt,hash:null,streams:[{member:hashText(this.transport.id),lastSeq:this.own.lastSeq,entries:this.own.next()}]}),true);
  }
  private tick():void {
    const now=performance.now(),elapsed=now-this.lastTick;this.lastTick=now;
    const permitted=this.transport.authorityPermitted();
    const transitionStatus=authorityTransitionStatus(this.authorityActive,permitted);
    if(transitionStatus)this.status.recurring(transitionStatus);
    this.status.refresh();
    if(!permitted){this.accumulator=0;this.authorityActive=false;return;}
    this.authorityActive=true;
    if(this.pendingJoin&&now-this.pendingJoin.sentAt>=JOIN_RETRY_MS){
      this.pendingJoin.sentAt=now;
      if(this.session){const error=this.session.command(this.transport.id,this.pendingJoin.command);this.pendingJoin=undefined;if(error)this.status.notice(error);else this.save();}
      else this.transport.send(this.transport.hostId,{type:'command',command:this.pendingJoin.command});
    }
    if(this.session)this.hostTick(now,elapsed);else this.guestTick(now,elapsed);
  }
  private hostTick(now:number,elapsed:number):void {
    const session=this.session!;
    if(this.recovering){
      if(session.game.phase==='lobby'||[...session.game.players.values()].filter(player=>player.alive).every(player=>player.connected))this.recovering=false;
      else{this.accumulator=0;if(now-this.lastPausedPublish>=500){this.publish(now,true);this.lastPausedPublish=now;}this.status.recurring('Recovered game paused — waiting for riders to rejoin, or reset to main menu');return;}
    }
    this.accumulator+=Math.min(elapsed,100);
    if(document.hidden){if(!this.announced){this.publish(now,true);this.announced=true;}this.accumulator=0;return;}
    this.announced=false;
    while(this.accumulator>=TICK_MS){
      this.accumulator-=TICK_MS;
      for(const [id,at] of this.lastHeard)if(now-at>SILENCE_MS&&session.game.players.get(id)?.connected)session.presence(id,false);
      const {matchId,round}=session.game;
      for(const event of session.advance())this.callbacks.event(event,matchId,round,session.tick);
      this.publish(now,false);
    }
  }
  private publish(now:number,paused:boolean):void {
    const session=this.session!,game=session.game,tick=session.tick;
    if(tick%HASH_INTERVAL_TICKS===0||paused)this.save();
    this.previous=this.current;this.current={...session.snapshot(),tick,round:game.round};
    this.callbacks.state(this.current,session.settings,game.matchId);
    const hash=tick%HASH_INTERVAL_TICKS===0?session.hash():null;
    for(const id of this.peers){
      const streams=[...session.senders].filter(([member])=>member!==id).map(([member,sender])=>({member:hashText(member),lastSeq:sender.lastSeq,entries:sender.next()}));
      this.transport.send(id,packFast({type:'streams',tick:tick+this.accumulator/TICK_MS,sentAt:now,echoSentAt:this.peerSentAt.get(id)??null,hash,streams}),true);
    }
  }
  private guestTick(now:number,elapsed:number):void {
    const sim=this.sim;
    if(!sim){if(now-this.hostHeardAt>2000)this.status.recurring(`Waiting for direct connection — ${this.transport.explain(this.transport.hostId)}`);this.requestResync();return;}
    if(now-this.hostHeardAt>SILENCE_MS){this.status.recurring('Waiting for the host…');this.sendAccumulator=0;return;}
    this.status.recurring('Connected · direct game link');
    const target=Math.floor(this.clock.tick());
    if(target>sim.tick&&!document.hidden){
      const {matchId,round}=sim.state.game;
      const result=sim.advanceTo(target,(event,tick)=>this.callbacks.event(event,matchId,round,tick));
      if(result.status==='baseline'){this.requestResync();return;}
      this.publishView();
      this.checkHash();
    }
    this.sendAccumulator+=Math.min(elapsed,100);
    if(this.sendAccumulator>=TICK_MS){this.sendAccumulator=0;this.sendOwn(now);this.own.retain(sim.tick);}
  }
  private publishView():void {
    const sim=this.sim!,game=sim.state.game;
    this.previous=this.current;this.current={...toSnapshot(game),tick:game.tick,round:game.round};
    this.callbacks.state(this.current,this.settings,game.matchId);
  }
  /** The host's periodic hash is compared only once every stream it covers is complete here. */
  private checkHash():void {
    const sim=this.sim,pending=this.pendingHash;if(!sim||!pending||sim.tick<pending.tick)return;
    for(const [member,lastSeq] of pending.lastSeq)if(sim.stream(member).contiguous<lastSeq)return;
    this.pendingHash=undefined;
    const hash=sim.hashAt(pending.tick);if(hash===undefined||hash===pending.hash)return;
    const now=performance.now();this.mismatches=this.mismatches.filter(at=>now-at<60_000);this.mismatches.push(now);
    if(this.mismatches.length>=3)this.status.notice('Simulation out of sync — reload this page');
    this.requestResync();
  }
  private save(){if(this.session)try{localStorage.setItem(`fuse-checkpoint-${this.code}`,this.session.checkpoint());}catch{}}
  stop(){this.save();clearInterval(this.interval);this.transport.close();}
}
