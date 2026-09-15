import { applyOperation, replayHash, validOperation, validAim, REPLAY_RULES, type ActionJournal, type AimTuple, type GameOperation, type ReplayState } from '../shared/action-log.js';
import { decodeGameState, encodeGameState } from './checkpoint.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import { isAppliedMotionState } from './prediction-validation.js';
import type { AppliedMotionState } from './prediction-contract.js';

export const ACTION_PROTOCOL=1;
export const MAX_BATCH_OPERATIONS=400;
/** Ticks between replica hash comparisons. */
export const HASH_INTERVAL_TICKS=20;
/** `motion` is omitted while unchanged apart from its tick and null when the recipient has no ledger. */
export interface ActionMetadata { ack:number; paused:boolean; motion?:AppliedMotionState|null; settings?:RoomSettings }
export interface ActionBaseline { type:'baseline'; protocol:number; rules:string; seq:number; game:string; held:[number,number,number,AimTuple][]; hash:string; settings:RoomSettings; meta:ActionMetadata }
export interface ActionBatch { type:'actions'; from:number; tick:number; ops:GameOperation[]; hash:string|null; meta:ActionMetadata }
export type ActionMessage=ActionBaseline|ActionBatch;
const integer=(x:unknown,max=Number.MAX_SAFE_INTEGER):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0&&x<=max;
const hashText=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{16}$/.test(x);
function metadata(raw:unknown):raw is ActionMetadata {
  if(!raw||typeof raw!=='object')return false;
  const v=raw as ActionMetadata;
  return Number.isSafeInteger(v.ack)&&v.ack>=-1&&typeof v.paused==='boolean'&&(v.motion===undefined||v.motion===null||isAppliedMotionState(v.motion))&&(v.settings===undefined||parseRoomSettings(v.settings)!==undefined);
}
function motionMatches(meta:ActionMetadata,state:ReplayState):boolean {
  return !meta.motion||meta.motion.tick===state.game.tick&&meta.motion.scope.matchId===state.game.matchId&&meta.motion.scope.round===state.game.round;
}

/** One peer's view of the host journal on an ordered reliable channel. A refused send is retried from the same
 * sequence at the next publish; a peer behind the journal's memory, or one asking to resync, gets a fresh baseline.
 * ponytail: no receipts; ordered reliable delivery either delivers or the link dies and gets a new sender. */
export class ActionSender {
  private sent=-1;
  private hashedTick=-Infinity;
  private lastSettings='';
  private lastMotion='';
  publish(journal:ActionJournal,settings:RoomSettings,meta:ActionMetadata,hash:()=>string,send:(message:ActionMessage)=>boolean):void {
    const state=journal.state,tick=state.game.tick,settingsJson=JSON.stringify(settings),motionKey=meta.motion?JSON.stringify({...meta.motion,tick:0}):'null';
    const ops=this.sent<0?undefined:journal.since(this.sent);
    if(!ops){
      const baseline:ActionBaseline={type:'baseline',protocol:ACTION_PROTOCOL,rules:REPLAY_RULES,seq:journal.sequence,game:encodeGameState(state.game),held:[...state.held].map(([slot,h])=>[slot,h.at,h.flags,h.aim]),hash:hash(),settings,meta};
      if(send(baseline)){this.sent=journal.sequence;this.hashedTick=tick;this.lastSettings=settingsJson;this.lastMotion=motionKey;}
      return;
    }
    const compared=tick-this.hashedTick>=HASH_INTERVAL_TICKS?hash():null,changed=settingsJson!==this.lastSettings,moved=motionKey!==this.lastMotion;
    const batch:ActionBatch={type:'actions',from:this.sent,tick,ops,hash:compared,meta:{ack:meta.ack,paused:meta.paused,...(moved?{motion:meta.motion??null}:{}),...(changed?{settings}:{})}};
    if(send(batch)){this.sent=journal.sequence;if(compared!==null)this.hashedTick=tick;if(changed)this.lastSettings=settingsJson;if(moved)this.lastMotion=motionKey;}
  }
}

export type ReceiveResult={status:'accepted';state:ReplayState;meta:ActionMetadata;settings:RoomSettings}|{status:'stale'}|{status:'resync'};
/** Applies committed operations in journal order; anything it cannot place exactly asks for a baseline. */
export class ActionReceiver {
  private current?:ReplayState;
  private sequence=-1;
  private settings?:RoomSettings;
  private motion?:AppliedMotionState;
  get state():ReplayState|undefined{return this.current;}
  reset():void{this.current=undefined;this.sequence=-1;this.settings=undefined;this.motion=undefined;}
  receive(raw:unknown):ReceiveResult {
    try {
      if(!raw||typeof raw!=='object')return {status:'resync'};
      const v=raw as ActionMessage;
      if(v.type==='baseline')return this.baseline(v);
      const current=this.current;
      if(v.type!=='actions'||!current||!this.settings)return {status:'resync'};
      if(!integer(v.from)||!integer(v.tick)||!Array.isArray(v.ops)||v.ops.length>MAX_BATCH_OPERATIONS||!v.ops.every(validOperation)||!metadata(v.meta)||!(v.hash===null||hashText(v.hash)))return {status:'resync'};
      const end=v.from+v.ops.length;
      if(v.from<this.sequence&&end<=this.sequence)return {status:'stale'};
      if(v.from>this.sequence)return {status:'resync'};
      for(const op of v.ops.slice(this.sequence-v.from))applyOperation(current,op);
      this.sequence=end;
      if(current.game.tick!==v.tick||!motionMatches(v.meta,current)||(v.hash!==null&&replayHash(current)!==v.hash)){this.current=undefined;return {status:'resync'};}
      if(v.meta.settings)this.settings=parseRoomSettings(v.meta.settings);
      this.motion=v.meta.motion===null?undefined:v.meta.motion??(this.motion&&{...this.motion,tick:current.game.tick});
      return {status:'accepted',state:current,meta:{...v.meta,motion:this.motion},settings:this.settings!};
    }catch{this.current=undefined;return {status:'resync'};}
  }
  private baseline(v:ActionBaseline):ReceiveResult {
    if(v.protocol!==ACTION_PROTOCOL||v.rules!==REPLAY_RULES||!integer(v.seq)||typeof v.game!=='string'||!Array.isArray(v.held)||v.held.length>5||!hashText(v.hash)||!metadata(v.meta))return {status:'resync'};
    const settings=parseRoomSettings(v.settings),game=decodeGameState(v.game);
    if(!settings||!game)return {status:'resync'};
    const state:ReplayState={game,held:new Map()};
    for(const h of v.held){
      if(!Array.isArray(h)||h.length!==4||!integer(h[0],4)||!integer(h[1],game.tick)||!integer(h[2],7)||!validAim(h[3])||state.held.has(h[0])||![...game.players.values()].some(p=>p.slot===h[0]))return {status:'resync'};
      state.held.set(h[0],{at:h[1],flags:h[2],aim:h[3]});
    }
    if(!motionMatches(v.meta,state)||replayHash(state)!==v.hash)return {status:'resync'};
    if(this.current&&this.current.game.matchId===game.matchId&&game.tick<this.current.game.tick)return {status:'stale'};
    this.current=state;this.sequence=v.seq;this.settings=settings;this.motion=v.meta.motion??undefined;
    return {status:'accepted',state,meta:{...v.meta,motion:this.motion},settings};
  }
}
