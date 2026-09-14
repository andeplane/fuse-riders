/** Opt-in CPU render-submission evidence. These are not physical screen/scanout timestamps. */
export interface ResponseActor {id:string;angle:number;alive:boolean;drunkUntilTick:number;invulnerableUntilTick:number;portalCooldownUntilTick:number;shielded:boolean}
export interface ResponseFrame {kind:'response-render';delayTicks?:0.5|1|2;clock?:{rttMs:number;sampleAgeMs:number;nearbySamples:number;scope:{matchId:string;round:number;controlEpoch:string}};epochAt:number;scope:string;phase:string;tick:number;powerupsDisabled:boolean;players:ResponseActor[]}
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
/** Comparable sampled render windows: excludes phase/death/scope changes and gaps between attempts. */
export function renderedTickContinuity(frames:readonly ResponseFrame[],actorId:string){
 const unique=[...new Map(frames.map(f=>[f.epochAt,f])).values()].sort((a,b)=>a.epochAt-b.epochAt);
 const intervals:number[]=[],holds:number[]=[],largeGaps:number[]=[];let previous:ResponseFrame|undefined,hold=0,repeated=0,repeatedMs=0;
 const endHold=()=>{if(hold>0)holds.push(hold);hold=0;};
 for(const frame of unique){
  const actor=frame.players.find(p=>p.id===actorId);
  if(frame.phase!=='playing'||!actor?.alive){endHold();previous=undefined;continue;}
  const dt=previous?frame.epochAt-previous.epochAt:0;
  if(previous&&previous.scope===frame.scope&&dt>0&&dt<=100){
   intervals.push(dt);
   if(Math.abs(frame.tick-previous.tick)<1e-6){repeated++;repeatedMs+=dt;hold+=dt;}else endHold();
  }else {if(previous&&previous.scope===frame.scope&&dt>100)largeGaps.push(dt);endHold();}
  previous=frame;
 }
 endHold();
 const q=(v:number[])=>{const s=[...v].sort((a,b)=>a-b);return{count:s.length,p50:s[Math.ceil(s.length*.5)-1]??null,p95:s[Math.ceil(s.length*.95)-1]??null,p99:s[Math.ceil(s.length*.99)-1]??null,max:s.at(-1)??null};};
 return {intervals:q(intervals),excludedGapsOver100ms:q(largeGaps),observedHoldSpansMs:q(holds),repeatedTickIntervals:repeated,repeatedTickRatio:intervals.length?repeated/intervals.length:0,repeatedTickTimeRatio:intervals.length?repeatedMs/intervals.reduce((a,b)=>a+b,0):0};
}
