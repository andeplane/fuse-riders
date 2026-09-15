import { authorityTransitionStatus } from './authority-status.js';
import { StatusNotices } from './status-notices.js';
import { HostSession, type BaselineMessage, type RoomCommand } from './host-session.js';
import { PeerTransport, type TransportCallbacks } from './peer-transport.js';
import { Simulation, TickClock, SNAPSHOT_COUNT, SNAPSHOT_EVERY_TICKS, TICK_MS } from './rollback.js';
import { StreamSender } from './stream.js';
import { InputEdges } from './input-edges.js';
import { hashText, packFast, unpackFast, type StreamPacket } from './wire.js';
import { decodeGameState } from './checkpoint.js';
import { interpolateWorld } from './interpolate.js';
import { NetStats } from './net-stats.js';
import { Telemetry, telemetryEndpoint } from './telemetry.js';
import { BombInputBuffer } from '../shared/bomb-input.js';
import { MAX_ENTRIES_PER_TICK, replayHash, validEntry, REPLAY_RULES, type LogEntry, type ReplayState } from '../shared/action-log.js';
import { toSnapshot } from '../shared/game.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import { uuid } from '../shared/uuid.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import type { GameEvent } from '../shared/protocol.js';

export interface Callbacks { state:(snapshot:ViewSnapshot,settings:RoomSettings,matchId:string)=>void;event:(event:GameEvent,matchId:string,round:number,tick:number)=>void;status:(text:string)=>void;ready:(id:string,host:boolean)=>void;ended?:()=>void }
/** The browser bindings, injected so the fold can be driven by a test clock. */
export interface RoomRuntimeDependencies { now():number;hidden():boolean;transport(callbacks:TransportCallbacks):PeerTransport }
/** A member silent this long is logged absent by the host; a host silent this long freezes its views. */
export const SILENCE_MS=1000;
export const HASH_INTERVAL_TICKS=20;
/**
 * How far behind its own tick a sender's published hash refers to: the oldest snapshot in its ring, the newest
 * state no late entry can rewind. Hashing the tick just simulated compares a state the host is still free to
 * change, so every entry that arrives late reads as a divergence on every replica.
 */
/** The host's oldest snapshot: nothing can rewind it any more. A view keeps GUEST_SNAPSHOT_MARGIN more snapshots so it still holds that tick after the packet's flight and its own clock lead. */
export const HASH_LAG_TICKS=SNAPSHOT_EVERY_TICKS*(SNAPSHOT_COUNT-1);
export const GUEST_SNAPSHOT_MARGIN=8;
const REPAIR_INTERVAL_MS=250,RESYNC_INTERVAL_MS=2000,JOIN_RETRY_MS=2000,BASELINE_INTERVAL_MS=500,SAVE_INTERVAL_MS=500;

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
  private lastBaselineSent=new Map<string,number>();
  private lastSave=-Infinity;
  // Guest side.
  private sim?:Simulation;
  private readonly clock=new TickClock(()=>this.dependencies.now());
  private own=new StreamSender();
  private readonly edges=new InputEdges();
  private readonly members=new Map<number,string>();
  private hostSentAt:number|null=null;
  private hostHeardAt=-Infinity;
  private lastResync=-Infinity;
  private pendingHash?:{tick:number;hash:string;lastSeq:Map<string,number>};
  private mismatches:number[]=[];
  private gapSince=new Map<string,number>();
  private pendingJoin?:{command:Extract<RoomCommand,{type:'join'}>;sentAt:number};
  private settings:RoomSettings;
  // Presentation.
  private previous?:ViewSnapshot;
  private current?:ViewSnapshot;
  private interval?:ReturnType<typeof setInterval>;
  private lastTick:number;
  private accumulator=0;
  private sendAccumulator=0;
  private sendTicks=0;
  private announced=false;
  private authorityActive=false;
  private recovering=false;
  private lastPausedPublish=0;
  readonly transport:PeerTransport;
  /** What this view saw of the host link lately; the device overlay reads it. */
  private lastStatusText='';
  readonly netStats=new NetStats(()=>this.dependencies.now());
  readonly telemetry=new Telemetry(typeof location==='undefined'?undefined:telemetryEndpoint(),()=>this.dependencies.now());
  private readonly status:StatusNotices;
  constructor(private code:string,token:string,settings:RoomSettings,private callbacks:Callbacks,private readonly dependencies:RoomRuntimeDependencies={now:()=>performance.now(),hidden:()=>document.hidden,transport:callbacks=>new PeerTransport(code,token,callbacks)}){
    this.settings=settings;this.lastTick=dependencies.now();
    this.status=new StatusNotices(()=>this.dependencies.now(),text=>{if(text!==this.lastStatusText){this.lastStatusText=text;this.telemetry.log('status',{text});}callbacks.status(text);});
    this.transport=dependencies.transport({
      welcome:(id,hostId)=>{
        this.telemetry.identify({room:code,id,role:id===hostId?'host':'guest',ua:typeof navigator==='undefined'?'':navigator.userAgent.slice(0,80)});this.telemetry.log('welcome',{host:id===hostId});
        if(id===hostId&&!this.session){
          this.session=new HostSession(id,settings,{token:uuid});
          try{const checkpoint=localStorage.getItem(`fuse-checkpoint-${code}`);if(checkpoint){const restored=this.session.restore(checkpoint);this.recovering=restored&&this.session.game.phase!=='lobby';if(!restored)this.status.notice('Saved game is incompatible or damaged — a fresh lobby is ready');}}catch{}
        }
        this.resetView();this.callbacks.ready(id,id===hostId);
        if(id!==hostId)this.requestResync(true);
      },
      peer:(id,online)=>{
        if(online){this.peers.add(id);this.session?.reconnect(id);this.lastHeard.set(id,this.dependencies.now());if(id===this.transport.hostId&&!this.session){this.resetView();this.requestResync(true);}}
        else{this.peers.delete(id);this.lastHeard.delete(id);this.peerSentAt.delete(id);this.lastRepairSent.delete(id);this.lastBaselineSent.delete(id);this.session?.disconnect(id);}
      },
      message:(id,data)=>this.receive(id,data),status:text=>this.status.recurring(text),
      ended:()=>{clearInterval(this.interval);this.session=undefined;this.peers.clear();this.resetView();this.callbacks.ended?.();},
      revoked:()=>{clearInterval(this.interval);this.interval=undefined;this.session=undefined;this.status.terminal('This host tab was replaced — use the newer tab');},
      terminated:text=>{clearInterval(this.interval);this.interval=undefined;this.status.terminal(text);},
      authorityChanged:()=>{this.resetView();this.accumulator=0;},
    });
  }
  private resetView():void {this.netStats.reset();this.sim=undefined;this.members.clear();this.own=new StreamSender();this.edges.reset();this.clock.reset();this.pendingHash=undefined;this.hostSentAt=null;this.hostHeardAt=-Infinity;this.previous=undefined;this.current=undefined;this.gapSince.clear();this.lastRepairSent.clear();this.lastBaselineSent.clear();this.mismatches=[];}
  start(){this.transport.connect();this.interval=setInterval(()=>this.tick(),10);}
  /** The interpolated world for this frame: the last two simulated ticks at the fractional clock. */
  render():ViewSnapshot|undefined {
    if(!this.current)return undefined;
    const fraction=this.session?this.accumulator/TICK_MS:Math.max(0,Math.min(1,this.clock.tick()-this.current.tick));
    return interpolateWorld(this.previous,this.current,fraction);
  }
  /** The steer the fold currently holds for a rider; a controller phone has no fold and reports nothing. */
  held(id:string):{left:boolean;right:boolean}|undefined {const flags=(this.session?.sim??this.sim)?.state.streams.get(id)?.flags;return flags===undefined?undefined:{left:Boolean(flags&1),right:Boolean(flags&2)};}
  private requestResync(force=false):void {
    const now=this.dependencies.now();if(!force&&now-this.lastResync<RESYNC_INTERVAL_MS)return;
    this.lastResync=now;this.netStats.record('resync');this.telemetry.log('resync',{force});this.transport.send(this.transport.hostId,{type:'resync'});
  }
  private receive(id:string,raw:unknown):void {
    if(Array.isArray(raw)){const message=unpackFast(raw);if(message)this.receiveFast(id,message);return;}
    if(!raw||typeof raw!=='object')return;
    const data=raw as {type:string;command?:RoomCommand;error?:string;transient?:boolean};
    if(this.session){
      if(data.type==='command'){const error=this.session.command(id,data.command);if(data.command?.type!=='input')this.save();if(error)this.transport.send(id,{type:'error',error,...(data.command?.type==='input'?{transient:true}:{})});this.peers.add(id);this.heard(id);}
      if(data.type==='resync'){this.peers.add(id);this.heard(id);this.telemetry.log('resync-in',{from:id});this.sendBaseline(id);}
      return;
    }
    if(id!==this.transport.hostId)return;
    if(data.type==='baseline'){this.installBaseline(raw as BaselineMessage);this.hostHeardAt=this.dependencies.now();}
    else if(data.type==='error'){const text=data.error??'Room error';if(data.transient===true)this.status.transient(text);else this.status.notice(text);}
  }
  private heard(id:string):void {this.lastHeard.set(id,this.dependencies.now());this.session?.presence(id,true);}
  /** Encoding and sending a baseline is the host's most expensive reply: one per peer per half second, however often it is asked. */
  private sendBaseline(id:string):boolean {
    const now=this.dependencies.now();if(now-(this.lastBaselineSent.get(id)??-Infinity)<BASELINE_INTERVAL_MS)return false;
    this.lastBaselineSent.set(id,now);return this.transport.send(id,this.session!.baseline(id));
  }
  private receiveFast(id:string,message:ReturnType<typeof unpackFast>&object):void {
    const now=this.dependencies.now(),session=this.session;
    if(session){
      if(message.type==='repair'){const member=[...session.senders.keys()].find(m=>hashText(m)===message.member);const sender=member?session.senders.get(member):undefined;if(!member||!sender)return;const entries=sender.since(message.firstMissingSeq).slice(0,32);if(!entries.length||entries[0]![0]!==message.firstMissingSeq){this.sendBaseline(id);return;}this.transport.send(id,packFast({type:'streams',tick:session.tick+this.accumulator/TICK_MS,sentAt:now,echoSentAt:this.peerSentAt.get(id)??null,hash:null,streams:[{member:message.member,lastSeq:sender.lastSeq,entries}]}),true);return;}
      const own=message.streams.find(s=>s.member===hashText(id));if(!own)return;
      this.peerSentAt.set(id,message.sentAt);this.heard(id);
      const {firstMissing}=session.ingest(id,own.entries);this.telemetry.log('ingest',{from:id,n:own.entries.length,first:own.entries[0]?.[0],lastSeq:own.lastSeq,...(firstMissing===undefined?{}:{firstMissing})});
      if(firstMissing!==undefined&&now-(this.lastRepairSent.get(id)??-Infinity)>=REPAIR_INTERVAL_MS){this.lastRepairSent.set(id,now);this.transport.send(id,packFast({type:'repair',member:own.member,firstMissingSeq:firstMissing}),true);}
      return;
    }
    if(id!==this.transport.hostId)return;
    if(message.type==='repair'){if(message.member!==hashText(this.transport.id))return;this.transport.send(id,packFast({type:'streams',tick:this.clock.tick(),sentAt:now,echoSentAt:this.hostSentAt,hash:null,streams:[{member:message.member,lastSeq:this.own.lastSeq,entries:this.own.since(message.firstMissingSeq).slice(0,MAX_ENTRIES_PER_TICK)}]}),true);return;}
    this.hostHeardAt=now;this.hostSentAt=message.sentAt;
    // The echo is this guest's own send time; older than a second it measures silence, not the link.
    const echo=message.echoSentAt!==null&&now-message.echoSentAt<=SILENCE_MS;
    if(echo)this.clock.observe(message.tick,Math.max(0,now-message.echoSentAt!));else if(!this.clock.live)this.clock.observe(message.tick,0);
    this.netStats.record('packet',echo?now-message.echoSentAt!:0);this.netStats.clockOffsetTicks=this.clock.tick()-message.tick;
    this.telemetry.log('recv',{tick:Math.round(message.tick*10)/10,rtt:echo?Math.round(now-message.echoSentAt!):null,hash:message.hash!==null,streams:message.streams.map(s=>[s.member,s.lastSeq,s.entries.length]),simTick:this.sim?.tick??null,clock:Math.round(this.clock.tick()*10)/10});
    const sim=this.sim;if(!sim)return;
    const lastSeq=new Map<string,number>(),hostStream=hashText(this.transport.hostId);
    for(const stream of message.streams){
      // Only the host's own stream carries management, so only it may name a member; anything else is unverified.
      if(stream.member===hostStream)for(const entry of stream.entries)if(entry[2]===10)this.members.set(hashText(entry[3] as string),entry[3] as string);
      const member=this.members.get(stream.member);if(!member||member===this.transport.id)continue;
      lastSeq.set(member,stream.lastSeq);
      for(const entry of stream.entries){
        const result=sim.insert(member,entry);
        if(result==='invalid'){this.telemetry.log('invalid',{member,entry});this.requestResync();return;}
        // Absence zeroes our held controls in every fold, but our edge encoder still believes they are held: when
        // the host marks us present again it has to forget, so the next resend restates the whole controller.
        if(result!=='duplicate'&&entry[3]===this.transport.id&&(entry[2]===10||entry[2]===12&&entry[4]===true))this.edges.reset();
      }
    }
    if(message.hash!==null)this.pendingHash={tick:Math.floor(message.tick)-HASH_LAG_TICKS,hash:message.hash,lastSeq};
    const open=new Set<string>();
    for(const [member,firstMissing] of sim.gaps()){
      open.add(member);if(!this.gapSince.has(member)){this.netStats.record('gap');this.telemetry.log('gap',{member,firstMissing});}const since=this.gapSince.get(member)??now;this.gapSince.set(member,since);
      if(now-since>SILENCE_MS){this.gapSince.delete(member);this.requestResync();continue;}
      if(now-(this.lastRepairSent.get(member)??-Infinity)<REPAIR_INTERVAL_MS)continue;
      this.lastRepairSent.set(member,now);this.netStats.record('repair');this.telemetry.log('repair',{member,firstMissing});this.transport.send(id,packFast({type:'repair',member:hashText(member),firstMissingSeq:firstMissing}),true);
    }
    for(const member of [...this.gapSince.keys()])if(!open.has(member))this.gapSince.delete(member);
  }
  private installBaseline(message:BaselineMessage):void {
    let refused:string|undefined;
    try{refused=this.applyBaseline(message);}catch(error){refused=`${error}`;}
    this.telemetry.log('baseline',{tick:message.tick,refused:refused??null,simTick:this.sim?.tick??null});
    if(refused===undefined)return;
    // A silently dropped baseline leaves a blank or frozen view and no way to tell why; the next resync asks again.
    console.warn(`Baseline refused: ${refused}`);
    this.status.transient('Rebuilding the game state…');
  }
  /** Installs a baseline, or says why it was refused. */
  private applyBaseline(message:BaselineMessage):string|undefined {
    if(message.rules!==REPLAY_RULES||!Number.isSafeInteger(message.tick)||typeof message.game!=='string'||!Array.isArray(message.streams)||message.streams.length>8||typeof message.hash!=='string')return'malformed message';
    const pending=parseRoomSettings(message.pending),game=decodeGameState(message.game);if(!pending||!game||game.tick!==message.tick)return'unreadable game state';
    const state:ReplayState={game,pending,streams:new Map()};const folded=new Map<string,number>(),retained:[string,LogEntry[]][]=[];
    for(const raw of message.streams){
      if(!Array.isArray(raw)||raw.length!==4)return'malformed stream';const [member,position,streamState,entries]=raw;
      if(typeof member!=='string'||!member||member.length>128||!Number.isSafeInteger(position)||position<0||!(streamState===null||typeof streamState==='object')||!Array.isArray(entries)||entries.length>512||!entries.every(validEntry))return'malformed stream';
      if(streamState){
        const bombs=BombInputBuffer.fromJSON(streamState.bombs);if(!bombs||!Number.isSafeInteger(streamState.flags)||streamState.flags<0||streamState.flags>3)return'malformed stream state';
        const aim=streamState.aim;if(aim!==null&&!(aim&&typeof aim==='object'&&[aim.x,aim.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1)))return'malformed aim';
        if(streamState.gesture!==null&&!Number.isSafeInteger(streamState.gesture))return'malformed gesture';
        state.streams.set(member,{flags:streamState.flags,...(aim?{aim:{x:aim.x,y:aim.y}}:{}),...(streamState.gesture===null?{}:{gesture:streamState.gesture}),bombs});
      }
      folded.set(member,position);retained.push([member,entries as LogEntry[]]);this.members.set(hashText(member),member);
    }
    if(replayHash(state)!==message.hash)return'hash mismatch';
    this.members.set(hashText(this.transport.hostId),this.transport.hostId);this.members.set(hashText(this.transport.id),this.transport.id);
    // The fold starts over from the host's state. Our own stream is the exception: the host reports how far it has
    // consumed it in our numbering, and everything past that we still hold and replay onto the baseline ourselves.
    this.sim=new Simulation(state,this.transport.hostId,SNAPSHOT_COUNT+GUEST_SNAPSHOT_MARGIN);
    this.sim.install(state,folded);
    for(const [member,entries] of retained)for(const entry of entries)this.sim.insert(member,entry);
    const ingested=folded.get(this.transport.id)??0;
    for(const entry of this.own.retained)if(entry[0]>ingested)this.sim.insert(this.transport.id,entry,true);
    this.settings=pending;this.publishView();
    return undefined;
  }
  command(command:RoomCommand):boolean {
    if(command.type==='join'){this.pendingJoin={command,sentAt:-Infinity};return true;}
    if(!this.transport.authorityPermitted()){this.status.notice('Waiting for room authority — try again when connected');return false;}
    if(this.session){const error=this.session.command(this.transport.id,command);if(command.type!=='input')this.save();if(error){if(command.type==='input')this.status.transient(error);else this.status.notice(error);}return !error;}
    if(command.type==='input'){
      const sim=this.sim;if(!sim)return false;
      const base=Math.floor(this.clock.tick());
      for(const body of this.edges.edges(command)){const entry=this.own.append(Math.min(Math.max(base+1,this.own.lastTick),base+3),body);this.telemetry.log('input',{seq:entry[0],tick:entry[1],kind:entry[2],simTick:sim.tick});sim.insert(this.transport.id,entry,true);}
      this.sendOwn(this.dependencies.now());return true;
    }
    if(command.type==='avatar'){const sim=this.sim;if(!sim)return false;const entry=this.own.append(Math.floor(this.clock.tick())+1,[5,command.avatarId]);sim.insert(this.transport.id,entry,true);this.sendOwn(this.dependencies.now());return true;}
    return this.transport.send(this.transport.hostId,{type:'command',command});
  }
  /** Every tick while there are recent entries to repeat, otherwise every five ticks as a liveness and clock heartbeat. */
  private sendOwn(now:number):void {
    if(!this.sim)return;
    const entries=this.own.next();
    const sent=this.transport.send(this.transport.hostId,packFast({type:'streams',tick:this.clock.tick(),sentAt:now,echoSentAt:this.hostSentAt,hash:null,streams:[{member:hashText(this.transport.id),lastSeq:this.own.lastSeq,entries}]}),true);
    if(entries.length)this.telemetry.log('send',{lastSeq:this.own.lastSeq,n:entries.length,first:entries[0]![0],sent});
  }
  private tick():void {
    const now=this.dependencies.now(),elapsed=now-this.lastTick;this.lastTick=now;
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
    if(this.dependencies.hidden()){if(!this.announced){this.publish(now,true);this.announced=true;}this.accumulator=0;return;}
    this.announced=false;
    while(this.accumulator>=TICK_MS){
      this.accumulator-=TICK_MS;
      for(const [id,at] of this.lastHeard)if(now-at>SILENCE_MS&&session.game.players.get(id)?.connected){this.telemetry.log('absent',{id,silentMs:Math.round(now-at)});session.presence(id,false);}
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
    const hash=tick%HASH_INTERVAL_TICKS===0?session.sim.hashAt(tick-HASH_LAG_TICKS)??null:null;
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
    // A hidden tab keeps folding (its timer runs at 1 Hz, advanceTo caps the catch-up), or every relayed entry would be 'future' and force a baseline.
    if(target>sim.tick){
      const {matchId,round}=sim.state.game;
      const result=sim.advanceTo(target,(event,tick)=>this.callbacks.event(event,matchId,round,tick));
      if(result.status==='baseline'){this.requestResync();return;}
      if(result.rewound){this.netStats.record('rewind',result.rewound);this.telemetry.log('rewind',{depth:result.rewound,tick:sim.tick});}
      this.publishView();
      this.checkHash();
    }
    this.sendAccumulator+=Math.min(elapsed,100);
    if(this.sendAccumulator>=TICK_MS){this.sendAccumulator=0;this.own.retain(sim.tick);this.sendTicks++;if(this.own.retained.length||this.sendTicks%5===0)this.sendOwn(now);}
  }
  private publishView():void {
    const sim=this.sim!,game=sim.state.game;
    this.previous=this.current;this.current={...toSnapshot(game),tick:game.tick,round:game.round};
    this.settings=sim.state.pending;this.callbacks.state(this.current,this.settings,game.matchId);
  }
  /** The host's periodic hash is compared only once every stream it covers is complete here. */
  private checkHash():void {
    const sim=this.sim,pending=this.pendingHash;if(!sim||!pending||sim.tick<pending.tick)return;
    for(const [member,lastSeq] of pending.lastSeq)if(sim.stream(member).contiguous<lastSeq)return;
    this.pendingHash=undefined;
    const hash=sim.hashAt(pending.tick);if(hash===undefined||hash===pending.hash)return;
    const now=this.dependencies.now();this.mismatches=this.mismatches.filter(at=>now-at<60_000);this.mismatches.push(now);this.netStats.record('mismatch');this.telemetry.log('mismatch',{tick:pending.tick});
    if(this.mismatches.length>=3)this.status.notice('Simulation out of sync — reload this page');
    this.requestResync();
  }
  /** Encoding and storing the checkpoint is synchronous; any peer's commands can ask for it, so it runs on a cadence, not per command. */
  private save(force=false){
    if(!this.session)return;
    const now=this.dependencies.now();if(!force&&now-this.lastSave<SAVE_INTERVAL_MS)return;
    this.lastSave=now;try{localStorage.setItem(`fuse-checkpoint-${this.code}`,this.session.checkpoint());}catch{}
  }
  stop(){this.save(true);clearInterval(this.interval);this.transport.close();}
}
