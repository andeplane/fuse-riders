import { FakeNetwork, FakeTransport } from "./fake-room.js";
import {
  decodePacket,
  encodePacket,
  roomHash,
  wrapMs,
  type Packet,
} from "fuse-netcode";
import { fuseGame } from "../../src/online/fuse-game.js";
import { RULES } from "../../src/engine/apply-tick.js";
import type { Entry } from "../../src/engine/input-log.js";

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
  private lastClock = 0;
  /** Nacks addressed to this peer, and fast packets that did not decode at all. */
  nacks = 0;
  undecodable = 0;
  /** When each member's fast packets arrived, so a test can tell who is still sending to this peer. */
  readonly heardFast = new Map<string, number[]>();
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
        this.heardFast.set(from, [
          ...(this.heardFast.get(from) ?? []),
          net.now,
        ]);
        const decoded = decodePacket(fuseGame, bytes);
        if (!decoded) this.undecodable++;
        else if ("nack" in decoded) this.nacks++;
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
  /** Ask again now, as a page does when the room has dropped its seat. */
  askForSeat(): void {
    if (this.joinName !== undefined)
      this.transport.send(this.net.hostId, {
        type: "join",
        name: this.joinName,
      });
  }
  /**
   * The room clock as the creator's latest packet showed it, projected to now. It never steps back: under jitter a late
   * packet would otherwise lower the reading, and a heartbeat built on it would break its own earlier `through`.
   */
  clock(): number {
    if (this.reading)
      this.lastClock = Math.max(
        this.lastClock,
        this.reading.clockTick + (this.net.now - this.reading.at) / 50,
      );
    return this.lastClock;
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
    if (this.net.now - this.lastSendAt < 50) return;
    this.lastSendAt = this.net.now;
    const packet = this.script(this);
    if (packet) this.send(packet);
  }
}
