import { ROOM_ENDED_TEXT, handleRoomSocketClose } from "./room-socket-close.js";
import { isCurrentLinkCallback } from "./link-callback.js";
import { LinkHealth } from "./link-health.js";
import {
  GAMEPLAY_BUFFER_LIMIT,
  LinkSendGate,
  PROBE_BUFFER_LIMIT,
} from "./link-send-gate.js";
import {
  AuthorityClock,
  CLOSE_AUTHORITY_REPLACED,
  ROOM_PROTOCOL_VERSION,
  isAuthorityGrant,
  type AuthorityGrant,
} from "fuse-network-protocol";
import { ICE_FETCH_TIMEOUT_MS, IceConfig } from "./ice-config.js";
import { candidateType, sameCertificate } from "./ice-signal.js";
import { RemoteSignal } from "./remote-signal.js";
import { LinkRestartPolicy } from "./link-restart.js";
import { explainLink, type LinkDiagnostic } from "./link-diagnostics.js";
import type { RoomTransport, TransportEvents } from "./transport.js";
export type TransportCallbacks = TransportEvents;
/** One datagram under the 1,280-byte IPv6 minimum MTU with DTLS/SCTP headers to spare. */
export const DEFAULT_MAX_FAST_BYTES = 1100;
/** Player-facing wording the transport emits; a game overrides what should speak its own language. */
export interface TransportCopy {
  linking: string;
  protocolChanged: string;
  roomEnded: string;
  hostAbsent: string;
}
export const DEFAULT_TRANSPORT_COPY: TransportCopy = {
  linking: "Connected · linking peers",
  protocolChanged: "Room protocol changed — reload this page",
  roomEnded: ROOM_ENDED_TEXT,
  hostAbsent: "the host is not in the room yet",
};
export interface PeerTransportOptions {
  /** Resolves a room service path (`/api/rooms/…`) to an absolute URL; see `createEndpoints`. */
  apiUrl: (path: string) => string;
  /** Largest `sendFast` payload, sent or accepted. */
  maxFastBytes?: number;
  /** Diagnostic: join the room and signal nothing, so no direct link ever forms. */
  disableDirect?: boolean;
  copy?: Partial<TransportCopy>;
}
interface Link {
  pc: RTCPeerConnection;
  game?: RTCDataChannel;
  input?: RTCDataChannel;
  remote: RemoteSignal;
  health: LinkHealth;
  gate: LinkSendGate;
  restart: LinkRestartPolicy;
  createdAt: number;
  local: Partial<Record<string, number>>;
  remoteTypes: Partial<Record<string, number>>;
  counts: {
    offersOut: number;
    offersIn: number;
    answersOut: number;
    answersIn: number;
    candidatesOut: number;
    relayFailed: number;
  };
  lastFailure?: string;
}
const RESTART_ATTEMPTS = 4;
const LINK_BYE_GRACE_MS = 150;
/** The unreliable channel skips a cadence send once this much is queued; a stale packet is worse than none. */
export const FAST_BUFFER_LIMIT = 16_000;
/**
 * Full mesh over WebRTC: one RTCPeerConnection per member pair, negotiated through the room service. The member with
 * the lexicographically smaller id initiates the offer and any ICE restart. Each link carries a reliable ordered
 * `game` channel (JSON envelopes) and an unordered, unreliable `input` channel (binary per-tick packets).
 */
export class PeerTransport implements RoomTransport {
  id = "";
  hostId = "";
  connectionId = "";
  sentBytes = 0;
  grant?: AuthorityGrant;
  private authorityClock = new AuthorityClock(() => performance.now());
  private connections = new Map<string, string>();
  private probes = new Map<number, number>();
  private nextProbe = 0;
  private timeInterval?: ReturnType<typeof setInterval>;
  private healthInterval?: ReturnType<typeof setInterval>;
  private readonly visibility = () => {
    this.authorityClock.invalidate();
    if (!document.hidden) this.sampleTime();
  };
  private acceptGrant(raw: unknown): void {
    if (!isAuthorityGrant(raw)) return;
    const previous = this.grant;
    if (
      previous &&
      previous.incarnation === raw.incarnation &&
      (raw.epoch < previous.epoch ||
        (raw.epoch === previous.epoch && raw.expiresAt < previous.expiresAt))
    )
      return;
    this.grant = raw;
  }
  /** Service time keeps the room alive and, for the creator, renews the lease that resolves duplicate creator tabs. */
  private sampleTime(renew = true): void {
    if (this.stopped || this.socket?.readyState !== WebSocket.OPEN) return;
    const id = ++this.nextProbe,
      sentAt = performance.now();
    this.probes.set(id, sentAt);
    for (const [key, at] of this.probes)
      if (sentAt - at > 4000) this.probes.delete(key);
    try {
      this.socket.send(
        JSON.stringify({
          type: "time",
          id,
          sentAt,
          ...(renew && this.id === this.hostId && this.grant
            ? { renew: this.grant }
            : {}),
        }),
      );
    } catch {
      // Best effort. The readyState check above and this send run in one synchronous turn, so a throw
      // is not a close racing the send: it is the WebSocket implementation refusing the frame, or the
      // message failing to serialise. Either way the probe expires above and the next sample, or the
      // reconnect, takes over.
    }
  }
  private socket?: WebSocket;
  private links = new Map<string, Link>();
  // Macrotask deferral that background timer throttling cannot delay (a throttled setTimeout would pong a
  // screen-off phone a second late, fail LinkHealth and force-re-offer a healthy channel every 8 s).
  private readonly deferred: Array<() => void> = [];
  private readonly deferPort = (() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => this.deferred.shift()?.();
    return channel.port2;
  })();
  private defer(task: () => void): void {
    this.deferred.push(task);
    this.deferPort.postMessage(null);
  }
  private seq = 0;
  private stopped = false;
  private retry?: ReturnType<typeof setTimeout>;
  private ice = new IceConfig();
  private readonly apiUrl: (path: string) => string;
  private readonly maxFastBytes: number;
  private readonly relayOnly: boolean;
  private readonly copy: TransportCopy;
  constructor(
    readonly code: string,
    readonly token: string,
    private callbacks: TransportCallbacks,
    options: PeerTransportOptions,
  ) {
    this.apiUrl = options.apiUrl;
    this.maxFastBytes = options.maxFastBytes ?? DEFAULT_MAX_FAST_BYTES;
    this.relayOnly = options.disableDirect === true;
    this.copy = { ...DEFAULT_TRANSPORT_COPY, ...options.copy };
  }
  /** The smaller id offers; the other answers. Symmetric for every pair, so no member needs the creator to link. */
  private initiator(id: string): boolean {
    return this.id < id;
  }
  connect(): void {
    this.authorityClock.invalidate();
    if (!this.healthInterval)
      this.healthInterval = setInterval(() => this.checkLinks(), 200);
    if (!this.timeInterval) {
      this.timeInterval = setInterval(() => this.sampleTime(), 2000);
      document.addEventListener("visibilitychange", this.visibility);
    }
    const url = new URL(this.apiUrl(`/api/rooms/${this.code}/ws`));
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", this.token);
    const ws = new WebSocket(url);
    this.socket = ws;
    ws.onmessage = async (event) => {
      if (ws !== this.socket) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "welcome") {
          if (
            message.protocol !== ROOM_PROTOCOL_VERSION ||
            typeof message.connectionId !== "string"
          ) {
            this.terminate(this.copy.protocolChanged);
            this.close();
            return;
          }
          this.received.clear();
          // Peers that left while our socket was down never produce a peer-offline message; reconcile against the roster first.
          const roster = new Set<string>(
            message.peers.map((peer: { id: string }) => peer.id),
          );
          for (const id of this.connections.keys())
            if (!roster.has(id)) this.callbacks.peer(id, false);
          for (const link of this.links.values()) link.pc.close();
          this.links.clear();
          this.connections.clear();
          this.id = message.id;
          this.hostId = message.hostId;
          this.connectionId = message.connectionId;
          for (const peer of message.peers)
            this.connections.set(peer.id, peer.connectionId);
          this.acceptGrant(message.grant);
          this.sampleTime();
          // Offers and signals can arrive during this fetch; link() awaits the ICE config so no peer connection is built without STUN (#27).
          await this.ice.load(
            (signal) =>
              fetch(
                this.apiUrl(`/api/rooms/${this.code}/ice?token=${this.token}`),
                { signal },
              ).then((response) => response.json()),
            AbortSignal.timeout(ICE_FETCH_TIMEOUT_MS),
          );
          if (ws !== this.socket) return;
          this.callbacks.status(this.copy.linking);
          this.callbacks.welcome(this.id, this.hostId);
          for (const peer of message.peers) {
            this.callbacks.peer(peer.id, true);
            if (this.initiator(peer.id)) await this.offer(peer.id);
          }
        } else if (message.type === "time") {
          const sent = this.probes.get(message.id);
          if (sent === undefined || sent !== message.sentAt) return;
          this.probes.delete(message.id);
          this.acceptGrant(message.grant);
          this.authorityClock.synchronize(sent, message.serviceTime);
          if (
            this.id === this.hostId &&
            this.grant &&
            this.grant.holder !== this.connectionId &&
            this.authorityClock.permits(this.grant)
          ) {
            ws.close(CLOSE_AUTHORITY_REPLACED, "Authority held elsewhere");
            return;
          }
        } else if (message.type === "authority") {
          this.acceptGrant(message.grant);
          this.sampleTime(false);
        } else if (message.type === "peer") {
          if (typeof message.connectionId !== "string") return;
          if (message.online) {
            const previous = this.connections.get(message.id);
            this.connections.set(message.id, message.connectionId);
            if (previous !== message.connectionId) {
              this.drop(message.id);
            }
            this.callbacks.peer(message.id, true);
            if (this.initiator(message.id)) await this.offer(message.id);
          } else if (
            this.connections.get(message.id) === message.connectionId
          ) {
            // The service is the membership authority: the connection is retired even if the RTC channel still reads "open".
            this.drop(message.id);
            this.connections.delete(message.id);
            this.callbacks.peer(message.id, false);
          }
        } else if (
          message.type === "signal" &&
          this.connections.get(message.from) === message.connectionId
        )
          await this.signal(message.from, message.data);
      } catch (error) {
        this.callbacks.status(
          `Connection recovery: ${error instanceof Error ? error.message : "invalid frame"}`,
        );
      }
    };
    ws.onclose = (event) => {
      if (ws !== this.socket) return;
      handleRoomSocketClose(event.code, {
        stopped: () => this.stopped,
        stop: () => this.close(),
        revoked: () => this.callbacks.revoked(),
        ended: () => this.callbacks.ended(),
        status: this.callbacks.status,
        terminated: () => this.terminate(this.copy.roomEnded),
        retry: () => {
          this.retry = setTimeout(() => this.connect(), 1500);
        },
      });
    };
    ws.onerror = () => ws.close();
  }
  private drop(id: string): void {
    const link = this.links.get(id);
    if (!link) return;
    link.gate.drain();
    link.pc.close();
    this.links.delete(id);
    this.received.delete(id);
    this.callbacks.link(id, false);
  }
  private relay(type: string, to: string, data: unknown): boolean {
    if (
      this.socket?.readyState !== WebSocket.OPEN ||
      this.socket.bufferedAmount > 256000
    )
      return false;
    try {
      this.socket.send(
        JSON.stringify({
          type,
          to,
          targetConnectionId: this.connections.get(to),
          data,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
  /** Resolves undefined when the socket epoch changed while waiting for the ICE config: that signal belongs to the old admission. */
  private async link(
    id: string,
    restart?: LinkRestartPolicy,
  ): Promise<Link | undefined> {
    const existing = this.links.get(id);
    if (existing) return existing;
    const socket = this.socket;
    const iceServers = await this.ice.iceServers();
    if (socket !== this.socket || this.stopped) return undefined;
    const concurrent = this.links.get(id);
    if (concurrent) return concurrent;
    const pc = new RTCPeerConnection({ iceServers });
    const now = performance.now();
    const link: Link = {
      pc,
      remote: new RemoteSignal(pc),
      health: new LinkHealth(now),
      gate: new LinkSendGate(),
      restart: restart ?? new LinkRestartPolicy(now, RESTART_ATTEMPTS),
      createdAt: now,
      local: {},
      remoteTypes: {},
      counts: {
        offersOut: 0,
        offersIn: 0,
        answersOut: 0,
        answersIn: 0,
        candidatesOut: 0,
        relayFailed: 0,
      },
    };
    this.links.set(id, link);
    pc.onicecandidate = (event) => {
      if (!isCurrentLinkCallback(this.links.get(id), link) || !event.candidate)
        return;
      const type = candidateType(event.candidate.candidate);
      link.local[type] = (link.local[type] ?? 0) + 1;
      if (this.relay("signal", id, { candidate: event.candidate.toJSON() }))
        link.counts.candidatesOut++;
      else link.counts.relayFailed++;
    };
    pc.ondatachannel = (event) => {
      if (!isCurrentLinkCallback(this.links.get(id), link)) {
        event.channel.close();
        return;
      }
      this.channel(id, link, event.channel);
    };
    pc.onconnectionstatechange = () => {
      if (!isCurrentLinkCallback(this.links.get(id), link)) return;
      if (pc.connectionState === "connected")
        this.callbacks.status("Direct peer link connected");
      // "disconnected" may recover through fresh probes; only terminal states drain the link.
      if (pc.connectionState === "failed" || pc.connectionState === "closed")
        this.fail(id, link);
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      ) {
        link.health.fail(performance.now());
        this.callbacks.status(
          `Direct connection interrupted — ${this.explain(id)}`,
        );
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (!isCurrentLinkCallback(this.links.get(id), link)) return;
      if (
        pc.iceConnectionState === "failed" ||
        pc.iceConnectionState === "closed"
      )
        this.fail(id, link);
    };
    return link;
  }
  private fail(id: string, link: Link): void {
    const was = link.gate.draining;
    link.gate.drain();
    if (!was) this.callbacks.link(id, false);
  }
  private channel(id: string, link: Link, channel: RTCDataChannel): void {
    const current = () =>
      isCurrentLinkCallback(this.links.get(id), link) &&
      (link.game === channel || link.input === channel);
    if (channel.label === "input") {
      link.input = channel;
      channel.binaryType = "arraybuffer";
      channel.onmessage = (event) => {
        if (!current()) return;
        const data = event.data;
        if (
          !(data instanceof ArrayBuffer) ||
          data.byteLength > this.maxFastBytes ||
          data.byteLength === 0
        )
          return;
        this.callbacks.fast(id, new Uint8Array(data));
      };
      channel.onclosing = () => {
        if (current()) this.fail(id, link);
      };
      channel.onclose = () => {
        if (current()) this.fail(id, link);
      };
      channel.onerror = (event) => {
        event.preventDefault();
        if (current()) this.fail(id, link);
      };
      return;
    }
    link.game = channel;
    channel.onmessage = (event) => {
      if (!current()) return;
      if (typeof event.data !== "string" || event.data.length > 200000) {
        channel.close();
        return;
      }
      try {
        this.receive(id, JSON.parse(event.data), true);
      } catch {
        // A peer's malformed frame is dropped. Deliberately unchanged here: this also swallows whatever
        // receive() and the message callback throw; narrowing it to the parser belongs to #258.
      }
    };
    channel.onopen = () => {
      if (current()) {
        this.callbacks.status("Direct peer link connected");
        this.callbacks.link(id, true);
      }
    };
    channel.onclosing = () => {
      if (current()) this.fail(id, link);
    };
    channel.onclose = () => {
      if (current()) this.fail(id, link);
    };
    channel.onerror = (event) => {
      event.preventDefault();
      if (!current()) return;
      this.fail(id, link);
      this.callbacks.status("Direct connection failed · retrying");
    };
  }
  /** `force` replaces a drained link with a fresh RTCPeerConnection and gate; the restart budget carries over. */
  private async offer(id: string, force = false): Promise<void> {
    if (this.relayOnly) return;
    const old = this.links.get(id);
    if (!force && old?.game?.readyState === "open") return;
    if (old) {
      old.pc.close();
      this.links.delete(id);
    }
    const link = await this.link(id, force ? old?.restart : undefined);
    if (!link || link.game) return;
    this.channel(id, link, link.pc.createDataChannel("game"));
    this.channel(
      id,
      link,
      link.pc.createDataChannel("input", { ordered: false, maxRetransmits: 0 }),
    );
    await link.pc.setLocalDescription(await link.pc.createOffer());
    if (!isCurrentLinkCallback(this.links.get(id), link)) return;
    if (this.relay("signal", id, { description: link.pc.localDescription }))
      link.counts.offersOut++;
    else link.counts.relayFailed++;
  }
  /** Same RTCPeerConnection, new ICE credentials; the answerer recognises the unchanged DTLS certificate and answers on its existing connection. */
  private async restartIce(id: string, link: Link): Promise<void> {
    const attempt = link.restart.begin(performance.now());
    try {
      await link.pc.setLocalDescription(
        await link.pc.createOffer({ iceRestart: true }),
      );
      if (
        !isCurrentLinkCallback(this.links.get(id), link) ||
        !link.restart.complete(attempt)
      )
        return;
      if (this.relay("signal", id, { description: link.pc.localDescription }))
        link.counts.offersOut++;
      else link.counts.relayFailed++;
    } catch (error) {
      link.lastFailure = `restart: ${error instanceof Error ? error.name : "error"}`;
      link.restart.complete(attempt);
    }
  }
  private async signal(
    id: string,
    data: {
      description?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    },
  ): Promise<void> {
    if (this.relayOnly) return;
    const previous = this.links.get(id);
    if (
      data.description?.type === "offer" &&
      previous &&
      !sameCertificate(
        previous.pc.remoteDescription?.sdp,
        data.description.sdp ?? "",
      )
    ) {
      this.drop(id);
    }
    const link = await this.link(id);
    if (!link) return;
    try {
      if (data.description) {
        if (data.description.type === "offer") link.counts.offersIn++;
        else link.counts.answersIn++;
        await link.remote.describe(data.description);
        if (!isCurrentLinkCallback(this.links.get(id), link)) return;
        if (data.description.type === "offer") {
          await link.pc.setLocalDescription(await link.pc.createAnswer());
          if (!isCurrentLinkCallback(this.links.get(id), link)) return;
          if (
            this.relay("signal", id, { description: link.pc.localDescription })
          )
            link.counts.answersOut++;
          else link.counts.relayFailed++;
        }
      } else if (data.candidate) {
        const type = candidateType(data.candidate.candidate);
        link.remoteTypes[type] = (link.remoteTypes[type] ?? 0) + 1;
        await link.remote.candidate(data.candidate);
      }
    } catch (error) {
      link.lastFailure = `${data.description ? data.description.type : "candidate"}: ${error instanceof Error ? error.name : "error"}`;
    }
  }
  private received = new Map<string, Set<number>>();
  private receive(
    id: string,
    envelope: { id: number; data: unknown; sender: string; receiver: string },
    direct = false,
  ): void {
    if (
      !envelope ||
      !Number.isSafeInteger(envelope.id) ||
      envelope.sender !== this.connections.get(id) ||
      envelope.receiver !== this.connectionId
    )
      return;
    if (envelope.data && typeof envelope.data === "object") {
      const probe = envelope.data as { type?: string; probeId?: number };
      // #143: the peer is closing its side. Stop sending on this link now, before WebKit's lagging readyState lets a probe hit the dead channel.
      if (probe.type === "linkBye") {
        if (direct) this.links.get(id)?.gate.drain();
        return;
      }
      if (probe.type === "linkProbe" || probe.type === "linkPong") {
        if (!direct || !Number.isSafeInteger(probe.probeId)) return;
        if (probe.type === "linkPong")
          this.links
            .get(id)
            ?.health.acknowledge(probe.probeId!, performance.now());
        else {
          // libwebrtc delivers the probe before the closing state change that follows it (WebKit posts OnMessage, then
          // OnStateChange). Answering inside this onmessage task would hand the pong to an already-dead transport, so
          // defer one macrotask: the queued state-change task runs first and readyState plus the gate refuse the send.
          const link = this.links.get(id),
            probeId = probe.probeId!;
          if (link)
            this.defer(() => {
              if (isCurrentLinkCallback(this.links.get(id), link))
                this.sendDirectProbe(id, { type: "linkPong", probeId });
            });
        }
        return;
      }
    }
    const seen = this.received.get(id) ?? new Set<number>();
    if (seen.has(envelope.id)) return;
    seen.add(envelope.id);
    if (seen.size > 1000) seen.delete(seen.values().next().value!);
    this.received.set(id, seen);
    this.callbacks.message(id, envelope.data);
  }
  /** Reliable, ordered: room control, snapshots and hellos. A permitted send means queued in the browser, never applied by the peer. */
  send(
    id: string,
    data: unknown,
    bufferLimit = GAMEPLAY_BUFFER_LIMIT,
  ): boolean {
    if (this.stopped || !this.connections.has(id)) return false;
    const envelope = {
      id: ++this.seq,
      data,
      sender: this.connectionId,
      receiver: this.connections.get(id)!,
    };
    const link = this.links.get(id);
    if (
      !this.relayOnly &&
      link?.gate.permits(link.game, bufferLimit) &&
      link.pc.connectionState === "connected" &&
      link.health.direct(performance.now())
    ) {
      try {
        const text = JSON.stringify(envelope);
        link.game!.send(text);
        this.sentBytes += text.length;
        return true;
      } catch {
        // The gate check and this send run in one synchronous turn, so the channel cannot close in
        // between. What throws is `JSON.stringify` on data it cannot serialise (a cycle, a BigInt) or
        // the channel refusing the message (over the peer's maximum message size, or a full send
        // buffer). Both are swallowed here and reported unsent, as below; neither reaches the caller.
      }
    }
    return false;
  }
  /** Unordered, unreliable: the per-tick packet. Skipped rather than queued when the channel is backed up. */
  sendFast(id: string, bytes: Uint8Array): boolean {
    if (
      this.stopped ||
      !this.connections.has(id) ||
      bytes.byteLength > this.maxFastBytes
    )
      return false;
    const link = this.links.get(id);
    // WebKit keeps a channel "open" for a task hop after its transport died and reports the send as a page error, so the
    // connection state is checked as well as the channel state.
    if (
      !link ||
      link.gate.draining ||
      link.pc.connectionState !== "connected" ||
      link.input?.readyState !== "open" ||
      link.input.bufferedAmount >= FAST_BUFFER_LIMIT
    )
      return false;
    try {
      link.input.send(bytes as Uint8Array<ArrayBuffer>);
      this.sentBytes += bytes.byteLength;
      return true;
    } catch {
      return false;
    }
  }
  linked(id: string): boolean {
    const link = this.links.get(id);
    return (
      !!link &&
      !link.gate.draining &&
      link.game?.readyState === "open" &&
      link.health.direct(performance.now())
    );
  }
  private sendDirectProbe(
    id: string,
    data: { type: string; probeId?: number },
  ): boolean {
    const link = this.links.get(id);
    if (!link?.gate.permits(link.game, PROBE_BUFFER_LIMIT)) return false;
    try {
      link.game!.send(
        JSON.stringify({
          id: ++this.seq,
          data,
          sender: this.connectionId,
          receiver: this.connections.get(id),
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
  private checkLinks(): void {
    if (this.stopped || document.hidden) return;
    const now = performance.now();
    for (const [id, link] of this.links) {
      this.sendDirectProbe(id, {
        type: "linkProbe",
        probeId: link.health.probe(now),
      });
      if (link.health.direct(now)) {
        link.restart.healthy(now);
        continue;
      }
      // A down socket cannot carry the restart offer; do not burn the budget on it. Only the initiator restarts.
      if (
        !link.health.shouldRestart(now) ||
        !this.initiator(id) ||
        this.socket?.readyState !== WebSocket.OPEN ||
        !link.restart.due(now)
      )
        continue;
      if (link.gate.draining) {
        // The gate is monotonic: a drained link never sends again, so an in-place ICE restart could not recover it.
        const attempt = link.restart.begin(now);
        void this.offer(id, true)
          .catch((error) => {
            link.lastFailure = `recreate: ${error instanceof Error ? error.name : "error"}`;
          })
          .finally(() => {
            link.restart.complete(attempt);
          });
      } else void this.restartIce(id, link);
    }
  }
  /** Terminal for this page: report it as a notice the room runtime keeps on screen over recurring status. */
  private terminate(status: string): void {
    this.callbacks.terminated(status);
  }
  /** A page that leaves on purpose (`farewell`) says goodbye on every direct link first (#143): the peer drains its gate on the bye instead of
   *  probing a channel WebKit still reports open after our side is gone, and the connections close a moment later so the bye can leave the
   *  send queue. A close forced by the room socket (4004/4001) sends nothing: every member already has that close, and a send then could be
   *  the very one that lands on a dead transport. */
  close(farewell = false): void {
    const byes =
      farewell && !this.stopped
        ? [...this.links.keys()].filter((id) =>
            this.sendDirectProbe(id, { type: "linkBye" }),
          )
        : [];
    this.stopped = true;
    this.deferred.length = 0;
    this.authorityClock.invalidate();
    clearInterval(this.timeInterval);
    clearInterval(this.healthInterval);
    document.removeEventListener("visibilitychange", this.visibility);
    clearTimeout(this.retry);
    this.socket?.close();
    const connections = [...this.links.values()].map((link) => link.pc);
    this.links.clear();
    const closeAll = () => {
      for (const pc of connections) pc.close();
    };
    if (byes.length) setTimeout(closeAll, LINK_BYE_GRACE_MS);
    else closeAll();
  }
  private summary(id: string, link: Link, now: number): LinkDiagnostic {
    return {
      peer: id === this.hostId ? "host" : "guest",
      local: link.local,
      remote: link.remoteTypes,
      gathering: link.pc.iceGatheringState,
      ice: link.pc.iceConnectionState,
      connection: link.pc.connectionState,
      signaling: link.pc.signalingState,
      channel: link.gate.draining
        ? "drained"
        : `${link.game?.readyState ?? "none"}/${link.input?.readyState ?? "none"}`,
      sctp: link.pc.sctp?.state,
      signalling: { ...link.remote.counts, ...link.counts },
      restarts: {
        attempts: link.restart.attempts,
        max: link.restart.max,
        exhausted: link.restart.exhausted,
      },
      healthy: link.health.direct(now),
      ageMs: now - link.createdAt,
      lastFailure: link.lastFailure,
    };
  }
  /** Why the link to `id` is not carrying gameplay, for header status; redacted. */
  explain(id: string): string {
    if (this.socket?.readyState !== WebSocket.OPEN)
      return "room service connection down — reconnecting";
    if (!this.hostId) return "waiting for room admission";
    const link = this.links.get(id);
    if (!link)
      return this.connections.has(id)
        ? this.initiator(id)
          ? "offer not sent yet — waiting for the room service"
          : "no offer received yet — signalling has not delivered the offer"
        : this.copy.hostAbsent;
    return explainLink(this.summary(id, link, performance.now()));
  }
  /** Redacted per-link diagnostics including the selected candidate pair from getStats. */
  async diagnostics(): Promise<{
    links: LinkDiagnostic[];
    ice: { servers: number; source: string };
    socket: string;
  }> {
    const links: LinkDiagnostic[] = [];
    const now = performance.now();
    for (const [id, link] of this.links) {
      const summary = this.summary(id, link, now);
      try {
        const report = await link.pc.getStats();
        report.forEach((stat) => {
          if (stat.type === "transport" && typeof stat.dtlsState === "string")
            summary.dtls = stat.dtlsState;
          if (
            stat.type === "candidate-pair" &&
            (stat.nominated || stat.state === "succeeded") &&
            !summary.selected
          ) {
            const local = report.get(stat.localCandidateId),
              remote = report.get(stat.remoteCandidateId);
            summary.selected = {
              local: local?.candidateType ?? "?",
              remote: remote?.candidateType ?? "?",
              protocol: local?.protocol ?? "?",
            };
          }
        });
      } catch {
        // Diagnostics only: a closed connection rejects getStats, and the summary stands without a selected pair.
      }
      links.push(summary);
    }
    const socketStates = ["connecting", "open", "closing", "closed"];
    return {
      links,
      ice: { servers: this.ice.servers.length, source: this.ice.source },
      socket: socketStates[this.socket?.readyState ?? 3] ?? "closed",
    };
  }
  async stats(): Promise<{
    direct: number;
    relayed: number;
    buffered: number;
  }> {
    let direct = 0,
      relayed = 0,
      buffered = this.socket?.bufferedAmount ?? 0;
    for (const link of this.links.values()) {
      buffered +=
        (link.game?.bufferedAmount ?? 0) + (link.input?.bufferedAmount ?? 0);
      if (link.game?.readyState !== "open") continue;
      const report = await link.pc.getStats();
      let usesRelay = false;
      report.forEach((stat) => {
        if (stat.type === "candidate-pair" && stat.state === "succeeded") {
          const local = report.get(stat.localCandidateId);
          const remote = report.get(stat.remoteCandidateId);
          if (
            local?.candidateType === "relay" ||
            remote?.candidateType === "relay"
          )
            usesRelay = true;
        }
      });
      if (usesRelay) relayed++;
      else direct++;
    }
    return { direct, relayed, buffered };
  }
}
