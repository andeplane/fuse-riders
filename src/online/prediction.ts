import { RIDER_SPEED, RIDER_TURN_RATE } from '../shared/game.js';
import { advanceRiderPose, type RiderPose, type MotionControls } from '../shared/rider-motion.js';
import { drunkHeadingOffset } from '../shared/drunk.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import { sameControlScope, type AppliedMotionState, type ScheduledMotionInput, type TickClockSample } from './prediction-contract.js';
import { PredictionClock, type TickEstimate } from './prediction-clock.js';
export { PredictionClock } from './prediction-clock.js';
interface Pending extends ScheduledMotionInput { at:number }
const NEUTRAL:MotionControls={left:false,right:false};
/** Presentation only. Every replay starts from a confirmed state AFTER its tick. */
export class LocalPrediction {
  readonly clock:PredictionClock;
  private base?:{state:ViewSnapshot;id:string;ledger:AppliedMotionState;pose:RiderPose;at:number};
  private pending:Pending[]=[];
  private authorityScope='';
  private offset={x:0,y:0};
  private lastRender=0;
  private shown?:RiderPose;
  correction=0;ackMs=0;
  constructor(private readonly now:()=>number){this.clock=new PredictionClock(now);}
  resetExternalScope():void {this.base=undefined;this.pending=[];this.shown=undefined;this.offset={x:0,y:0};this.clock.reset();}
  observeClock(sample:TickClockSample):boolean{return this.clock.observe(sample);}
  /** Opt-in measurement data for the input probe; reads the scoped clock (refreshing its freshness), so call only alongside input(). */
  diagnostics():{baseTick?:number;pending:number;estimate?:TickEstimate}{return {baseTick:this.base?.state.tick,pending:this.pending.length,estimate:this.base?this.clock.estimate(this.base.ledger.scope):undefined};}
  /** Only the host's admission window decides; a slow clock or lagging snapshot limits the local preview, never the send. */
  input(seq:number,left:boolean,right:boolean):ScheduledMotionInput|undefined {
    const base=this.base;
    if(!base)return undefined;
    const estimate=this.clock.estimate(base.ledger.scope);
    // Outside play the host reports paused, which legitimately clears the clock; scheduling against it would only spam the
    // authority with input it cannot use and churn scope-expired replies across every phase boundary.
    if(!estimate&&base.state.phase!=='playing')return undefined;
    // Overflow: first drop what the host can no longer apply; a full window of unreported input is stale as a whole.
    if(this.pending.length>=128){this.pending=this.pending.filter(input=>input.intendedTick>=base.state.tick-4);if(this.pending.length>=128)this.pending=[];}
    // A lost clock must limit the preview, not the send (#65): an aged authoritative tick still lands inside the host's admission window while snapshots arrive, and only the host decides.
    const intendedTick=Math.floor(estimate?.tick??base.state.tick+(this.now()-base.at)/50)+1;
    const input={seq,left,right,intendedTick,scope:{...base.ledger.scope},resultAcks:base.ledger.results.map(result=>result.seq)};
    this.pending.push({...input,at:this.now()});return input;
  }
  /** A scheduled input the transport refused never reaches the authority. */
  discard(seq:number):void {this.pending=this.pending.filter(input=>input.seq!==seq);}
  /** ack is retained only for wire compatibility; receive sequence never retires input. */
  accept(state:ViewSnapshot,id:string,_ack:number,ledger?:AppliedMotionState,authorityScope=''):boolean {
    const player=state.players.find(p=>p.id===id);
    if(!player||!ledger||ledger.tick!==state.tick||ledger.scope.round!==state.round||ledger.results.some(r=>r.status==='applied'&&r.appliedTick>state.tick))return false;
    const previous=this.base;
    const changed=authorityScope!==this.authorityScope||!previous||!sameControlScope(previous.ledger.scope,ledger.scope)||previous.state.phase!==state.phase;
    if(!changed&&state.tick<previous.state.tick)return false;
    const priorPlayer=previous?.state.players.find(p=>p.id===id);
    const reset=changed||!player.alive||player.portalCooldownUntilTick!==priorPlayer?.portalCooldownUntilTick;
    const oldPose=!reset&&previous?.state.phase==='playing'&&state.phase==='playing'?this.predict(state.tick):undefined;
    if(changed){this.pending=[];this.offset={x:0,y:0};if(previous)this.clock.reset();}
    const results=new Set(ledger.results.map(r=>r.seq));
    for(const input of this.pending)if(results.has(input.seq))this.ackMs=this.now()-input.at;
    // Results retire pending; anything behind the host's admission window can no longer be applied.
    this.pending=this.pending.filter(input=>!results.has(input.seq)&&input.intendedTick>=state.tick-4);
    const pose={x:player.x,y:player.y,angle:player.angle,drunkHeadingOffset:ledger.motion.drunkHeadingOffset};
    this.correction=oldPose?Math.hypot(oldPose.x-pose.x,oldPose.y-pose.y):0;
    this.base={state,id,ledger,pose,at:this.now()};this.authorityScope=authorityScope;
    if(reset){this.pending=[];this.offset={x:0,y:0};this.shown=pose;}
    else if(oldPose&&this.correction<80)this.offset={x:oldPose.x-pose.x,y:oldPose.y-pose.y};
    else this.offset={x:0,y:0};
    return true;
  }
  /** Exact fixed-tick replay plus an uncommitted fractional presentation step. */
  predict(targetTick:number):RiderPose|undefined {
    const base=this.base;if(!base)return undefined;
    let pose={...base.pose},held=base.ledger.held,appliedTick=base.ledger.appliedTick,seq=base.ledger.appliedSeq;
    const end=Math.max(base.state.tick,Math.min(base.state.tick+4,targetTick));
    for(let tick=base.state.tick+1;tick<=Math.ceil(end);tick++){
      const eligible=this.pending.filter(input=>input.intendedTick<=tick&&input.seq>seq).sort((a,b)=>b.seq-a.seq)[0];
      if(eligible){held=eligible;seq=eligible.seq;appliedTick=tick;}
      if(tick-appliedTick>=10)held=NEUTRAL;
      const fraction=Math.min(1,end-(tick-1));if(fraction<=0)break;
      const motion=base.ledger.motion;
      pose=advanceRiderPose(pose,held,{distance:RIDER_SPEED/20*fraction,turn:RIDER_TURN_RATE/20*fraction,drunkHeadingOffset:drunkHeadingOffset(motion.seed,base.id,tick-1+fraction,motion.drunkStartedTick,motion.drunkUntilTick)});
    }
    return pose;
  }
  render(state:ViewSnapshot,id:string):ViewSnapshot {
    const base=this.base,player=base?.state.players.find(p=>p.id===id);if(!base||!player)return state;
    if(!player.alive||base.state.phase!=='playing')return {...state,players:state.players.map(p=>p.id===id?player:p)};
    const estimate=this.clock.estimate(base.ledger.scope);
    const pose=estimate?this.predict(Math.min(estimate.tick,base.state.tick+4)):this.shown??base.pose;
    if(!pose)return state;
    const now=this.now(),decay=Math.exp(-Math.max(0,now-this.lastRender)/65);this.lastRender=now;
    this.offset.x*=decay;this.offset.y*=decay;this.shown=pose;
    const x=pose.x+this.offset.x,y=pose.y+this.offset.y;
    const distance=Math.hypot(x-player.x,y-player.y);
    const trail=distance>0&&distance<=40?[...player.trail,{x1:player.x,y1:player.y,x2:x,y2:y,createdTick:base.state.tick,expiresAtTick:base.state.tick+4}]:player.trail;
    return {...state,players:state.players.map(p=>p.id===id?{...player,...pose,x,y,trail}:p)};
  }
}

/** All discrete state belongs to the earlier tick; never expose future trail/death state. */
export function interpolateWorld(older:ViewSnapshot|undefined,newer:ViewSnapshot,fraction:number):ViewSnapshot {
  if(!older||older.round!==newer.round||older.phase!==newer.phase||fraction>=1)return newer;
  const f=Math.max(0,Math.min(1,fraction));
  return {...older,tick:older.tick+(newer.tick-older.tick)*f,players:older.players.map(previous=>{
    const player=newer.players.find(p=>p.id===previous.id);
    if(!player||!previous.alive||!player.alive||previous.portalCooldownUntilTick!==player.portalCooldownUntilTick)return previous;
    const delta=Math.atan2(Math.sin(player.angle-previous.angle),Math.cos(player.angle-previous.angle));
    return {...previous,x:previous.x+(player.x-previous.x)*f,y:previous.y+(player.y-previous.y)*f,angle:previous.angle+delta*f};
  }),bombs:older.bombs.map(previous=>{
    const bomb=newer.bombs.find(b=>b.id===previous.id);
    if(!bomb?.shell||!previous.shell||bomb.shell.vx!==previous.shell.vx||bomb.shell.vy!==previous.shell.vy)return previous;
    return {...previous,x:previous.x+(bomb.x-previous.x)*f,y:previous.y+(bomb.y-previous.y)*f};
  })};
}
export class RemoteWorldBuffer {
  private frames:ViewSnapshot[]=[];private scope='';private presented=-Infinity;
  push(state:ViewSnapshot,scope:string):void {
    if(scope!==this.scope||this.frames.at(-1)?.round!==state.round||this.frames.at(-1)?.phase!==state.phase){this.frames=[];this.presented=-Infinity;this.scope=scope;}
    if(this.frames.at(-1)&&state.tick<this.frames.at(-1)!.tick)return;
    if(this.frames.at(-1)?.tick===state.tick)this.frames.pop();this.frames.push(state);if(this.frames.length>32)this.frames.shift();
  }
  render(authorityTick?:number,delayTicks:0.5|1|2=2):ViewSnapshot|undefined {
    const newest=this.frames.at(-1);if(!newest)return undefined;
    // Freeze at newest available snapshot: no guessed bounce/collision trajectories.
    const delay=delayTicks===0.5?0.5:delayTicks===1?1:2;
    const tick=Math.max(this.presented,Math.min(newest.tick,Math.max(this.frames[0]!.tick,(authorityTick??newest.tick+delay)-delay)));this.presented=tick;
    const upper=this.frames.findIndex(state=>state.tick>=tick);if(upper<=0)return this.frames[0];
    const a=this.frames[upper-1]!,b=this.frames[upper]!;return interpolateWorld(a,b,(tick-a.tick)/(b.tick-a.tick));
  }
}
