import { ufragMatches } from "./ice-signal.js";
/** The subset of RTCPeerConnection the inbound signalling path needs; typed fakes cover it in tests. */
export interface RemotePeer {
  readonly remoteDescription: { readonly sdp: string } | null;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
}
export interface SignalCounts {
  descriptions: number;
  candidates: number;
  applied: number;
  buffered: number;
  rejected: number;
  dropped: number;
}
/** Inbound remote descriptions and trickle candidates for one link. Candidates that arrive before their description, or while one is being applied, wait in a bounded buffer. */
export class RemoteSignal {
  private pending: RTCIceCandidateInit[] = [];
  private applying = false;
  readonly counts: SignalCounts = {
    descriptions: 0,
    candidates: 0,
    applied: 0,
    buffered: 0,
    rejected: 0,
    dropped: 0,
  };
  constructor(
    private readonly pc: RemotePeer,
    private readonly limit = 64,
  ) {}
  get waiting(): number {
    return this.pending.length;
  }
  async describe(description: RTCSessionDescriptionInit): Promise<void> {
    this.counts.descriptions++;
    this.applying = true;
    try {
      await this.pc.setRemoteDescription(description);
    } finally {
      this.applying = false;
    }
    await this.flush();
  }
  async candidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.counts.candidates++;
    const sdp = this.pc.remoteDescription?.sdp;
    if (this.applying || sdp === undefined || !ufragMatches(candidate, sdp)) {
      this.buffer(candidate);
      return;
    }
    await this.apply(candidate);
  }
  private buffer(candidate: RTCIceCandidateInit): void {
    if (this.pending.length >= this.limit) {
      this.pending.shift();
      this.counts.dropped++;
    }
    this.pending.push(candidate);
    this.counts.buffered++;
  }
  private async flush(): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    for (const candidate of batch) {
      const sdp = this.pc.remoteDescription?.sdp;
      if (sdp !== undefined && ufragMatches(candidate, sdp))
        await this.apply(candidate);
      else if (this.pending.length < this.limit) this.pending.push(candidate);
      else this.counts.dropped++;
    }
  }
  private async apply(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidate);
      this.counts.applied++;
    } catch {
      this.counts.rejected++;
    }
  }
}
