import { sameControlScope, type TickClockSample, type InputControlScope } from './prediction-contract.js';
export interface TickEstimate { lower:number; upper:number; tick:number }
/** Host tick sampled at send; receive time includes an unknown fraction of RTT. */
export class PredictionClock {
  private sample?:TickClockSample;
  private lastRead?:number;
  private nearbySamples=0;
  constructor(private readonly now:()=>number){}
  reset():void {this.sample=undefined;this.lastRead=undefined;this.nearbySamples=0;}
  observe(sample:TickClockSample):boolean {
    const now=this.now(),previous=this.sample;
    if(this.lastRead!==undefined&&(now<this.lastRead||now-this.lastRead>500))this.reset();
    const rtt=sample.localReceivedAt-sample.localSentAt;
    if(Number.isFinite(rtt)&&rtt>40)this.nearbySamples=0;
    if(sample.paused){this.reset();return false;}
    if(![rtt,sample.authorityTick,sample.localReceivedAt].every(Number.isFinite)||rtt<0||rtt>500||sample.localReceivedAt>this.now()||this.now()-sample.localReceivedAt>4000)return false;
    if(previous&&sameControlScope(sample.scope,previous.scope)&&sample.localReceivedAt<=previous.localReceivedAt)return false;
    if(!this.sample||!sameControlScope(sample.scope,this.sample.scope)||sample.localReceivedAt-this.sample.localReceivedAt>1000)this.nearbySamples=0;
    this.nearbySamples=rtt<=40?Math.min(3,this.nearbySamples+1):0;
    this.sample={...sample,scope:{...sample.scope}};this.lastRead=this.now();return true;
  }
  /** Only a fresh validated nearby host probe permit a shorter presentation buffer. */
  presentationDelayTicks():0.5|2 {
    if(!this.estimate()||!this.sample||this.now()-this.sample.localReceivedAt>1000){this.nearbySamples=0;return 2;}
    return this.nearbySamples>=1?0.5:2;
  }
  /** Read-only opt-in measurement data; does not refresh or qualify a clock. */
  diagnostics():{scope:InputControlScope;rttMs:number;sampleAgeMs:number;nearbySamples:number}|undefined {
    const sample=this.sample;return sample?{scope:{...sample.scope},rttMs:sample.localReceivedAt-sample.localSentAt,sampleAgeMs:this.now()-sample.localReceivedAt,nearbySamples:this.nearbySamples}:undefined;
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
