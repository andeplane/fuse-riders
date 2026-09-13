import type { GameSnapshot, TrailSegment } from '../shared/protocol.js';
export interface WorldFrame {
  stream: string; seq: number; base: number; tick: number; round: number; matchId: string;
  state: GameSnapshot;
  trails: { player: string; add: [number, TrailSegment][]; remove: number[] }[];
}
/** IDs describe complete immutable segments, including gun splits and clipped endpoints. */
export class WorldEncoder {
  private seq = 0;
  private readonly stream = crypto.randomUUID();
  private nextId = 1;
  private previous = new Map<string, Map<string,number>>();
  encode(state: GameSnapshot, matchId: string, round: number, tick: number, keyframe = false): WorldFrame {
    const base = keyframe ? 0 : this.seq;
    if (keyframe) this.previous.clear();
    const trails = state.players.map(player => {
      const old = this.previous.get(player.id) ?? new Map<string,number>();
      const next = new Map<string,number>(); const add: [number,TrailSegment][] = [];
      for (const segment of player.trail) {
        const key = JSON.stringify(segment); const existing = old.get(key); const id = existing ?? this.nextId++;
        next.set(key,id); if(existing === undefined) add.push([id,segment]);
      }
      this.previous.set(player.id,next);
      return { player:player.id, add, remove:[...old].filter(([key])=>!next.has(key)).map(([,id])=>id) };
    });
    for(const id of this.previous.keys())if(!state.players.some(player=>player.id===id))this.previous.delete(id);
    return {stream:this.stream,seq:++this.seq,base,tick,round,matchId,state:{...state,players:state.players.map(player=>({...player,trail:[]}))},trails};
  }
}
export class WorldDecoder {
  private stream = "";
  private retired = new Set<string>();
  private seq = 0;
  private trails = new Map<string,Map<number,TrailSegment>>();
  accept(frame: WorldFrame): GameSnapshot | undefined {
    if(frame.stream !== this.stream) {
      if(frame.base !== 0 || this.retired.has(frame.stream))return;
      if(this.stream)this.retired.add(this.stream);
      this.stream=frame.stream;this.seq=0;
    }
    if(frame.seq <= this.seq || (frame.base !== 0 && frame.base !== this.seq))return;
    if(frame.base===0)this.trails.clear();
    for(const change of frame.trails){
      const trail=this.trails.get(change.player)??new Map<number,TrailSegment>();
      for(const id of change.remove)trail.delete(id);
      for(const [id,segment] of change.add)trail.set(id,segment);
      this.trails.set(change.player,trail);
    }
    for(const id of this.trails.keys())if(!frame.state.players.some(player=>player.id===id))this.trails.delete(id);
    this.seq=frame.seq;
    return {...frame.state,players:frame.state.players.map(player=>({...player,trail:[...(this.trails.get(player.id)?.values()??[])]}))};
  }
  reset(): void { this.seq=0;this.stream="";this.retired.clear();this.trails.clear(); }
}
