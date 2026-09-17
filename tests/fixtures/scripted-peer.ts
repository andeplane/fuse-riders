import { FakeNetwork, FakeTransport } from "./fake-room.js";
import {
  decodePacket,
  encodePacket,
  roomHash,
  wrapMs,
  type Packet,
} from "../../src/online/packet.js";
import { RULES } from "../../src/shared/apply-tick.js";
import type { Entry } from "../../src/shared/input-log.js";

export interface ScriptedPacket {
  through: number;
  lastSeq: number;
  entries: Entry[];
}

/**
 * A member that speaks the wire protocol without simulating anything: it says hello, asks for a seat and sends whatever
 * packets its script returns, so a test can play a modified client against real runtimes. It reads the room clock off
 * the creator's packets, as any follower does. The script runs once per 50 ms; returning nothing sends nothing.
 */
export class ScriptedPeer {
  readonly transport: FakeTransport;
  /** Reliable messages received, by sender. */
  readonly inbox: { from: string; data: { type?: string; error?: string } }[] =
    [];
  seq = 0;
  script: (peer: ScriptedPeer) => ScriptedPacket | undefined = (peer) =>
    peer.heartbeat();
  private readonly room: number;
  private reading?: { clockTick: number; at: number };
  private lastSendAt = -Infinity;
  private readonly greeted = new Set<string>();
  private joinName?: string;
  constructor(
    private readonly net: FakeNetwork,
    readonly id: string,
    private readonly options: { generation?: number; rules?: string } = {},
  ) {
    this.room = roomHash(`AB42:${net.hostId}`);
    this.transport = new FakeTransport(net, id, {
      welcome: () => {},
      peer: (peer, online) => {
        if (!online) this.greeted.delete(peer);
      },
      link: (peer, open) => {
        if (!open) this.greeted.delete(peer);
      },
      message: (from, data) =>
        this.inbox.push({ from, data: data as { type?: string } }),
      fast: (from, bytes) => {
        const decoded = decodePacket(bytes);
        if (decoded && "packet" in decoded && from === net.hostId)
          this.reading = { clockTick: decoded.packet.clockTick, at: net.now };
      },
      status: () => {},
      revoked: () => {},
      ended: () => {},
      terminated: () => {},
    });
    net.ticks.set(id, () => this.tick());
  }
  get generation(): number {
    return this.options.generation ?? 1;
  }
  connect(): void {
    this.transport.connect();
  }
  /** Ask the creator for a seat once the link carries messages. */
  join(name: string): void {
    this.joinName = name;
  }
  /** The room clock as the creator's latest packet showed it, projected to now. */
  clock(): number {
    return this.reading
      ? this.reading.clockTick + (this.net.now - this.reading.at) / 50
      : 0;
  }
  /** The next own entry, stamped `tick`. */
  entry(tick: number, ...body: unknown[]): Entry {
    return [++this.seq, tick, ...body] as Entry;
  }
  /** What an honest idle member sends: complete through its clock, nothing new. */
  heartbeat(): ScriptedPacket {
    return {
      through: Math.floor(this.clock()),
      lastSeq: this.seq,
      entries: [],
    };
  }
  send(packet: ScriptedPacket): void {
    const bytes = encodePacket({
      room: this.room,
      from: this.id,
      generation: this.generation,
      sentAt: wrapMs(this.net.now),
      echoSentAt: 0,
      echoHeld: 0,
      clockTick: Math.max(0, this.clock()),
      hash: null,
      ...packet,
    } satisfies Packet);
    for (const peer of this.transport.links)
      this.transport.sendFast(peer, bytes);
  }
  private tick(): void {
    for (const peer of this.transport.links) {
      if (this.greeted.has(peer)) continue;
      this.greeted.add(peer);
      this.transport.send(peer, {
        type: "hello",
        generation: this.generation,
        full: true,
        rules: this.options.rules ?? RULES,
        world: false,
      });
      if (this.joinName !== undefined && peer === this.net.hostId)
        this.transport.send(peer, { type: "join", name: this.joinName });
    }
    if (this.net.now - this.lastSendAt < 50 || !this.reading) return;
    this.lastSendAt = this.net.now;
    const packet = this.script(this);
    if (packet) this.send(packet);
  }
}
