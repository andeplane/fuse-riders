import { isGameSnapshot } from './checkpoint.js';
import { isAppliedMotionState } from './prediction-validation.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import type { AppliedMotionState } from './prediction-contract.js';
import type { GameSnapshot } from '../shared/protocol.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import type { HostSession } from './host-session.js';

/** Ticks between position/tick heartbeats to a controller phone when nothing else changed. */
export const STATUS_HEARTBEAT_TICKS=5;
/** What a shared-TV phone shows: phase, roster, its own cooldown/powerups and recap. No geometry, no projectiles. */
export interface ControllerStatus { type:'status'; tick:number; ack:number; paused:boolean; matchId?:string; round?:number; state?:GameSnapshot; pos?:[number,number]|null; motion?:AppliedMotionState|null; settings?:RoomSettings }
export function stripSnapshot(snapshot:GameSnapshot):GameSnapshot {
  const {portalPair:_portal,...rest}=snapshot;
  return {...rest,players:snapshot.players.map(player=>({...player,trail:[]})),bombs:[],blasts:[],pickups:[]};
}

/** Sends a controller phone the stripped snapshot only when it changes and a small heartbeat in between. */
export class ControllerSender {
  private lastState='';
  private lastMotion='';
  private lastSettings='';
  private lastTick=-Infinity;
  publish(session:HostSession,id:string,paused:boolean,send:(message:ControllerStatus)=>boolean):void {
    const game=session.game,state=stripSnapshot(session.snapshot());
    // Geometry that moves every tick is not what the phone shows; its own position rides the heartbeat instead.
    const stateKey=JSON.stringify({...state,boundaryInset:0,players:state.players.map(({x:_x,y:_y,angle:_angle,...rest})=>rest)});
    const motion=session.appliedMotion(id),motionKey=motion?JSON.stringify({...motion,tick:0}):'null';
    const settingsKey=JSON.stringify(session.settings);
    const changed=stateKey!==this.lastState||motionKey!==this.lastMotion||settingsKey!==this.lastSettings;
    if(!changed&&game.tick-this.lastTick<STATUS_HEARTBEAT_TICKS)return;
    const player=game.players.get(id);
    const message:ControllerStatus={type:'status',tick:game.tick,ack:session.acknowledgements()[id]??-1,paused,
      ...(player?{pos:[Math.round(player.x),Math.round(player.y)] as [number,number]}:{}),
      ...(stateKey!==this.lastState?{matchId:game.matchId,round:game.round,state}:{}),
      ...(motionKey!==this.lastMotion?{motion:motion??null}:{}),
      ...(settingsKey!==this.lastSettings?{settings:session.settings}:{})};
    if(!send(message))return;
    this.lastTick=game.tick;this.lastState=stateKey;this.lastMotion=motionKey;this.lastSettings=settingsKey;
  }
}

export interface ControllerFrame { snapshot:ViewSnapshot; settings:RoomSettings; ack:number; matchId:string; motion?:AppliedMotionState; paused:boolean }
/** Rebuilds the view a controller phone renders from full status messages and heartbeats, validating each. */
export class ControllerView {
  private state?:GameSnapshot;
  private matchId='';
  private round=0;
  private settings?:RoomSettings;
  private motion?:AppliedMotionState;
  private tick=0;
  reset():void{this.state=undefined;this.matchId='';this.round=0;this.settings=undefined;this.motion=undefined;this.tick=0;}
  receive(raw:unknown,selfId:string):ControllerFrame|undefined {
    if(!raw||typeof raw!=='object')return;
    const v=raw as ControllerStatus;
    if(v.type!=='status'||!Number.isSafeInteger(v.tick)||v.tick<0||!Number.isSafeInteger(v.ack)||v.ack<-1||typeof v.paused!=='boolean')return;
    if(v.settings!==undefined){const settings=parseRoomSettings(v.settings);if(!settings)return;this.settings=settings;}
    if(v.state!==undefined){
      const {matchId,round}=v;
      if(!isGameSnapshot(v.state)||typeof matchId!=='string'||!matchId||matchId.length>128||!Number.isSafeInteger(round)||round===undefined||round<0)return;
      this.state=v.state;this.matchId=matchId;this.round=round;
    }
    if(v.motion===null)this.motion=undefined;else if(v.motion!==undefined){if(!isAppliedMotionState(v.motion))return;this.motion=v.motion;}
    if(v.pos!==undefined&&v.pos!==null&&!(Array.isArray(v.pos)&&v.pos.length===2&&v.pos.every(n=>Number.isFinite(n))))return;
    const state=this.state,settings=this.settings;
    if(!state||!settings)return;
    if(v.tick<this.tick&&v.state===undefined)return;
    this.tick=v.tick;
    const players=v.pos?state.players.map(player=>player.id===selfId?{...player,x:v.pos![0],y:v.pos![1]}:player):state.players;
    if(v.pos)this.state={...state,players};
    const motion=this.motion&&{...this.motion,tick:v.tick};
    return {snapshot:{...state,players,tick:v.tick,round:this.round},settings,ack:v.ack,matchId:this.matchId,motion,paused:v.paused};
  }
}
