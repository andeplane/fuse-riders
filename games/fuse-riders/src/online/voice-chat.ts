import { el as element } from "fuse-ui";
import {
  VoiceSession,
  readVoiceState,
  type VoiceState,
} from "./voice-session.js";

interface PeerVoice {
  pc: RTCPeerConnection;
  state?: VoiceState;
  audio: HTMLAudioElement;
  track?: MediaStreamTrack;
  transceiver?: RTCRtpTransceiver;
  detach?: () => void;
  meter?: {
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
    samples: Uint8Array<ArrayBuffer>;
  };
  muted: boolean;
  speaking: boolean;
  blocked: boolean;
  failed: boolean;
}
/** Optional per-device media. No voice state is recorded in the game log or checkpoints. */
export class VoiceChat {
  readonly session: VoiceSession<MediaStreamTrack>;
  readonly controls = element("section");
  readonly button = element("button", "VOICE");
  private join = element("button", "JOIN VOICE");
  private listen = element("button", "LISTEN ONLY");
  private mute = element("button", "UNMUTE MIC");
  private deafen = element("button", "DEAFEN");
  private leave = element("button", "LEAVE VOICE");
  private retry = element("button", "ENABLE VOICE AUDIO");
  private devices = element("select");
  private note = element("p");
  private participants = element("div");
  private peers = new Map<string, PeerVoice>();
  private silenced = new Set<string>();
  private names = new Map<string, string>();
  private context?: AudioContext;
  private poll: ReturnType<typeof setInterval>;
  private volume = 1;
  private deviceRequest = 0;
  private localId = "";
  private localMeter?: PeerVoice["meter"];
  private localTrack?: MediaStreamTrack;
  private speaking = false;
  private onChange: () => void = () => {};
  private deviceChange = () => {
    void this.refreshDevices();
  };
  constructor() {
    this.session = new VoiceSession(
      async (deviceId) => {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("Microphone requires HTTPS");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          },
          video: false,
        });
        const track = stream.getAudioTracks()[0];
        if (!track) {
          stream.getTracks().forEach((t) => t.stop());
          throw new Error("No microphone");
        }
        return track;
      },
      () => {
        this.render();
        void this.refreshDevices();
      },
    );
    this.controls.className = "voice-settings";
    this.controls.setAttribute("aria-label", "Voice chat");
    this.button.className = "voice-toggle";
    this.button.title = "Open voice chat controls";
    const actions = element("div");
    actions.className = "voice-actions";
    actions.append(
      this.join,
      this.listen,
      this.mute,
      this.deafen,
      this.leave,
      this.retry,
    );
    const label = element("label", "Microphone");
    label.append(this.devices);
    this.devices.setAttribute("aria-label", "Microphone");
    const volumeLabel = element("label", "Voice volume"),
      volume = element("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "100";
    volume.value = "100";
    volume.setAttribute("aria-label", "Voice volume");
    volume.oninput = () => {
      this.volume = Number(volume.value) / 100;
      this.render();
    };
    volumeLabel.append(volume);
    this.note.setAttribute("role", "status");
    this.participants.className = "voice-participants";
    this.controls.append(
      element("h3", "VOICE CHAT"),
      element(
        "p",
        "Voice is off until you join. On a shared TV, use one device for voice or headphones to avoid echo.",
      ),
      actions,
      label,
      volumeLabel,
      this.note,
      this.participants,
    );
    this.join.onclick = () => {
      this.unlock();
      void this.session.microphone(this.devices.value);
    };
    this.listen.onclick = () => {
      this.unlock();
      this.session.listen();
    };
    this.mute.onclick = () => {
      this.unlock();
      if (this.session.pending || this.session.state === "live")
        this.session.setMuted(true);
      else if (this.session.track) this.session.setMuted(false);
      else void this.session.microphone(this.devices.value);
    };
    this.deafen.onclick = () => {
      this.unlock();
      this.session.setDeafened(!this.session.deafened);
    };
    this.leave.onclick = () => this.session.leave();
    this.retry.onclick = () => this.unlock();
    this.devices.onchange = () => {
      if (this.session.joined && this.session.track) {
        void this.session.microphone(this.devices.value, true);
      }
    };
    navigator.mediaDevices?.addEventListener("devicechange", this.deviceChange);
    this.poll = setInterval(() => this.measure(), 150);
    this.render();
    void this.refreshDevices();
  }
  setChanged(callback: () => void): void {
    this.onChange = callback;
  }
  setRoster(
    id: string,
    players: ReadonlyArray<{ id: string; name: string }>,
  ): void {
    this.localId = id;
    this.names = new Map(players.map((p) => [p.id, p.name]));
    this.renderParticipants();
  }
  indicator(id: string): string {
    if (id === this.localId)
      return this.session.state === "off"
        ? ""
        : this.session.state === "muted"
          ? "MIC OFF"
          : this.speaking
            ? "SPEAKING"
            : "MIC ON";
    const peer = this.peers.get(id);
    return !peer?.state || peer.state === "off"
      ? ""
      : peer.muted
        ? "SILENCED"
        : peer.state === "muted"
          ? "MIC OFF"
          : peer.speaking
            ? "SPEAKING"
            : "MIC ON";
  }
  get state(): VoiceState {
    return this.session.state;
  }
  status(): unknown {
    return { type: "voice", version: 1, state: this.state };
  }
  receive(id: string, data: unknown): boolean {
    if (
      !data ||
      typeof data !== "object" ||
      Reflect.get(data, "type") !== "voice"
    )
      return false;
    const state = readVoiceState(data),
      peer = this.peers.get(id);
    if (peer && state && peer.state !== state) {
      peer.state = state;
      this.render();
    }
    return true;
  }
  /** Only the offerer creates the audio m-line; the answerer adopts it after setRemoteDescription. */
  attach(id: string, pc: RTCPeerConnection, offerer: boolean): void {
    this.drop(id);
    const audio = element("audio");
    audio.dataset.voicePeer = id;
    audio.autoplay = false;
    audio.muted = true;
    audio.hidden = true;
    document.body.append(audio);
    const peer: PeerVoice = {
      pc,
      audio,
      muted: this.silenced.has(id),
      speaking: false,
      blocked: false,
      failed: false,
    };
    this.peers.set(id, peer);
    pc.addEventListener("track", (event) => {
      if (this.peers.get(id) !== peer || event.track.kind !== "audio") return;
      peer.track = event.track;
      audio.srcObject = new MediaStream([event.track]);
      this.disconnectMeter(peer.meter);
      peer.meter = this.meter(event.track);
      this.render();
    });
    if (offerer) {
      try {
        this.bind(peer, pc.addTransceiver("audio", { direction: "sendrecv" }));
      } catch {
        peer.failed = true;
        this.render();
      }
    }
  }
  answer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer || peer.transceiver) return;
    const transceiver = peer.pc
      .getTransceivers()
      .find((t) => t.receiver.track.kind === "audio");
    if (transceiver) {
      try {
        transceiver.direction = "sendrecv";
        this.bind(peer, transceiver);
      } catch {
        peer.failed = true;
        this.render();
      }
    }
  }
  private bind(peer: PeerVoice, transceiver: RTCRtpTransceiver): void {
    peer.transceiver = transceiver;
    peer.detach = this.session.addSender(transceiver.sender, () => {
      peer.failed = true;
      this.render();
    });
  }
  drop(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.detach?.();
    peer.audio.pause();
    peer.audio.srcObject = null;
    peer.audio.remove();
    this.disconnectMeter(peer.meter);
    this.peers.delete(id);
    this.render();
  }
  reset(): void {
    for (const id of this.peers.keys()) this.drop(id);
  }
  close(): void {
    this.session.close();
    this.reset();
    this.silenced.clear();
    clearInterval(this.poll);
    ++this.deviceRequest;
    navigator.mediaDevices?.removeEventListener(
      "devicechange",
      this.deviceChange,
    );
    this.disconnectMeter(this.localMeter);
    this.localMeter = undefined;
    if (this.context) void this.context.close().catch(() => {});
  }
  private unlock(): void {
    if (this.session.closed) return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => {});
    } catch {
      /* Audio elements still work without speaking meters. */
    }
    for (const peer of this.peers.values()) {
      peer.blocked = false;
      if (this.session.joined) this.play(peer);
      if (peer.track && !peer.meter) peer.meter = this.meter(peer.track);
    }
  }
  private play(peer: PeerVoice): void {
    if (!peer.audio.srcObject || peer.blocked || !peer.audio.paused) return;
    void peer.audio.play().catch(() => {
      if (this.session.joined && [...this.peers.values()].includes(peer)) {
        peer.blocked = true;
        this.render();
      }
    });
  }
  private async refreshDevices(): Promise<void> {
    if (this.session.closed || !navigator.mediaDevices?.enumerateDevices)
      return;
    const request = ++this.deviceRequest;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (request !== this.deviceRequest || this.session.closed) return;
      const selected = this.devices.value; // Empty string deliberately selects System default.
      const options = [
        new Option("System default", ""),
        ...devices
          .filter(
            (d) =>
              d.kind === "audioinput" && d.deviceId && d.deviceId !== "default",
          )
          .map(
            (d, i) => new Option(d.label || `Microphone ${i + 1}`, d.deviceId),
          ),
      ];
      this.devices.replaceChildren(...options);
      this.devices.value = options.some((o) => o.value === selected)
        ? selected
        : "";
    } catch {
      /* Permission denial must not affect gameplay. */
    }
  }
  private render(): void {
    const s = this.session;
    if (!s) return;
    this.button.textContent = s.joined
      ? s.deafened
        ? "VOICE DEAFENED"
        : s.state === "live"
          ? "MIC ON"
          : "MIC OFF"
      : "VOICE";
    this.button.disabled = s.closed;
    this.join.hidden = this.listen.hidden = s.joined;
    this.mute.hidden = this.deafen.hidden = this.leave.hidden = !s.joined;
    this.mute.textContent = s.pending
      ? "CANCEL MIC"
      : s.state === "live"
        ? "MUTE MIC"
        : "UNMUTE MIC";
    this.mute.disabled = s.deafened;
    this.deafen.textContent = s.deafened ? "UNDEAFEN" : "DEAFEN";
    this.deafen.setAttribute("aria-pressed", String(s.deafened));
    this.devices.disabled = s.pending || s.closed;
    for (const button of [this.join, this.listen, this.leave, this.deafen])
      button.disabled = s.closed;
    this.join.disabled ||= !navigator.mediaDevices?.getUserMedia;
    this.note.textContent = s.closed
      ? "Voice closed."
      : !navigator.mediaDevices?.getUserMedia
        ? "Microphone access requires HTTPS or localhost. You can still try listen-only."
        : s.error ||
          (s.pending
            ? "Waiting for microphone permission…"
            : s.deafened
              ? "Voice and microphone silenced."
              : s.joined
                ? "Voice enabled on this device."
                : "Join with your microphone or listen only.");
    for (const peer of this.peers.values()) {
      peer.audio.volume = this.volume;
      peer.audio.muted =
        !s.joined || s.deafened || peer.muted || peer.state !== "live";
      if (s.joined) this.play(peer);
      else peer.audio.pause();
    }
    this.retry.hidden =
      !s.joined || ![...this.peers.values()].some((p) => p.blocked);
    if (this.localTrack !== s.track) {
      this.disconnectMeter(this.localMeter);
      this.localTrack = s.track;
      this.localMeter = s.track ? this.meter(s.track) : undefined;
    }
    this.renderParticipants();
    this.onChange();
  }
  private renderParticipants(): void {
    // Keep focused participant buttons stable while levels and game snapshots update.
    for (const child of [...this.participants.children])
      if (!this.peers.has((child as HTMLElement).dataset.peer!)) child.remove();
    for (const [id, peer] of this.peers) {
      let row = [...this.participants.children].find(
        (e) => (e as HTMLElement).dataset.peer === id,
      ) as HTMLElement | undefined;
      if (!row) {
        row = element("div");
        row.dataset.peer = id;
        const name = element("span"),
          mute = element("button");
        mute.onclick = () => {
          peer.muted = !peer.muted;
          if (peer.muted) {
            this.silenced.add(id);
            if (this.silenced.size > 32)
              this.silenced.delete(this.silenced.values().next().value!);
          } else this.silenced.delete(id);
          this.render();
        };
        row.append(name, mute);
        this.participants.append(row);
      }
      row.firstElementChild!.textContent = `${this.names.get(id) ?? "Room device"} · ${peer.failed ? "voice unavailable" : this.indicator(id) || (peer.state === "off" ? "voice off" : "connecting voice")}`;
      const mute = row.lastElementChild as HTMLButtonElement;
      mute.textContent = peer.muted ? "UNSILENCE" : "SILENCE";
      mute.setAttribute(
        "aria-label",
        `${peer.muted ? "Unsilence" : "Silence"} ${this.names.get(id) ?? "room device"}`,
      );
      mute.setAttribute("aria-pressed", String(peer.muted));
    }
  }
  private meter(track: MediaStreamTrack): PeerVoice["meter"] {
    if (!this.context) return;
    try {
      const source = this.context.createMediaStreamSource(
          new MediaStream([track]),
        ),
        analyser = this.context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      return { source, analyser, samples: new Uint8Array(256) };
    } catch {
      return;
    }
  }
  private disconnectMeter(meter?: PeerVoice["meter"]): void {
    meter?.source.disconnect();
    meter?.analyser.disconnect();
  }
  private active(meter?: PeerVoice["meter"]): boolean {
    if (!meter || this.context?.state !== "running") return false;
    meter.analyser.getByteTimeDomainData(meter.samples);
    let sum = 0;
    for (const value of meter.samples) sum += ((value - 128) / 128) ** 2;
    return Math.sqrt(sum / meter.samples.length) > 0.025;
  }
  private measure(): void {
    const local = this.session.state === "live" && this.active(this.localMeter);
    let changed = local !== this.speaking;
    this.speaking = local;
    for (const peer of this.peers.values()) {
      const speaking =
        this.session.joined &&
        !this.session.deafened &&
        !peer.muted &&
        peer.state === "live" &&
        this.active(peer.meter);
      changed ||= speaking !== peer.speaking;
      peer.speaking = speaking;
    }
    if (changed) {
      this.renderParticipants();
      this.onChange();
    }
  }
}
