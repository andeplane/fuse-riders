import { StatusNotices } from "./status-notices.js";
import { TICK_MS, TickClock } from "./clock.js";
import { World, type Frame } from "./rollback.js";
import { STALL_TICKS } from "./rollback.js";
import { PACKET_ENTRIES } from "./stream.js";
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
  BOT_NAMES,
  MAX_SPECTATORS,
  RULES,
  actingCreator,
  createRoomState,
  memberConnected,
  reclaimable,
  successionOrder,
} from "../engine/apply-tick.js";
import {
  ACTION,
  AVATAR,
  BOT,
  CANCEL,
  JOIN,
  LEAVE,
  PRESENCE,
  PRESS,
  RELEASE,
  SETTINGS,
  SPECTATOR,
  STEER,
} from "../engine/input-log.js";
import { isAvatarId, type AvatarId } from "../shared/avatars.js";
import {
  parseRoomSettings,
  type RoomSettings,
} from "../engine/room-settings.js";
import { botDisplayName, BOT_ID_PREFIX } from "../engine/bot-controller.js";
import { MAX_RIDER_NAME, seatRiderName } from "../engine/rider-name.js";
import type { GameEvent } from "../engine/view.js";
import { uuid } from "../shared/uuid.js";
import type { RoomTransport, TransportEvents } from "fuse-network-fe";

export type RoomCommand =
  | { type: "join"; name: string; avatarId?: AvatarId }
  /** Take a place in the watching list instead of a seat: no inputs, no colour, no score. */
  | { type: "spectate"; name: string }
  | {
      type: "input";
      seq: number;
      left: boolean;
      right: boolean;
      bomb: boolean;
      bombAction?: "press" | "release" | "cancel";
    }
  | { type: "avatar"; avatarId: AvatarId }
  | { type: "action"; action: "start" | "lobby" | "rematch" }
  | { type: "settings"; settings: RoomSettings }
  | { type: "bot"; action: "add" | "remove"; id?: string };
export type { RoomTransport, TransportEvents };
export interface RuntimeDependencies {
  now(): number;
  hidden(): boolean;
  token(): string;
  generation(): number;
  schedule(callback: () => void, intervalMs: number): () => void;
  onVisibilityChange(callback: () => void): () => void;
}
export interface Callbacks {
  state(frame: Frame, settings: RoomSettings): void;
  event(event: GameEvent, matchId: string, round: number, tick: number): void;
  status(text: string): void;
  ready(id: string, host: boolean): void;
  ended?(): void;
}
/** What `presentation()` hands the screen: frames and times, not a finished picture. */
export interface PresentationFrames {
  /** The tick before `newer`, when there is one to interpolate from. */
  older?: Frame;
  newer: Frame;
  /** The fractional tick to show, between the two frames. */
  tick: number;
  /** Present while this device steers a rider: lead it `lead` ticks (0 to 1) past `tick` with the held controls. */
  local?: {
    id: string;
    controls: { left: boolean; right: boolean };
    lead: number;
  };
}
/** What the runtime can report about its own health: per link, per stream and for the fold as a whole. */
export interface RuntimeMetrics {
  tick: number;
  clockTick: number;
  rollbacks: number;
  rollbackTicks: number;
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
interface Member {
  generation: number;
  snapshotServedAt: number;
  lastPacketAt: number;
  lastSentAt: number;
  lastSentReceivedAt: number;
  rttMs?: number;
  full: boolean;
  nackAt: number;
  helloed: boolean;
  clockTick?: number;
  gapSince: number;
  rejected: number;
  /** The peer's hello announced different `RULES`: its stream, joins and snapshots are refused until a matching hello. */
  refused: boolean;
  /** The rules a refused peer announced, so the status can say which side is out of date. */
  rules?: string;
  /** Since when every packet from this member has fallen outside this replica's window; -Infinity once one is taken. */
  windowSince: number;
  /** When this runtime learned of the member's current connection: the start of the wait for a link that never comes up. */
  since: number;
  /** When the link to the member's current connection was first seen usable, so its packets could arrive; -Infinity until then. */
  linkedAt: number;
  presence?: { connected: boolean; tick: number; at: number };
}
/**
 * What a rules mismatch tells each side. Reloading only helps the page that is behind, so only its lines say "reload this
 * page", which the header turns into a reload button. `staleRoom` and `replyToNewer` are for the page that is current
 * and stuck: "start a new room" keeps them on screen verbatim (the boot card would otherwise swap in its network hint)
 * without offering a reload that does nothing. `staleRider` is a passing notice on a page that has nothing to do.
 */
export const RULES_MISMATCH = {
  stale: "This page is out of date — reload this page",
  staleRider: "A rider is on an older game version — they must reload",
  staleRoom:
    "This room is on an older game version — start a new room, or have its riders reload",
  unknown: "A rider is on a different game version — reload this page",
  replyToStale: "This room runs a newer game version — reload this page",
  replyToNewer: "This room is on an older game version — start a new room",
  replyToUnknown: "This room runs a different game version — reload this page",
} as const;
const rulesNumber = (rules: unknown): number | undefined => {
  const match = typeof rules === "string" && /^fuse-p2p-(\d+)$/.exec(rules);
  return match ? Number(match[1]) : undefined;
};
/** Whether a peer announcing `theirs` is ahead of this build, behind it, or not comparable. */
export function rulesAge(theirs: unknown): "newer" | "older" | "unknown" {
  const mine = rulesNumber(RULES),
    other = rulesNumber(theirs);
  if (mine === undefined || other === undefined || mine === other)
    return "unknown";
  return other > mine ? "newer" : "older";
}

export const DISCONNECT_MS = 1000,
  CREATOR_SILENCE_MS = 5000,
  /** How long a member this runtime has never heard is given for its link to come up before that counts as silence. */
  LINK_WAIT_MS = 5000,
  LAG_INDICATOR_MS = 250,
  SNAPSHOT_RETRY_MS = 2000,
  SNAPSHOT_FAILURES = 3,
  JOIN_RETRY_MS = 1000;
export const SNAPSHOT_BUFFER_LIMIT = 4_000_000,
  STALLED_GAP_MS = 1500,
  /** How long a member whose packets all fall outside this replica's window still counts as heard, and is resynced for: several snapshot attempts. */
  WINDOW_GRACE_MS = 10_000,
  SNAPSHOT_SERVE_MS = 500;
export const HASH_INTERVAL = 20,
  HASH_LAG = 40,
  CATCHUP_TICKS = 8,
  BEHIND_TICKS = 400,
  NACK_INTERVAL_MS = 100,
  DIVERGENCE_WINDOW_MS = 60_000,
  DIVERGENCE_LIMIT = 3,
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
export class RoomRuntime {
  readonly transport?: RoomTransport;
  private readonly deps: RuntimeDependencies;
  private readonly status: StatusNotices;
  private readonly clock: TickClock;
  private readonly members = new Map<string, Member>();
  private readonly generation: number;
  private world?: World;
  /** When this runtime first held a world: before that it could judge nobody, so no wait for a link starts earlier. */
  private judgingSince = -Infinity;
  private id = "";
  private hostId = "";
  private room = 0;
  private welcomeAt = -Infinity;
  /** Peers that answered a snapshot request with `noWorld`, and when: an answer older than the retry interval is asked again. */
  private noWorld = new Map<string, number>();
  private held = {
    flags: -1,
    active: 0,
    latest: 0,
  };
  private lastOwnTick = 0;
  private lastPacketTick = -1;
  private lastFrameTick = -1;
  private pendingJoin?: {
    name: string;
    avatarId?: AvatarId;
    /** Whether this asks for the watching list rather than a seat. */
    spectator: boolean;
    sentAt: number;
  };
  private snapshotRequest?: { to: string; at: number; failures: number };
  private assembler?: SnapshotAssembler;
  private mismatches: number[] = [];
  private hashChecks = 0;
  private outOfSync = false;
  private full = true;
  private hiddenState = false;
  private cancelTick?: () => void;
  private cancelVisibility?: () => void;
  constructor(
    readonly code: string,
    private readonly settings: RoomSettings,
    private readonly callbacks: Callbacks,
    private readonly options: RuntimeOptions = {},
  ) {
    this.deps = options.dependencies ?? browserDependencies;
    this.status = new StatusNotices(
      () => this.deps.now(),
      (text) => this.deliver("status", () => callbacks.status(text)),
    );
    this.clock = new TickClock(() => this.deps.now());
    this.generation = this.deps.generation();
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
          this.status.terminal(
            "This host tab was replaced — use the newer tab",
          );
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
  get solo(): boolean {
    return !this.transport;
  }
  get creator(): boolean {
    return this.id !== "" && this.id === this.hostId;
  }
  /** Whether this replica's management entries apply right now: the creator, or the delegate while the creator is logged absent. */
  private get manager(): boolean {
    return (
      this.creator ||
      (this.world !== undefined &&
        actingCreator(this.world.state, this.hostId) === this.id)
    );
  }
  /** Where a joiner sends its join: the creator, or whoever manages while the creator is absent. */
  private managerId(): string {
    return (
      (this.world && actingCreator(this.world.state, this.hostId)) ??
      this.hostId
    );
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
      this.createWorld({
        ...this.settings,
        mode: "devices",
        weights: { ...this.settings.weights },
      });
      this.deliver("ready", () => this.callbacks.ready("solo", true));
      this.status.recurring("Solo · you and four AI riders");
      const name = seatRiderName(this.options.humanName ?? "") ?? "You";
      this.join("solo", name, undefined);
      for (let index = 0; index < 4; index++)
        this.command({ type: "bot", action: "add" });
      this.command({ type: "action", action: "start" });
      this.world!.advance(this.lastOwnTick); // The first frame already seats everyone; the clock catches up within a tick.
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
    this.noWorld.clear();
    if (!this.world)
      this.status.recurring(
        id === hostId
          ? "Connected · preparing the room"
          : "Connected · waiting for the game",
      );
    this.deliver("ready", () => this.callbacks.ready(id, id === hostId));
  }
  private peer(id: string, online: boolean): void {
    if (online) {
      const known = this.members.get(id);
      // The same member on a new connection (a reload the service saw before the old socket closed): the transport has
      // dropped the old link, and the new page cannot be heard before its own link is up. A member never heard gets
      // the whole link wait again, for the connection that can now link.
      if (known) {
        known.linkedAt = -Infinity;
        known.since = this.deps.now();
      } else
        this.members.set(id, {
          generation: 0,
          snapshotServedAt: -Infinity,
          lastPacketAt: -Infinity,
          lastSentAt: 0,
          lastSentReceivedAt: 0,
          full: true,
          nackAt: -Infinity,
          helloed: false,
          gapSince: -Infinity,
          rejected: 0,
          refused: false,
          windowSince: -Infinity,
          since: this.deps.now(),
          linkedAt: -Infinity,
        });
      return;
    }
    this.members.delete(id);
    this.noWorld.delete(id);
    if (this.snapshotRequest?.to === id) this.snapshotRequest = undefined;
    const state = this.world?.state,
      player = state?.game.players.get(id),
      watcher = state?.spectators.get(id);
    if (!this.manager || (!player && !watcher)) return;
    // A watcher holds no seat, so the lobby frees its place outright and a live match keeps it listed but absent, as for a rider.
    if (watcher) {
      if (state!.game.phase === "lobby") this.append(SPECTATOR, "leave", id);
      else if (watcher.connected)
        this.append(PRESENCE, id, false, watcher.generation);
      return;
    }
    // A reload reaches here too: the service retires the old socket before it admits the new page. In the lobby that
    // frees the seat, and the page confirms its name on the join card. Mid-match it is absence, not departure: `LEAVE`
    // frees a seat at once in `roundOver` and `matchOver`, so a reload that landed just after the round ended lost the
    // seat inside that round. Absent riders are pruned when the next round starts, which leaves the page the whole
    // pause to come back, and they are logged present again once heard (`creatorDuties`).
    if (state!.game.phase === "lobby") this.append(LEAVE, id);
    else if (player!.connected)
      this.append(PRESENCE, id, false, state!.folds.get(id)?.generation ?? 0);
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
      rules: RULES,
      world: this.world !== undefined,
    });
    if (!member.helloed) return;
    if (this.needsWorld() && !this.snapshotRequest) this.requestSnapshot(id);
    if (this.pendingJoin && id === this.managerId()) this.sendJoin();
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
    };
    const member = this.members.get(id);
    if (!member) return;
    // A peer on different rules folds the same log into a different world: only a matching hello is heard from it.
    if (member.refused && data.type !== "hello") {
      if (data.type === "join") {
        const age = rulesAge(member.rules);
        this.transport!.send(id, {
          type: "error",
          error:
            age === "older"
              ? RULES_MISMATCH.replyToStale
              : age === "newer"
                ? RULES_MISMATCH.replyToNewer
                : RULES_MISMATCH.replyToUnknown,
        });
      }
      return;
    }
    switch (data.type) {
      case "hello":
        if (data.rules !== RULES) {
          member.refused = true;
          member.rules =
            typeof data.rules === "string" ? data.rules : undefined;
          if (this.snapshotRequest?.to === id) {
            this.snapshotRequest = undefined;
            this.assembler = undefined;
          }
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
        // A peer announcing a world is worth asking again, whatever it answered before.
        if (data.world === true) this.noWorld.delete(id);
        return;
      case "join":
        if (this.manager && typeof data.name === "string") {
          const error =
            data.role === "spectator"
              ? this.spectate(id, data.name)
              : this.join(
                  id,
                  data.name,
                  isAvatarId(data.avatarId) ? data.avatarId : undefined,
                );
          if (error) this.transport!.send(id, { type: "error", error });
        }
        return;
      case "snapshotRequest": {
        // One snapshot per peer per half second: a requester retries on its own timer, so a storm of requests cannot make this replica encode and queue megabytes.
        const now = this.deps.now();
        if (now - member.snapshotServedAt < SNAPSHOT_SERVE_MS) return;
        member.snapshotServedAt = now;
        if (this.world) {
          for (const chunk of encodeSnapshot(this.world, this.room))
            if (!this.transport!.send(id, chunk, SNAPSHOT_BUFFER_LIMIT)) break;
        } else this.transport!.send(id, { type: "noWorld" });
        return;
      }
      case "noWorld":
        this.noWorld.set(id, this.deps.now());
        if (this.snapshotRequest?.to === id) {
          this.snapshotRequest = undefined;
          this.assembler = undefined;
        }
        return;
      case "snapshot":
        this.acceptSnapshotChunk(id, raw);
        return;
      case "error":
        if (typeof data.error === "string")
          this.status.notice(data.error.slice(0, 120));
        return;
      default:
        return;
    }
  }
  private fast(id: string, bytes: Uint8Array): void {
    const decoded = decodePacket(bytes),
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
      // A packet no unmodified client sends is not a sign of life: a rider whose stream cannot be folded is marked
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
    if (result.rollbackTicks > 0) this.lastFrameTick = -1;
    for (const event of result.events)
      this.deliver("event", () =>
        this.callbacks.event(
          event.event,
          event.matchId,
          event.round,
          event.tick,
        ),
      );
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
    if (this.creator) this.ensurePresence(id, member);
  }

  // ---- world lifecycle --------------------------------------------------------------------------------------------
  private needsWorld(): boolean {
    return !this.world && this.id !== "";
  }
  private createWorld(settings: RoomSettings): void {
    this.world = new World(
      createRoomState(this.deps.token(), settings),
      this.hostId,
      this.id,
    );
    this.world.stream(this.id, this.generation);
    // Nobody is seated in a fresh world, and a seat needs a link (`join` travels over it): the anchor is set for one
    // invariant — "since the first world" — not because anything here could be misjudged.
    this.judgingSince = this.deps.now();
    this.clock.start(0);
    this.lastOwnTick = 0;
    this.resetHeld();
    this.status.recurring(
      this.solo
        ? "Solo · you and four AI riders"
        : "Connected · direct game link",
    );
    // Peers that asked while there was nothing to serve re-hear a hello that now announces a world.
    for (const member of this.members.values()) member.helloed = false;
    if (this.pendingJoin) this.sendJoin();
  }
  /**
   * One line for every refused member together, whatever order they arrived in: any of them ahead of this build makes
   * this page the stale one, and reloading it is the thing to do; otherwise an older one is named; otherwise the rules
   * do not compare. `waiting`: this page has no world and nobody compatible to get one from, so the older members are the room.
   */
  private mismatchStatus(waiting = false): string {
    const ages = new Set(
      [...this.members.values()]
        .filter((member) => member.refused)
        .map((member) => rulesAge(member.rules)),
    );
    return ages.has("newer")
      ? RULES_MISMATCH.stale
      : ages.has("older")
        ? waiting
          ? RULES_MISMATCH.staleRoom
          : RULES_MISMATCH.staleRider
        : RULES_MISMATCH.unknown;
  }
  /** Members whose world could be this one: everyone but those refused for announcing different rules. */
  private compatible(): string[] {
    return [...this.members]
      .filter(([, member]) => !member.refused)
      .map(([id]) => id);
  }
  private saidNoWorld(id: string): boolean {
    return (
      this.deps.now() - (this.noWorld.get(id) ?? -Infinity) < SNAPSHOT_RETRY_MS
    );
  }
  private requestSnapshot(preferred?: string): void {
    if (!this.transport) return;
    const all = this.compatible()
        .filter((id) => this.transport!.linked(id))
        .sort(),
      holders = all.filter((id) => !this.saidNoWorld(id));
    const linked = holders.length ? holders : all;
    if (!linked.length) return;
    const authority = this.authority();
    const previous = this.snapshotRequest?.to,
      next = linked[(linked.indexOf(previous ?? "") + 1) % linked.length]!;
    const to =
      preferred && linked.includes(preferred)
        ? preferred
        : authority !== this.id &&
            linked.includes(authority) &&
            previous !== authority
          ? authority
          : next;
    this.snapshotRequest = {
      to,
      at: this.deps.now(),
      failures: this.snapshotRequest?.failures ?? 0,
    };
    this.assembler = new SnapshotAssembler(this.room);
    this.transport.send(to, { type: "snapshotRequest" });
  }
  private acceptSnapshotChunk(id: string, raw: unknown): void {
    if (
      !this.snapshotRequest ||
      this.snapshotRequest.to !== id ||
      !this.assembler
    )
      return;
    const complete = this.assembler.accept(raw);
    if (!complete) return;
    const decoded = decodeSnapshot(complete.bytes, this.room);
    // A snapshot that fails validation is retried on the timer, rotating peers; asking again at once would storm a peer that keeps serving the same bad state.
    if (!decoded) {
      this.snapshotRequest.failures++;
      this.snapshotRequest.at = this.deps.now();
      this.assembler = new SnapshotAssembler(this.room);
      return;
    }
    const tick = decoded.state.tick,
      previous = this.world?.streams.get(this.id);
    if (this.world) this.world.install(decoded.state);
    else {
      this.world = new World(decoded.state, this.hostId, this.id);
      // Not on a resync: a replica that already judged its members keeps the waits it started.
      this.judgingSince = this.deps.now();
    }
    for (const stream of decoded.streams) {
      // My own current stream is rebuilt below with its continuity; my retired generations (the previous page's entries before
      // its presence switched) install like anyone else's, and the own-stream creation then retires them in order.
      if (stream.id === this.id && stream.generation >= this.generation)
        continue;
      const log = this.world.stream(stream.id, stream.generation, {
        seq: stream.seq,
        tick,
        gesture: stream.gesture,
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
        : { seq: 0, tick, gesture: 0 };
    const own = this.world.stream(this.id, this.generation, {
      seq: base.seq,
      tick,
      gesture: base.gesture,
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
    this.lastOwnTick = Math.max(tick + 1, this.lastOwnTick);
    if (!carried.length) this.resetHeld();
    this.lastFrameTick = -1;
    this.lastPacketTick = -1;
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
          : tick + (now - this.snapshotRequest.at) / 2 / TICK_MS,
      );
    }
    this.snapshotRequest = undefined;
    this.assembler = undefined;
    this.noWorld.clear();
    this.status.recurring("Connected · direct game link");
    if (this.pendingJoin) this.sendJoin();
    this.publish();
  }
  private compareHash(tick: number, hash: string, now: number): void {
    if (
      !this.world ||
      tick > this.world.completeTick() ||
      [...this.world.streams.values()].some((stream) => stream.gap)
    )
      return;
    const mine = this.world.hashAt(tick);
    if (mine !== undefined) this.hashChecks++;
    if (mine === undefined || mine === hash) return;
    console.warn(
      `fuse-riders: simulation diverged at tick ${tick}: local ${mine}, authority ${hash}`,
    );
    this.mismatches = this.mismatches.filter(
      (at) => now - at <= DIVERGENCE_WINDOW_MS,
    );
    this.mismatches.push(now);
    if (this.mismatches.length >= DIVERGENCE_LIMIT) {
      this.outOfSync = true;
      this.status.notice("Simulation out of sync — reload this page");
      return;
    }
    this.status.transient("Simulation corrected · resyncing");
    this.requestSnapshot();
  }

  // ---- the creator's management duties -----------------------------------------------------------------------------
  private join(
    from: string,
    rawName: string,
    avatarId: AvatarId | undefined,
  ): string | undefined {
    if (!this.world) return "The room is still loading";
    // The one normaliser: what is logged is a valid rider name every replica's log guard accepts, never half an emoji.
    const name = seatRiderName(rawName);
    if (!name) return `Choose a name (1–${MAX_RIDER_NAME} characters)`;
    const game = this.world.state.game,
      member = from === this.id ? undefined : this.members.get(from);
    const generation = from === this.id ? this.generation : member?.generation;
    if (generation === undefined) return "Reconnect before joining";
    if (this.world.state.spectators.has(from))
      return "Stop watching before taking a seat";
    if (game.players.has(from)) {
      if (from === this.id) this.ensurePresence(from, this.selfMember());
      else this.ensurePresence(from, member!);
      return;
    }
    if (this.pending().ids.has(from)) return;
    const slot = this.claimSlot();
    if (slot < 0) return "Room is full (5 players)";
    this.append(JOIN, from, name, slot, avatarId ?? "fox", generation);
    return;
  }
  /**
   * The other half of `join`: a place in the watching list rather than a seat. A watcher is a named member of the room —
   * it is folded, it survives a reload and it ranks in the succession order — but it steers nothing, so nothing waits on
   * its stream and it never reaches `step`.
   */
  private spectate(from: string, rawName: string): string | undefined {
    if (!this.world) return "The room is still loading";
    const name = seatRiderName(rawName);
    if (!name) return `Choose a name (1–${MAX_RIDER_NAME} characters)`;
    const state = this.world.state,
      member = from === this.id ? undefined : this.members.get(from);
    const generation = from === this.id ? this.generation : member?.generation;
    if (generation === undefined) return "Reconnect before joining";
    if (state.game.players.has(from)) return "Leave your seat before watching";
    if (state.spectators.has(from)) {
      this.ensurePresence(from, from === this.id ? this.selfMember() : member!);
      return;
    }
    const pending = this.pending();
    if (pending.ids.has(from)) return;
    if (state.spectators.size + pending.watchers >= MAX_SPECTATORS)
      return `Room is full (${MAX_SPECTATORS} spectators watching)`;
    this.append(SPECTATOR, "join", from, name, generation);
    return;
  }
  /** Own management entries logged but not yet applied: seats they will take or free when their tick arrives. */
  private pending(): {
    slots: Set<number>;
    freed: Set<string>;
    ids: Set<string>;
    seats: number;
    /** Net watchers this replica has logged but not yet folded, so a sixth is refused before the fifth applies. */
    watchers: number;
  } {
    const slots = new Set<number>(),
      freed = new Set<string>(),
      ids = new Set<string>();
    let seats = 0,
      watchers = 0;
    for (const entry of this.own().entries.values()) {
      if (entry[1] <= this.world!.tick) continue;
      if (entry[2] === JOIN && !this.world!.state.game.players.has(entry[3])) {
        slots.add(entry[5]);
        ids.add(entry[3]);
        seats++;
      } else if (entry[2] === BOT && entry[3] === "add") {
        slots.add(entry[6]);
        ids.add(entry[4]);
        seats++;
      } else if (entry[2] === LEAVE) {
        freed.add(entry[3]);
        seats--;
      } else if (entry[2] === SPECTATOR) {
        if (entry[3] === "join") {
          ids.add(entry[4]);
          watchers++;
        } else watchers--;
      }
    }
    return { slots, freed, ids, seats, watchers };
  }
  /** A free seat, freeing a disconnected rider's seat between rounds first. */
  private claimSlot(): number {
    const game = this.world!.state.game,
      pending = this.pending();
    const taken = new Set([
      ...[...game.players.values()]
        .filter((player) => !pending.freed.has(player.id))
        .map((player) => player.slot),
      ...pending.slots,
    ]);
    const free = [0, 1, 2, 3, 4].find((slot) => !taken.has(slot));
    if (free !== undefined || !reclaimable(game)) return free ?? -1;
    const seat = [...game.players.values()].find(
      (player) => !player.connected && !pending.freed.has(player.id),
    );
    if (!seat) return -1;
    this.append(LEAVE, seat.id);
    return seat.slot;
  }
  private selfMember(): Member {
    return {
      generation: this.generation,
      snapshotServedAt: -Infinity,
      lastPacketAt: this.deps.now(),
      lastSentAt: 0,
      lastSentReceivedAt: 0,
      full: this.full,
      nackAt: 0,
      helloed: true,
      gapSince: -Infinity,
      rejected: 0,
      refused: false,
      windowSince: -Infinity,
      since: -Infinity,
      linkedAt: -Infinity,
    };
  }
  private ensurePresence(id: string, member: Member): void {
    const state = this.world?.state;
    if (!state || (member.generation === 0 && id !== this.id)) return;
    const watcher = state.spectators.get(id);
    if (watcher) {
      if (watcher.connected && watcher.generation === member.generation) return;
      this.logPresence(id, member, true);
      return;
    }
    const player = state.game.players.get(id);
    if (!player) return;
    const fold = state.folds.get(id);
    if (player.connected && fold?.generation === member.generation) return;
    this.logPresence(id, member, true);
  }
  private logPresence(id: string, member: Member, connected: boolean): void {
    const now = this.deps.now(),
      pending = member.presence;
    if (
      pending &&
      pending.connected === connected &&
      (this.world!.tick < pending.tick || now - pending.at < 500)
    )
      return;
    const tick = this.append(PRESENCE, id, connected, member.generation);
    member.presence = { connected, tick, at: now };
  }
  /**
   * Whether `member` has been silent for `ms`, counting only time in which this runtime could have heard it: since its
   * last packet, or since the link to its current connection became usable if that is later. A page that has just
   * loaded has heard nobody, and a page that has just loaded cannot be heard — neither is silence. A member never heard
   * whose link never comes up is given `LINK_WAIT_MS`, counted from when this runtime learned of its connection or from
   * when it first held a world, whichever is later: a page whose own first link or snapshot took five seconds has
   * only then begun to wait for the others. Without this a reloaded creator logged every rider it had not heard YET as
   * absent in its second pass, and a round boundary or lobby reset inside that window took a healthy rider's seat. The
   * link counts once per connection, so a flapping link cannot stand in for packets.
   */
  private silent(member: Member, now: number, ms: number): boolean {
    const from = Math.max(member.lastPacketAt, member.linkedAt);
    return from === -Infinity
      ? now - Math.max(member.since, this.judgingSince) >
          Math.max(ms, LINK_WAIT_MS)
      : now - from > ms;
  }
  private creatorDuties(now: number): void {
    const state = this.world!.state,
      stalled = now - this.lastLoopAt > DISCONNECT_MS / 2;
    const listed = (id: string) =>
      state.game.players.has(id) || state.spectators.has(id);
    for (const [id, member] of this.members) {
      if (!listed(id)) continue;
      const connected = memberConnected(state, id);
      // Present again only on a packet; absent only on silence this runtime could have heard. In between — a link
      // just up and no packet yet — nothing is logged either way.
      const heard = now - member.lastPacketAt <= DISCONNECT_MS;
      // A creator whose own loop just stalled cannot tell silence from its own absence.
      if (connected && !stalled && this.silent(member, now, DISCONNECT_MS))
        this.logPresence(id, member, false);
      else if (!connected && heard) this.ensurePresence(id, member);
    }
    if (listed(this.id) && !memberConnected(state, this.id))
      this.ensurePresence(this.id, this.selfMember());
  }
  /**
   * Succession: the lowest connected rider that is still heard marks absent everyone ahead of it in the succession order
   * (the creator, then the lower-sorted riders) once they have been silent for five seconds, so play continues whoever
   * dropped together. Every replica accepts those entries from any rider ranked behind the one it names.
   */
  private actingCreatorDuties(now: number): void {
    const state = this.world!.state,
      order = successionOrder(state, this.hostId),
      mine = order.indexOf(this.id);
    // No record at all: the service says that member is offline. A record not heard yet gets the same fair chance as above.
    const silent = (id: string) => {
      const member = this.members.get(id);
      return !member || this.silent(member, now, CREATOR_SILENCE_MS);
    };
    // Only a silent creator opens the succession: while it is heard, it alone marks riders absent, on its one-second rule.
    if (mine < 0 || !silent(this.hostId)) return;
    const heard = (id: string) =>
      id === this.id ||
      (this.members.has(id) &&
        now - this.members.get(id)!.lastPacketAt <= DISCONNECT_MS);
    if (order.slice(1).find(heard) !== this.id) return;
    for (const id of order.slice(0, mine)) {
      if (!memberConnected(state, id) || !silent(id)) continue;
      this.logPresence(id, this.members.get(id) ?? this.selfMember(), false);
    }
  }

  // ---- own entries --------------------------------------------------------------------------------------------------
  private own() {
    return this.world!.streams.get(this.id)!;
  }
  private ownTick(): number {
    this.lastOwnTick = Math.max(
      Math.floor(this.clock.tick()) + 1,
      this.lastOwnTick,
    );
    return this.lastOwnTick;
  }
  private append(...body: unknown[]): number {
    const tick = this.ownTick();
    this.own().append(tick, body);
    this.lastPacketTick = -1;
    return tick;
  }
  /** Neutral controls, but gesture ids never restart: the own stream refuses a reused id and so would every peer. */
  private resetHeld(): void {
    this.held = {
      flags: -1,
      active: 0,
      latest: Math.max(
        this.held.latest,
        this.world?.streams.get(this.id)?.latestGesture() ?? 0,
      ),
    };
  }
  private player() {
    return this.world?.state.game.players.get(this.id);
  }
  /** The steer the fold currently holds for a rider: what the benchmark reports as applied motion. */
  heldControls(id: string): { left: boolean; right: boolean } | undefined {
    const fold = this.world?.state.folds.get(id);
    if (!fold) return undefined;
    return { left: (fold.flags & 1) === 1, right: (fold.flags & 2) === 2 };
  }
  command(command: RoomCommand): boolean {
    if (!command || typeof command !== "object") return false;
    if (command.type === "join" || command.type === "spectate") {
      if (this.options.displayOnly) return false;
      this.pendingJoin = {
        name: command.name,
        avatarId: command.type === "join" ? command.avatarId : undefined,
        spectator: command.type === "spectate",
        sentAt: -Infinity,
      };
      if (this.creator || this.solo) return this.sendJoin();
      this.sendJoin();
      return true;
    }
    if (!this.world) {
      this.status.notice("Waiting for the game to load");
      return false;
    }
    if (command.type === "input") return this.input(command);
    if (command.type === "avatar") {
      if (!isAvatarId(command.avatarId) || !this.player()) return false;
      this.append(AVATAR, command.avatarId);
      this.sendPackets(this.deps.now());
      return true;
    }
    if (!this.creator) {
      this.status.notice("Only the host can manage the room");
      return false;
    }
    const game = this.world.state.game;
    if (command.type === "settings") {
      const settings = parseRoomSettings(command.settings);
      if (!settings) {
        this.status.notice("Invalid settings");
        return false;
      }
      this.append(
        SETTINGS,
        this.solo ? { ...settings, mode: "devices" } : settings,
      );
      return true;
    }
    if (command.type === "action") {
      const connected =
        [...game.players.values()].filter((player) => player.connected).length +
        this.pending().seats;
      if (
        command.action === "start" &&
        (game.phase !== "lobby" || connected < 2)
      ) {
        this.status.notice(
          game.phase !== "lobby"
            ? "A match is already running"
            : "Two riders are needed to start",
        );
        return false;
      }
      if (
        command.action === "rematch" &&
        (game.phase !== "matchOver" || connected < 2)
      ) {
        this.status.notice("Rematch is available after the match ends");
        return false;
      }
      if (!["start", "rematch", "lobby"].includes(command.action)) return false;
      this.append(ACTION, command.action, this.deps.token());
      return true;
    }
    if (command.type === "bot") {
      if (command.action === "add") {
        const slot = this.claimSlot();
        if (slot < 0) {
          this.status.notice("Room is full (5 players including AI)");
          return false;
        }
        const pending = this.pending();
        let number = 1;
        while (
          game.leaderboard.has(`${BOT_ID_PREFIX}${number}`) ||
          pending.ids.has(`${BOT_ID_PREFIX}${number}`)
        )
          number++;
        const id = `${BOT_ID_PREFIX}${number}`;
        this.append(BOT, "add", id, botDisplayName(BOT_NAMES[slot]!), slot);
        return true;
      }
      if (
        typeof command.id !== "string" ||
        !this.world.state.bots.has(command.id)
      ) {
        this.status.notice("AI rider not found");
        return false;
      }
      if (!reclaimable(game)) {
        this.status.notice("Remove AI between rounds or return to menu");
        return false;
      }
      this.append(BOT, "remove", command.id);
      return true;
    }
    return false;
  }
  private sendJoin(): boolean {
    const join = this.pendingJoin;
    if (!join) return false;
    join.sentAt = this.deps.now();
    if (this.creator || this.solo) {
      if (!this.world) return true;
      const error = join.spectator
        ? this.spectate(this.id, join.name)
        : this.join(this.id, join.name, join.avatarId);
      if (error) {
        this.status.notice(error);
        this.pendingJoin = undefined;
        return false;
      }
      return true;
    }
    // A manager refused for its rules would only answer with an error this replica drops: the status says what to do.
    if (this.members.get(this.managerId())?.refused) return false;
    return this.transport!.send(this.managerId(), {
      type: "join",
      name: join.name,
      avatarId: join.avatarId,
      ...(join.spectator ? { role: "spectator" } : {}),
    });
  }
  /** Edge-filtered: an unchanged frame produces no entry; each press is a new gesture in the log. */
  private input(command: Extract<RoomCommand, { type: "input" }>): boolean {
    if (!this.player() || this.hiddenState) return false;
    if (this.held.active === 0)
      this.held.latest = Math.max(this.held.latest, this.own().latestGesture());
    const flags = (command.left ? 1 : 0) | (command.right ? 2 : 0);
    if (flags !== this.held.flags) {
      this.append(STEER, flags);
      this.held.flags = flags;
    }
    if (command.bombAction === "press") {
      this.held.active = ++this.held.latest;
      this.append(PRESS, this.held.active);
    }
    if (command.bombAction === "release" && this.held.active) {
      this.append(RELEASE, this.held.active);
      this.held.active = 0;
    }
    if (command.bombAction === "cancel" && this.held.active) {
      this.append(CANCEL, this.held.active);
      this.held.active = 0;
    }
    if (this.lastPacketTick === -1) this.sendPackets(this.deps.now());
    return true;
  }

  // ---- cadence ----------------------------------------------------------------------------------------------------
  private authority(): string {
    if (this.creator || this.members.has(this.hostId)) return this.hostId;
    const now = this.deps.now();
    return [
      this.id,
      ...[...this.members]
        .filter(([, member]) => now - member.lastPacketAt <= CREATOR_SILENCE_MS)
        .map(([id]) => id),
    ].sort()[0]!;
  }
  private visibilityChanged(): void {
    const hidden = this.deps.hidden();
    if (hidden === this.hiddenState) return;
    this.hiddenState = hidden;
    if (hidden) {
      if (this.world && this.player()) {
        if (this.held.flags > 0) {
          this.append(STEER, 0);
          this.held.flags = 0;
        }
        if (this.held.active) {
          this.append(CANCEL, this.held.active);
          this.held.active = 0;
        }
      }
      // Solo freezes the clock, so the released controls are folded in now rather than when the tab returns.
      if (this.solo && this.world) {
        this.world.advance(this.lastOwnTick);
        this.clock.pause();
        this.publish();
      }
      return;
    }
    if (this.solo) this.clock.resume();
    else if (
      this.world &&
      Math.floor(this.clock.tick()) - this.world.tick > BEHIND_TICKS
    )
      this.requestSnapshot();
  }
  private lastLoopAt = -Infinity;
  private tickLoop(): void {
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
      const candidates = this.compatible();
      if (
        !this.snapshotRequest &&
        candidates.some(
          (id) => this.transport!.linked(id) && !this.saidNoWorld(id),
        )
      )
        this.requestSnapshot();
      if (this.creator && this.transport && !this.snapshotRequest) {
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
            `Recovering the room from ${linked.length ? "a rider" : "the riders"} — ${this.transport.explain(candidates.sort()[0]!)}`,
          );
      }
      if (
        this.snapshotRequest &&
        now - this.snapshotRequest.at > SNAPSHOT_RETRY_MS
      )
        this.retrySnapshot();
      else if (
        !this.snapshotRequest &&
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
            : `Waiting for the game — ${this.transport!.explain(this.hostId)}`,
        );
      }
      if (this.pendingJoin && now - this.pendingJoin.sentAt > JOIN_RETRY_MS)
        this.sendJoin();
      return;
    }
    const world = this.world!;
    const tick = Math.floor(this.clock.tick());
    if (
      this.snapshotRequest &&
      now - this.snapshotRequest.at > SNAPSHOT_RETRY_MS
    )
      this.retrySnapshot();
    this.own().through = Math.max(this.own().through, tick);
    if (!this.hiddenState && tick > world.tick) {
      // Only ticks the stall rule lets us reach count as a backlog: a world waiting on a rider is not behind, and a
      // long stall must end by catching up, never by fetching a snapshot from a peer that waited just as long.
      const reachable = Math.min(tick, world.stallBound().tick);
      if (
        this.transport &&
        reachable - world.tick > BEHIND_TICKS &&
        this.members.size > 0
      ) {
        if (!this.snapshotRequest) this.requestSnapshot();
      } else {
        const result = world.advance(
          Math.min(tick, world.tick + CATCHUP_TICKS),
        );
        for (const event of result.events)
          this.deliver("event", () =>
            this.callbacks.event(
              event.event,
              event.matchId,
              event.round,
              event.tick,
            ),
          );
        if (result.waitingFor !== undefined) {
          this.status.recurring(`Waiting for ${result.waitingFor}`);
        } else if (!this.outOfSync)
          this.status.recurring(
            this.solo ? "Solo · you and four AI riders" : this.lagging(now),
          );
      }
    }
    if (this.transport) {
      if (this.manager) this.creatorDuties(now);
      if (!this.creator) this.actingCreatorDuties(now);
      this.lastLoopAt = now;
      const player = this.player();
      if (player && !player.connected && this.held.flags !== -1)
        this.resetHeld();
      if (this.pendingJoin) {
        const admitted = this.pendingJoin.spectator
          ? world.state.spectators.get(this.id)?.connected === true
          : player?.connected === true;
        if (admitted) this.pendingJoin = undefined;
        else if (now - this.pendingJoin.sentAt > JOIN_RETRY_MS) this.sendJoin();
      }
      const full =
        this.options.displayOnly === true ||
        world.state.settings.mode !== "shared" ||
        !player;
      if (full !== this.full) {
        this.full = full;
        for (const [id, member] of this.members) {
          member.helloed = false;
          this.greet(id, member);
        }
      }
      if (tick !== this.lastPacketTick) this.sendPackets(now);
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
        else if (now - member.gapSince > pace && !this.snapshotRequest) {
          this.requestSnapshot();
          // Only a request that went out uses up the wait: with no link fit to carry one, the next tick tries again.
          if (this.snapshotRequest) member.gapSince = now;
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
    const game = this.world!.state.game;
    for (const [id, member] of this.members) {
      const player = game.players.get(id);
      if (
        player?.connected &&
        now - member.lastPacketAt > LAG_INDICATOR_MS &&
        member.lastPacketAt !== -Infinity
      )
        return `Connected · ${player.name} lagging`;
    }
    if (
      game.settings.mode === "shared" &&
      !this.full &&
      ![...this.members.values()].some(
        (member) => member.full && now - member.lastPacketAt <= DISCONNECT_MS,
      )
    )
      return "Waiting for a display";
    return "Connected · direct game link";
  }
  private retrySnapshot(): void {
    const request = this.snapshotRequest!;
    request.failures++;
    if (request.failures >= SNAPSHOT_FAILURES)
      this.status.notice("Could not load the game — reload this page");
    this.requestSnapshot();
  }
  private sendPackets(now: number): void {
    if (!this.transport || !this.world) return;
    const tick = Math.floor(this.clock.tick());
    this.lastPacketTick = tick;
    const entries = this.own().packetEntries();
    // Nothing is sent to a member refused for its rules: a build without the refusal would take this replica's clock
    // and entries for its own room's, so it must see silence and carry on by its own succession instead.
    for (const [id, member] of this.members)
      if (!member.refused) this.sendPacket(id, member, entries, now, tick);
  }
  private sendPacket(
    id: string,
    member: Member,
    entries: Packet["entries"],
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
            `fuse-riders: ${kind} callback and error reporter failed`,
            error,
            reporterError,
          );
        }
      } else console.error(`fuse-riders: ${kind} callback failed`, error);
      return false;
    }
  }
  private publish(): void {
    const frame = this.world?.view()[0];
    if (!frame || frame.tick === this.lastFrameTick) return;
    if (
      this.deliver("state", () =>
        this.callbacks.state(frame, this.world!.state.settings),
      )
    )
      this.lastFrameTick = frame.tick;
  }
  /**
   * What to draw now, for presentation to place in time (`presentWorld` in `src/render/time/`): the two newest
   * simulated ticks, the fractional tick to show (one log tick behind the clock) and how far to lead the local rider
   * with the controls it holds. The runtime says when; it does not interpolate or predict.
   *
   * The clock counts log ticks and the frames' `tick` is the game's clock, which a log tick can advance by several
   * steps (`driveGameTick`). The fraction of the way from the older frame's log tick to the newer one's is the
   * same fraction of the way between their game ticks, so a game running several steps per log tick is drawn that
   * many times faster while the clock keeps its one rate.
   */
  presentation(): PresentationFrames | undefined {
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
    const player = this.player(),
      controls = {
        left: (this.held.flags & 1) === 1,
        right: (this.held.flags & 2) === 2,
      };
    return {
      ...(older ? { older } : {}),
      newer,
      tick: presentation,
      ...(player && this.held.flags >= 0
        ? {
            local: {
              id: this.id,
              controls,
              lead: Math.max(0, Math.min(1, clock - at)),
            },
          }
        : {}),
    };
  }
  /**
   * The game's clock (`GameState.tick`, what `DecidedRound.tick` and the frames carry) at the newest log tick every
   * connected rider's input is confirmed through, so no rollback can change state up to it.
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
      snapshotRequest: this.snapshotRequest !== undefined,
      mismatches: this.mismatches.length,
      hashChecks: this.hashChecks,
      refused: [...this.members]
        .filter(([, member]) => member.refused)
        .map(([id]) => id)
        .sort(),
      stall: this.world?.stallBound() ?? { tick: Infinity },
      streams,
    };
  }
}
