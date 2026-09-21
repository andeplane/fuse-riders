import { StatusNotices } from "./status-notices.js";
import { TICK_MS, TickClock } from "./clock.js";
import {
  World,
  type Frame,
  type WindowTime,
  type WorldEvent,
} from "./rollback.js";
import { STALL_TICKS } from "./rollback.js";
import { PACKET_ENTRIES, type StreamLog } from "./stream.js";
import {
  decodePacket,
  encodeNack,
  encodePacketTrimmed,
  roomHash,
  wrapDelta,
  wrapMs,
  type Packet,
} from "./packet.js";
import {
  SnapshotAssembler,
  decodeSnapshot,
  encodeSnapshot,
} from "./snapshot.js";
import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  ROOM_ACTIONS,
  SETTINGS,
  SPECTATOR,
  actingCreator,
  roomManager,
  successionOrder,
  type ManagementEntry,
  type RoomAction,
} from "./management.js";
import type {
  LogEntry,
  RollbackGame,
  RoomClock,
  RuntimeText,
  Seat,
} from "./game.js";
import { uuid } from "./uuid.js";
import { Membership, rulesAge, type Member } from "./membership.js";
import { WorldSync } from "./world-sync.js";
import { InputRecorder } from "./input-recorder.js";
import {
  CREATOR_SILENCE_MS,
  DISCONNECT_MS,
  RoomManager,
} from "./room-manager.js";
import type { RoomTransport, TransportEvents } from "fuse-network-fe";

/** The room commands every game has; a game adds its own input commands in a subclass. */
export type RoomCommand<Settings = unknown, Avatar extends string = string> =
  | { type: "join"; name: string; avatarId?: Avatar }
  /** Take a place in the watching list instead of a seat: no inputs, no slot, no score. */
  | { type: "spectate"; name: string }
  | { type: "action"; action: RoomAction }
  | { type: "settings"; settings: Settings }
  | { type: "bot"; action: "add" | "remove"; id?: string }
  /** Remove a human player or a watcher: the manager's escape hatch for an absent friend, between rounds like AI removal. */
  | { type: "kick"; id: string };
export type { RoomTransport, TransportEvents };
export interface RuntimeDependencies {
  now(): number;
  hidden(): boolean;
  token(): string;
  generation(): number;
  schedule(callback: () => void, intervalMs: number): () => void;
  onVisibilityChange(callback: () => void): () => void;
}
export interface Callbacks<
  View extends { tick: number } = { tick: number },
  Event = unknown,
  Settings = unknown,
> {
  state(frame: Frame<View>, settings: Settings): void;
  event(event: Event, matchId: string, round: number, tick: number): void;
  status(text: string): void;
  ready(id: string, host: boolean): void;
  /** The manager removed this device from the room. The seat is already gone from the fold; the screen says why. */
  kicked?(): void;
  ended?(): void;
}
/** What `frameTiming()` hands the screen: frames and times, not a finished picture. */
export interface FrameTiming<View extends { tick: number } = { tick: number }> {
  /** The tick before `newer`, when there is one to interpolate from. */
  older?: Frame<View>;
  newer: Frame<View>;
  /** The fractional tick to show, between the two frames. */
  tick: number;
  /** How far the clock is past `tick`, 0 to 1: how far a game may lead its local player with the controls it holds. */
  lead: number;
}
/** What the runtime can report about its own health: per link, per stream and for the fold as a whole. */
export interface RuntimeMetrics {
  tick: number;
  clockTick: number;
  rollbacks: number;
  rollbackTicks: number;
  /** Simulation steps the current world has run (`World.steps`): catch-up, rollback re-runs and fast log ticks included. */
  steps: number;
  /** No rollback re-run is owed (`World.settled`). */
  settled: boolean;
  rtt: Record<string, number>;
  heard: Record<string, number>;
  clock: ReturnType<TickClock["diagnostics"]>;
  sentBytes: number;
  snapshotRequest: boolean;
  mismatches: number;
  /** Authority hashes this replica could compare with its own state, whatever the outcome. */
  hashChecks: number;
  /** Members refused for announcing different rules: nothing they send is folded in. */
  refused: string[];
  stall: { tick: number; waitingFor?: string };
  streams: Record<
    string,
    {
      generation: number;
      contiguous: number;
      lastSeq: number;
      through: number;
      complete: number;
      gap: boolean;
      base: number;
      rejected: number;
    }
  >;
}
export interface RuntimeOptions {
  /** Receives consumer failures; defaults to console.error. Must not throw. */
  callbackError?: (kind: keyof Callbacks, error: unknown) => void;
  transport?: (events: TransportEvents) => RoomTransport;
  displayOnly?: boolean;
  humanName?: string;
  dependencies?: RuntimeDependencies;
}
const fill = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );

export const LAG_INDICATOR_MS = 250,
  SNAPSHOT_RETRY_MS = 2000,
  SNAPSHOT_FAILURES = 3,
  JOIN_RETRY_MS = 1000;
export const SNAPSHOT_BUFFER_LIMIT = 4_000_000,
  STALLED_GAP_MS = 1500,
  /** How long a member whose packets all fall outside this replica's window still counts as heard, and is resynced for: several snapshot attempts. */
  WINDOW_GRACE_MS = 10_000,
  SNAPSHOT_SERVE_MS = 500;
export const AWAY_REPEAT_MS = 5000,
  /** How often a page back in the foreground logs its own return in a room with nobody present to log it. */
  RETURN_REPEAT_MS = 1000,
  /** How long a resync that brought no newer world keeps this replica catching up instead of fetching again. */
  CATCH_UP_HOLD_MS = 10_000;
export const HASH_INTERVAL = 20,
  HASH_LAG = 40,
  /** Simulation steps per 10 ms loop interval, catch-up and rollback re-runs together (`World.refill`). */
  CATCHUP_STEPS = 8,
  /** Milliseconds a loop interval's window may keep starting steps: a slow device paints between passes (`World.refill`). */
  CATCHUP_MS = 6,
  /** Estimated steps of backlog past which a member fetches a snapshot instead of catching up (`RoomRuntime.behind`). */
  BEHIND_STEPS = 400,
  NACK_INTERVAL_MS = 100,
  FRESH_WORLD_WAIT_MS = 3000;
/** A page's generation: 100 ms units since 2020-09-13, so two loads of the same page never share one (the previous whole-second value collided on quick reloads); wraps in 2034. */
export const pageGeneration = (nowMs = Date.now()): number =>
  Math.floor((nowMs - 1_600_000_000_000) / 100) >>> 0;
const browserDependencies: RuntimeDependencies = {
  now: () => performance.now(),
  hidden: () => document.hidden,
  token: uuid,
  generation: () => pageGeneration(),
  schedule: (callback, ms) => {
    const timer = setInterval(callback, ms);
    return () => clearInterval(timer);
  },
  onVisibilityChange: (callback) => {
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
  },
};

/**
 * One runtime for solo and online play: every member simulates the shared log locally, sends one packet per tick to
 * every other member, and rolls back when a late entry changes history. The creator additionally logs the room's
 * management entries; any member can serve the world to a joiner.
 */
export class RoomRuntime<
  Room extends RoomClock,
  Entry extends LogEntry,
  View extends { tick: number },
  Event,
  Settings,
> {
  readonly transport?: RoomTransport;
  protected readonly deps: RuntimeDependencies;
  protected readonly status: StatusNotices;
  protected readonly clock: TickClock;
  private readonly members: Membership;
  /** The room's management duties: seating, presence, succession and kicks. */
  private readonly management: RoomManager<Room, Entry, View, Event, Settings>;
  protected readonly generation: number;
  /** Where this replica stands with the shared world: the lifecycle state, the snapshot fetch and the divergence count. */
  readonly sync: WorldSync<Room, Entry, View, Event, Settings>;
  protected readonly text: RuntimeText;
  protected id = "";
  private hostId = "";
  private room = 0;
  private welcomeAt = -Infinity;
  /** What this device writes into the shared log, and when the next packet is owed. */
  protected readonly recorder: InputRecorder<Entry>;
  /** The frame last handed to `state`: a rollback's re-run replaces the frames with new ones at the same tick. */
  private lastFrame: Frame<View> | undefined;
  private pendingJoin?: {
    name: string;
    avatarId?: string;
    /** Whether this asks for the watching list rather than a seat. */
    spectator: boolean;
    /** Whether this asks to move the name of a seat this member already holds, which is what it then waits on. */
    rename: boolean;
    sentAt: number;
  };
  private full = true;
  protected hiddenState = false;
  /**
   * The tick of this member's own `PRESENCE false` while its page is hidden, until it logs its return: the hidden-member
   * policy (ADR-047 §12). Kept here rather than read from the world, which does not advance while the page is hidden.
   */
  private awayTick?: number;
  /** When this member last logged its own away entry, and when it last logged its own return (both are repeated, §12). */
  private awayAt = -Infinity;
  private returnAt = -Infinity;
  private cancelTick?: () => void;
  private cancelVisibility?: () => void;
  constructor(
    readonly game: RollbackGame<Room, Entry, View, Event, Settings>,
    readonly code: string,
    private readonly settings: Settings,
    private readonly callbacks: Callbacks<View, Event, Settings>,
    private readonly options: RuntimeOptions = {},
  ) {
    this.text = game.text;
    this.deps = options.dependencies ?? browserDependencies;
    this.members = new Membership(() => this.deps.now());
    this.sync = new WorldSync(game.id);
    this.recorder = new InputRecorder(
      () => this.own(),
      () => this.clock.tick(),
    );
    this.generation = this.deps.generation();
    const runtime = this;
    this.management = new RoomManager({
      game,
      members: this.members,
      recorder: this.recorder,
      text: this.text,
      get id() {
        return runtime.id;
      },
      get hostId() {
        return runtime.hostId;
      },
      get creator() {
        return runtime.creator;
      },
      generation: this.generation,
      get hidden() {
        return runtime.hiddenState;
      },
      get full() {
        return runtime.full;
      },
      get lastLoopAt() {
        return runtime.lastLoopAt;
      },
      get world() {
        return runtime.sync.world;
      },
      own: () => this.own(),
      now: () => this.deps.now(),
      notice: (text) => this.status.notice(text),
      send: (id, message) => this.transport?.send(id, message) ?? false,
    });
    this.status = new StatusNotices(
      () => this.deps.now(),
      (text) => this.deliver("status", () => callbacks.status(text)),
    );
    this.clock = new TickClock(() => this.deps.now());
    if (options.transport)
      this.transport = options.transport({
        welcome: (id, hostId) => this.welcome(id, hostId),
        peer: (id, online) => this.peer(id, online),
        link: (id, open) => this.link(id, open),
        message: (id, data) => this.message(id, data),
        fast: (id, bytes) => this.fast(id, bytes),
        status: (text) => this.status.recurring(text),
        revoked: () => {
          this.halt();
          this.status.terminal(this.text.hostReplaced);
        },
        ended: () => {
          this.halt();
          this.deliver("ended", () => this.callbacks.ended?.());
        },
        terminated: (text) => {
          this.halt();
          this.status.terminal(text);
        },
      });
  }
  /** The world this replica folds the log into, once it has one: `WorldSync` owns when that is and how it changes. */
  protected get world(): World<Room, Entry, View, Event, Settings> | undefined {
    return this.sync.world;
  }
  get solo(): boolean {
    return !this.transport;
  }
  get creator(): boolean {
    return this.id !== "" && this.id === this.hostId;
  }
  /**
   * Whether the page that opened the room is here: this one, or a member the room service still lists. A stand-in host
   * needs it to change its own side, since it cannot write its own pair (`switchWriter`), so the screen asks too.
   */
  get hostPresent(): boolean {
    return this.creator || this.members.has(this.hostId);
  }
  /** Whether this replica's management entries apply right now: the creator, or the delegate while the creator is logged absent. */
  private get manager(): boolean {
    return this.management.manager;
  }
  /** Whether this device runs the room for the players: the crown, not the log duties. */
  private get managing(): boolean {
    return this.management.managing;
  }
  /** Where a joiner sends its join: the creator, or whoever manages while the creator is absent. */
  private managerId(): string {
    return this.management.managerId();
  }
  get tick(): number {
    return this.world?.tick ?? 0;
  }
  start(): void {
    if (this.cancelTick) return;
    if (this.transport) this.transport.connect();
    else {
      this.id = this.hostId = "solo";
      this.room = roomHash("solo");
      const seating = this.game.seating;
      this.createWorld(seating.soloSettings(this.settings));
      this.deliver("ready", () => this.callbacks.ready("solo", true));
      this.status.recurring(this.text.solo);
      const name =
        seating.seatName(this.options.humanName ?? "") ?? seating.solo.name;
      this.management.join("solo", name, undefined);
      for (let index = 0; index < seating.solo.bots; index++)
        this.command({ type: "bot", action: "add" });
      this.command({ type: "action", action: "start" });
      this.world!.refill(Infinity);
      this.world!.advance(this.recorder.tick); // The first frame already seats everyone; the clock catches up within a tick.
      this.publish();
    }
    this.hiddenState = this.deps.hidden();
    if (this.hiddenState && this.solo) this.clock.pause();
    this.cancelVisibility = this.deps.onVisibilityChange(() =>
      this.visibilityChanged(),
    );
    this.cancelTick = this.deps.schedule(() => this.tickLoop(), 10);
  }
  stop(): void {
    this.halt();
    this.transport?.close(true);
  }
  private halt(): void {
    this.cancelTick?.();
    this.cancelVisibility?.();
    this.cancelTick = this.cancelVisibility = undefined;
  }

  // ---- transport events -------------------------------------------------------------------------------------------
  private welcome(id: string, hostId: string): void {
    this.id = id;
    this.hostId = hostId;
    this.room = roomHash(`${this.code}:${hostId}`);
    this.welcomeAt = this.deps.now();
    this.sync.clearNoWorld();
    if (!this.world)
      this.status.recurring(
        id === hostId ? this.text.preparing : this.text.waitingForGame,
      );
    this.deliver("ready", () => this.callbacks.ready(id, id === hostId));
  }
  private peer(id: string, online: boolean): void {
    if (online) {
      this.members.connect(id);
      return;
    }
    this.members.forget(id);
    this.sync.forgetNoWorld(id);
    if (this.sync.request?.to === id) this.sync.abandonRequest();
    const state = this.world?.state,
      player = state && this.game.seat(state, id);
    // A hidden page's world is frozen: what it would log is judged from stale seats, so it leaves that to the others.
    // Nor does a manager whose own seat is still away log departures: the entry would be discarded by every reducer
    // while the stall rule read it, so the room would stop waiting for a member nobody disconnected.
    if (
      !this.manager ||
      !player ||
      this.hiddenState ||
      this.game.seat(state!, this.id)?.away === true
    )
      return;
    // A reload reaches here too: the service retires the old socket before it admits the new page. In the lobby that
    // frees the seat, and the page confirms its name on the join card. Mid-match it is absence, not departure: `LEAVE`
    // frees a seat at once in `roundOver` and `matchOver`, so a reload that landed just after the round ended lost the
    // seat inside that round. Absent members are pruned when the next round starts, which leaves the page the whole
    // pause to come back, and they are logged present again once heard (`creatorDuties`). A watcher holds no seat, so
    // the lobby frees its place outright and a live match keeps it listed but absent, as for a player.
    if (this.game.stage(state!) === "lobby")
      if (player.watcher) this.append(SPECTATOR, "leave", id);
      else this.append(LEAVE, id);
    else if (player.connected || player.away)
      this.append(PRESENCE, id, false, player.generation ?? 0);
  }
  /** A link opening is only a hint: the transport admits sends once its own probes confirm the path, so the tick loop retries. */
  private link(id: string, open: boolean): void {
    const member = this.members.get(id);
    if (!member) return;
    member.helloed = false;
    if (open) this.greet(id, member);
  }
  private greet(id: string, member: Member): void {
    if (member.helloed || !this.transport!.linked(id)) return;
    member.helloed = this.transport!.send(id, {
      type: "hello",
      generation: this.generation,
      full: this.full,
      rules: this.game.rules,
      world: this.world !== undefined,
      hidden: this.hiddenState,
    });
    if (!member.helloed) return;
    if (this.needsWorld() && !this.sync.requesting) this.requestSnapshot(id);
    // The creator too: a member already in the room sends a side switch to its page rather than to the manager.
    if (this.pendingJoin && (id === this.managerId() || id === this.hostId))
      this.sendJoin();
  }
  private message(id: string, raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const data = raw as {
      type?: unknown;
      generation?: unknown;
      full?: unknown;
      rules?: unknown;
      name?: unknown;
      avatarId?: unknown;
      error?: unknown;
      world?: unknown;
      role?: unknown;
      hidden?: unknown;
    };
    const member = this.members.get(id);
    if (!member) return;
    // A peer on different rules folds the same log into a different world: only a matching hello is heard from it.
    if (member.refused && data.type !== "hello") {
      if (data.type === "join") {
        const age = rulesAge(this.game.rules, member.rules),
          mismatch = this.text.mismatch;
        this.transport!.send(id, {
          type: "error",
          error:
            age === "older"
              ? mismatch.replyToStale
              : age === "newer"
                ? mismatch.replyToNewer
                : mismatch.replyToUnknown,
        });
      }
      return;
    }
    switch (data.type) {
      case "hello":
        if (data.rules !== this.game.rules) {
          member.refused = true;
          member.rules =
            typeof data.rules === "string" ? data.rules : undefined;
          if (this.sync.request?.to === id) this.sync.abandonRequest();
          this.status.notice(this.mismatchStatus());
          return;
        }
        member.refused = false;
        member.rules = undefined;
        if (
          typeof data.generation === "number" &&
          Number.isSafeInteger(data.generation) &&
          data.generation >= 0
        )
          this.bump(id, member, data.generation);
        member.full = data.full === true;
        member.hidden = data.hidden === true;
        // A peer announcing a world is worth asking again, whatever it answered before.
        if (data.world === true) {
          this.sync.forgetNoWorld(id);
          // A source that may hold a newer world: worth one fetch again, whatever the last resync brought.
          if (!member.hidden) this.sync.releaseCatchUp();
        }
        return;
      case "join":
        if (
          this.manager &&
          !this.hiddenState &&
          // A manager whose own seat is away seats nobody: the `JOIN` would be discarded and the joiner left waiting.
          (this.world === undefined ||
            this.game.seat(this.world.state, this.id)?.away !== true) &&
          typeof data.name === "string"
        ) {
          const error =
            data.role === "spectator"
              ? this.management.spectate(id, data.name)
              : this.management.join(
                  id,
                  data.name,
                  this.game.seating.isAvatar(data.avatarId)
                    ? data.avatarId
                    : undefined,
                );
          if (error) this.transport!.send(id, { type: "error", error });
        }
        return;
      case "snapshotRequest": {
        // One snapshot per peer per half second: a requester retries on its own timer, so a storm of requests cannot make this replica encode and queue megabytes.
        const now = this.deps.now();
        if (now - member.snapshotServedAt < SNAPSHOT_SERVE_MS) return;
        member.snapshotServedAt = now;
        // A hidden page's world is frozen where it hid: it is no source (and its reliable sends lapse soon after, §12).
        if (this.world && !this.hiddenState) {
          for (const chunk of encodeSnapshot(this.world, this.room))
            if (!this.transport!.send(id, chunk, SNAPSHOT_BUFFER_LIMIT)) break;
        } else this.transport!.send(id, { type: "noWorld" });
        return;
      }
      case "noWorld":
        this.sync.noteNoWorld(id, this.deps.now());
        if (this.sync.request?.to === id) this.sync.abandonRequest();
        return;
      case "snapshot":
        this.acceptSnapshotChunk(id, raw);
        return;
      // Only from whoever manages the room, and only about this device: a peer cannot talk anyone else out of its seat.
      case "kicked":
        if (id !== this.hostId && id !== this.managerId()) return;
        this.pendingJoin = undefined;
        this.status.notice(this.text.kicked);
        this.deliver("kicked", () => this.callbacks.kicked?.());
        return;
      case "error":
        if (typeof data.error === "string")
          this.status.notice(data.error.slice(0, 120));
        // An arrival keeps asking: a seat or a place on the list frees and it is in. A side switch is a deliberate tap
        // by a member that already has a place, so a refusal ends it — left queued, the retry pinned the refusal in the
        // status line for a whole round and then moved the member at a pause nobody asked for.
        if (
          this.pendingJoin &&
          (id === this.hostId || id === this.managerId()) &&
          (this.management.switchingSides(this.pendingJoin.spectator) ||
            this.pendingJoin.rename)
        )
          this.pendingJoin = undefined;
        return;
      default:
        return;
    }
  }
  private fast(id: string, bytes: Uint8Array): void {
    const decoded = decodePacket(this.game, bytes),
      member = this.members.get(id);
    if (!decoded || !member || member.refused) return;
    const now = this.deps.now();
    if ("nack" in decoded) {
      if (
        decoded.nack.room !== this.room ||
        decoded.nack.from !== id ||
        !this.world
      )
        return;
      const entries = this.own().repairEntries(decoded.nack.firstMissingSeq);
      if (entries.length) this.sendPacket(id, member, entries, now);
      return;
    }
    const packet = decoded.packet;
    if (packet.room !== this.room || packet.from !== id) return;
    if (packet.generation < member.generation) return;
    this.bump(id, member, packet.generation);
    const heardAt = member.lastPacketAt;
    member.lastPacketAt = now;
    member.lastSentAt = packet.sentAt;
    member.lastSentReceivedAt = now;
    member.clockTick = packet.clockTick + (member.rttMs ?? 0) / 2 / TICK_MS;
    if (packet.echoSentAt !== 0) {
      const rtt = wrapDelta(wrapMs(now), packet.echoSentAt) - packet.echoHeld;
      if (rtt >= 0 && rtt < 10_000) {
        member.rttMs = rtt;
        if (id === this.authority()) this.clock.sample(packet.clockTick, rtt);
      }
    }
    if (!this.world) return;
    const result = this.world.receive(
      id,
      packet.entries,
      packet.lastSeq,
      packet.through,
      Math.floor(this.clock.tick()),
    );
    if (result.status !== "invalid") member.windowSince = -Infinity;
    if (result.status === "unrepairable") {
      this.requestSnapshot();
      return;
    }
    if (result.status === "invalid") {
      member.rejected++;
      // A packet no unmodified client sends is not a sign of life: a member whose stream cannot be folded is marked
      // absent like a silent one, so the room plays on instead of waiting for completeness it will never accept.
      // A packet outside this replica's own window says nothing about its sender, which stays heard while the usual
      // recovery runs (a resync, a gap closing, this clock catching up) — but only for so long: a member that never
      // comes back inside the window is then treated as silent too, rather than stalling the room for good.
      if (result.refusal === "window" && member.windowSince === -Infinity)
        member.windowSince = now;
      if (
        result.refusal !== "window" ||
        now - member.windowSince > WINDOW_GRACE_MS
      )
        member.lastPacketAt = heardAt;
      return;
    }
    this.deliverEvents(result.events);
    const stream = this.world.streams.get(id);
    if (stream?.gap && now - member.nackAt >= NACK_INTERVAL_MS) {
      member.nackAt = now;
      this.transport!.sendFast(
        id,
        encodeNack({
          room: this.room,
          from: this.id,
          firstMissingSeq: stream.firstMissing()!,
        }),
      );
    }
    if (packet.hash && id === this.authority())
      this.compareHash(packet.hash[0], packet.hash[1], now);
    if (result.rollbackTicks > 0) this.publish();
  }
  private deliverEvents(events: readonly WorldEvent<Event>[]): void {
    for (const event of events)
      this.deliver("event", () =>
        this.callbacks.event(
          event.event,
          event.matchId,
          event.round,
          event.tick,
        ),
      );
  }
  private bump(id: string, member: Member, generation: number): void {
    if (generation > member.generation) member.generation = generation;
    this.ensureStream(id, member);
  }
  /** Every known member with a generation has a stream in the world, whichever of hello, packet or snapshot came first. */
  private ensureStream(id: string, member: Member): void {
    if (!this.world || member.generation === 0) return;
    const existing = this.world.streams.get(id);
    if (existing && existing.generation === member.generation) return;
    this.world.stream(id, member.generation, {
      seq: 0,
      tick: Math.max(0, this.world.tick - STALL_TICKS),
    });
    if (this.creator && !this.hiddenState)
      this.management.ensurePresence(id, member);
  }

  // ---- world lifecycle --------------------------------------------------------------------------------------------
  private needsWorld(): boolean {
    return !this.world && this.id !== "";
  }
  private createWorld(settings: Settings): void {
    const world = new World(
      this.game,
      this.game.createRoom(this.deps.token(), settings),
      this.hostId,
      this.id,
    );
    this.sync.open(world);
    world.refill(CATCHUP_STEPS, this.windowTime);
    world.stream(this.id, this.generation);
    // Nobody is seated in a fresh world, and a seat needs a link (`join` travels over it): the anchor is set for one
    // invariant — "since the first world" — not because anything here could be misjudged.
    this.members.judgingSince = this.deps.now();
    this.clock.start(0);
    this.recorder.restart();
    this.resetControls();
    this.status.recurring(this.solo ? this.text.solo : this.text.connected);
    // Peers that asked while there was nothing to serve re-hear a hello that now announces a world.
    this.members.regreetAll();
    if (this.pendingJoin) this.sendJoin();
  }
  /**
   * One line for every refused member together, whatever order they arrived in: any of them ahead of this build makes
   * this page the stale one, and reloading it is the thing to do; otherwise an older one is named; otherwise the rules
   * do not compare. `waiting`: this page has no world and nobody compatible to get one from, so the older members are the room.
   */
  private mismatchStatus(waiting = false): string {
    const ages = this.members.refusedAges(this.game.rules);
    const mismatch = this.text.mismatch;
    return ages.has("newer")
      ? mismatch.stale
      : ages.has("older")
        ? waiting
          ? mismatch.staleRoom
          : mismatch.staleRider
        : mismatch.unknown;
  }
  private saidNoWorld(id: string): boolean {
    return this.sync.saidNoWorld(id, this.deps.now(), SNAPSHOT_RETRY_MS);
  }
  /** A fetch that has gone unanswered for the retry interval: the tick loop asks the next holder. */
  private staleRequest(now: number): boolean {
    const request = this.sync.request;
    return request !== undefined && now - request.at > SNAPSHOT_RETRY_MS;
  }
  /** A member whose page is hidden, by its hello or by its away seat in this replica's world: its world is frozen. */
  private hiddenMember(id: string): boolean {
    if (this.members.get(id)?.hidden) return true;
    return (
      this.world !== undefined &&
      this.game.seat(this.world.state, id)?.away === true
    );
  }
  /** Members a snapshot may come from: compatible, linked and not hidden. */
  private sources(): string[] {
    return this.members
      .compatible()
      .filter((id) => this.transport!.linked(id) && !this.hiddenMember(id))
      .sort();
  }
  /**
   * Fetch the world from a peer: the first one after a welcome, or a resync when this replica's own fold cannot be
   * repaired. Public because it is a real operation a screen may offer and a test may force, and because `WorldSync`
   * reports what it did (`sync.state`, `sync.request`) rather than leaving it to be inferred.
   */
  requestSnapshot(preferred?: string): void {
    if (!this.transport) return;
    const all = this.sources(),
      holders = all.filter((id) => !this.saidNoWorld(id));
    const linked = holders.length ? holders : all;
    if (!linked.length) return;
    const authority = this.authority();
    const previous = this.sync.request?.to,
      next = linked[(linked.indexOf(previous ?? "") + 1) % linked.length]!;
    // The authority first, then round the others in order on each retry: preferring the authority on every retry
    // alternated between it and the member after it, so a third holder was never asked while those two could not answer
    // (a hidden page, whose reliable sends lapse, among them).
    const to =
      preferred && linked.includes(preferred)
        ? preferred
        : authority !== this.id &&
            linked.includes(authority) &&
            previous === undefined
          ? authority
          : next;
    this.sync.requestFrom(
      to,
      this.deps.now(),
      new SnapshotAssembler(this.game, this.room),
    );
    this.transport.send(to, { type: "snapshotRequest" });
  }
  private acceptSnapshotChunk(id: string, raw: unknown): void {
    const request = this.sync.request;
    if (!request || request.to !== id) return;
    const complete = request.assembler.accept(raw);
    if (!complete) return;
    const decoded = decodeSnapshot(this.game, complete.bytes, this.room);
    // A snapshot that fails validation is retried on the timer, rotating peers; asking again at once would storm a peer that keeps serving the same bad state.
    if (!decoded) {
      this.sync.restartAssembly(
        this.deps.now(),
        new SnapshotAssembler(this.game, this.room),
      );
      return;
    }
    const tick = decoded.state.tick,
      existing = this.sync.world,
      previous = existing?.streams.get(this.id);
    // A resync that is not ahead of this world says nobody is: the room is behind everywhere (a returning hidden page
    // that was the only world holder, for one), so the backlog is caught up at the step budget instead of fetched again.
    if (existing !== undefined && tick <= existing.tick)
      this.sync.holdCatchUp(this.deps.now() + CATCH_UP_HOLD_MS);
    else this.sync.releaseCatchUp();
    let world = existing;
    if (world) world.install(decoded.state);
    else {
      world = new World(this.game, decoded.state, this.hostId, this.id);
      world.refill(CATCHUP_STEPS, this.windowTime);
      // Not on a resync: a replica that already judged its members keeps the waits it started.
      this.members.judgingSince = this.deps.now();
    }
    // Live (or still Diverged) from here: the fetch is over, and the streams below are rebuilt in the installed world.
    this.sync.installed(world);
    for (const stream of decoded.streams) {
      // My own current stream is rebuilt below with its continuity; my retired generations (the previous page's entries before
      // its presence switched) install like anyone else's, and the own-stream creation then retires them in order.
      if (stream.id === this.id && stream.generation >= this.generation)
        continue;
      const log = world.stream(stream.id, stream.generation, {
        seq: stream.seq,
        tick,
        ordinal: stream.ordinal,
      });
      const member = this.members.get(stream.id);
      if (member && member.generation < stream.generation)
        member.generation = stream.generation;
      for (
        let offset = 0;
        offset < stream.entries.length;
        offset += PACKET_ENTRIES
      ) {
        const part = stream.entries.slice(offset, offset + PACKET_ENTRIES);
        log.receive(part, part.at(-1)![0], tick, tick + 60, tick);
      }
    }
    // The own stream keeps its seq numbering: peers already hold everything up to lastSeq, and entries after the
    // snapshot tick are re-applied here so this replica and its peers keep folding the same log.
    const base =
      previous?.generation === this.generation
        ? previous.baseAt(tick)
        : { seq: 0, tick, ordinal: 0 };
    const own = world.stream(this.id, this.generation, {
      seq: base.seq,
      tick,
      ordinal: base.ordinal,
    });
    const carried =
      previous?.generation === this.generation
        ? previous.entriesAfter(base.seq, tick)
        : [];
    for (let offset = 0; offset < carried.length; offset += PACKET_ENTRIES) {
      const part = carried.slice(offset, offset + PACKET_ENTRIES);
      own.receive(part, previous!.lastSeq, tick, tick + 60, tick);
    }
    own.lastSeq = Math.max(own.lastSeq, previous?.lastSeq ?? 0);
    for (const [id, member] of this.members) this.ensureStream(id, member);
    this.recorder.resumeAfter(tick);
    if (!carried.length) this.resetControls();
    this.lastFrame = undefined;
    // A clock with no samples yet (the returning creator, whose clock nobody else corrects) joins the room's running
    // clock: the freshest peer clock reading, projected to now, else the snapshot tick plus half the request round trip.
    if (!this.clock.started) {
      const now = this.deps.now(),
        readings = [...this.members.values()]
          .filter(
            (member) =>
              member.clockTick !== undefined &&
              now - member.lastPacketAt < 2000,
          )
          .map(
            (member) =>
              member.clockTick! + (now - member.lastPacketAt) / TICK_MS,
          );
      this.clock.start(
        readings.length
          ? Math.max(...readings)
          : tick + (now - request.at) / 2 / TICK_MS,
      );
    }
    this.sync.clearNoWorld();
    this.status.recurring(this.text.connected);
    if (this.pendingJoin) this.sendJoin();
    this.publish();
  }
  /** What the authority's hash for `tick` said about this replica's own fold, and the status and resync that follow. */
  private compareHash(tick: number, hash: string, now: number): void {
    const verdict = this.sync.compareHash(tick, hash, now);
    if (verdict === "unknown" || verdict === "match") return;
    if (verdict === "diverged") {
      this.status.notice(this.text.outOfSync);
      return;
    }
    this.status.transient(this.text.resyncing);
    this.requestSnapshot();
  }

  /** A free seat, freeing a disconnected member's seat between rounds first (`RoomManager.claimSlot`). */
  protected claimSlot(): number {
    return this.management.claimSlot();
  }

  // ---- own entries --------------------------------------------------------------------------------------------------
  protected own(): StreamLog<Entry> {
    return this.world!.streams.get(this.id)!;
  }
  protected append(...body: unknown[]): number {
    return this.recorder.append(body);
  }
  /** A game's held controls go neutral: a fresh world, a resync that carried no own entries. */
  protected resetControls(): void {}
  /** The page was hidden while this device holds a seat: a game logs whatever releases its held controls. */
  protected releaseControls(): void {}
  /** This device's seat is logged absent: a game forgets the controls it held. */
  protected absentControls(): void {}
  /** This device's seat, if it holds one: a watcher's place in the list is not a seat. */
  protected player(): Seat | undefined {
    const seat = this.world && this.game.seat(this.world.state, this.id);
    return seat?.watcher ? undefined : seat;
  }
  command(command: RoomCommand<Settings>): boolean {
    if (!command || typeof command !== "object") return false;
    if (command.type === "join" || command.type === "spectate") {
      if (this.options.displayOnly) return false;
      // A member the room already lists, asking for the other side, is switching rather than arriving. Whether it may
      // is answered here as well as at the writer, because the one refusal no writer can deliver is the one about
      // having nobody to write it: that request would be addressed to this device itself and answered by nobody.
      // Everything else is re-checked where the entries are written, against the fold they are written on.
      if (this.management.switchingSides(command.type === "spectate")) {
        const refusal = this.management.switchable(
          this.id,
          command.type === "spectate"
            ? this.text.watchInRound
            : this.text.takeSeatInRound,
        );
        if (refusal) {
          this.status.notice(refusal);
          return false;
        }
      }
      // A rename moves something the seat already has, so the "am I seated on the right side?" test that admits an
      // arrival cannot see whether it landed: a request the manager never heard would never be retried and the name
      // would quietly snap back. A rename waits on the name itself instead. Only a request that really does move the
      // name may wait on it — a game that leaves `seating.renameable` out never renames anyone, and a name the
      // normaliser rejects is never logged, so either would wait for something that is not coming.
      const seated = this.world && this.game.seat(this.world.state, this.id);
      const wanted = this.game.seating.seatName(command.name);
      this.pendingJoin = {
        name: command.name,
        avatarId: command.type === "join" ? command.avatarId : undefined,
        spectator: command.type === "spectate",
        rename:
          command.type === "join" &&
          seated !== undefined &&
          seated.watcher !== true &&
          this.game.seating.renameable !== undefined &&
          !!wanted &&
          wanted !== seated.name,
        sentAt: -Infinity,
      };
      if (this.creator || this.solo) return this.sendJoin();
      this.sendJoin();
      return true;
    }
    if (!this.world) {
      this.status.notice(this.text.loading);
      return false;
    }
    // A hidden page's world is frozen where it hid: nothing it would log from it is sound (§12).
    if (this.hiddenState && this.transport) return false;
    // Whoever runs the room right now: the creator, or the delegate holding it while the creator is away.
    if (!this.managing) {
      this.status.notice(this.text.hostOnly);
      return false;
    }
    const room = this.world.state,
      seating = this.game.seating;
    if (command.type === "settings") {
      const settings = seating.parseSettings(command.settings);
      if (settings === undefined) {
        this.status.notice(this.text.invalidSettings);
        return false;
      }
      this.append(
        SETTINGS,
        this.solo ? seating.soloSettings(settings) : settings,
      );
      return true;
    }
    if (command.type === "action") {
      const stage = this.game.stage(room);
      const connected =
        [...this.game.members(room)].filter(
          (player) => player.connected && !player.watcher,
        ).length + this.management.pending().seats;
      if (command.action === "start" && (stage !== "lobby" || connected < 2)) {
        this.status.notice(
          stage !== "lobby" ? this.text.matchRunning : this.text.needTwo,
        );
        return false;
      }
      if (command.action === "rematch" && (stage !== "over" || connected < 2)) {
        this.status.notice(this.text.rematchLater);
        return false;
      }
      if (!ROOM_ACTIONS.includes(command.action)) return false;
      this.append(ACTION, command.action, this.deps.token());
      return true;
    }
    if (command.type === "bot") {
      if (command.action === "add") {
        const slot = this.claimSlot();
        if (slot < 0) {
          this.status.notice(this.text.fullWithBots);
          return false;
        }
        const id = seating.botId(room, this.management.pending().ids);
        this.append(BOT, "add", id, seating.botName(slot), slot);
        return true;
      }
      if (
        typeof command.id !== "string" ||
        !this.game.seat(room, command.id)?.bot
      ) {
        this.status.notice(this.text.botNotFound);
        return false;
      }
      if (this.game.stage(room) === "running") {
        this.status.notice(this.text.botBetweenRounds);
        return false;
      }
      this.append(BOT, "remove", command.id);
      return true;
    }
    if (command.type === "kick") return this.management.kick(command.id);
    return false;
  }
  private sendJoin(): boolean {
    const join = this.pendingJoin;
    if (!join) return false;
    join.sentAt = this.deps.now();
    const write = (): boolean => {
      if (!this.world) return true;
      const error = join.spectator
        ? this.management.spectate(this.id, join.name)
        : this.management.join(this.id, join.name, join.avatarId);
      if (error) {
        this.status.notice(error);
        this.pendingJoin = undefined;
        return false;
      }
      return true;
    };
    if (this.creator || this.solo) return write();
    // A member already in the room asking for the other side goes to whoever may write its pair, which is not always
    // whoever a joiner would ask (`switchWriter`). An arrival keeps asking the manager, whose id is "" until the room
    // says otherwise — the send fails and the join timer tries again, as it always has.
    const switching = this.management.switchingSides(join.spectator);
    const to = switching ? this.management.switchWriter() : this.managerId();
    if (switching && to === this.id) {
      // Nobody left who could write it. Say so rather than posting the request into our own inbox forever.
      this.status.notice(this.text.switchAsStandIn);
      this.pendingJoin = undefined;
      return false;
    }
    // This device manages the room and is asking about itself — a rename, or a reconnection it can log on its own
    // stream. Writing it here rather than addressing a request to our own inbox, where nobody would answer it. A side
    // switch never reaches this: it is refused above, because the entry pair needs a writer that is not the subject.
    if (to === this.id) return write();
    // A manager refused for its rules would only answer with an error this replica drops: the status says what to do.
    if (this.members.get(to)?.refused) return false;
    return this.transport!.send(to, {
      type: "join",
      name: join.name,
      avatarId: join.avatarId,
      ...(join.spectator ? { role: "spectator" } : {}),
    });
  }

  // ---- cadence ----------------------------------------------------------------------------------------------------
  private authority(): string {
    // A hidden page's packets come once a second at best: it is no clock or hash authority, creator or not (§12).
    const host = this.members.get(this.hostId);
    if (this.creator || (host !== undefined && !host.hidden))
      return this.hostId;
    const now = this.deps.now();
    return [
      this.id,
      ...[...this.members]
        .filter(
          ([, member]) =>
            now - member.lastPacketAt <= CREATOR_SILENCE_MS && !member.hidden,
        )
        .map(([id]) => id),
    ].sort()[0]!;
  }
  private visibilityChanged(): void {
    const hidden = this.deps.hidden();
    if (hidden === this.hiddenState) return;
    this.hiddenState = hidden;
    if (hidden) {
      if (this.world && this.player()) this.releaseControls();
      if (this.transport) this.stepAway();
      // Solo freezes the clock, so the released controls are folded in now rather than when the tab returns.
      if (this.solo && this.world) {
        // Solo has no peers to roll back for and is at most a tick behind: this fold is not paced.
        this.world.refill(Infinity);
        this.world.advance(this.recorder.tick);
        this.clock.pause();
        this.publish();
      }
      return;
    }
    if (this.solo) {
      this.clock.resume();
      return;
    }
    this.stepBack();
    if (this.world && this.behind(Math.floor(this.clock.tick())))
      this.requestSnapshot();
  }
  /**
   * The hidden-member policy (ADR-047 §12, `docs/design/hidden-tab-policy.md`). A member that is present in the room logs
   * its own `PRESENCE false` as its page hides: every replica then keeps its seat and its place in the game, folds neutral
   * controls for it, stops waiting on its stream and stops judging its silence, so a page whose timers the browser
   * throttles to once a second, once a minute or not at all neither flaps nor stalls anyone. The entry leaves now, in a
   * packet of its own, while the page still runs; the hello that follows tells the others not to ask this page for the
   * world it has stopped advancing.
   */
  private stepAway(): void {
    // A seat or a place in the watching list is enough, present or not: a member the manager logged absent a moment
    // earlier still steps away, or its throttled packets would flap the seat back and forth.
    const own = this.world && this.game.seat(this.world.state, this.id);
    if (own && !own.away && this.awayTick === undefined) {
      this.awayTick = this.awayEntry();
      this.sendPackets(this.deps.now());
    }
    this.announceVisibility();
  }
  /**
   * Back: the hello says this page is visible and serves its world again, and the manager logs the return from the
   * packets it hears (`creatorDuties`). The member does not log its own return here: that entry is on a stream nobody
   * waits for, so a lost one would leave this replica the only one that thinks it is back — a divergence the hash would
   * then chase. It logs its own only when the room has nobody present to do it (`ownReturn`).
   */
  private stepBack(): void {
    this.awayTick = undefined;
    this.announceVisibility();
  }
  /** This member's own away entry, sent at once: repeated while hidden, because a manager may have logged it absent first. */
  private awayEntry(): number {
    this.awayAt = this.deps.now();
    const tick = this.append(PRESENCE, this.id, false, this.generation);
    this.sendPackets(this.awayAt);
    return tick;
  }
  /**
   * The one case the manager cannot cover: this page is back, its seat is still away and the room has nobody present to
   * log it in — every other member is away or has none. Its own entry cannot diverge from a present replica, because
   * there is none: the others fold it when they come back.
   */
  private ownReturn(now: number): void {
    const state = this.world!.state;
    if (
      [...this.game.members(state)].some(
        (seat) => seat.connected && !seat.bot && seat.id !== this.id,
      )
    )
      return;
    this.returnAt = now;
    this.append(PRESENCE, this.id, true, this.generation);
    this.sendPackets(now);
  }
  private announceVisibility(): void {
    for (const [id, member] of this.members) {
      member.helloed = false;
      this.greet(id, member);
    }
  }
  /** See `WorldSync.behind`: whether catching up to log tick `to` would cost more than `BEHIND_STEPS` steps. */
  private behind(to: number): boolean {
    const world = this.world!;
    return this.sync.behind(to, this.game.steps(world.state), BEHIND_STEPS);
  }
  private readonly windowTime: WindowTime = {
    now: () => this.deps.now(),
    ms: CATCHUP_MS,
  };
  private lastLoopAt = -Infinity;
  /**
   * One loop pass, then a fresh step budget for the next 10 ms: rollbacks in packet handlers until then draw on it too.
   * `dependencies.schedule` drives this every 10 ms in a page; a deterministic test drives it directly.
   */
  tickLoop(): void {
    // A pass that throws after advancing must still open the next window, or the world would never step again.
    try {
      this.tickPass();
    } finally {
      this.world?.refill(CATCHUP_STEPS, this.windowTime);
    }
  }
  private tickPass(): void {
    const now = this.deps.now();
    this.status.refresh();
    if (this.transport && this.id === "") return;
    for (const [id, member] of this.members) {
      // Once per connection: a link that flaps cannot keep restarting the wait for a member that never sends.
      if (member.linkedAt === -Infinity && this.transport!.linked(id))
        member.linkedAt = now;
      this.greet(id, member);
    }
    if (this.needsWorld()) {
      // Creator included: a room whose members all connected together has no world anywhere until every linked peer has said so.
      const candidates = this.members.compatible();
      if (
        !this.sync.requesting &&
        candidates.some(
          (id) => this.transport!.linked(id) && !this.saidNoWorld(id),
        )
      )
        this.requestSnapshot();
      if (this.creator && this.transport && !this.sync.requesting) {
        // A fresh world is opened only when nobody can have one: the room is empty, or every linked member answered
        // that it holds none. A returning creator with peers waits for their snapshot however long the links take;
        // opening a lobby on a timer would let the authority serve that lobby over the match its peers are playing.
        // Members refused for their rules count as nobody: whatever world they hold is not this game's.
        const linked = candidates.filter((id) => this.transport!.linked(id));
        const nobodyHasIt =
          linked.length > 0 && linked.every((id) => this.saidNoWorld(id));
        if (candidates.length === 0 || nobodyHasIt) {
          this.createWorld(this.settings);
          this.publish();
        } else if (now - this.welcomeAt > FRESH_WORLD_WAIT_MS)
          this.status.recurring(
            fill(this.text.recovering, {
              who: linked.length
                ? this.text.recoverFromOne
                : this.text.recoverFromAll,
              peer: this.transport.explain(candidates.sort()[0]!),
            }),
          );
      }
      if (this.staleRequest(now)) this.retrySnapshot();
      else if (
        !this.sync.requesting &&
        !this.creator &&
        now - this.welcomeAt > SNAPSHOT_RETRY_MS
      ) {
        // Nobody compatible can serve the game and a linked member was refused for its rules: that is why this page
        // waits, and it stays on screen (the notice at the hello is gone after a few seconds).
        const refused = [...this.members].some(
          ([id, member]) => member.refused && this.transport!.linked(id),
        );
        this.status.recurring(
          refused &&
            !candidates.some(
              (id) => this.transport!.linked(id) && !this.saidNoWorld(id),
            )
            ? this.mismatchStatus(true)
            : fill(this.text.waitingForHost, {
                peer: this.transport!.explain(this.hostId),
              }),
        );
      }
      if (this.pendingJoin && now - this.pendingJoin.sentAt > JOIN_RETRY_MS)
        this.sendJoin();
      return;
    }
    const world = this.world!;
    const tick = Math.floor(this.clock.tick());
    if (this.staleRequest(now)) this.retrySnapshot();
    this.own().through = Math.max(this.own().through, tick);
    if (this.hiddenState && !world.settled)
      // A hidden world does not advance, but a rollback's re-run is history it already reached: it finishes.
      this.deliverEvents(world.advance(world.tick).events);
    else if (!this.hiddenState && (tick > world.tick || !world.settled)) {
      // Only ticks the stall rule lets us reach count as a backlog: a world waiting on a member is not behind, and a
      // long stall must end by catching up, never by fetching a snapshot from a peer that waited just as long.
      const reachable = Math.min(tick, world.stallBound().tick),
        behind = this.behind(reachable);
      if (!behind) this.sync.releaseCatchUp();
      // Fetched only from someone who can have a newer world: with every source hidden or without one, or after a
      // resync that brought nothing newer, the backlog is caught up here at the step budget.
      if (
        this.transport &&
        behind &&
        this.sync.mayFetchBacklog(now) &&
        this.sources().some((id) => !this.saidNoWorld(id))
      ) {
        if (!this.sync.requesting) this.requestSnapshot();
      } else {
        // The budget window (`CATCHUP_STEPS`, refilled after every pass) paces how far this pass gets.
        const result = world.advance(tick);
        this.deliverEvents(result.events);
        if (result.waitingFor !== undefined) {
          this.status.recurring(
            fill(this.text.waitingFor, { name: result.waitingFor }),
          );
        } else if (!this.sync.diverged)
          this.status.recurring(this.solo ? this.text.solo : this.lagging(now));
      }
    }
    if (this.transport) {
      const own = this.game.seat(world.state, this.id);
      if (
        this.hiddenState &&
        this.awayTick !== undefined &&
        now - this.awayAt >= AWAY_REPEAT_MS
      )
        this.awayTick = this.awayEntry();
      else if (
        !this.hiddenState &&
        this.awayTick === undefined &&
        own?.away === true &&
        world.settled &&
        now - this.returnAt >= RETURN_REPEAT_MS
      )
        this.ownReturn(now);
      // A hidden page's world is frozen where it hid: it judges nobody and logs nothing for the room (§12).
      if (this.manager && !this.hiddenState) this.management.creatorDuties(now);
      if (!this.creator && !this.hiddenState)
        this.management.actingCreatorDuties(now);
      this.management.settleKick();
      this.lastLoopAt = now;
      const player = this.player();
      if (player && !player.connected) this.absentControls();
      if (this.pendingJoin) {
        const own = this.game.seat(world.state, this.id),
          admitted =
            own?.connected === true &&
            (own.watcher === true) === this.pendingJoin.spectator &&
            (!this.pendingJoin.rename ||
              own.name === this.game.seating.seatName(this.pendingJoin.name));
        if (admitted) this.pendingJoin = undefined;
        else if (now - this.pendingJoin.sentAt > JOIN_RETRY_MS) this.sendJoin();
      }
      const full =
        this.options.displayOnly === true ||
        !this.game.seating.sharedScreen(this.game.settings(world.state)) ||
        !player;
      if (full !== this.full) {
        this.full = full;
        for (const [id, member] of this.members) {
          member.helloed = false;
          this.greet(id, member);
        }
      }
      if (this.recorder.owes(tick)) this.sendPackets(now);
      for (const [id, member] of this.members) {
        const stream = world.streams.get(id);
        // A stream whose owner is out of reach (`ahead`) has no gap to nack, but needs the same snapshot: it takes the
        // same throttled path. Once the member no longer counts as heard the asking backs off, but never stops: a
        // replica whose links could not carry a request inside the grace would otherwise be wedged for good.
        const ahead = stream?.ahead === true,
          pace =
            !stream?.gap && now - member.windowSince > WINDOW_GRACE_MS
              ? WINDOW_GRACE_MS
              : STALLED_GAP_MS;
        if (!stream?.gap && !ahead) {
          member.gapSince = -Infinity;
          continue;
        }
        if (member.gapSince === -Infinity) member.gapSince = now;
        // Nack repairs a gap within a round trip. One that outlives the owner's retained window (an entry logged
        // before that peer's links could carry packets) can only be closed by a snapshot from a peer that has it.
        else if (now - member.gapSince > pace && !this.sync.requesting) {
          this.requestSnapshot();
          // Only a request that went out uses up the wait: with no link fit to carry one, the next tick tries again.
          if (this.sync.requesting) member.gapSince = now;
          continue;
        }
        if (
          stream.gap &&
          now - member.nackAt >= NACK_INTERVAL_MS &&
          this.transport.linked(id)
        ) {
          member.nackAt = now;
          this.transport.sendFast(
            id,
            encodeNack({
              room: this.room,
              from: this.id,
              firstMissingSeq: stream.firstMissing()!,
            }),
          );
        }
      }
    }
    this.publish();
  }
  private lagging(now: number): string {
    const room = this.world!.state;
    for (const [id, member] of this.members) {
      const player = this.game.seat(room, id);
      // A watcher steers nothing, so nobody waits on it and it is not named as lagging.
      if (
        player?.connected &&
        !player.watcher &&
        now - member.lastPacketAt > LAG_INDICATOR_MS &&
        member.lastPacketAt !== -Infinity
      )
        return fill(this.text.lagging, { name: player.name });
    }
    if (
      this.game.seating.sharedScreen(
        this.game.matchSettings
          ? this.game.matchSettings(room)
          : this.game.settings(room),
      ) &&
      !this.full &&
      ![...this.members.values()].some(
        (member) => member.full && now - member.lastPacketAt <= DISCONNECT_MS,
      )
    )
      return this.text.waitingForDisplay;
    return this.text.connected;
  }
  private retrySnapshot(): void {
    const request = this.sync.request!;
    request.failures++;
    if (request.failures >= SNAPSHOT_FAILURES)
      this.status.notice(this.text.couldNotLoad);
    this.requestSnapshot();
  }
  protected sendPackets(now: number): void {
    if (!this.transport || !this.world) return;
    const tick = Math.floor(this.clock.tick());
    this.recorder.sent(tick);
    const entries = this.own().packetEntries();
    // Nothing is sent to a member refused for its rules: a build without the refusal would take this replica's clock
    // and entries for its own room's, so it must see silence and carry on by its own succession instead.
    for (const [id, member] of this.members)
      if (!member.refused) this.sendPacket(id, member, entries, now, tick);
  }
  private sendPacket(
    id: string,
    member: Member,
    entries: Packet<Entry>["entries"],
    now: number,
    tick = Math.floor(this.clock.tick()),
  ): void {
    const hash =
      tick % HASH_INTERVAL === 0 &&
      tick - HASH_LAG <= this.world!.completeTick()
        ? this.world!.hashAt(tick - HASH_LAG)
        : undefined;
    const packet: Packet = {
      room: this.room,
      from: this.id,
      generation: this.generation,
      through: Math.max(this.own().through, tick),
      lastSeq: this.own().lastSeq,
      entries,
      sentAt: wrapMs(now),
      echoSentAt: member.lastSentAt,
      echoHeld: member.lastSentAt
        ? Math.max(0, Math.round(now - member.lastSentReceivedAt)) >>> 0
        : 0,
      clockTick: Math.max(0, this.clock.tick()),
      hash: hash === undefined ? null : [tick - HASH_LAG, hash],
    };
    try {
      this.transport!.sendFast(id, encodePacketTrimmed(packet));
    } catch {
      /* Even a single entry over the cap is a bug in the entry validator, never a crash. */
    }
  }
  /** Consumer failures never abort simulation, peer delivery or the rest of an event batch. */
  private deliver(kind: keyof Callbacks, callback: () => void): boolean {
    try {
      callback();
      return true;
    } catch (error) {
      if (this.options.callbackError) {
        try {
          this.options.callbackError(kind, error);
        } catch (reporterError) {
          console.error(
            `${this.game.id}: ${kind} callback and error reporter failed`,
            error,
            reporterError,
          );
        }
      } else console.error(`${this.game.id}: ${kind} callback failed`, error);
      return false;
    }
  }
  private publish(): void {
    const frame = this.world?.view()[0];
    if (!frame || frame === this.lastFrame) return;
    if (
      this.deliver("state", () =>
        this.callbacks.state(frame, this.game.settings(this.world!.state)),
      )
    )
      this.lastFrame = frame;
  }
  /**
   * What to draw now, for a game's presentation to place in time: the two newest simulated ticks, the fractional tick
   * to show (one log tick behind the clock) and how far the clock is past it, which a game may use to lead its local
   * player. The runtime says when; it does not interpolate or predict.
   *
   * The clock counts log ticks and the frames' `tick` is the game's clock, which a log tick can advance by several
   * steps. The fraction of the way from the older frame's log tick to the newer one's is the
   * same fraction of the way between their game ticks, so a game running several steps per log tick is drawn that
   * many times faster while the clock keeps its one rate.
   */
  frameTiming(): FrameTiming<View> | undefined {
    const frames = this.world?.view();
    const newer = frames?.[0];
    if (!newer) return undefined;
    const older = frames[1],
      clock = this.clock.tick(),
      at = Math.max(
        older?.logTick ?? newer.logTick,
        Math.min(newer.logTick, clock - 1),
      ),
      span = older ? newer.logTick - older.logTick : 0,
      presentation =
        older && span > 0
          ? older.tick +
            ((at - older.logTick) / span) * (newer.tick - older.tick)
          : newer.tick;
    return {
      ...(older ? { older } : {}),
      newer,
      tick: presentation,
      lead: Math.max(0, Math.min(1, clock - at)),
    };
  }
  /**
   * The game's clock (what the frames carry) at the newest log tick every connected member's input is confirmed
   * through, so no rollback can change state up to it.
   */
  confirmedTick(): number {
    return this.world ? this.world.confirmedGameTick() : -1;
  }
  metrics(): RuntimeMetrics {
    const streams = Object.fromEntries(
      [...(this.world?.streams ?? [])].map(([id, stream]) => [
        id,
        {
          generation: stream.generation,
          contiguous: stream.contiguous,
          lastSeq: stream.lastSeq,
          through: stream.through,
          complete: stream.completeThrough(),
          gap: stream.gap,
          base: stream.baseTick,
          rejected: this.members.get(id)?.rejected ?? 0,
        },
      ]),
    );
    const now = this.deps.now();
    return {
      tick: this.tick,
      clockTick: this.clock.tick(),
      rollbacks: this.world?.rollbacks ?? 0,
      rollbackTicks: this.world?.rollbackTicks ?? 0,
      steps: this.world?.steps ?? 0,
      settled: this.world?.settled ?? true,
      rtt: Object.fromEntries(
        [...this.members]
          .filter(([, member]) => member.rttMs !== undefined)
          .map(([id, member]) => [id, member.rttMs!]),
      ),
      heard: Object.fromEntries(
        [...this.members]
          .filter(([, member]) => member.lastPacketAt !== -Infinity)
          .map(([id, member]) => [id, Math.round(now - member.lastPacketAt)]),
      ),
      clock: this.clock.diagnostics(),
      sentBytes: this.transport?.sentBytes ?? 0,
      snapshotRequest: this.sync.requesting,
      mismatches: this.sync.mismatchCount,
      hashChecks: this.sync.hashChecks,
      refused: [...this.members]
        .filter(([, member]) => member.refused)
        .map(([id]) => id)
        .sort(),
      stall: this.world?.stallBound() ?? { tick: Infinity },
      streams,
    };
  }
}
