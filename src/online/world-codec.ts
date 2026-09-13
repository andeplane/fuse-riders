import { isGameSnapshot } from './checkpoint.js';
import type { GameSnapshot, TrailSegment } from '../shared/protocol.js';
type TrailTuple=[number,number,number,number,number,number,number];
interface Patch { set:Record<string,unknown>;unset:string[] }
interface WorldChanges { root:Patch;players:{id:string;patch:Patch}[];removed:string[] }
export interface WorldFrame {
  generation:number;stream:string;seq:number;base:number;tick:number;round:number;matchId:string;
  state?:GameSnapshot;changes?:WorldChanges;
  trails:{player:string;add:TrailTuple[];remove:number[]}[];
}
function difference(before:object,after:object):Patch {
  const old=before as Record<string,unknown>,next=after as Record<string,unknown>;
  const set:Record<string,unknown>={};const unset:string[]=[];
  for(const key of Object.keys(next))if(JSON.stringify(old[key])!==JSON.stringify(next[key])){
    if(next[key]===undefined)unset.push(key);else set[key]=next[key];
  }
  for(const key of Object.keys(old))if(!(key in next))unset.push(key);
  return {set,unset};
}
function apply<T extends object>(before:T,patch:Patch):T {
  const next={...before,...patch.set};for(const key of patch.unset)delete (next as Record<string,unknown>)[key];return next;
}
/** Stable segment IDs and field patches avoid resending unchanged player metadata. */
export class WorldEncoder {
  constructor(readonly generation=1){if(!Number.isSafeInteger(generation)||generation<1)throw new Error('Invalid world generation');}
  private seq=0;
  private readonly stream=crypto.randomUUID();
  private nextId=1;
  private previous=new Map<string,Map<string,number>>();
  private previousState?:GameSnapshot;
  encode(state:GameSnapshot,matchId:string,round:number,tick:number,keyframe=false):WorldFrame {
    keyframe ||= !this.previousState;
    const base=keyframe?0:this.seq;if(keyframe)this.previous.clear();
    const trails=state.players.map(player=>{
      const old=this.previous.get(player.id)??new Map<string,number>();
      const next=new Map<string,number>();const add:TrailTuple[]=[];
      for(const segment of player.trail){
        const key=JSON.stringify(segment),existing=old.get(key),id=existing??this.nextId++;
        next.set(key,id);if(existing===undefined)add.push([id,segment.x1,segment.y1,segment.x2,segment.y2,segment.createdTick,segment.expiresAtTick]);
      }
      this.previous.set(player.id,next);
      return {player:player.id,add,remove:[...old].filter(([key])=>!next.has(key)).map(([,id])=>id)};
    }).filter(change=>change.add.length||change.remove.length);
    for(const id of this.previous.keys())if(!state.players.some(player=>player.id===id))this.previous.delete(id);
    const compact={...state,players:state.players.map(player=>({...player,trail:[]}))};
    const frame:WorldFrame={generation:this.generation,stream:this.stream,seq:++this.seq,base,tick,round,matchId,trails};
    if(keyframe)frame.state=compact;
    else {
      const {players:oldPlayers,...oldRoot}=this.previousState!;
      const {players,...root}=compact;
      frame.changes={root:difference(oldRoot,root),players:players.map(player=>({id:player.id,patch:difference(oldPlayers.find(old=>old.id===player.id)??{},player)})).filter(change=>Object.keys(change.patch.set).length||change.patch.unset.length),removed:oldPlayers.filter(old=>!players.some(player=>player.id===old.id)).map(player=>player.id)};
    }
    this.previousState=compact;return frame;
  }
}
export type DecodeResult = {status:'accepted';state:GameSnapshot}|{status:'stale'|'needsBaseline'|'invalid'};
export class WorldDecoder {
  private generation=0;private stream='';private seq=0;private tick=-1;
  private state?:GameSnapshot;
  private trails=new Map<string,Map<number,TrailSegment>>();
  accept(frame:WorldFrame):GameSnapshot|undefined {const result=this.decode(frame);return result.status==='accepted'?result.state:undefined;}
  decode(frame:WorldFrame):DecodeResult {
    try {
      if(!frame||![frame.generation,frame.seq,frame.base,frame.tick,frame.round].every(n=>Number.isSafeInteger(n)&&n>=0)||frame.generation<1||frame.seq<1||typeof frame.stream!=='string'||frame.stream.length>128||typeof frame.matchId!=='string'||frame.matchId.length>128)return {status:'invalid'};
      if(frame.generation<this.generation||frame.tick<this.tick||(frame.generation===this.generation&&frame.seq<=this.seq))return {status:'stale'};
      if(frame.generation===this.generation&&frame.stream!==this.stream)return {status:'invalid'};
      if(frame.base!==0&&(frame.generation!==this.generation||frame.base!==this.seq))return {status:'needsBaseline'};
      if(!Array.isArray(frame.trails)||frame.trails.length>5)return {status:'invalid'};
      let state:GameSnapshot;
      const trails=frame.base===0?new Map<string,Map<number,TrailSegment>>():new Map([...this.trails].map(([id,trail])=>[id,new Map(trail)]));
      if(frame.base===0){if(!frame.state||!isGameSnapshot(frame.state))return {status:'invalid'};state=structuredClone(frame.state);}
      else {
        if(!this.state||!frame.changes)return {status:'invalid'};
        const changes=frame.changes;
        if(!Array.isArray(changes.players)||changes.players.length>5||!Array.isArray(changes.removed)||changes.removed.length>5)return {status:'invalid'};
        state=apply(this.state,changes.root);
        const players=this.state.players.filter(player=>!changes.removed.includes(player.id)).map(player=>({...player}));
        for(const {id,patch} of changes.players){const index=players.findIndex(player=>player.id===id);if(index>=0)players[index]=apply(players[index]!,patch);else players.push(patch.set as unknown as GameSnapshot['players'][number]);}
        state.players=players.sort((a,b)=>a.slot-b.slot);
      }
      const changed=new Set<string>();
      for(const change of frame.trails){
        if(changed.has(change.player)||!state.players.some(p=>p.id===change.player)||!Array.isArray(change.add)||change.add.length>1024||!Array.isArray(change.remove)||change.remove.length>1024)return {status:'invalid'};
        changed.add(change.player);
        const trail=trails.get(change.player)??new Map<number,TrailSegment>();
        for(const id of change.remove){if(!Number.isSafeInteger(id)||id<1)return {status:'invalid'};trail.delete(id);}
        for(const tuple of change.add){
          if(!Array.isArray(tuple)||tuple.length!==7||!tuple.every(Number.isFinite))return {status:'invalid'};
          const [id,x1,y1,x2,y2,createdTick,expiresAtTick]=tuple;
          if(!Number.isSafeInteger(id)||id<1||trail.has(id))return {status:'invalid'};
          trail.set(id,{x1,y1,x2,y2,createdTick,expiresAtTick});
        }
        if(trail.size>1024)return {status:'invalid'};trails.set(change.player,trail);
      }
      for(const id of trails.keys())if(!state.players.some(player=>player.id===id))trails.delete(id);
      const candidate={...state,players:state.players.map(player=>({...player,trail:[...(trails.get(player.id)?.values()??[])]}))};
      if(!isGameSnapshot(candidate))return {status:'invalid'};
      this.generation=frame.generation;this.stream=frame.stream;this.seq=frame.seq;this.tick=frame.tick;this.state=state;this.trails=trails;
      return {status:'accepted',state:candidate};
    }catch{return {status:'invalid'};}
  }
  reset():void{this.generation=0;this.seq=0;this.stream='';this.tick=-1;this.trails.clear();this.state=undefined;}
}
