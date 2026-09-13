import type { InputControlScope, TickClockSample } from './prediction-contract.js';
/** Bind host time samples to requests; unsolicited/stale replies cannot move the clock. */
export class TickProbes {
  private nextId=0;
  private pending=new Map<number,number>();
  constructor(private readonly now:()=>number){}
  request():{probeId:number;localSentAt:number} {
    const localSentAt=this.now(),probeId=++this.nextId;
    this.pending.set(probeId,localSentAt);
    for(const [id,at] of this.pending)if(localSentAt-at>2000)this.pending.delete(id);
    while(this.pending.size>8)this.pending.delete(this.pending.keys().next().value!);
    return{probeId,localSentAt};
  }
  accept(probeId:number,localSentAt:number,authorityTick:number,paused:boolean,scope:InputControlScope):TickClockSample|undefined {
    const sent=this.pending.get(probeId),localReceivedAt=this.now();
    if(sent===undefined||sent!==localSentAt)return;
    this.pending.delete(probeId);
    if(localReceivedAt<sent||localReceivedAt-sent>2000||!Number.isFinite(authorityTick)||authorityTick<0||typeof paused!=='boolean')return;
    return{scope,localSentAt,localReceivedAt,authorityTick,paused};
  }
  clear():void{this.pending.clear();}
}
