/** Capture and sender lifecycle, independent of browser UI and deterministic gameplay. */
export interface VoiceTrack {
  enabled: boolean;
  readonly readyState: string;
  stop(): void;
  addEventListener(type: "ended", listener: () => void): void;
  removeEventListener(type: "ended", listener: () => void): void;
}
export interface VoiceSender<T> {
  replaceTrack(track: T | null): Promise<void>;
}
export type VoiceState = "off" | "muted" | "live";
export function readVoiceState(raw: unknown): VoiceState | undefined {
  if (!raw || typeof raw !== "object") return;
  const value = raw as Record<string, unknown>;
  if (
    value.type === "voice" &&
    value.version === 1 &&
    typeof value.state === "string" &&
    ["off", "muted", "live"].includes(value.state)
  )
    return value.state as VoiceState;
}
export class VoiceSession<T extends VoiceTrack> {
  joined = false;
  muted = true;
  deafened = false;
  pending = false;
  closed = false;
  error = "";
  track?: T;
  deviceId = "";
  private request = 0;
  private senders = new Set<{
    sender: VoiceSender<T>;
    running: boolean;
    applied: T | null | undefined;
    active: boolean;
    failed: () => void;
  }>();
  private ended = () => {
    this.release();
    this.muted = true;
    this.error =
      "Microphone disconnected. Choose a microphone and unmute to retry.";
    this.update();
  };
  constructor(
    private capture: (deviceId: string) => Promise<T>,
    private changed: () => void,
  ) {}
  get state(): VoiceState {
    return !this.joined
      ? "off"
      : this.muted || this.deafened || !this.track
        ? "muted"
        : "live";
  }
  /** Listen-only never requests microphone permission. Calling again retries blocked playback in the UI. */
  listen(): void {
    if (this.closed) return;
    this.joined = true;
    this.update();
  }
  async microphone(
    deviceId = this.deviceId,
    preserveMute = false,
  ): Promise<void> {
    if (this.closed) return;
    const request = ++this.request,
      muted = preserveMute && this.muted;
    this.joined = true;
    this.pending = true;
    this.error = "";
    this.update();
    try {
      const track = await this.capture(deviceId);
      if (request !== this.request || this.closed) {
        track.stop();
        return;
      }
      if (track.readyState === "ended") {
        track.stop();
        throw new Error("Microphone unavailable");
      }
      this.release();
      this.track = track;
      this.deviceId = deviceId;
      this.muted = muted;
      track.addEventListener("ended", this.ended);
    } catch (error) {
      if (request !== this.request || this.closed) return;
      const name = error instanceof Error ? error.name : "";
      this.error =
        name === "NotAllowedError"
          ? "Microphone permission denied. Allow it in your browser, then try again."
          : "Microphone unavailable. Check the device and try again.";
    } finally {
      if (request === this.request && !this.closed) {
        this.pending = false;
        this.update();
      }
    }
  }
  setMuted(muted: boolean): void {
    if (this.closed) return;
    // Cancelling a permission prompt must not let a late grant unexpectedly unmute the microphone.
    if (muted) {
      ++this.request;
      this.pending = false;
    }
    this.muted = muted;
    this.update();
  }
  setDeafened(deafened: boolean): void {
    if (!this.closed) {
      this.deafened = deafened;
      this.update();
    }
  }
  leave(): void {
    ++this.request;
    this.pending = false;
    this.joined = false;
    this.muted = true;
    this.deafened = false;
    this.error = "";
    this.release();
    this.update();
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.leave();
  }
  addSender(sender: VoiceSender<T>, failed: () => void): () => void {
    const entry = {
      sender,
      running: false,
      applied: undefined as T | null | undefined,
      active: true,
      failed,
    };
    this.senders.add(entry);
    void this.sync(entry);
    return () => {
      entry.active = false;
      this.senders.delete(entry);
    };
  }
  private release(): void {
    if (!this.track) return;
    this.track.enabled = false;
    this.track.removeEventListener("ended", this.ended);
    this.track.stop();
    this.track = undefined;
  }
  private update(): void {
    if (this.track) this.track.enabled = this.state === "live";
    for (const sender of this.senders) void this.sync(sender);
    this.changed();
  }
  /** Coalesce changes while replaceTrack is pending; an old completion can never overwrite the latest intent. */
  private async sync(entry: {
    sender: VoiceSender<T>;
    running: boolean;
    applied: T | null | undefined;
    active: boolean;
    failed: () => void;
  }): Promise<void> {
    if (entry.running || !entry.active) return;
    entry.running = true;
    try {
      while (entry.active) {
        const desired = this.track ?? null;
        if (desired === entry.applied) break;
        try {
          await entry.sender.replaceTrack(desired);
        } catch {
          if (entry.active) entry.failed();
          break;
        }
        entry.applied = desired;
      }
    } finally {
      entry.running = false;
    }
  }
}
