import type {AppliedMotionState,InputControlScope} from './prediction-contract.js';
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer=(value:unknown,min=0):value is number=>Number.isSafeInteger(value)&&Number(value)>=min;
export function isInputControlScope(value:unknown):value is InputControlScope {
 return record(value)&&typeof value.matchId==='string'&&value.matchId.length>0&&value.matchId.length<=128&&integer(value.round)&&typeof value.controlEpoch==='string'&&value.controlEpoch.length>0&&value.controlEpoch.length<=256;
}
export function isAppliedMotionState(value:unknown):value is AppliedMotionState {
 if(!record(value)||!isInputControlScope(value.scope)||!integer(value.tick)||!integer(value.appliedSeq,-1)||!integer(value.appliedTick)||value.appliedTick>value.tick||!record(value.held)||typeof value.held.left!=='boolean'||typeof value.held.right!=='boolean'||!Array.isArray(value.results)||value.results.length>128||!record(value.motion))return false;
 const motion=value.motion;
 if(!integer(motion.seed)||!integer(motion.drunkStartedTick)||!integer(motion.drunkUntilTick)||typeof motion.drunkHeadingOffset!=='number'||!Number.isFinite(motion.drunkHeadingOffset)||Math.abs(motion.drunkHeadingOffset)>Math.PI)return false;
 const tick=value.tick;
 const seen=new Set<number>();
 return value.results.every(result=>{
  if(!record(result)||!integer(result.seq)||seen.has(result.seq))return false;seen.add(result.seq);
  return result.status==='applied'?integer(result.appliedTick)&&result.appliedTick<=tick:result.status==='superseded'||result.status==='expired';
 });
}
