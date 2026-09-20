import { ROOM_PROTOCOL_VERSION } from "fuse-network-protocol";
import {
  PeerTransport,
  type PeerTransportOptions,
  type RoomServiceSocket,
  type TransportCallbacks,
  type TransportDependencies,
} from "../../src/index.js";

/**
 * Typed browser fakes for `PeerTransport`. Nothing here monkeypatches a global, reads a private field or waits on a
 * real timer: the transport is constructed with these through `dependencies`, and a test owns the clock.
 */

/** A timer the harness holds; `interval` repeats, a one-shot is removed when it fires. */
interface FakeTimer {
  at: number;
  intervalMs?: number;
  run: () => void;
}

/** Injected `setInterval`/`setTimeout`/`performance.now()`. Time only moves when a test moves it. */
export class FakeClock {
  now = 0;
  private next = 0;
  private readonly timers = new Map<number, FakeTimer>();
  /** How many timers are still armed: a teardown that leaks one shows up here. */
  get pending(): number {
    return this.timers.size;
  }
  /** The interval periods still armed, so a test can say *which* timer leaked. */
  get intervals(): number[] {
    return [...this.timers.values()]
      .filter((timer) => timer.intervalMs !== undefined)
      .map((timer) => timer.intervalMs!)
      .sort((a, b) => a - b);
  }
  schedule(run: () => void, intervalMs: number): () => void {
    return this.arm({ at: this.now + intervalMs, intervalMs, run });
  }
  delay(run: () => void, ms: number): () => void {
    return this.arm({ at: this.now + ms, run });
  }
  private arm(timer: FakeTimer): () => void {
    const id = ++this.next;
    this.timers.set(id, timer);
    return () => this.timers.delete(id);
  }
  /** Moves time forward, firing every timer that comes due in order. */
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      let due: [number, FakeTimer] | undefined;
      for (const entry of this.timers)
        if (entry[1].at <= until && (!due || entry[1].at < due[1].at))
          due = entry;
      if (!due) break;
      this.now = due[1].at;
      if (due[1].intervalMs === undefined) this.timers.delete(due[0]);
      else due[1].at = this.now + due[1].intervalMs;
      due[1].run();
    }
    this.now = until;
  }
}

/** A `CloseEvent` without a browser: the transport reads `code` and `reason`. */
class FakeCloseEvent extends Event implements CloseEvent {
  readonly wasClean = false;
  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super("close");
  }
}

/** A `MessageEvent` without a browser. */
class FakeMessageEvent<T> extends Event implements MessageEvent<T> {
  readonly lastEventId = "";
  readonly origin = "";
  readonly ports: readonly MessagePort[] = [];
  readonly source = null;
  constructor(readonly data: T) {
    super("message");
  }
  initMessageEvent(): void {
    throw new Error("initMessageEvent is deprecated and is not used");
  }
}

/** The room service's side of the socket, driven frame by frame. */
export class FakeRoomSocket implements RoomServiceSocket {
  readyState = 0;
  bufferedAmount = 0;
  onmessage: ((event: MessageEvent) => void | Promise<void>) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  /** Every frame the transport sent, parsed. */
  readonly sent: Record<string, unknown>[] = [];
  closed?: { code?: number; reason?: string };
  private opened?: () => void;
  constructor(readonly url: string) {}
  addEventListener(type: "open", listener: () => void): void {
    if (type === "open") this.opened = listener;
  }
  /** The service accepted the socket: the transport sends its auth frame here. */
  open(): void {
    this.readyState = 1;
    this.opened?.();
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closed = { code, reason };
  }
  /** Delivers one service frame and resolves once the transport finished handling it. */
  async deliver(frame: unknown): Promise<void> {
    await this.onmessage?.(new FakeMessageEvent(JSON.stringify(frame)));
  }
  /** The service dropped the socket with `code`. */
  drop(code: number, reason = ""): void {
    this.readyState = 3;
    this.onclose?.(new FakeCloseEvent(code, reason));
  }
  /** Frames of one `type`, newest last. */
  frames(type: string): Record<string, unknown>[] {
    return this.sent.filter((frame) => frame.type === type);
  }
}

/** An `RTCError` without a browser; `DOMException` supplies the legacy members nothing here reads. */
class FakeRtcError extends DOMException implements RTCError {
  readonly errorDetail: RTCErrorDetailType = "data-channel-failure";
  readonly receivedAlert = null;
  readonly sctpCauseCode = null;
  readonly sdpLineNumber = null;
  readonly sentAlert = null;
  constructor() {
    super("send failure", "OperationError");
  }
}

/** An `RTCErrorEvent` without a browser; the transport only calls `preventDefault`. */
class FakeRtcErrorEvent extends Event implements RTCErrorEvent {
  readonly error: RTCError = new FakeRtcError();
  constructor() {
    super("error", { cancelable: true });
  }
}

/** A data channel whose state a test sets directly, recording what the transport sent on it. */
export class FakeDataChannel extends EventTarget implements RTCDataChannel {
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  readonly id = 1;
  readonly maxPacketLifeTime = null;
  readonly maxRetransmits: number | null;
  readonly negotiated = false;
  readonly ordered: boolean;
  readonly protocol = "";
  readyState: RTCDataChannelState = "connecting";
  onbufferedamountlow: ((this: RTCDataChannel, ev: Event) => unknown) | null =
    null;
  onclose: ((this: RTCDataChannel, ev: Event) => unknown) | null = null;
  onclosing: ((this: RTCDataChannel, ev: Event) => unknown) | null = null;
  onerror: ((this: RTCDataChannel, ev: RTCErrorEvent) => unknown) | null = null;
  onmessage: ((this: RTCDataChannel, ev: MessageEvent) => unknown) | null =
    null;
  onopen: ((this: RTCDataChannel, ev: Event) => unknown) | null = null;
  /** Everything the transport sent, in order. */
  readonly sent: (string | ArrayBufferLike | ArrayBufferView)[] = [];
  closeCalls = 0;
  /** Set to make the next `send` throw, as a channel over its maximum message size does. */
  throwOnSend?: Error;
  constructor(
    readonly label: string,
    init?: RTCDataChannelInit,
  ) {
    super();
    this.ordered = init?.ordered ?? true;
    this.maxRetransmits = init?.maxRetransmits ?? null;
  }
  close(): void {
    this.closeCalls++;
    this.readyState = "closed";
  }
  send(data: string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>): void {
    if (this.throwOnSend) throw this.throwOnSend;
    if (data instanceof Blob) throw new Error("the transport sends no blobs");
    this.sent.push(data);
  }
  /** The channel opened. */
  open(): void {
    this.readyState = "open";
    this.onopen?.call(this, new Event("open"));
  }
  /** The peer closed its side. */
  shut(): void {
    this.readyState = "closed";
    this.onclose?.call(this, new Event("close"));
  }
  /** The channel reported an error (WebKit's `NetworkSendQueue` path). */
  err(): void {
    this.onerror?.call(this, new FakeRtcErrorEvent());
  }
  /** The peer sent `data`. */
  receive(data: unknown): void {
    this.onmessage?.call(this, new FakeMessageEvent(data));
  }
  /** The JSON envelopes sent on this channel, in order. */
  envelopes(): {
    id: number;
    data: unknown;
    sender: string;
    receiver: string;
  }[] {
    return this.sent
      .filter((data): data is string => typeof data === "string")
      .map(
        (text) =>
          JSON.parse(text) as {
            id: number;
            data: unknown;
            sender: string;
            receiver: string;
          },
      );
  }
}

let sdpSerial = 0;

/** A peer connection whose negotiation a test resolves and whose states it sets. */
export class FakePeerConnection
  extends EventTarget
  implements RTCPeerConnection
{
  readonly canTrickleIceCandidates = null;
  connectionState: RTCPeerConnectionState = "new";
  readonly currentLocalDescription = null;
  readonly currentRemoteDescription = null;
  iceConnectionState: RTCIceConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "new";
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  readonly pendingLocalDescription = null;
  readonly pendingRemoteDescription = null;
  readonly sctp = null;
  signalingState: RTCSignalingState = "stable";
  onconnectionstatechange:
    ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  ondatachannel:
    ((this: RTCPeerConnection, ev: RTCDataChannelEvent) => unknown) | null =
    null;
  onicecandidate:
    | ((this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) => unknown)
    | null = null;
  onicecandidateerror:
    | ((this: RTCPeerConnection, ev: RTCPeerConnectionIceErrorEvent) => unknown)
    | null = null;
  oniceconnectionstatechange:
    ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  onicegatheringstatechange:
    ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  onnegotiationneeded:
    ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  onsignalingstatechange:
    ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  ontrack: ((this: RTCPeerConnection, ev: RTCTrackEvent) => unknown) | null =
    null;
  /** Channels this side created, by label. */
  readonly created = new Map<string, FakeDataChannel>();
  readonly offers: (RTCOfferOptions | undefined)[] = [];
  answers = 0;
  closeCalls = 0;
  /** Set to make the next `createOffer` reject, as a closed connection does. */
  failOffer?: Error;
  constructor(readonly configuration: RTCConfiguration) {
    super();
  }
  addIceCandidate(): Promise<void> {
    return Promise.resolve();
  }
  addTrack(): RTCRtpSender {
    throw new Error("media is not used by the mesh");
  }
  addTransceiver(): RTCRtpTransceiver {
    throw new Error("media is not used by the mesh");
  }
  close(): void {
    this.closeCalls++;
    this.connectionState = "closed";
  }
  createAnswer(): Promise<RTCSessionDescriptionInit> & Promise<void> {
    this.answers++;
    return Promise.resolve({
      type: "answer",
      sdp: `answer-${++sdpSerial}`,
    }) as Promise<RTCSessionDescriptionInit> & Promise<void>;
  }
  createDataChannel(label: string, init?: RTCDataChannelInit): RTCDataChannel {
    const channel = new FakeDataChannel(label, init);
    this.created.set(label, channel);
    return channel;
  }
  /** The union widens the parameter only so the class satisfies the deprecated callback overload too. */
  createOffer(
    options?: RTCOfferOptions | RTCSessionDescriptionCallback,
  ): Promise<RTCSessionDescriptionInit> & Promise<void> {
    this.offers.push(typeof options === "function" ? undefined : options);
    if (this.failOffer) return Promise.reject<never>(this.failOffer);
    return Promise.resolve({
      type: "offer",
      sdp: `offer-${++sdpSerial}`,
    }) as Promise<RTCSessionDescriptionInit> & Promise<void>;
  }
  getConfiguration(): RTCConfiguration {
    return this.configuration;
  }
  getReceivers(): RTCRtpReceiver[] {
    return [];
  }
  getSenders(): RTCRtpSender[] {
    return [];
  }
  /** What `getStats()` answers; `stats()` and `diagnostics()` read the selected candidate pair from it. */
  stats: RTCStatsReport = new Map();
  getStats(): Promise<RTCStatsReport> {
    return Promise.resolve(this.stats);
  }
  getTransceivers(): RTCRtpTransceiver[] {
    return [];
  }
  removeTrack(): void {}
  restartIce(): void {}
  setConfiguration(): void {}
  setLocalDescription(
    description?: RTCLocalSessionDescriptionInit,
  ): Promise<void> {
    const local = {
      type: description?.type ?? "offer",
      sdp: description?.sdp ?? `local-${++sdpSerial}`,
    };
    this.localDescription = { ...local, toJSON: () => local };
    return Promise.resolve();
  }
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    const remote = { type: description.type, sdp: description.sdp ?? "" };
    this.remoteDescription = { ...remote, toJSON: () => remote };
    return Promise.resolve();
  }
  /** The peer offered a channel of its own. */
  offerChannel(label: string, init?: RTCDataChannelInit): FakeDataChannel {
    const channel = new FakeDataChannel(label, init);
    this.ondatachannel?.call(
      this,
      Object.assign(new Event("datachannel"), { channel }),
    );
    return channel;
  }
  /** The connection moved to `state`. */
  connectionBecomes(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.call(
      this,
      new Event("connectionstatechange"),
    );
  }
  /** ICE moved to `state`. */
  iceBecomes(state: RTCIceConnectionState): void {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.call(
      this,
      new Event("iceconnectionstatechange"),
    );
  }
}

/** One room-service frame plus whatever the test recorded from the callbacks. */
export interface Recorded {
  peers: [string, boolean][];
  links: [string, boolean][];
  messages: [string, unknown][];
  fast: [string, Uint8Array][];
  statuses: string[];
  welcomes: [string, string][];
  terminated: string[];
  revoked: number;
  ended: number;
}

/**
 * A `PeerTransport` on typed fakes. The clock, the peer connections, the room socket and the macrotask deferral are
 * all the test's; `flush()` drains the promises a delivered frame started, and `run(ms)` moves the clock and then
 * drains, so no assertion waits on a real timer.
 */
export class TransportHarness {
  readonly clock = new FakeClock();
  readonly connections: FakePeerConnection[] = [];
  readonly sockets: FakeRoomSocket[] = [];
  readonly recorded: Recorded = {
    peers: [],
    links: [],
    messages: [],
    fast: [],
    statuses: [],
    welcomes: [],
    terminated: [],
    revoked: 0,
    ended: 0,
  };
  hidden = false;
  /** How many visibility subscriptions are live: teardown must leave none. */
  visibilitySubscriptions = 0;
  /** Thrown by the `message` callback when set, to exercise a misbehaving application handler. */
  messageThrows?: Error;
  /** Thrown by the `peer` callback when set. */
  peerThrows?: Error;
  readonly transport: PeerTransport;
  private visibility?: () => void;
  private readonly deferred: (() => void)[] = [];
  constructor(options: Partial<PeerTransportOptions> = {}) {
    const callbacks: TransportCallbacks = {
      welcome: (id, hostId) => this.recorded.welcomes.push([id, hostId]),
      peer: (id, online) => {
        this.recorded.peers.push([id, online]);
        if (this.peerThrows) throw this.peerThrows;
      },
      link: (id, open) => this.recorded.links.push([id, open]),
      message: (id, data) => {
        this.recorded.messages.push([id, data]);
        if (this.messageThrows) throw this.messageThrows;
      },
      fast: (id, bytes) => this.recorded.fast.push([id, bytes]),
      status: (text) => this.recorded.statuses.push(text),
      revoked: () => this.recorded.revoked++,
      ended: () => this.recorded.ended++,
      terminated: (text) => this.recorded.terminated.push(text),
    };
    const dependencies: TransportDependencies = {
      now: () => this.clock.now,
      hidden: () => this.hidden,
      onVisibilityChange: (callback) => {
        this.visibility = callback;
        this.visibilitySubscriptions++;
        return () => {
          this.visibility = undefined;
          this.visibilitySubscriptions--;
        };
      },
      schedule: (callback, intervalMs) =>
        this.clock.schedule(callback, intervalMs),
      delay: (callback, ms) => this.clock.delay(callback, ms),
      defer: (callback) => this.deferred.push(callback),
      connection: (configuration) => {
        const pc = new FakePeerConnection(configuration);
        this.connections.push(pc);
        return pc;
      },
      socket: (url) => {
        const socket = new FakeRoomSocket(url);
        this.sockets.push(socket);
        return socket;
      },
      // The room service's ICE list; an empty body leaves `IceConfig` on its defaults.
      fetcher: () => Promise.resolve(new Response("{}")),
    };
    this.transport = new PeerTransport("ROOM", "token", callbacks, {
      apiUrl: (path) => `https://rooms.test${path}`,
      ...options,
      dependencies,
    });
  }
  /** The socket the transport is using now. */
  get socket(): FakeRoomSocket {
    const socket = this.sockets.at(-1);
    if (!socket) throw new Error("connect() has not opened a socket");
    return socket;
  }
  /** Runs the queued macrotask deferrals and drains the microtask queue. */
  async flush(): Promise<void> {
    for (let turn = 0; turn < 4; turn++) {
      while (this.deferred.length) this.deferred.shift()!();
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  /** Moves the clock and then settles whatever the fired timers started. */
  async run(ms: number): Promise<void> {
    this.clock.advance(ms);
    await this.flush();
  }
  /**
   * Moves the clock in `step` slices, settling in between. Real time does not jump, and a single long `advance`
   * would step over an asynchronous retry that has begun but not completed, hiding the next one behind it.
   */
  async runSteps(ms: number, step = 200): Promise<void> {
    for (let elapsed = 0; elapsed < ms; elapsed += step)
      await this.run(Math.min(step, ms - elapsed));
  }
  /** The page's visibility changed. */
  async setHidden(hidden: boolean): Promise<void> {
    this.hidden = hidden;
    this.visibility?.();
    await this.flush();
  }
  /** Connects, opens the socket and admits this page as `id` with `peers` already in the room. */
  async admit(
    id: string,
    peers: string[],
    hostId = peers[0] ?? id,
  ): Promise<void> {
    this.transport.connect();
    this.socket.open();
    await this.socket.deliver({
      type: "welcome",
      protocol: ROOM_PROTOCOL_VERSION,
      id,
      hostId,
      connectionId: `c-${id}`,
      peers: peers.map((peer) => ({ id: peer, connectionId: `c-${peer}` })),
    });
    await this.flush();
  }
  /** Every `signal` frame relayed on any socket this transport has opened. */
  get relayedSignals(): number {
    return this.sockets.reduce(
      (total, socket) => total + socket.frames("signal").length,
      0,
    );
  }
  /** The `signal` payloads the transport relayed to `to`, in order. */
  signalsTo(to: string): unknown[] {
    return this.socket
      .frames("signal")
      .filter((frame) => frame.to === to)
      .map((frame) => frame.data);
  }
  /** The descriptions the transport relayed to `to`, in order. */
  descriptionsTo(to: string): RTCSessionDescriptionInit[] {
    return this.signalsTo(to)
      .filter(
        (data): data is { description: RTCSessionDescriptionInit } =>
          typeof data === "object" &&
          data !== null &&
          "description" in data &&
          data.description !== null,
      )
      .map((data) => data.description);
  }
}
