/** Per-link send permission. WebKit's RTCDataChannel keeps readyState "open" for a task hop after the
 * SCTP/DTLS transport is gone; a send in that gap fails inside WebKit's NetworkSendQueue and is reported
 * as a console error, not a thrown exception, so try/catch cannot see it. Record every closing signal we
 * get earlier than the DOM state and refuse to send once one is recorded. State is monotonic and scoped to
 * one link instance: a replacement link starts with a fresh gate. */
export interface SendChannelFacts { readyState:RTCDataChannelState;bufferedAmount:number }
export const GAMEPLAY_BUFFER_LIMIT=64000;
export const PROBE_BUFFER_LIMIT=4096;
export const COORDINATION_BUFFER_LIMIT=12_000;
export const CHECKPOINT_BUFFER_LIMIT=6_000;
export const CHECKPOINT_CHUNK_BYTES=2_000;
/** Shared uplink budget includes every link/lane and the complete prospective wire envelope. */
export function permitsAggregate(links:Iterable<{channel?:SendChannelFacts;fast?:SendChannelFacts}>,bytes:number,limit:number):boolean {
  if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>limit)return false;
  let total=bytes;
  for(const link of links)for(const channel of [link.channel,link.fast])if(channel){
    if(!Number.isFinite(channel.bufferedAmount)||channel.bufferedAmount<0)return false;
    total+=channel.bufferedAmount;if(total>limit)return false;
  }
  return true;
}
/** Re-evaluate at send time, including deferred replies. Reliable backlog must not block fast health evidence. */
export function permitsFastControl(stopped:boolean,hidden:boolean,fast:SendChannelFacts|undefined,fastGate:LinkSendGate,reliable:SendChannelFacts|undefined,reliableGate:LinkSendGate):boolean {
  return !stopped&&!hidden&&reliable?.readyState==='open'&&!reliableGate.draining&&fastGate.permits(fast,PROBE_BUFFER_LIMIT);
}
export class LinkSendGate {
  private drained=false;
  /** Monotonic: nothing revives a drained link; a replacement link gets a new gate. */
  drain():void { this.drained=true; }
  get draining():boolean { return this.drained; }
  /** Bulk transfers must wait until the action lane has completely drained. */
  permitsIdle(channel:SendChannelFacts|undefined):boolean {
    return this.permits(channel,1)&&channel!.bufferedAmount===0;
  }
  /** A permitted send means queued in the browser, never applied by the peer. */
  permits(channel:SendChannelFacts|undefined,bufferLimit:number):boolean {
    return !this.draining&&channel?.readyState==='open'&&channel.bufferedAmount<bufferLimit;
  }
}
