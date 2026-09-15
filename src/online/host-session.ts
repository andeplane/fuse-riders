import { ActionJournal } from '../shared/action-log.js';
import { sameControlScope, type InputControlScope, type AppliedMotionState, type MotionApplicationResult } from './prediction-contract.js';
import { BotController, BOT_ID_PREFIX, type BotDependencies } from '../shared/bot-controller.js';
import { encodeCheckpoint, decodeCheckpoint } from './checkpoint.js';
import { createGame, SLOT_COLORS, toSnapshot, type GameState, type InputIntent } from '../shared/game.js';
import { BombInputBuffer } from '../server/bomb-input.js';
import { isAvatarId } from '../shared/avatars.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import type { AvatarId } from '../shared/avatars.js';
import type { AimPoint, GameEvent } from '../shared/protocol.js';
export type RoomCommand =
  | { type:'join'; name:string; avatarId?:AvatarId }
  | { type:'input'; scope:InputControlScope; intendedTick:number; resultAcks?:number[]; seq:number; left:boolean;right:boolean;bomb:boolean;bombAction?:'press'|'release'|'cancel';aim?:AimPoint }
  | { type:'avatar'; avatarId:AvatarId }
  | { type:'action'; action:'start'|'lobby'|'rematch' }
  | { type:'settings'; settings:RoomSettings }
  | { type:'bot'; action:'add'|'remove'; id?:string };
type InputCommand=Extract<RoomCommand,{type:'input'}>;
interface Seat { seq:number; tick:number; input:InputIntent; bombs:BombInputBuffer; scope:InputControlScope; pending:Map<number,InputCommand>; results:Map<number,{outcome:MotionApplicationResult;at:number}>; appliedSeq:number; appliedTick:number; processedSeq:number; bombSeq:number }
export interface HostDependencies { token:()=>string; botRandom?:BotDependencies['random']; captureActions?:boolean }
export class HostSession {
  game:GameState;
  journal:ActionJournal;
  private seats=new Map<string,Seat>();
  private bots=new Set<string>();
  private scopeCounter=0;
  private readonly botController:BotController;
  constructor(readonly hostId:string, public settings:RoomSettings, private readonly dependencies:HostDependencies) {
    this.game=createGame(dependencies.token());this.game.settings=settings;
    this.journal=new ActionJournal(this.game,dependencies.captureActions);
    this.botController=new BotController(dependencies.botRandom?{random:dependencies.botRandom}:undefined);
  }
  command(peerId:string, raw:unknown):string|undefined {
    if(!raw||typeof raw!=='object')return 'Invalid command';
    const command=raw as RoomCommand;
    if(command.type==='bot'){
      if(peerId!==this.hostId)return 'Only the host can manage AI riders';
      if(command.action==='add')return this.addBot();
      if(command.action==='remove'&&typeof command.id==='string')return this.removeBot(command.id);
      return 'Invalid AI command';
    }
    if(this.bots.has(peerId))return 'AI riders are controlled by the host';
    if(command.type==='join') {
      if(typeof command.name!=='string'||!command.name.trim()||command.name.length>20)return 'Choose a name (1–20 characters)';
      const existing=this.game.players.get(peerId);
      if(existing){this.journal.apply([3,peerId,true]);return;}
      if(!this.game.leaderboard.has(peerId)&&this.game.leaderboard.size>=128)return 'Start a fresh room before adding more riders';
      const slot=this.freeSlot();
      if(slot<0)return 'Room is full (5 players)';
      this.journal.apply([1,{id:peerId,name:command.name.trim(),slot,color:SLOT_COLORS[slot]!,...(isAvatarId(command.avatarId)?{avatarId:command.avatarId}:{})}]);
      this.seats.set(peerId,this.newSeat(-1));return;
    }
    if(command.type==='settings') {
      if(peerId!==this.hostId)return 'Only the host can change settings';
      const settings=parseRoomSettings(command.settings);if(!settings)return 'Invalid settings';
      this.settings=settings;
      if(this.game.phase==='lobby')this.journal.apply([4,settings]);
      return;
    }
    if(command.type==='action') {
      if(peerId!==this.hostId)return 'Only the host can manage the room';
      if(command.action!=='lobby'&&command.action!=='start'&&command.action!=='rematch')return 'Unknown action';
      // A rider lost mid-round must not be dragged into the next match; a boundary action releases its seat first.
      if(command.action!=='lobby'&&this.reclaimable())this.pruneDisconnected();
      try {
        if(command.action==='lobby'){this.journal.apply([5,2,this.dependencies.token()]);}
        else if(command.action==='start'){this.journal.apply([4,this.settings]);this.journal.apply([5,0,'']);}
        else{this.journal.apply([4,this.settings]);this.journal.apply([5,3,this.dependencies.token()]);}
      }catch(error){return error instanceof Error?error.message:'Action unavailable';}
      this.clear();return;
    }
    const player=this.game.players.get(peerId),seat=this.seats.get(peerId);if(!player||!seat)return 'Join before playing';
    if(command.type==='avatar'){if(isAvatarId(command.avatarId))this.journal.apply([6,peerId,command.avatarId]);return;}
    if(command.type!=='input')return 'Unknown command';
    if(!this.validScope(command.scope)||!sameControlScope(command.scope,seat.scope))return 'Input scope expired; resync';
    const invalid=(message:string):string=>{if(command.bombAction==='release'||command.bombAction==='cancel'){seat.input.bomb=false;seat.bombs.cancel(true);if(Number.isSafeInteger(command.seq))seat.bombSeq=Math.max(seat.bombSeq,command.seq);}return message;};
    if(command.resultAcks!==undefined&&!this.acknowledgeMotion(peerId,command.scope,command.resultAcks))return invalid('Invalid result acknowledgement');
    if(!Number.isSafeInteger(command.seq)||command.seq<0||typeof command.left!=='boolean'||typeof command.right!=='boolean'||typeof command.bomb!=='boolean')return invalid('Invalid input');
    if(command.bombAction!==undefined&&!['press','release','cancel'].includes(command.bombAction))return invalid('Invalid bomb action');
    if(command.aim&&(!Number.isFinite(command.aim.x)||!Number.isFinite(command.aim.y)||command.aim.x<0||command.aim.x>1||command.aim.y<0||command.aim.y>1))return invalid('Invalid aim');
    if(!Number.isSafeInteger(command.intendedTick)||command.intendedTick<this.game.tick-4||command.intendedTick>this.game.tick+4){
      if(!seat.pending.has(command.seq)&&!seat.results.has(command.seq)&&command.seq>seat.processedSeq){
        this.pruneResults(seat);if(seat.pending.size+seat.results.size>=128){this.resetSeat(seat);return 'Input history full; resync';}
        seat.seq=Math.max(seat.seq,command.seq);seat.processedSeq=Math.max(seat.processedSeq,command.seq);seat.results.set(command.seq,{at:this.game.tick,outcome:{seq:command.seq,status:'expired'}});
      }
      return invalid('Input tick expired; resync');
    }
    if(seat.pending.has(command.seq)||seat.results.has(command.seq)||command.seq<=seat.processedSeq)return;
    this.pruneResults(seat);
    if(seat.pending.size+seat.results.size>=128){this.resetSeat(seat);return 'Input history full; resync';}
    seat.seq=Math.max(seat.seq,command.seq);
    seat.pending.set(command.seq,{...command,scope:{...command.scope},...(command.aim?{aim:{...command.aim}}:{})});
  }
  private validScope(raw:unknown):raw is InputControlScope {
    if(!raw||typeof raw!=='object')return false;const value=raw as InputControlScope;
    return typeof value.matchId==='string'&&typeof value.controlEpoch==='string'&&Number.isSafeInteger(value.round);
  }
  // removePlayer is legal only between rounds: mid-round a vanished rider keeps its seat so a reconnect resumes it.
  private reclaimable():boolean {return ['lobby','roundOver','matchOver'].includes(this.game.phase);}
  private pruneDisconnected():void {
    for(const player of [...this.game.players.values()])if(!player.connected){this.journal.apply([2,player.id]);this.seats.delete(player.id);}
  }
  private freeSlot():number {
    const open=()=>SLOT_COLORS.findIndex((_,slot)=>![...this.game.players.values()].some(player=>player.slot===slot));
    const slot=open();
    if(slot>=0||!this.reclaimable())return slot;
    this.pruneDisconnected();return open();
  }
  private newSeat(seq:number):Seat {
    return {seq,tick:this.game.tick,input:{left:false,right:false,bomb:false},bombs:new BombInputBuffer(),scope:{matchId:this.game.matchId,round:this.game.round,controlEpoch:`${this.dependencies.token()}:${++this.scopeCounter}`},pending:new Map(),results:new Map(),appliedSeq:-1,appliedTick:this.game.tick,processedSeq:seq,bombSeq:seq};
  }
  // A new control scope already fences old gestures; queue cancellation without blocking a new press.
  private resetSeat(seat:Seat):void {Object.assign(seat,this.newSeat(seat.seq));seat.bombs.cancel();}
  private pruneResults(seat:Seat):void {for(const [seq,result] of seat.results)if(this.game.tick-result.at>100)seat.results.delete(seq);}
  controlScope(id:string):InputControlScope|undefined {const seat=this.seats.get(id);return seat?{...seat.scope}:undefined;}
  acknowledgeMotion(id:string,scope:InputControlScope,seqs:readonly number[]):boolean {
    const seat=this.seats.get(id);if(!seat||!this.validScope(scope)||!sameControlScope(scope,seat.scope)||!Array.isArray(seqs)||seqs.length>128||seqs.some(seq=>!Number.isSafeInteger(seq)||seq<0))return false;
    for(const seq of seqs)seat.results.delete(seq);return true;
  }
  appliedMotion(id:string):AppliedMotionState|undefined {
    const seat=this.seats.get(id),player=this.game.players.get(id);if(!seat||!player)return;
    this.pruneResults(seat);
    return {scope:{...seat.scope},tick:this.game.tick,appliedSeq:seat.appliedSeq,appliedTick:seat.appliedTick,held:{left:seat.input.left,right:seat.input.right},results:[...seat.results.values()].map(result=>({...result.outcome})),motion:{seed:this.game.seed,drunkStartedTick:player.drunkStartedTick,drunkUntilTick:player.drunkUntilTick,drunkHeadingOffset:player.drunkHeadingOffset}};
  }

  advance():GameEvent[] {
    const inputs=new Map<string,InputIntent>();
    const nextTick=this.game.tick+1;
    for(const [id,seat] of this.seats){
      if(this.bots.has(id)){inputs.set(id,this.botController.input(this.game,id));continue;}
      this.pruneResults(seat);
      // Sequence order dominates intended tick: a fire edge stamped from a stale clock estimate must not be skipped by a
      // later hold sample whose fresher estimate named an earlier tick (#43).
      const queued=[...seat.pending.values()].sort((a,b)=>a.seq-b.seq),latest=queued.filter(command=>command.intendedTick<=nextTick).at(-1)?.seq;
      const eligible=latest===undefined?[]:queued.filter(command=>command.seq<=latest);
      const newest=eligible.filter(command=>command.seq>seat.appliedSeq&&command.intendedTick>=this.game.tick-4).at(-1);
      for(const command of eligible){
        seat.pending.delete(command.seq);seat.processedSeq=Math.max(seat.processedSeq,command.seq);
        const expired=command.intendedTick<this.game.tick-4;
        seat.results.set(command.seq,{at:nextTick,outcome:expired?{seq:command.seq,status:'expired'}:command===newest?{seq:command.seq,status:'applied',appliedTick:nextTick}:{seq:command.seq,status:'superseded'}});
        if(command.seq>seat.bombSeq){
          seat.bombSeq=command.seq;
          if(expired){if(command.bombAction==='release'||command.bombAction==='cancel')seat.bombs.cancel(true);}
          else seat.bombs.accept(command.bomb,command.bombAction,command.aim);
        }
      }
      if(newest){seat.input={left:newest.left,right:newest.right,bomb:newest.bomb,...(newest.aim?{aim:newest.aim}:{})};seat.tick=nextTick;seat.appliedSeq=newest.seq;seat.appliedTick=nextTick;}
      if(nextTick-seat.tick>=10){seat.input={left:false,right:false,bomb:false};seat.bombs.cancel();}
      inputs.set(id,{...seat.input,bombCommands:seat.bombs.drainCommands()});
    }
    const before=this.game.phase;const events=this.journal.advance(inputs);
    if(before!==this.game.phase)this.clear();
    if(this.game.phase==='roundOver'&&this.game.phaseEndsAtTick!==undefined&&this.game.tick>=this.game.phaseEndsAtTick){
      for(const player of [...this.game.players.values()])if(!player.connected){this.journal.apply([2,player.id]);this.seats.delete(player.id);this.bots.delete(player.id);}
      if([...this.game.players.values()].filter(player=>player.connected).length>=2){
        // Format stays fixed for a match; powerup changes apply at round boundaries.
        this.journal.apply([4,{...this.settings,match:this.game.settings!.match,length:this.game.settings!.length}]);
        this.journal.apply([5,1,'']);this.clear();
      }
    }
    return events;
  }
  private addBot():string|undefined {
    const slot=this.freeSlot();
    if(slot<0)return 'Room is full (5 players including AI)';
    if(this.game.leaderboard.size>=128)return 'Start a fresh room before adding more riders';
    let number=1;while(this.game.leaderboard.has(`${BOT_ID_PREFIX}${number}`))number++;
    const id=`${BOT_ID_PREFIX}${number}`,names=['Ada','Turing','Hopper','Nova','Byte'];
    this.journal.apply([1,{id,name:`AI ${names[slot]!}`,slot,color:SLOT_COLORS[slot]!,avatarId:'robot',connected:true}]);
    this.bots.add(id);this.seats.set(id,this.newSeat(-1));
  }
  private removeBot(id:string):string|undefined {
    if(!this.bots.has(id))return 'AI rider not found';
    if(!['lobby','roundOver','matchOver'].includes(this.game.phase))return 'Remove AI between rounds or return to menu';
    this.journal.apply([2,id]);this.bots.delete(id);this.seats.delete(id);
  }
  acknowledgements():Record<string,number>{return Object.fromEntries([...this.seats].map(([id,seat])=>[id,seat.seq]));}
  // Mirrors the LAN server's explicit leave: between rounds a vanished guest frees its seat instead of holding it forever.
  disconnect(id:string):void {
    if(this.bots.has(id))return;
    if(this.game.players.has(id)){
      if(this.reclaimable()){this.journal.apply([2,id]);this.seats.delete(id);return;}
      this.journal.apply([3,id,false]);
    }
    const seat=this.seats.get(id);if(seat)this.resetSeat(seat);
  }
  clear():void {for(const seat of this.seats.values())this.resetSeat(seat);}
  checkpoint():string {
    return encodeCheckpoint(this.hostId,this.game,this.settings,[...this.seats].filter(([id])=>this.game.players.has(id)).map(([id,seat])=>[id,seat.seq] as const),this.bots);
  }
  restore(raw:string):boolean {
    const candidate=decodeCheckpoint(raw,this.hostId);if(!candidate)return false;
    const seats=new Map<string,Seat>();
    for(const [id,seq] of candidate.sequences)seats.set(id,this.newSeat(seq));
    this.game=candidate.game;this.journal=new ActionJournal(this.game,this.dependencies.captureActions);this.settings=candidate.settings;this.seats=seats;this.bots=new Set(candidate.botIds);this.clear();
    return true;
  }
  snapshot(){return toSnapshot(this.game);}
}
