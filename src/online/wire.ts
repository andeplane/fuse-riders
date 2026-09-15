import { decode, encode } from '@msgpack/msgpack';
import type { ActionBatch } from './action-replication.js';
import type { RoomCommand } from './host-session.js';
import type { InputControlScope } from './prediction-contract.js';
import type { ControllerStatus } from './controller-status.js';

/** Largest packet accepted on the unreliable channel; everything bigger belongs on the reliable one. */
export const FAST_MESSAGE_BYTES=4096;
const integer=(x:unknown,max=Number.MAX_SAFE_INTEGER):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0&&x<=max;
export function hashText(text:string):number {
  let hash=0x811c9dc5;
  for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),0x01000193);
  return hash>>>0;
}
/** A 32-bit stand-in for the three-part control scope; the receiver resolves it against scopes it already knows. */
export function hashScope(scope:InputControlScope):number { return hashText(`${scope.matchId}|${scope.round}|${scope.controlEpoch}`); }
/** Sender, receiver and link identity are implied by the data channel the bytes arrive on; only the authority fence travels. */
export interface FastEnvelope { id:number; epoch:number; incarnation:number; data:unknown }
export function encodeFast(envelope:FastEnvelope):Uint8Array { return encode([envelope.id,envelope.epoch,envelope.incarnation,envelope.data],{ignoreUndefined:true}); }
export function decodeFast(bytes:ArrayBuffer|Uint8Array):FastEnvelope|undefined {
  const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(view.byteLength>FAST_MESSAGE_BYTES)return;
  try {
    const v=decode(view,{maxArrayLength:512,maxMapLength:64,maxStrLength:512,maxBinLength:0,maxExtLength:0});
    if(!Array.isArray(v)||v.length!==4||!integer(v[0])||!integer(v[1])||!integer(v[2]))return;
    return {id:v[0],epoch:v[1],incarnation:v[2],data:v[3]};
  }catch{return;}
}

type InputCommand=Extract<RoomCommand,{type:'input'}>;
export type FastMessage=ActionBatch
  |{type:'command';command:InputCommand}
  |{type:'tickProbe';probeId:number;localSentAt:number}
  |{type:'tickPong';probeId:number;localSentAt:number;authorityTick:number;paused:boolean;scope:InputControlScope}
  |ControllerStatus;
const BOMB_ACTIONS=['press','release','cancel'] as const;
const STALE_SCOPE:InputControlScope={matchId:'',round:-1,controlEpoch:''};
/** Positional tuples with numeric tags; values are validated by the same code that validates the JSON shapes. */
export function packFast(message:FastMessage):unknown[] {
  switch(message.type){
    case 'actions': return [1,message.from,message.tick,message.ops,message.hash,message.meta.ack,message.meta.paused,message.meta.motion===undefined?0:message.meta.motion,message.meta.settings??null];
    case 'command': {const c=message.command;return [2,hashScope(c.scope),c.seq,c.intendedTick,Number(c.left)|Number(c.right)<<1|Number(c.bomb)<<2,c.gesture??null,c.bombAction?BOMB_ACTIONS.indexOf(c.bombAction)+1:0,c.aim?[c.aim.x,c.aim.y]:null,c.resultAcks??[]];}
    case 'tickProbe': return [3,message.probeId,message.localSentAt];
    case 'tickPong': return [4,message.probeId,message.localSentAt,message.authorityTick,message.paused,hashScope(message.scope)];
    case 'status': return [5,message.tick,message.ack,message.paused,message.pos??null];
  }
}
export function unpackFast(value:unknown,scopeFor:(hash:number)=>InputControlScope|undefined):FastMessage|undefined {
  if(!Array.isArray(value))return;
  switch(value[0]){
    case 1: {
      if(value.length!==9)return;const [,from,tick,ops,hash,ack,paused,motion,settings]=value as [number,number,number,ActionBatch['ops'],string|null,number,boolean,unknown,unknown];
      return {type:'actions',from,tick,ops,hash,meta:{ack,paused,...(motion===0?{}:{motion:motion as ActionBatch['meta']['motion']}),...(settings===null?{}:{settings:settings as ActionBatch['meta']['settings']})}};
    }
    case 2: {
      if(value.length!==9)return;const [,scopeHash,seq,intendedTick,flags,gesture,action,aim,resultAcks]=value as [number,number,number,number,number,number|null,number,[number,number]|null,number[]];
      if(!integer(scopeHash)||!integer(flags,7)||!integer(action,3))return;
      const scope=scopeFor(scopeHash)??{...STALE_SCOPE};
      return {type:'command',command:{type:'input',scope,seq,intendedTick,left:!!(flags&1),right:!!(flags&2),bomb:!!(flags&4),...(gesture===null?{}:{gesture}),...(action?{bombAction:BOMB_ACTIONS[action-1]!}:{}),...(Array.isArray(aim)&&aim.length===2?{aim:{x:aim[0],y:aim[1]}}:{}),resultAcks}};
    }
    case 3: {if(value.length!==3)return;const [,probeId,localSentAt]=value as [number,number,number];return {type:'tickProbe',probeId,localSentAt};}
    case 4: {
      if(value.length!==6||!integer(value[5]))return;const [,probeId,localSentAt,authorityTick,paused]=value as [number,number,number,number,boolean];
      const scope=scopeFor(value[5] as number);if(!scope)return;
      return {type:'tickPong',probeId,localSentAt,authorityTick,paused,scope};
    }
    case 5: {if(value.length!==5)return;const [,tick,ack,paused,pos]=value as [number,number,number,boolean,[number,number,number]|null];return {type:'status',tick,ack,paused,...(pos===null?{}:{pos})};}
    default: return;
  }
}
