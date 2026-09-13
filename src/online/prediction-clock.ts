import { sameControlScope, type TickClockSample, type InputControlScope } from './prediction-contract.js';
export interface TickEstimate { lower:number; upper:number; tick:number }
/** Host tick sampled at send; receive time includes an unknown fraction of RTT. */
export class PredictionClock {
  private sample?:TickClockSample;
  private lastRead?:number;
  constructor(private readonly now:()=>number){}
  reset():void {this.sample=undefined;this.lastRead=undefined;}
  observe(sample:TickClockSample):boolean {
    const rtt=sample.localReceivedAt-sample.localSentAt;
    if(sample.paused){this.reset();return false;}
    if(![rtt,sample.authorityTick,sample.localReceivedAt].every(Number.isFinite)||rtt<0||rtt>500||sample.localReceivedAt>this.now()||this.now()-sample.localReceivedAt>4000)return false;
    if(this.sample&&sameControlScope(sample.scope,this.sample.scope)&&sample.localReceivedAt<=this.sample.localReceivedAt)return false;
    this.sample={...sample,scope:{...sample.scope}};this.lastRead=this.now();return true;
  }
  estimate(scope?:InputControlScope):TickEstimate|undefined {
    const now=this.now(),sample=this.sample;
    if(this.lastRead!==undefined&&(now<this.lastRead||now-this.lastRead>500)){this.reset();return undefined;}
    this.lastRead=now;
    if(!sample||(scope&&!sameControlScope(scope,sample.scope)))return undefined;
    const age=now-sample.localReceivedAt;
    if(age<0||age>4000){this.reset();return undefined;}
    const drift=age*.001/50,elapsed=age/50;
    const lower=sample.authorityTick+elapsed-drift,upper=sample.authorityTick+elapsed+drift+(sample.localReceivedAt-sample.localSentAt)/50;
    return {lower,upper,tick:(lower+upper)/2};
  }
}
