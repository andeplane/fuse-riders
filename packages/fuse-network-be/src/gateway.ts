import {
  RoomError,
  RoomStore,
  isGrantIdentity,
  type RoomRecord,
  type Member,
} from "./room-store.js";
import {
  BUS_FRAME_TTL_MS,
  type RoomBus,
  type RoutedMessage,
} from "./room-bus.js";
import { validSignal } from "./signal.js";
import { ROOM_PROTOCOL_VERSION } from "fuse-network-protocol";
export interface GatewaySocket {
  send(raw: string): void;
  close(code: number, reason: string): void;
  bufferedAmount: number;
}
export interface GatewayDependencies {
  now: () => number;
  id: () => string;
  error: (kind: string, error: unknown) => void;
  schedule?: (callback: () => void, delayMs: number) => () => void;
}
interface Client {
  room: string;
  incarnation: string;
  member: Member;
  socket: GatewaySocket;
  window: number;
  count: number;
  bytes: number;
  chain: Promise<void>;
  pending: number;
  pendingBytes: number;
  /** One signalling bucket per target member; "" is shared by every target this gateway does not know. */
  signals: Map<string, Bucket>;
  /** Spent by each refused frame; running out is what a flood looks like. */
  refusals: Bucket;
  refused: number;
  noticeAt: number;
  /** This member was closed for flooding moments ago: its links start without the negotiation burst. */
  flagged: boolean;
  closed: boolean;
}
interface Bucket {
  tokens: number;
  at: number;
}
function take(
  bucket: Bucket,
  now: number,
  burst: number,
  perSecond: number,
): boolean {
  bucket.tokens = Math.min(
    burst,
    bucket.tokens + (Math.max(0, now - bucket.at) * perSecond) / 1000,
  );
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens--;
  return true;
}
// docs/design/signalling-abuse-isolation.md carries the arithmetic behind these.
/** Frames one connection may send per second, of any kind: above the largest honest mesh negotiation (5 links × 67). */
const FRAMES_PER_SECOND = 400;
/** Frames and bytes one connection may have waiting on the database or the bus: the memory the old 64 × 32 kB cap allowed. */
const PENDING_FRAMES = 400,
  PENDING_BYTES = 2_000_000;
/** One link's negotiation: a description, the 64 candidates `RemoteSignal` will hold, end markers, and a restart offer on top. */
const LINK_BURST = 80;
/** Refills a whole negotiation within the 8 s ICE restart interval. */
const LINK_PER_SECOND = 10;
/** Refused frames tolerated before the connection counts as a flood, and how fast that tolerance returns. */
const FLOOD_BURST = 400,
  FLOOD_PER_SECOND = 50;
const NOTICE_INTERVAL_MS = 1000;
/** How long, and for how many members, a gateway remembers whom it closed for flooding. */
const FLAG_MS = 60_000,
  FLAGS = 1024;
interface View {
  room: RoomRecord;
  stop: () => void;
  cancelExpiry?: () => void;
  seen: Map<string, number>;
}
export type GatewayState =
  "idle" | "starting" | "ready" | "draining" | "failed";
/** Local sockets only; Firestore owns membership and the addressed bus reaches other processes. */
export class RoomGateway {
  private clients = new Map<string, Client>();
  private views = new Map<string, View>();
  private lifecycle: Promise<void> = Promise.resolve();
  private stateValue: GatewayState = "idle";
  private rooms = new Map<string, Promise<void>>();
  private activeOperations = 0;
  private busGeneration = 0;
  private stopping = false;
  private flags = new Map<string, number>();
  constructor(
    readonly id: string,
    readonly store: RoomStore,
    private bus: RoomBus,
    private deps: GatewayDependencies,
  ) {}
  get state(): GatewayState {
    return this.stateValue;
  }
  get connections(): number {
    return this.clients.size;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(operation, operation);
    this.lifecycle = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  /** Only bus start/stop is global; database latency in one room cannot queue another. */
  private inRoom<T>(code: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.rooms.get(code) ?? Promise.resolve();
    const result = previous.then(async () => {
      this.activeOperations++;
      try {
        return await operation();
      } finally {
        this.activeOperations--;
        await this.serial(async () => {
          if (
            this.activeOperations === 0 &&
            this.clients.size === 0 &&
            this.stateValue !== "idle"
          )
            await this.drain();
        });
      }
    });
    const settled = result.then(
      () => {},
      () => {},
    );
    this.rooms.set(code, settled);
    void settled.then(() => {
      if (this.rooms.get(code) === settled) this.rooms.delete(code);
    });
    return result;
  }
  async connect(
    code: string,
    token: string,
    socket: GatewaySocket,
  ): Promise<string> {
    if (this.stopping) throw new RoomError(503, "Service restarting");
    return this.inRoom(code, async () => {
      const generation = await this.serial(async () => {
        if (this.stateValue === "failed") await this.drain();
        if (this.stateValue !== "ready") {
          this.stateValue = "starting";
          try {
            await this.bus.start(
              (message) => this.deliver(message),
              (error) => this.fail("bus", error),
            );
            this.stateValue = "ready";
          } catch (error) {
            this.stateValue = "failed";
            throw error;
          }
        }
        return this.busGeneration;
      });
      const priorIncarnation = this.views.get(code)?.room.incarnation;
      const admission = await this.store.admit(code, token, this.id);
      if (generation !== this.busGeneration || this.stateValue !== "ready") {
        await this.store.leave(code, admission.member);
        throw new RoomError(503, "Room relay restarting");
      }
      const currentView = this.views.get(code);
      if (
        priorIncarnation &&
        currentView &&
        currentView.room.incarnation !== priorIncarnation &&
        admission.room.incarnation === priorIncarnation
      )
        throw new RoomError(404, "Room ended during admission");
      const { room, member } = admission,
        client: Client = {
          room: code,
          incarnation: room.incarnation,
          member,
          socket,
          window: this.deps.now(),
          count: 0,
          bytes: 0,
          chain: Promise.resolve(),
          pending: 0,
          pendingBytes: 0,
          signals: new Map(),
          refusals: { tokens: FLOOD_BURST, at: this.deps.now() },
          refused: 0,
          noticeAt: -Infinity,
          flagged:
            (this.flags.get(`${code}:${member.id}`) ?? 0) > this.deps.now(),
          closed: false,
        };
      this.clients.set(member.connectionId, client);
      this.send(client, {
        type: "welcome",
        protocol: ROOM_PROTOCOL_VERSION,
        id: member.id,
        hostId: room.hostId,
        connectionId: member.connectionId,
        peers: Object.values(room.members)
          .filter(
            (p) =>
              p.connectionId !== member.connectionId &&
              p.expiresAt > this.deps.now(),
          )
          .map((p) => ({ id: p.id, connectionId: p.connectionId })),
        grant: room.grant,
      });
      if (this.views.has(code)) this.observe(code, room);
      else {
        const view: View = { room, stop: () => {}, seen: new Map() };
        this.views.set(code, view);
        this.watchView(code, view);
        this.scheduleExpiry(code, view);
      }
      return member.connectionId;
    });
  }
  receive(connectionId: string, raw: string): Promise<void> {
    const client = this.clients.get(connectionId);
    if (!client || client.closed) return Promise.resolve();
    const bytes = Buffer.byteLength(raw);
    if (bytes > 32_000) {
      client.socket.close(1009, "Message too large");
      return Promise.resolve();
    }
    const now = this.deps.now();
    if (now - client.window >= 1000) {
      client.window = now;
      client.count = 0;
      client.bytes = 0;
    }
    // A guest links to as many peers as the creator does, so the frame allowance no longer depends on the role.
    if (
      ++client.count > FRAMES_PER_SECOND ||
      (client.bytes += bytes) > (client.member.host ? 2_000_000 : 256_000) ||
      client.pending >= PENDING_FRAMES ||
      client.pendingBytes + bytes > PENDING_BYTES
    ) {
      this.refuse(client, now);
      return Promise.resolve();
    }
    client.pending++;
    client.pendingBytes += bytes;
    const result = client.chain.then(() => this.handle(client, raw));
    client.chain = result
      .catch((error) => {
        this.deps.error("message", error);
        client.socket.close(
          error instanceof RoomError && error.status === 404
            ? 4004
            : error instanceof RoomError && error.status === 409
              ? 4001
              : 4000,
          "Room connection interrupted",
        );
        void this.disconnect(connectionId);
      })
      .finally(() => {
        client.pending--;
        client.pendingBytes -= bytes;
      });
    return client.chain;
  }
  /**
   * Every limit drops the frame it refuses and leaves the socket open: a close makes the page reconnect, and a
   * reconnect tears down every link and negotiates the whole mesh again, which is the largest burst there is. Trickle
   * ICE survives a lost candidate; a lost description is offered again by the link's restart policy. The sender is
   * told at most once a second. Only a flood of refused frames ends the connection, and the member it belonged to
   * then reconnects without the negotiation burst.
   */
  private refuse(client: Client, now: number): void {
    client.refused++;
    if (!take(client.refusals, now, FLOOD_BURST, FLOOD_PER_SECOND)) {
      client.closed = true;
      // Re-inserting keeps the map in expiry order, so the sweep stops at the first entry still in force.
      const flag = `${client.room}:${client.member.id}`;
      this.flags.delete(flag);
      for (const [key, until] of this.flags)
        if (until <= now || this.flags.size >= FLAGS) this.flags.delete(key);
        else break;
      this.flags.set(flag, now + FLAG_MS);
      client.socket.close(1008, "Signalling flood");
      void this.disconnect(client.member.connectionId);
      return;
    }
    if (now - client.noticeAt < NOTICE_INTERVAL_MS) return;
    client.noticeAt = now;
    this.send(client, {
      type: "notice",
      notice: "signal-throttled",
      dropped: client.refused,
    });
    client.refused = 0;
  }
  /** Known targets each get their own bucket; every unknown target shares one, so naming strangers mints nothing. */
  private signalBucket(client: Client, room: RoomRecord, to: string): Bucket {
    const key = Object.hasOwn(room.members, to) ? to : "";
    let bucket = client.signals.get(key);
    if (!bucket) {
      // A long-lived connection keeps a bucket per current member and one for strangers, never one per member it ever saw.
      for (const id of client.signals.keys())
        if (id && !Object.hasOwn(room.members, id)) client.signals.delete(id);
      bucket = {
        tokens: client.flagged ? LINK_PER_SECOND : LINK_BURST,
        at: this.deps.now(),
      };
      client.signals.set(key, bucket);
    }
    return bucket;
  }
  private async handle(client: Client, raw: string): Promise<void> {
    if (
      this.stateValue !== "ready" ||
      client.closed ||
      !this.clients.has(client.member.connectionId)
    )
      return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    const m = data as Record<string, unknown>;
    const room = this.views.get(client.room)?.room;
    if (!room || room.expiresAt <= this.deps.now())
      throw new RoomError(404, "Room expired");
    if (
      room.members[client.member.id]?.connectionId !==
        client.member.connectionId ||
      room.members[client.member.id].expiresAt <= this.deps.now()
    )
      throw new RoomError(409, "Connection replaced");
    if (m.type === "time") {
      if (
        !(
          (typeof m.id === "string" && m.id.length > 0 && m.id.length <= 64) ||
          (Number.isSafeInteger(m.id) && Number(m.id) >= 0)
        ) ||
        typeof m.sentAt !== "number" ||
        !Number.isFinite(m.sentAt) ||
        m.sentAt < 0
      )
        return;
      const current = await this.store.time(
        client.room,
        client.member,
        isGrantIdentity(m.renew) ? m.renew : undefined,
      );
      if (
        this.clients.get(client.member.connectionId) !== client ||
        this.views.get(client.room)?.room.incarnation !== client.incarnation ||
        current.incarnation !== client.incarnation
      )
        return;
      this.observe(client.room, current);
      this.send(client, {
        type: "time",
        id: m.id,
        sentAt: m.sentAt,
        serviceTime: this.deps.now(),
        grant: current.grant,
      });
      return;
    }
    if (m.type === "relay") {
      this.send(client, {
        type: "error",
        error: "Direct WebRTC connection required; retry the connection",
      });
      return;
    }
    const to = m.to;
    if (m.type !== "signal" || typeof to !== "string") return;
    if (!validSignal(m.data)) return;
    // Charged before the target is resolved, so a refused frame never costs a database read or a bus publish.
    // A rejoin negotiates every link at once: each target has its own allowance rather than a share of one.
    const now = this.deps.now();
    if (
      !take(
        this.signalBucket(client, room, to),
        now,
        LINK_BURST,
        LINK_PER_SECOND,
      )
    ) {
      this.refuse(client, now);
      return;
    }

    const member = (from: RoomRecord): Member | undefined =>
      Object.hasOwn(from.members, to) ? from.members[to] : undefined;
    let current = room,
      target = member(current);
    // Only a connection transition needs an authoritative metadata refresh; no database read per input.
    if (
      !target ||
      (m.targetConnectionId !== undefined &&
        target.connectionId !== m.targetConnectionId)
    ) {
      current = await this.store.get(client.room);
      if (
        this.clients.get(client.member.connectionId) !== client ||
        this.views.get(client.room)?.room.incarnation !== client.incarnation ||
        current.incarnation !== client.incarnation
      )
        return;
      this.observe(client.room, current);
      target = member(current);
    }
    // Any two current members may signal: the gameplay mesh links every pair directly.
    if (
      !target ||
      target.expiresAt <= this.deps.now() ||
      (m.targetConnectionId !== undefined &&
        m.targetConnectionId !== target.connectionId) ||
      target.id === client.member.id ||
      current.members[client.member.id]?.connectionId !==
        client.member.connectionId
    )
      return;
    const routed: RoutedMessage = {
      id: this.deps.id(),
      code: client.room,
      incarnation: current.incarnation,
      destination: target.gatewayId,
      from: client.member,
      to: target,
      expiresAt: this.deps.now() + BUS_FRAME_TTL_MS,
      wire: {
        type: "signal",
        from: client.member.id,
        connectionId: client.member.connectionId,
        data: m.data,
      },
    };
    if (target.gatewayId === this.id) await this.route(routed, false);
    else await this.bus.publish(routed);
  }
  private observe(code: string, room: RoomRecord | undefined): void {
    let view = this.views.get(code);
    if (!view) return;
    if (
      room &&
      room.revision <= view.room.revision &&
      room.incarnation === view.room.incarnation
    )
      return;
    const previous = view.room;
    if (room) {
      if (room.incarnation !== previous.incarnation) {
        view.stop();
        view.cancelExpiry?.();
        view = { room, stop: () => {}, seen: new Map() };
        this.views.set(code, view);
        this.watchView(code, view);
      } else view.room = room;
      this.scheduleExpiry(code, view);
    }
    for (const client of this.clients.values())
      if (client.room === code) {
        if (
          !room ||
          room.expiresAt <= this.deps.now() ||
          room.incarnation !== client.incarnation ||
          room.members[client.member.id]?.connectionId !==
            client.member.connectionId
        ) {
          client.socket.close(
            !room || room.expiresAt <= this.deps.now() ? 4004 : 4001,
            !room || room.expiresAt <= this.deps.now()
              ? "Room ended or expired"
              : "Reconnected elsewhere",
          );
          void this.disconnect(client.member.connectionId);
          continue;
        }
        for (const old of Object.values(previous.members))
          if (old.id !== client.member.id && !room.members[old.id])
            this.send(client, {
              type: "peer",
              id: old.id,
              connectionId: old.connectionId,
              online: false,
            });
        for (const next of Object.values(room.members))
          if (
            next.id !== client.member.id &&
            previous.members[next.id]?.connectionId !== next.connectionId
          )
            this.send(client, {
              type: "peer",
              id: next.id,
              connectionId: next.connectionId,
              online: true,
            });
        if (JSON.stringify(previous.grant) !== JSON.stringify(room.grant))
          this.send(client, { type: "authority", grant: room.grant });
      }
  }
  async deliver(message: RoutedMessage): Promise<void> {
    return this.route(message, true);
  }
  private async route(
    message: RoutedMessage,
    busOrigin: boolean,
  ): Promise<void> {
    if (
      this.stateValue !== "ready" ||
      message.destination !== this.id ||
      message.expiresAt <= this.deps.now()
    )
      return;
    const client = this.clients.get(message.to.connectionId);
    if (
      !client ||
      client.room !== message.code ||
      client.member.id !== message.to.id
    )
      return;
    let room = this.views.get(message.code)?.room;
    if (
      !room ||
      room.expiresAt <= this.deps.now() ||
      room.incarnation !== message.incarnation
    )
      return;
    if (
      room.members[message.from.id]?.connectionId !== message.from.connectionId
    ) {
      room = await this.store.get(message.code);
      if (
        this.clients.get(message.to.connectionId) !== client ||
        this.views.get(message.code)?.room.incarnation !==
          message.incarnation ||
        room.incarnation !== message.incarnation
      )
        return;
      this.observe(message.code, room);
    }
    if (
      room.expiresAt <= this.deps.now() ||
      room.incarnation !== message.incarnation ||
      room.members[message.from.id]?.connectionId !==
        message.from.connectionId ||
      room.members[message.to.id]?.connectionId !== message.to.connectionId ||
      message.from.id === message.to.id
    )
      return;
    if (busOrigin) {
      // Each live room owns a bounded dedupe window. One abusive room cannot
      // consume another room's capacity or fail the gateway. Local delivery never retries.
      const seen = this.views.get(message.code)!.seen;
      for (const [id, expires] of seen)
        if (expires <= this.deps.now()) seen.delete(id);
      if (seen.has(message.id) || seen.size >= 512) return;
      seen.set(
        message.id,
        Math.min(message.expiresAt, this.deps.now() + BUS_FRAME_TTL_MS),
      );
    }
    // observe above sends peer connection replacement before this source's first frame.
    this.send(client, message.wire);
  }
  private watchView(code: string, view: View): void {
    view.stop = this.store.database.watch(
      code,
      (current) => {
        if (this.views.get(code) === view) this.observe(code, current);
      },
      (error) => {
        if (this.views.get(code) === view) this.fail("metadata", error);
      },
    );
  }
  private scheduleExpiry(code: string, view: View): void {
    view.cancelExpiry?.();
    const incarnation = view.room.incarnation;
    const same = () =>
      this.views.get(code) === view && view.room.incarnation === incarnation;
    const close = (status: number) => {
      if (!same()) return;
      for (const client of this.clients.values())
        if (client.room === code && client.incarnation === incarnation) {
          client.socket.close(
            status,
            status === 4004 ? "Room expired" : "Room connection interrupted",
          );
          void this.disconnect(client.member.connectionId);
        }
    };
    const expire = () => {
      if (!same()) return;
      if (view.room.expiresAt > this.deps.now()) {
        this.scheduleExpiry(code, view);
        return;
      }
      // One metadata recheck at expiry prevents a delayed watch from falsely terminating a renewed room.
      void this.store
        .get(code)
        .then((current) => {
          if (!same()) return;
          if (current.incarnation !== incarnation) {
            close(4004);
            return;
          }
          this.observe(code, current);
          if (same()) this.scheduleExpiry(code, view);
        })
        .catch((error) => {
          close(
            error instanceof RoomError && error.status === 404 ? 4004 : 1012,
          );
        });
    };
    const delay = Math.max(0, view.room.expiresAt - this.deps.now());
    if (this.deps.schedule)
      view.cancelExpiry = this.deps.schedule(expire, delay);
    else {
      const timer = setTimeout(expire, delay);
      timer.unref();
      view.cancelExpiry = () => clearTimeout(timer);
    }
  }
  async disconnect(connectionId: string): Promise<void> {
    const room = this.clients.get(connectionId)?.room;
    if (!room) return;
    return this.inRoom(room, async () => {
      const client = this.clients.get(connectionId);
      if (!client) return;
      this.clients.delete(connectionId);
      try {
        await this.store.leave(client.room, client.member);
      } catch (error) {
        this.deps.error("leave", error);
      }
      if (![...this.clients.values()].some((c) => c.room === client.room)) {
        this.views.get(client.room)?.stop();
        this.views.get(client.room)?.cancelExpiry?.();
        this.views.delete(client.room);
      }
    });
  }
  private send(client: Client, message: unknown): void {
    if (client.socket.bufferedAmount > 256_000) {
      client.socket.close(1013, "Slow connection — reconnect");
      void this.disconnect(client.member.connectionId);
      return;
    }
    try {
      client.socket.send(JSON.stringify(message));
    } catch (error) {
      this.deps.error("socket-send", error);
      void this.disconnect(client.member.connectionId);
    }
  }
  private fail(kind: string, error: Error): void {
    this.stateValue = "failed";
    this.busGeneration++;
    this.deps.error(kind, error);
    for (const client of this.clients.values()) {
      client.socket.close(1012, "Room relay restarting");
      void this.disconnect(client.member.connectionId);
    }
  }
  private async drain(): Promise<void> {
    this.stateValue = "draining";
    try {
      await this.bus.stop();
    } catch (error) {
      this.deps.error("bus-stop", error);
    }
    for (const view of this.views.values()) view.seen.clear();
    this.stateValue = "idle";
  }
  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.all(this.rooms.values());
    for (const client of this.clients.values())
      client.socket.close(1001, "Service restarting");
    for (const id of [...this.clients.keys()]) await this.disconnect(id);
    await this.serial(async () => {
      if (this.stateValue !== "idle") await this.drain();
    });
  }
}
