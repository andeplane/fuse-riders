import type { LogEntry, Seat, Stage, StreamEntries } from "./game.js";
import { memberId, uint32 } from "./wire.js";

/**
 * Management entries: the room's seats, presence, settings and match lifecycle, in one wire format every game shares.
 * The creator logs them (or, while it is absent, whoever succeeds it); every replica applies them in succession order
 * at their tick, and only those `permitted` for the stream that carries them. Kinds 10–16; a game's own entries use
 * other kinds. Fuse Riders' engine applies these kinds with its own reducer (`games/fuse-riders/src/engine/apply-tick.ts`, which cannot
 * import this package); a new game can apply them with `applyManagementTick` below.
 */
export const JOIN = 10,
  LEAVE = 11,
  PRESENCE = 12,
  SETTINGS = 13,
  ACTION = 14,
  BOT = 15,
  SPECTATOR = 16;
export type RoomAction = "start" | "rematch" | "lobby";
export const ROOM_ACTIONS: readonly RoomAction[] = [
  "start",
  "rematch",
  "lobby",
];

export type ManagementEntry<Settings = unknown> =
  | [
      seq: number,
      tick: number,
      kind: 10,
      memberId: string,
      name: string,
      slot: number,
      avatarId: string,
      generation: number,
    ]
  | [seq: number, tick: number, kind: 11, memberId: string]
  | [
      seq: number,
      tick: number,
      kind: 12,
      memberId: string,
      connected: boolean,
      generation: number,
    ]
  | [seq: number, tick: number, kind: 13, settings: Settings]
  | [
      seq: number,
      tick: number,
      kind: 14,
      action: RoomAction,
      newMatchId: string,
    ]
  | [
      seq: number,
      tick: number,
      kind: 15,
      action: "add",
      botId: string,
      name: string,
      slot: number,
    ]
  | [seq: number, tick: number, kind: 15, action: "remove", botId: string]
  | [
      seq: number,
      tick: number,
      kind: 16,
      action: "join",
      memberId: string,
      name: string,
      generation: number,
    ]
  | [seq: number, tick: number, kind: 16, action: "leave", memberId: string];

export function isManagementKind(kind: unknown): boolean {
  return typeof kind === "number" && kind >= JOIN && kind <= SPECTATOR;
}

/** What a game says about the payloads management entries carry. */
export interface ManagementPayloads {
  /** A logged name: what every replica's guard accepts (Fuse Riders: `loggedRiderName`). */
  name(value: unknown): boolean;
  avatar(value: unknown): boolean;
  settings(value: unknown): boolean;
  /** Seats per room; a slot is below it. */
  capacity: number;
}
const matchId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64;

/** Shape and bounds of a management entry, seq and tick included: the part of a game's `isEntry` for kinds 10–16. */
export function isManagementEntry<Settings>(
  raw: unknown,
  payloads: ManagementPayloads,
): raw is ManagementEntry<Settings> {
  if (
    !Array.isArray(raw) ||
    raw.length < 3 ||
    raw.length > 8 ||
    !uint32(raw[0]) ||
    raw[0] === 0 ||
    !uint32(raw[1]) ||
    raw[1] === 0
  )
    return false;
  const slot = (value: unknown) => uint32(value) && value < payloads.capacity;
  switch (raw[2]) {
    case JOIN:
      return (
        raw.length === 8 &&
        memberId(raw[3]) &&
        payloads.name(raw[4]) &&
        slot(raw[5]) &&
        payloads.avatar(raw[6]) &&
        uint32(raw[7])
      );
    case LEAVE:
      return raw.length === 4 && memberId(raw[3]);
    case PRESENCE:
      return (
        raw.length === 6 &&
        memberId(raw[3]) &&
        typeof raw[4] === "boolean" &&
        uint32(raw[5])
      );
    case SETTINGS:
      return raw.length === 4 && payloads.settings(raw[3]);
    case ACTION:
      return (
        raw.length === 5 &&
        (ROOM_ACTIONS as readonly unknown[]).includes(raw[3]) &&
        matchId(raw[4])
      );
    case BOT:
      return raw[3] === "add"
        ? raw.length === 7 &&
            memberId(raw[4]) &&
            payloads.name(raw[5]) &&
            slot(raw[6])
        : raw[3] === "remove" && raw.length === 5 && memberId(raw[4]);
    case SPECTATOR:
      return raw[3] === "join"
        ? raw.length === 7 &&
            memberId(raw[4]) &&
            payloads.name(raw[5]) &&
            uint32(raw[6])
        : raw[3] === "leave" && raw.length === 5 && memberId(raw[4]);
    default:
      return false;
  }
}

/**
 * Who manages the room when those before them are absent: the creator, then the connected seated humans by id, then the
 * connected watchers by id. Watchers rank last because a room with a seat left in it should be managed from that seat,
 * but they do rank: a room whose players all dropped is still run by whoever is left watching.
 */
export function successionOrder(
  seats: Iterable<Seat>,
  creatorId: string,
): string[] {
  const players: string[] = [],
    watchers: string[] = [];
  for (const seat of seats)
    if (seat.connected && !seat.bot && seat.id !== creatorId)
      (seat.watcher ? watchers : players).push(seat.id);
  return [creatorId, ...players.sort(), ...watchers.sort()];
}
/**
 * Which non-creator stream may carry management entries right now: the delegate, only while the creator is disconnected.
 * A creator present in a seat or in the watching list keeps the crown; a creator with no record at all (a display host
 * that never took a seat) makes the next member a manager beside it.
 */
export function actingCreator(
  seats: Iterable<Seat>,
  creatorId: string,
): string | undefined {
  const all = [...seats];
  if (all.some((seat) => seat.id === creatorId && seat.connected))
    return undefined;
  return successionOrder(all, creatorId)[1];
}
/**
 * Whether a management entry from `manager` applies: the creator always; the delegate while the creator is absent; and
 * any connected human may record the absence of someone ahead of it in the succession order, so a creator and a
 * delegate that drop together are both marked absent by the next member rather than leaving the room stalled.
 */
export function permitted(
  seats: Iterable<Seat>,
  creatorId: string,
  manager: string,
  entry: LogEntry,
): boolean {
  if (manager === creatorId) return true;
  const all = [...seats],
    order = successionOrder(all, creatorId),
    rank = order.indexOf(manager);
  if (rank < 0) return false;
  if (entry[2] === PRESENCE && entry[4] === false) {
    const target = order.indexOf(entry[3] as string);
    if (target >= 0 && target < rank) return true;
  }
  return actingCreator(all, creatorId) === manager;
}
/** The member a management entry disconnects, if it does: the stall rule may not wait for that member past its tick. */
export function disconnects(entry: LogEntry): string | undefined {
  return (entry[2] === PRESENCE && entry[4] === false) || entry[2] === LEAVE
    ? (entry[3] as string)
    : undefined;
}

/** A seat, or with `watcher` a place in the watching list, as `applyManagementTick` keeps it: plain data, so the room stays cloneable and hashable. */
export interface SeatRecord {
  id: string;
  name: string;
  /** −1 for a watcher. */
  slot: number;
  avatarId: string;
  connected: boolean;
  bot: boolean;
  watcher?: boolean;
  /** The stream generation this seat's own entries are read from; absent for a bot. */
  generation?: number;
}
/** The part of a room `applyManagementTick` manages. */
export interface ManagedRoom<Settings> {
  seats: Map<string, SeatRecord>;
  settings: Settings;
}
/** How the game reacts to the lifecycle entries; each is applied on every replica alike, so none may read anything outside `room`. */
export interface LifecycleHooks<Room, Settings> {
  stage(room: Room): Stage;
  /** Places in the watching list; a join past it is refused on every replica alike. */
  maxWatchers: number;
  parseSettings(raw: unknown): Settings | undefined;
  /** The avatar a bot's seat records; `"robot"` when unset. */
  botAvatar?: string;
  /** `matchId` is the one the creator logged with the start (Fuse Riders keeps the lobby's). */
  start(room: Room, matchId: string): void;
  rematch(room: Room, matchId: string): void;
  lobby(room: Room, matchId: string): void;
}
const seatView = (seat: SeatRecord): Seat => seat;

/**
 * Applies one log tick's management entries in succession order, each only when `permitted`, for a game that keeps its
 * seats in a `ManagedRoom`. An inapplicable entry is a no-op on every replica alike. The semantics are Fuse Riders':
 * a departure frees a seat when seats are reclaimable and otherwise marks it absent; a start or rematch first drops
 * absent seats when seats are reclaimable (whether or not the action then applies), and a return to the lobby drops
 * absent watchers.
 */
export function applyManagementTick<
  Room extends ManagedRoom<Settings>,
  Settings,
>(
  room: Room,
  tick: number,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries>,
  hooks: LifecycleHooks<Room, Settings>,
): void {
  const seats = () => [...room.seats.values()].map(seatView);
  for (const manager of successionOrder(seats(), creatorId)) {
    const stream = streams.get(manager);
    if (!stream) continue;
    // Not gated by generation: a returning creator's new stream must be able to log its own presence.
    for (const entry of [
      ...(stream.retired ?? []).flatMap((old) => old.entries),
      ...stream.entries,
    ]) {
      if (entry[1] !== tick || !isManagementKind(entry[2])) continue;
      // Re-evaluated per entry: the creator's own return revokes the acting creator mid-tick.
      if (!permitted(seats(), creatorId, manager, entry)) continue;
      applyManagementEntry(room, entry as ManagementEntry<Settings>, hooks);
    }
  }
}

export function applyManagementEntry<
  Room extends ManagedRoom<Settings>,
  Settings,
>(
  room: Room,
  entry: ManagementEntry<Settings>,
  hooks: LifecycleHooks<Room, Settings>,
): void {
  const reclaimable = hooks.stage(room) !== "running",
    all = () => [...room.seats.values()],
    slotTaken = (slot: number) =>
      all().some((seat) => !seat.watcher && seat.slot === slot),
    dropAbsent = (watchersOnly: boolean) => {
      for (const seat of all())
        if (!seat.connected && (seat.watcher || !watchersOnly))
          room.seats.delete(seat.id);
    };
  switch (entry[2]) {
    case JOIN: {
      const [, , , id, name, slot, avatarId, generation] = entry;
      const existing = room.seats.get(id);
      // A member is a player or a watcher, never both: it leaves the watching list first.
      if (existing?.watcher) return;
      if (existing) {
        existing.connected = true;
        existing.generation = generation;
        return;
      }
      if (slotTaken(slot)) return;
      room.seats.set(id, {
        id,
        name,
        slot,
        avatarId,
        connected: true,
        bot: false,
        generation,
      });
      return;
    }
    case LEAVE: {
      const seat = room.seats.get(entry[3]);
      if (!seat) return;
      // A watcher holds no seat, so leaving frees its place outright in every stage.
      if (reclaimable || seat.watcher) room.seats.delete(seat.id);
      else seat.connected = false;
      return;
    }
    case PRESENCE: {
      const [, , , id, connected, generation] = entry;
      const seat = room.seats.get(id);
      if (!seat || seat.bot) return;
      seat.connected = connected;
      seat.generation = generation;
      return;
    }
    case SPECTATOR: {
      if (entry[3] === "leave") {
        if (room.seats.get(entry[4])?.watcher) room.seats.delete(entry[4]);
        return;
      }
      const [, , , , id, name, generation] = entry as [
        number,
        number,
        16,
        "join",
        string,
        string,
        number,
      ];
      const existing = room.seats.get(id);
      if (existing?.watcher) {
        existing.connected = true;
        existing.generation = generation;
        return;
      }
      if (
        existing ||
        all().filter((seat) => seat.watcher).length >= hooks.maxWatchers
      )
        return;
      room.seats.set(id, {
        id,
        name,
        slot: -1,
        avatarId: "",
        connected: true,
        bot: false,
        watcher: true,
        generation,
      });
      return;
    }
    case SETTINGS: {
      const settings = hooks.parseSettings(entry[3]);
      if (settings !== undefined) room.settings = settings;
      return;
    }
    case ACTION: {
      const [, , , action, matchId] = entry;
      if (action !== "lobby" && reclaimable) dropAbsent(false);
      if (action === "lobby") {
        hooks.lobby(room, matchId);
        dropAbsent(true);
      } else if (action === "start") {
        if (hooks.stage(room) === "lobby") hooks.start(room, matchId);
      } else if (hooks.stage(room) === "over") hooks.rematch(room, matchId);
      return;
    }
    case BOT: {
      if (entry[3] === "add") {
        const [, , , , id, name, slot] = entry as [
          number,
          number,
          15,
          "add",
          string,
          string,
          number,
        ];
        if (room.seats.has(id) || slotTaken(slot)) return;
        room.seats.set(id, {
          id,
          name,
          slot,
          avatarId: hooks.botAvatar ?? "robot",
          connected: true,
          bot: true,
        });
      } else if (room.seats.get(entry[4])?.bot && reclaimable)
        room.seats.delete(entry[4]);
      return;
    }
  }
}
