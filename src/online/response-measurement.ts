/** Opt-in CPU render-submission evidence. These are not physical screen/scanout timestamps. */
export interface ResponseActor {id:string;angle:number;alive:boolean;drunkUntilTick:number;invulnerableUntilTick:number;portalCooldownUntilTick:number;shielded:boolean}
export interface ResponseFrame {kind:'response-render';delayTicks?:1|2;clock?:{rttMs:number;sampleAgeMs:number;nearbySamples:number;scope:{matchId:string;round:number;controlEpoch:string}};epochAt:number;scope:string;phase:string;tick:number;powerupsDisabled:boolean;players:ResponseActor[]}
export interface ResponsePointer {epochAt:number;actorId:string;direction:-1|1;trusted:boolean}
export interface ResponseResult {status:'changed'|'rejected'|'timeout';reason?:string;latencyMs?:number;baseline?:ResponseFrame;changed?:ResponseFrame;frames:ResponseFrame[]}
const delta=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const EPSILON=1e-4;
/** Requires a stable observed straight heading, rather than counting the next RAF. */
export function headingResponse(pointer:ResponsePointer,frames:readonly ResponseFrame[],deadlineMs=800,thresholdRadians=EPSILON):ResponseResult {
 const window=frames.filter(f=>f.epochAt>=pointer.epochAt-250&&f.epochAt<=pointer.epochAt+deadlineMs);
 const reject=(reason:string):ResponseResult=>({status:'rejected',reason,frames:window});
 if(!pointer.trusted||!Number.isFinite(pointer.epochAt)||!pointer.actorId)return reject('invalid-pointer');
 const before=window.filter(f=>f.epochAt<=pointer.epochAt),baseline=before.at(-1),actor=baseline?.players.find(p=>p.id===pointer.actorId);
 if(!baseline||!actor||pointer.epochAt-baseline.epochAt>100)return reject('missing-fresh-baseline');
 const stable=before.filter(f=>f.epochAt>=pointer.epochAt-200);
 if(stable.length<3||baseline.epochAt-stable[0]!.epochAt<150)return reject('short-baseline');
 const clean=(frame:ResponseFrame):ResponseActor|undefined=>{const p=frame.players.find(p=>p.id===pointer.actorId);return frame.phase==='playing'&&frame.scope===baseline.scope&&frame.powerupsDisabled&&p?.alive&&p.drunkUntilTick<=frame.tick&&p.invulnerableUntilTick<=frame.tick&&!p.shielded&&p.portalCooldownUntilTick===actor.portalCooldownUntilTick&&Number.isFinite(p.angle)?p:undefined;};
 if(stable.some(f=>{const p=clean(f);return !p||Math.abs(delta(p.angle,actor.angle))>EPSILON;}))return reject('confounded-or-turning-baseline');
 for(const frame of window.filter(f=>f.epochAt>pointer.epochAt)){
  const p=clean(frame);if(!p)return reject('phase-death-effect-or-scope-change');
  const change=delta(p.angle,actor.angle);if(Math.abs(change)<thresholdRadians)continue;
  if(change*pointer.direction<=0)return reject('opposite-heading-change');
  return {status:'changed',latencyMs:frame.epochAt-pointer.epochAt,baseline,changed:frame,frames:window.filter(f=>f.epochAt<=frame.epochAt)};
 }
 if((window.at(-1)?.epochAt??-Infinity)<pointer.epochAt+deadlineMs-100)return reject('incomplete-observation');
 return {status:'timeout',reason:'no-changed-heading-before-deadline',baseline,frames:window};
}
