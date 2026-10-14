/** The local description must precede its trickle candidates, including on a replacement connection. */
export interface LocalPeer {
  readonly localDescription: RTCSessionDescriptionInit | null;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
}
export type LocalSignalFrame =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit };
export class LocalSignal {
  private pending: RTCIceCandidateInit[] | undefined;
  private published = false;
  constructor(
    private readonly peer: LocalPeer,
    private readonly send: (frame: LocalSignalFrame) => boolean,
  ) {}
  candidate(candidate: RTCIceCandidateInit): void {
    if (this.pending) {
      if (this.pending.length < 64) this.pending.push(candidate);
    } else if (this.published) this.send({ candidate });
  }
  async describe(
    description: RTCSessionDescriptionInit,
    permits: () => boolean = () => true,
  ): Promise<void> {
    if (this.pending) throw new Error("Local negotiation already in progress");
    this.pending = [];
    this.published = false;
    try {
      await this.peer.setLocalDescription(description);
      this.published =
        permits() &&
        !!this.peer.localDescription &&
        this.send({ description: this.peer.localDescription });
      if (this.published)
        for (const candidate of this.pending) this.send({ candidate });
    } finally {
      this.pending = undefined;
    }
  }
}
