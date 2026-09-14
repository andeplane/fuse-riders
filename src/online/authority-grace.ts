/**
 * Seat control scopes survive a transient authority-clock gap (#48).
 *
 * `AuthorityClock.permits()` reads false whenever the lease cannot be *proven* by the conservative clock: a
 * main-thread stall over 500 ms, a WSS time sample older than 4 s or one whose uncertainty exceeds the lease guard.
 * The runtime must stop advancing, sending and receiving on any of those (that fence is unchanged), but rotating
 * every seat's control epoch as well made every guest's in-flight and held-resend inputs fail with
 * 'Input scope expired; resync' until a fresh snapshot arrived, even though the 10 s lease never lapsed.
 *
 * Seats are cleared only after AUTHORITY_GRACE_MS of continuous non-permission following active authority: one
 * full 2 s sample period plus the 500 ms maximum admissible round trip, so a single stalled, missed or uncertain
 * sample never resets controls, while an outage that outlives a complete re-sampling opportunity is treated as
 * authority loss. Kept pending inputs can only ever apply if the *same* grant is certified again, at the same
 * unchanged tick; a real authority change, revocation or room end clears seats immediately through the transport
 * callbacks, independent of this timer.
 */
export const AUTHORITY_GRACE_MS=2500;
export class AuthorityGrace {
  private since?:number;
  private armed=false;
  /** Feed every runtime tick with the local clock. True exactly once per outage, when the seats must be cleared. */
  clearSeats(now:number,permitted:boolean):boolean {
    if(permitted){this.since=undefined;this.armed=true;return false;}
    if(!this.armed)return false;
    if(this.since===undefined)this.since=now;
    if(now-this.since<AUTHORITY_GRACE_MS)return false;
    this.armed=false;return true;
  }
  /** A new authority scope clears seats itself and starts its own grace; nothing leaks across authorities. */
  reset():void{this.since=undefined;this.armed=false;}
}
