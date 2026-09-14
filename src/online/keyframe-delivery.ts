import type { WorldFrame } from './world-codec.js';
export interface KeyframeReceipt { generation:number; id:string; seq:number; matchId:string; round:number }
export interface FramedWorld { frame:WorldFrame }
export function keyframeReceipt(frame:WorldFrame):KeyframeReceipt {return {generation:frame.generation,id:frame.stream,seq:frame.seq,matchId:frame.matchId,round:frame.round};}
function validReceipt(value:unknown):value is KeyframeReceipt {
 if(!value||typeof value!=='object')return false;const v=value as Record<string,unknown>;
 return Number.isSafeInteger(v.generation)&&Number(v.generation)>0&&Number.isSafeInteger(v.seq)&&Number(v.seq)>0&&Number.isSafeInteger(v.round)&&Number(v.round)>=0&&typeof v.id==='string'&&v.id.length>0&&v.id.length<=128&&typeof v.matchId==='string'&&v.matchId.length>0&&v.matchId.length<=128;
}
function sameReceipt(a:KeyframeReceipt,b:KeyframeReceipt){return a.generation===b.generation&&a.id===b.id&&a.seq===b.seq&&a.matchId===b.matchId&&a.round===b.round;}
/** One full immutable world, including its matching application ledger, per peer. */
export class KeyframeDelivery<T extends FramedWorld> {
 private pending?:{world:T;createdAt:number;attemptedAt:number};
 private scope?:{matchId:string;round:number};
 hold(world:T,now:number):void {if(world.frame.base!==0)throw new Error('Only full keyframes can await receipt');this.pending={world:structuredClone(world),createdAt:now,attemptedAt:-Infinity};this.scope={matchId:world.frame.matchId,round:world.frame.round};}
 clear():void{this.pending=undefined;this.scope=undefined;}
 get waiting():boolean{return !!this.pending;}
 /** Caller must replace the encoder when lifecycle scope changes or age expires. */
 matchesScope(matchId:string,round:number):boolean{return !this.scope||(this.scope.matchId===matchId&&this.scope.round===round);}
 pump(now:number,send:(world:T)=>boolean):'idle'|'waiting'|'expired' {
  const pending=this.pending;if(!pending)return 'idle';
  if(now-pending.createdAt>=5000){this.clear();return 'expired';}
  if(now-pending.attemptedAt>=500){pending.attemptedAt=now;send(structuredClone(pending.world));}
  return 'waiting';
 }
 acknowledge(raw:unknown):boolean {if(!this.pending||!validReceipt(raw)||!sameReceipt(raw,keyframeReceipt(this.pending.world.frame)))return false;this.pending=undefined;return true;}
}
/** Only an exactly repeated, previously accepted envelope can receive another ACK. */
export class AcceptedKeyframe {
 private accepted?:{receipt:KeyframeReceipt;serialized:string};
 remember<T extends FramedWorld>(world:T):void {if(world.frame.base===0)this.accepted={receipt:keyframeReceipt(world.frame),serialized:JSON.stringify(world)};}
 receipt<T extends FramedWorld>(world:T):KeyframeReceipt|undefined {return this.accepted&&world.frame.base===0&&sameReceipt(keyframeReceipt(world.frame),this.accepted.receipt)&&JSON.stringify(world)===this.accepted.serialized?{...this.accepted.receipt}:undefined;}
 clear():void{this.accepted=undefined;}
}
