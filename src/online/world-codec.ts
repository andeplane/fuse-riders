import type { GameSnapshot, TrailSegment } from '../shared/protocol.js';
type TrailTuple=[number,number,number,number,number,number,number];
interface Patch { set:Record<string,unknown>;unset:string[] }
interface WorldChanges { root:Patch;players:{id:string;patch:Patch}[];removed:string[] }
export interface WorldFrame {
  stream:string;seq:number;base:number;tick:number;round:number;matchId:string;
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
    const frame:WorldFrame={stream:this.stream,seq:++this.seq,base,tick,round,matchId,trails};
    if(keyframe)frame.state=compact;
    else {
      const {players:oldPlayers,...oldRoot}=this.previousState!;
      const {players,...root}=compact;
      frame.changes={root:difference(oldRoot,root),players:players.map(player=>({id:player.id,patch:difference(oldPlayers.find(old=>old.id===player.id)??{},player)})).filter(change=>Object.keys(change.patch.set).length||change.patch.unset.length),removed:oldPlayers.filter(old=>!players.some(player=>player.id===old.id)).map(player=>player.id)};
    }
    this.previousState=compact;return frame;
  }
}
export class WorldDecoder {
  private stream='';private retired=new Set<string>();private seq=0;
  private state?:GameSnapshot;
  private trails=new Map<string,Map<number,TrailSegment>>();
  accept(frame:WorldFrame):GameSnapshot|undefined {
    if(frame.stream!==this.stream){if(frame.base!==0||this.retired.has(frame.stream))return;if(this.stream)this.retired.add(this.stream);this.stream=frame.stream;this.seq=0;}
    if(frame.seq<=this.seq||(frame.base!==0&&frame.base!==this.seq))return;
    if(frame.base===0){if(!frame.state)return;this.trails.clear();this.state=frame.state;}
    else {
      if(!this.state||!frame.changes)return;
      const changes=frame.changes;const next=apply(this.state,changes.root);
      const players=this.state.players.filter(player=>!changes.removed.includes(player.id)).map(player=>({...player}));
      for(const {id,patch} of changes.players){const index=players.findIndex(player=>player.id===id);if(index>=0)players[index]=apply(players[index]!,patch);else players.push(patch.set as unknown as GameSnapshot['players'][number]);}
      next.players=players.sort((a,b)=>a.slot-b.slot);this.state=next;
    }
    for(const change of frame.trails){
      const trail=this.trails.get(change.player)??new Map<number,TrailSegment>();
      for(const id of change.remove)trail.delete(id);
      for(const [id,x1,y1,x2,y2,createdTick,expiresAtTick] of change.add)trail.set(id,{x1,y1,x2,y2,createdTick,expiresAtTick});
      this.trails.set(change.player,trail);
    }
    for(const id of this.trails.keys())if(!this.state.players.some(player=>player.id===id))this.trails.delete(id);
    this.seq=frame.seq;
    return {...this.state,players:this.state.players.map(player=>({...player,trail:[...(this.trails.get(player.id)?.values()??[])]}))};
  }
  reset():void{this.seq=0;this.stream='';this.retired.clear();this.trails.clear();this.state=undefined;}
}
