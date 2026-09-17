import {
  RoomRuntime,
  type Callbacks,
  type RoomTransport,
  type RuntimeDependencies,
  type RuntimeOptions,
  type TransportEvents,
} from "../../src/online/room-runtime.js";
import type { RoomSettings } from "../../src/engine/room-settings.js";
import type { Frame } from "../../src/online/rollback.js";
import type { GameEvent } from "../../src/shared/protocol.js";
import { decodePacket } from "../../src/online/packet.js";

export interface NetworkOptions {
  loss: number;
  baseMs: number;
  jitterMs: number;
  reliableMs: number;
  oneWayMs?: (from: string, to: string) => number;
  duplicate?: number;
}
interface Delivery {
  at: number;
  order: number;
  deliver: () => void;
}
export interface Recorded {
  states: Frame[];
  events: { event: GameEvent; matchId: string; round: number; tick: number }[];
  statuses: string[];
  ready: [string, boolean][];
  ended: number;
}

/** Deterministic lossy, jittery, reordering mesh with an injected clock; reliable frames stay ordered per link. */
export class FakeNetwork {
  now = 0;
  private queue: Delivery[] = [];
  private order = 0;
  private reliableLast = new Map<string, number>();
  readonly transports = new Map<string, FakeTransport>();
  readonly runtimes = new Map<string, RoomRuntime>();
  readonly recorded = new Map<string, Recorded>();
  readonly ticks = new Map<string, () => void>();
  readonly hidden = new Map<string, boolean>();
  readonly generations = new Map<string, number>();
  readonly visibility = new Map<string, () => void>();
  private random: () => number;
  sentFast = 0;
  droppedFast = 0;
  bytesFast = 0;
  duplicatedFast = 0;
  reorderedFast = 0;
  private fastDelivered = new Map<string, number>();
  /** Actual state hashes emitted by each replica's normal fast-packet path. */
  readonly reportedHashes = new Map<string, Map<number, string>>();
  /** Every reliable message by sender, receiver and type, so a test can count joins, hellos and snapshot requests. */
  readonly reliableLog: {
    from: string;
    to: string;
    type: string;
    at: number;
  }[] = [];
  constructor(
    readonly hostId: string,
    public options: NetworkOptions,
    seed = 1,
  ) {
    let a = seed >>> 0;
    this.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
    };
  }
  private schedule(at: number, deliver: () => void): void {
    this.queue.push({ at, order: this.order++, deliver });
  }
  private delay(from: string, to: string): number {
    return (
      (this.options.oneWayMs?.(from, to) ?? this.options.baseMs) +
      this.random() * this.options.jitterMs
    );
  }
  /** Members whose fast packets are dropped outright, as if their links were not yet carrying traffic. */
  readonly muted = new Set<string>();
  sendFast(from: string, to: string, bytes: Uint8Array): boolean {
    const target = this.transports.get(to);
    if (!target?.online || !this.transports.get(from)?.online) return false;
    this.sentFast++;
    this.bytesFast += bytes.byteLength;
    const decoded = decodePacket(bytes);
    const packet = decoded && "packet" in decoded ? decoded.packet : undefined;
    if (packet?.hash) {
      let hashes = this.reportedHashes.get(from);
      if (!hashes) this.reportedHashes.set(from, (hashes = new Map()));
      hashes.set(packet.hash[0], packet.hash[1]);
    }
    if (this.muted.has(from) || this.random() < this.options.loss) {
      this.droppedFast++;
      return true;
    }
    const sequence = this.sentFast;
    const deliver = (duplicate: boolean) => {
      if (target.online && !target.deaf && target.linkedWith(from)) {
        const key = `${from}>${to}`;
        if (duplicate) this.duplicatedFast++;
        if (!duplicate && sequence < (this.fastDelivered.get(key) ?? 0))
          this.reorderedFast++;
        this.fastDelivered.set(
          key,
          Math.max(sequence, this.fastDelivered.get(key) ?? 0),
        );
        target.events.fast(from, bytes);
      }
    };
    this.schedule(this.now + this.delay(from, to), () => deliver(false));
    if (this.options.duplicate && this.random() < this.options.duplicate) {
      this.schedule(this.now + this.delay(from, to), () => deliver(true));
    }
    return true;
  }
  sendReliable(from: string, to: string, data: unknown): boolean {
    const target = this.transports.get(to);
    if (
      !target?.online ||
      !this.transports.get(from)?.online ||
      !this.transports.get(from)!.linkedWith(to)
    )
      return false;
    this.reliableLog.push({
      from,
      to,
      type: String((data as { type?: unknown })?.type),
      at: this.now,
    });
    const key = `${from}>${to}`,
      at = Math.max(
        this.now + this.options.reliableMs,
        this.reliableLast.get(key) ?? 0,
      );
    this.reliableLast.set(key, at);
    const payload = structuredClone(data);
    this.schedule(at, () => {
      if (target.online && !target.deaf && target.linkedWith(from))
        target.events.message(from, payload);
    });
    return true;
  }
  /** Advance fake time in 10 ms steps: deliver what is due, then run every runtime's tick. */
  step(ms: number): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now += 10;
      const due = this.queue
        .filter((item) => item.at <= this.now)
        .sort((a, b) => a.at - b.at || a.order - b.order);
      this.queue = this.queue.filter((item) => item.at > this.now);
      for (const item of due) item.deliver();
      for (const tick of this.ticks.values()) tick();
    }
  }
  dependencies(id: string): RuntimeDependencies {
    let tokens = 0;
    return {
      now: () => this.now,
      hidden: () => this.hidden.get(id) ?? false,
      token: () => `${id}-token-${++tokens}`,
      generation: () => this.generations.get(id) ?? 1,
      schedule: (callback) => {
        this.ticks.set(id, callback);
        return () => {
          this.ticks.delete(id);
        };
      },
      onVisibilityChange: (callback) => {
        this.visibility.set(id, callback);
        return () => {
          this.visibility.delete(id);
        };
      },
    };
  }
  setHidden(id: string, hidden: boolean): void {
    this.hidden.set(id, hidden);
    this.visibility.get(id)?.();
  }
  /** Create (or re-create with a new generation) a member's runtime and transport. */
  add(
    id: string,
    settings: RoomSettings,
    extra: {
      displayOnly?: boolean;
      humanName?: string;
      generation?: number;
      /** Fault injection: the tick's phases for this member's worlds, and where its faults are reported. */
      phases?: RuntimeOptions["phases"];
      simulationError?: RuntimeOptions["simulationError"];
    } = {},
  ): RoomRuntime {
    if (extra.generation !== undefined)
      this.generations.set(id, extra.generation);
    const recorded: Recorded = {
      states: [],
      events: [],
      statuses: [],
      ready: [],
      ended: 0,
    };
    this.recorded.set(id, recorded);
    const callbacks: Callbacks = {
      state: (frame) => {
        recorded.states.push(frame);
        if (recorded.states.length > 50) recorded.states.shift();
      },
      event: (event, matchId, round, tick) =>
        recorded.events.push({ event, matchId, round, tick }),
      status: (text) => {
        if (recorded.statuses.at(-1) !== text) recorded.statuses.push(text);
      },
      ready: (peer, host) => recorded.ready.push([peer, host]),
      ended: () => recorded.ended++,
    };
    const runtime = new RoomRuntime("AB42", settings, callbacks, {
      transport: (events) => new FakeTransport(this, id, events),
      displayOnly: extra.displayOnly,
      humanName: extra.humanName,
      dependencies: this.dependencies(id),
      ...(extra.phases ? { phases: extra.phases } : {}),
      ...(extra.simulationError
        ? { simulationError: extra.simulationError }
        : {}),
    });
    this.runtimes.set(id, runtime);
    return runtime;
  }
  connect(id: string): void {
    const transport = this.transports.get(id)!;
    transport.online = true;
    this.schedule(this.now + this.options.reliableMs, () => {
      if (!transport.online) return;
      transport.events.welcome(id, this.hostId);
      for (const [other, peer] of this.transports)
        if (other !== id && peer.online) {
          transport.events.peer(other, true);
          peer.events.peer(id, true);
          this.openLink(id, other);
        }
    });
  }
  private openLink(a: string, b: string): void {
    // Like the WebRTC transport, the open event precedes the probe-confirmed sendable state by a few hundred milliseconds.
    this.schedule(this.now + this.options.reliableMs * 2, () => {
      const first = this.transports.get(a),
        second = this.transports.get(b);
      if (!first?.online || !second?.online) return;
      first.events.link(b, true);
      second.events.link(a, true);
      this.schedule(this.now + 300, () => {
        if (first.online && second.online) {
          first.links.add(b);
          second.links.add(a);
        }
      });
    });
  }
  disconnect(id: string): void {
    const transport = this.transports.get(id);
    if (!transport) return;
    transport.online = false;
    transport.links.clear();
    for (const [other, peer] of this.transports)
      if (other !== id && peer.online) {
        peer.links.delete(id);
        peer.events.link(id, false);
        peer.events.peer(id, false);
      }
  }
  /** Simulate a page reload: the old runtime stops, a fresh one comes back with a higher generation. */
  reload(
    id: string,
    settings: RoomSettings,
    extra: { displayOnly?: boolean; humanName?: string } = {},
  ): RoomRuntime {
    this.runtimes.get(id)!.stop();
    this.disconnect(id);
    this.transports.delete(id);
    const runtime = this.add(id, settings, {
      ...extra,
      generation: (this.generations.get(id) ?? 1) + 1,
    });
    runtime.start();
    return runtime;
  }
  frame(id: string): Frame | undefined {
    return this.recorded.get(id)!.states.at(-1);
  }
}

export class FakeTransport implements RoomTransport {
  id: string;
  hostId: string;
  sentBytes = 0;
  reliableSends = 0;
  online = false;
  deaf = false;
  readonly links = new Set<string>();
  constructor(
    private readonly network: FakeNetwork,
    id: string,
    readonly events: TransportEvents,
  ) {
    this.id = id;
    this.hostId = network.hostId;
    network.transports.set(id, this);
  }
  connect(): void {
    this.network.connect(this.id);
  }
  close(): void {
    this.network.disconnect(this.id);
  }
  send(id: string, data: unknown, _bufferLimit?: number): boolean {
    const sent = this.network.sendReliable(this.id, id, data);
    if (sent) {
      this.sentBytes += JSON.stringify(data).length;
      this.reliableSends++;
    }
    return sent;
  }
  sendFast(id: string, bytes: Uint8Array): boolean {
    const sent = this.network.sendFast(this.id, id, bytes);
    if (sent) this.sentBytes += bytes.byteLength;
    return sent;
  }
  linked(id: string): boolean {
    return this.links.has(id);
  }
  linkedWith(id: string): boolean {
    return this.links.has(id);
  }
  explain(): string {
    return "fake link";
  }
  async stats() {
    return { direct: this.links.size, relayed: 0, buffered: 0 };
  }
}
