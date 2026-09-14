import { encode, decode } from '@msgpack/msgpack';
import { ActionJournal, REPLAY_RULES, applyOperation, replayHash, validOperation, validAim, type ReplayState } from '../shared/action-log.js';
import { decodeGameState, encodeGameState, isGameState } from './checkpoint.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import { isAppliedMotionState } from './prediction-validation.js';
import type { AppliedMotionState } from './prediction-contract.js';

export const ACTION_VERSION = 1;
const MAX_BYTES = 2_000_000, CHUNK_BYTES = 12_000, MAX_BATCH_BYTES = 128_000;
const integer = (x: unknown, max = Number.MAX_SAFE_INTEGER): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= max;
export interface ActionMetadata { settings:RoomSettings; ack:number; paused:boolean; motion?:AppliedMotionState }
export interface ActionChunk { type:'actionChunk'; generation:number; index:number; total:number; bytes:Uint8Array }
export interface ActionBatch { type:'actionBatch'; generation:number; from:number; tick:number; operations:unknown[]; hash:string|null; meta:ActionMetadata }
export interface ActionReceipt { type:'actionReceipt'; generation:number; sequence:number }
export type ActionMessage = ActionChunk | ActionBatch;
function metadata(raw:unknown): raw is ActionMetadata {
  if (!raw || typeof raw !== 'object') return false;
  const v = raw as ActionMetadata;
  return parseRoomSettings(v.settings) !== undefined && Number.isSafeInteger(v.ack) && v.ack >= -1 && typeof v.paused === 'boolean' && (v.motion === undefined || v.motion === null || isAppliedMotionState(v.motion));
}
function validMetadataTick(meta:ActionMetadata, state:ReplayState):boolean {
  return !meta.motion || meta.motion.tick === state.game.tick && meta.motion.scope.matchId === state.game.matchId && meta.motion.scope.round === state.game.round;
}
export function packMessage(value:unknown):Uint8Array { return encode(value, {ignoreUndefined:true, maxDepth:32}); }
export function unpackMessage(bytes:Uint8Array):unknown {
  if (bytes.byteLength > MAX_BYTES) throw new Error('Message too large');
  preflightMessage(bytes);
  return decode(bytes, {maxStrLength:MAX_BYTES,maxBinLength:MAX_BYTES,maxArrayLength:1024,maxMapLength:256,maxExtLength:0});
}
/** Bound nesting and declared collection capacity BEFORE MessagePack allocates containers. */
function preflightMessage(bytes:Uint8Array):void {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=0,nodes=0,capacity=0;
  const skip=(count:number)=>{if(count<0||offset+count>bytes.length)throw new Error('Truncated MessagePack');offset+=count;};
  const length=(width:1|2|4)=>{const at=offset;skip(width);return width===1?view.getUint8(at):width===2?view.getUint16(at):view.getUint32(at);};
  const visit=(depth:number):void=>{
    if(depth>32||++nodes>20_000)throw new Error('Message complexity limit');
    const tag=length(1);let array=-1,map=-1;
    if(tag<=0x7f||tag>=0xe0||tag===0xc0||tag===0xc2||tag===0xc3)return;
    if(tag>=0xa0&&tag<=0xbf){skip(tag&31);return;}
    if(tag>=0x90&&tag<=0x9f)array=tag&15;
    else if(tag>=0x80&&tag<=0x8f)map=tag&15;
    else if(tag===0xdc||tag===0xdd)array=length(tag===0xdc?2:4);
    else if(tag===0xde||tag===0xdf)map=length(tag===0xde?2:4);
    else if([0xc4,0xc5,0xc6,0xd9,0xda,0xdb].includes(tag)){skip(length(tag===0xc4||tag===0xd9?1:tag===0xc5||tag===0xda?2:4));return;}
    else {const widths:Record<number,number>={0xca:4,0xcb:8,0xcc:1,0xcd:2,0xce:4,0xcf:8,0xd0:1,0xd1:2,0xd2:4,0xd3:8};const width=widths[tag];if(!width)throw new Error('Unsupported MessagePack type');skip(width);return;}
    if(array>1024||map>256)throw new Error('Collection limit');
    const count=array>=0?array:map*2;capacity+=count;if(capacity>20_000)throw new Error('Allocation limit');
    for(let i=0;i<count;i++)visit(depth+1);
  };
  visit(0);if(offset!==bytes.length)throw new Error('Trailing MessagePack data');
}
export function packCheckpoint(journal:ActionJournal, meta:ActionMetadata):Uint8Array {
  const state=journal.state;
  const data=packMessage([ACTION_VERSION,REPLAY_RULES,journal.sequence,encodeGameState(state.game),[...state.held].map(([slot,h])=>[slot,h.at,h.flags,h.aim]),replayHash(state),meta]);
  if(data.byteLength>MAX_BYTES)throw new Error('Replay checkpoint too large');
  return data;
}
function unpackCheckpoint(bytes:Uint8Array):{state:ReplayState;sequence:number;meta:ActionMetadata}|undefined {
  try {
    const v=unpackMessage(bytes);
    if(!Array.isArray(v)||v.length!==7||v[0]!==ACTION_VERSION||v[1]!==REPLAY_RULES||!integer(v[2])||typeof v[3]!=='string'||!Array.isArray(v[4])||v[4].length>5||typeof v[5]!=='string'||!metadata(v[6]))return;
    const game=decodeGameState(v[3]);if(!game)return;
    const state:ReplayState={game,held:new Map()};
    for(const h of v[4]){
      if(!Array.isArray(h)||h.length!==4||!integer(h[0],4)||!integer(h[1],game.tick)||!integer(h[2],7)||!validAim(h[3])||state.held.has(h[0])||![...game.players.values()].some(p=>p.slot===h[0]))return;
      state.held.set(h[0],{at:h[1],flags:h[2],aim:h[3]});
    }
    if(!validMetadataTick(v[6],state)||replayHash(state)!==v[5])return;
    return {state,sequence:v[2],meta:v[6]};
  }catch{return;}
}

/** One immutable checkpoint transfer and one monotonic application acknowledgement per peer. */
export class ActionSender {
  private generation=0;
  private ack=-1;
  private sent=-1;
  private confirmedHashTick=-Infinity;
  private sentHash?:{sequence:number;tick:number};
  private pending?:{data:Uint8Array;sequence:number;tick:number;created:number;last:number;index:number;total:number};
  requestBaseline():void {this.pending=undefined;this.ack=-1;this.sent=-1;this.confirmedHashTick=-Infinity;this.sentHash=undefined;}
  receive(raw:unknown):void {
    if(!raw||typeof raw!=='object')return;
    const v=raw as ActionReceipt;
    if(v.type!=='actionReceipt'||v.generation!==this.generation||!integer(v.sequence)||v.sequence>this.sent||v.sequence<this.ack)return;
    if(this.pending){if(v.sequence!==this.pending.sequence)return;this.confirmedHashTick=this.pending.tick;this.pending=undefined;}
    if(this.sentHash&&v.sequence>=this.sentHash.sequence)this.confirmedHashTick=this.sentHash.tick;
    this.ack=v.sequence;
  }
  publish(journal:ActionJournal,meta:ActionMetadata,now:number,send:(message:ActionMessage)=>boolean):void {
    if(this.pending&&now-this.pending.created>=5000)this.requestBaseline();
    let ops=this.ack<0?undefined:journal.since(this.ack);
    if(!this.pending&&(!ops||ops.length>100||packMessage(ops).byteLength>MAX_BATCH_BYTES)){
      const data=packCheckpoint(journal,meta);this.generation++;this.ack=-1;
      this.pending={data,sequence:journal.sequence,tick:journal.state.game.tick,created:now,last:-Infinity,index:0,total:Math.ceil(data.byteLength/CHUNK_BYTES)};
    }
    const pending=this.pending;
    if(pending){
      if(pending.index===pending.total){if(now-pending.last<500)return;pending.index=0;}
      for(let count=0;count<4&&pending.index<pending.total;count++){
        const index=pending.index;
        if(!send({type:'actionChunk',generation:this.generation,index,total:pending.total,bytes:pending.data.slice(index*CHUNK_BYTES,(index+1)*CHUNK_BYTES)}))return;
        pending.index++;pending.last=now;
      }
      if(pending.index===pending.total)this.sent=pending.sequence;
      return;
    }
    ops=journal.since(this.ack)!;
    const hash=journal.state.game.tick-this.confirmedHashTick>=20?replayHash(journal.state):null;
    if(send({type:'actionBatch',generation:this.generation,from:this.ack,tick:journal.state.game.tick,operations:ops,hash,meta})){this.sent=journal.sequence;if(hash)this.sentHash={sequence:journal.sequence,tick:journal.state.game.tick};}
  }
}

export type ActionResult={status:'accepted';state:ReplayState;meta:ActionMetadata;receipt:ActionReceipt}|{status:'stale';receipt?:ActionReceipt}|{status:'waiting'|'resync'|'failed'};
export class ActionReceiver {
  private current?:ReplayState;
  private generation=0;
  private sequence=-1;
  private minimumTick=0;
  private assembly?:{generation:number;total:number;started:number;chunks:Map<number,Uint8Array>;bytes:number};
  private failures:number[]=[];
  private stopped=false;
  acceptedBatches=0;
  hashMismatches=0;
  get state():ReplayState|undefined{return this.current;}
  reset():void {this.current=undefined;this.generation=0;this.sequence=-1;this.minimumTick=0;this.assembly=undefined;this.failures=[];this.stopped=false;}
  /** Drop full-world history on controller mode, retaining anti-rollback fences. */
  release():void {this.current=undefined;this.assembly=undefined;}
  private receipt():ActionReceipt{return {type:'actionReceipt',generation:this.generation,sequence:this.sequence};}
  receive(raw:unknown,now:number):ActionResult {
    if(this.stopped)return {status:'failed'};
    try {
      if(!raw||typeof raw!=='object')return {status:'resync'};
      const v=raw as ActionMessage;
      if(!integer(v.generation)||v.generation<1)return {status:'resync'};
      if(v.generation<this.generation)return {status:'stale'};
      if(v.type==='actionChunk')return this.chunk(v,now);
      if(v.type!=='actionBatch'||!this.current||v.generation!==this.generation)return {status:'resync'};
      if(!integer(v.from)||!integer(v.tick)||!Array.isArray(v.operations)||v.operations.length>100||!v.operations.every(validOperation)||packMessage(v.operations).byteLength>MAX_BATCH_BYTES||!metadata(v.meta)||!(v.hash===null||typeof v.hash==='string'&&/^[0-9a-f]{16}$/.test(v.hash)))return {status:'resync'};
      const end=v.from+v.operations.length;
      if(end<this.sequence||v.tick<this.current.game.tick)return {status:'stale',receipt:this.receipt()};
      if(v.from>this.sequence)return {status:'resync'};
      const candidate:ReplayState=structuredClone(this.current);
      for(const op of v.operations.slice(this.sequence-v.from))applyOperation(candidate,op);
      if(candidate.game.tick!==v.tick||!validMetadataTick(v.meta,candidate)||!isGameState(candidate.game))return {status:'resync'};
      if(v.hash!==null&&replayHash(candidate)!==v.hash){
        this.hashMismatches++;this.failures=this.failures.filter(t=>now-t<30_000);this.failures.push(now);
        if(this.failures.length>=3){this.stopped=true;return {status:'failed'};}
        return {status:'resync'};
      }
      this.current=candidate;this.minimumTick=candidate.game.tick;this.sequence=end;this.acceptedBatches++;
      return {status:'accepted',state:candidate,meta:v.meta,receipt:this.receipt()};
    }catch{return {status:'resync'};}
  }
  private chunk(v:ActionChunk,now:number):ActionResult {
    if(v.generation===this.generation&&this.sequence>=0)return this.current?{status:'stale',receipt:this.receipt()}:{status:'stale'};
    if(!integer(v.index)||!integer(v.total,Math.ceil(MAX_BYTES/CHUNK_BYTES))||v.total<1||v.index>=v.total||!(v.bytes instanceof Uint8Array)||v.bytes.byteLength<1||v.bytes.byteLength>CHUNK_BYTES)return {status:'resync'};
    if(this.assembly&&now-this.assembly.started>=5000){this.assembly=undefined;return {status:'resync'};}
    if(this.assembly&&v.generation<this.assembly.generation)return {status:'stale'};
    if(!this.assembly||v.generation>this.assembly.generation)this.assembly={generation:v.generation,total:v.total,started:now,chunks:new Map(),bytes:0};
    const assembly=this.assembly;
    if(assembly.total!==v.total)return {status:'resync'};
    const old=assembly.chunks.get(v.index);
    if(old){if(old.length!==v.bytes.length||old.some((b,i)=>b!==v.bytes[i]))return {status:'resync'};}
    else {assembly.chunks.set(v.index,v.bytes.slice());assembly.bytes+=v.bytes.byteLength;}
    if(assembly.bytes>MAX_BYTES){this.assembly=undefined;return {status:'resync'};}
    if(assembly.chunks.size!==assembly.total)return {status:'waiting'};
    const data=new Uint8Array(assembly.bytes);let offset=0;
    for(let index=0;index<assembly.total;index++){const part=assembly.chunks.get(index)!;data.set(part,offset);offset+=part.length;}
    this.assembly=undefined;
    const candidate=unpackCheckpoint(data);
    if(!candidate||candidate.state.game.tick<this.minimumTick||candidate.sequence<this.sequence)return {status:'resync'};
    this.current=candidate.state;this.minimumTick=candidate.state.game.tick;this.sequence=candidate.sequence;this.generation=v.generation;
    return {status:'accepted',state:this.current,meta:candidate.meta,receipt:this.receipt()};
  }
}
