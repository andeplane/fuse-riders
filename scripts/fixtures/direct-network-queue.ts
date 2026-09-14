/** Seeded application-send impairment, not OS/IP shaping or SCTP retransmission emulation. */
export interface DirectNetworkProfile { name:string; delayMs:number; jitterMs:number; fastLoss:number; kilobitsPerSecond:number }
export const directNetworkProfiles:Record<string,DirectNetworkProfile>={
  local:{name:'local',delayMs:0,jitterMs:0,fastLoss:0,kilobitsPerSecond:0},
  regional:{name:'regional',delayMs:40,jitterMs:20,fastLoss:.02,kilobitsPerSecond:512},
  mobile:{name:'mobile',delayMs:75,jitterMs:50,fastLoss:.05,kilobitsPerSecond:256},
};
interface Entry<T> { channel:T; bytes:number; data:string|Uint8Array; due:number; at:number; serializedAt:number;buffered:boolean; order:number }
export class DirectNetworkQueue<T extends object> {
  private queue:Entry<T>[]=[];
  private reliableDue=new WeakMap<T,number>();
  private channelBytes=new WeakMap<T,number>();
  private bandwidthAt=0;
  private serial=0;
  readonly stats={attempted:0,delivered:0,fastDropped:0,closed:0,overflow:0,queuedBytes:0,bufferedBytes:0,maxBufferedBytes:0,maxQueuedBytes:0,maxQueuedPackets:0,maxScheduledDelayMs:0,maxResidenceMs:0};
  constructor(readonly profile:DirectNetworkProfile,private seed:number,private send:(channel:T,data:string|Uint8Array)=>boolean){}
  bufferedAmount(channel:T):number {return this.channelBytes.get(channel)??0;}
  private random():number {this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  enqueue(channel:T,data:string|Uint8Array,fast:boolean,now:number):void {
    const bytes=typeof data==='string'?new TextEncoder().encode(data).byteLength:data.byteLength;
    this.stats.attempted++;
    if(fast&&this.random()<this.profile.fastLoss){this.stats.fastDropped++;return;}
    if(this.queue.length>=2048||this.stats.queuedBytes+bytes>512*1024){this.stats.overflow++;return;}
    this.bandwidthAt=Math.max(now,this.bandwidthAt)+(this.profile.kilobitsPerSecond?bytes*8/this.profile.kilobitsPerSecond:0);
    let due=this.bandwidthAt+Math.max(0,this.profile.delayMs+(this.random()*2-1)*this.profile.jitterMs);
    if(!fast){due=Math.max(due,this.reliableDue.get(channel)??0);this.reliableDue.set(channel,due);}
    this.queue.push({channel,bytes,data:typeof data==='string'?data:new Uint8Array(data),due,at:now,serializedAt:this.bandwidthAt,buffered:true,order:++this.serial});
    this.stats.maxScheduledDelayMs=Math.max(this.stats.maxScheduledDelayMs,due-now);
    this.channelBytes.set(channel,this.bufferedAmount(channel)+bytes);
    this.stats.bufferedBytes+=bytes;this.stats.maxBufferedBytes=Math.max(this.stats.maxBufferedBytes,this.stats.bufferedBytes);
    this.stats.queuedBytes+=bytes;this.stats.maxQueuedBytes=Math.max(this.stats.maxQueuedBytes,this.stats.queuedBytes);this.stats.maxQueuedPackets=Math.max(this.stats.maxQueuedPackets,this.queue.length);
  }
  pump(now:number):void {
    // Propagation-delayed messages remain retained, but no longer occupy the sender's unsent buffer.
    for(const entry of this.queue)if(entry.buffered&&entry.serializedAt<=now){
      entry.buffered=false;this.channelBytes.set(entry.channel,this.bufferedAmount(entry.channel)-entry.bytes);this.stats.bufferedBytes-=entry.bytes;
    }
    this.queue.sort((a,b)=>a.due-b.due||a.order-b.order);
    while(this.queue.length&&this.queue[0].due<=now){
      const next=this.queue.shift()!;this.stats.queuedBytes-=next.bytes;
      this.stats.maxResidenceMs=Math.max(this.stats.maxResidenceMs,now-next.at);
      if(this.send(next.channel,next.data))this.stats.delivered++;else this.stats.closed++;
    }
  }
  clear():void {this.queue=[];this.channelBytes=new WeakMap();this.stats.queuedBytes=0;this.stats.bufferedBytes=0;}
}
