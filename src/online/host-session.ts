import { encodeCheckpoint, decodeCheckpoint } from './checkpoint.js';
import { addPlayer, createGame, removePlayer, resetMatch, returnToLobby, setPlayerConnected, SLOT_COLORS, startMatch, startNextRound, step, toSnapshot, type GameState, type InputIntent } from '../shared/game.js';
import { BombInputBuffer } from '../server/bomb-input.js';
import { isAvatarId } from '../shared/avatars.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import type { AvatarId } from '../shared/avatars.js';
import type { AimPoint, GameEvent } from '../shared/protocol.js';
export type RoomCommand =
  | { type:'join'; name:string; avatarId?:AvatarId }
  | { type:'input'; seq:number; left:boolean;right:boolean;bomb:boolean;bombAction?:'press'|'release'|'cancel';aim?:AimPoint }
  | { type:'avatar'; avatarId:AvatarId }
  | { type:'action'; action:'start'|'lobby'|'rematch' }
  | { type:'settings'; settings:RoomSettings };
interface Seat { seq:number; tick:number; input:InputIntent; bombs:BombInputBuffer }
export interface HostDependencies { token:()=>string }
export class HostSession {
  game:GameState;
  private seats=new Map<string,Seat>();
  constructor(readonly hostId:string, public settings:RoomSettings, private readonly dependencies:HostDependencies) {
    this.game=createGame(dependencies.token());this.game.settings=settings;
  }
  command(peerId:string, raw:unknown):string|undefined {
    if(!raw||typeof raw!=='object')return 'Invalid command';
    const command=raw as RoomCommand;
    if(command.type==='join') {
      if(typeof command.name!=='string'||!command.name.trim()||command.name.length>20)return 'Choose a name (1–20 characters)';
      const existing=this.game.players.get(peerId);
      if(existing){setPlayerConnected(this.game,peerId,true);return;}
      const slot=SLOT_COLORS.findIndex((_,slot)=>![...this.game.players.values()].some(player=>player.slot===slot));
      if(slot<0)return 'Room is full (5 players)';
      addPlayer(this.game,{id:peerId,name:command.name.trim(),slot,color:SLOT_COLORS[slot]!,...(isAvatarId(command.avatarId)?{avatarId:command.avatarId}:{})});
      this.seats.set(peerId,{seq:-1,tick:this.game.tick,input:{left:false,right:false,bomb:false},bombs:new BombInputBuffer()});return;
    }
    if(command.type==='settings') {
      if(peerId!==this.hostId)return 'Only the host can change settings';
      const settings=parseRoomSettings(command.settings);if(!settings)return 'Invalid settings';
      this.settings=settings;
      if(this.game.phase==='lobby')this.game.settings=settings;
      return;
    }
    if(command.type==='action') {
      if(peerId!==this.hostId)return 'Only the host can manage the room';
      try {
        if(command.action==='lobby'){const tick=this.game.tick;returnToLobby(this.game,this.dependencies.token());this.game.tick=tick;}
        else if(command.action==='start'){this.game.settings=this.settings;startMatch(this.game);}
        else if(command.action==='rematch'){this.game.settings=this.settings;resetMatch(this.game,this.dependencies.token());}
        else return 'Unknown action';
      }catch(error){return error instanceof Error?error.message:'Action unavailable';}
      this.clear();return;
    }
    const player=this.game.players.get(peerId),seat=this.seats.get(peerId);if(!player||!seat)return 'Join before playing';
    if(command.type==='avatar'){if(isAvatarId(command.avatarId))player.avatarId=command.avatarId;return;}
    if(command.type!=='input')return 'Unknown command';
    if(!Number.isSafeInteger(command.seq)||command.seq<=seat.seq||typeof command.left!=='boolean'||typeof command.right!=='boolean'||typeof command.bomb!=='boolean')return;
    if(command.bombAction!==undefined&&!['press','release','cancel'].includes(command.bombAction))return;
    if(command.aim&&(!Number.isFinite(command.aim.x)||!Number.isFinite(command.aim.y)||command.aim.x<0||command.aim.x>1||command.aim.y<0||command.aim.y>1))return;
    seat.seq=command.seq;seat.tick=this.game.tick;
    seat.input={left:command.left,right:command.right,bomb:command.bomb,...(command.aim?{aim:command.aim}:{})};
    seat.bombs.accept(command.bomb,command.bombAction,command.aim);
  }
  advance():GameEvent[] {
    const inputs=new Map<string,InputIntent>();
    for(const [id,seat] of this.seats){
      if(this.game.tick-seat.tick>10){seat.input={left:false,right:false,bomb:false};seat.bombs.cancel();}
      inputs.set(id,{...seat.input,bombCommands:seat.bombs.drainCommands()});
    }
    const before=this.game.phase;const result=step(this.game,inputs);
    if(before!==this.game.phase)this.clear();
    if(this.game.phase==='roundOver'&&this.game.phaseEndsAtTick!==undefined&&this.game.tick>=this.game.phaseEndsAtTick){
      for(const player of [...this.game.players.values()])if(!player.connected){removePlayer(this.game,player.id);this.seats.delete(player.id);}
      if([...this.game.players.values()].filter(player=>player.connected).length>=2){
        // Format stays fixed for a match; powerup changes apply at round boundaries.
        this.game.settings={...this.settings,match:this.game.settings!.match,length:this.game.settings!.length};
        startNextRound(this.game);
      }
    }
    return result.events;
  }
  acknowledgements():Record<string,number>{return Object.fromEntries([...this.seats].map(([id,seat])=>[id,seat.seq]));}
  disconnect(id:string):void {if(this.game.players.has(id))setPlayerConnected(this.game,id,false);const seat=this.seats.get(id);if(seat){seat.input={left:false,right:false,bomb:false};seat.bombs.cancel(true);}}
  clear():void {for(const seat of this.seats.values()){seat.input={left:false,right:false,bomb:false};seat.bombs.cancel(true);}}
  checkpoint():string {
    return encodeCheckpoint(this.hostId,this.game,this.settings,[...this.seats].filter(([id])=>this.game.players.has(id)).map(([id,seat])=>[id,seat.seq] as const));
  }
  restore(raw:string):boolean {
    const candidate=decodeCheckpoint(raw,this.hostId);if(!candidate)return false;
    const seats=new Map<string,Seat>();
    for(const [id,seq] of candidate.sequences)seats.set(id,{seq,tick:candidate.game.tick,input:{left:false,right:false,bomb:false},bombs:new BombInputBuffer()});
    this.game=candidate.game;this.settings=candidate.settings;this.seats=seats;
    return true;
  }
  snapshot(){return toSnapshot(this.game);}
}
