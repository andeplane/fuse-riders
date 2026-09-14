/** Per-link send permission. WebKit's RTCDataChannel keeps readyState "open" for a task hop after the
 * SCTP/DTLS transport is gone; a send in that gap fails inside WebKit's NetworkSendQueue and is reported
 * as a console error, not a thrown exception, so try/catch cannot see it. Record every closing signal we
 * get earlier than the DOM state and refuse to send once one is recorded. State is monotonic and scoped to
 * one link instance: a replacement link starts with a fresh gate. */
export type LinkDrainReason='closing'|'closed'|'error'|'failed'|'offline';
export interface SendChannelFacts { readyState:RTCDataChannelState;bufferedAmount:number }
export const GAMEPLAY_BUFFER_LIMIT=64000;
export const PROBE_BUFFER_LIMIT=4096;
export class LinkSendGate {
  private drain?:{reason:LinkDrainReason;at:number};
  /** First signal wins; later signals cannot revive the link. */
  drainFrom(reason:LinkDrainReason,at:number):void { this.drain??={reason,at}; }
  get draining():boolean { return this.drain!==undefined; }
  get drainedAt():number|undefined { return this.drain?.at; }
  get reason():LinkDrainReason|undefined { return this.drain?.reason; }
  /** A permitted send means queued in the browser, never applied by the peer. */
  permits(channel:SendChannelFacts|undefined,bufferLimit:number):boolean {
    return !this.drain&&channel?.readyState==='open'&&channel.bufferedAmount<bufferLimit;
  }
}
