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
 * Who manages the room when those before them are absent: the creator, then the connected seated humans in seat order,
 * then the connected watchers by id. Seat order is what a player reads off the lobby list, so the room passes to the
 * player in the next seat down rather than to whoever holds the lowest member id; `members()` may yield seats in any
 * order, so the rank is taken from `slot` here rather than trusted from the caller. Watchers rank last because a room
 * with a seat left in it should be managed from that seat, but they do rank: a room whose players all dropped is still
 * run by whoever is left watching.
 */
export function successionOrder(
  seats: Iterable<Seat>,
  creatorId: string,
  /** Rank away members too, as if present: the order in which absence may be recorded (`permitted`). */
  withAway = false,
): string[] {
  const players: Seat[] = [],
    watchers: string[] = [];
  for (const seat of seats)
    if (
      (seat.connected || (withAway && seat.away)) &&
      !seat.bot &&
      seat.id !== creatorId
    )
      if (seat.watcher) watchers.push(seat.id);
      else players.push(seat);
  players.sort(
    (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return [creatorId, ...players.map((seat) => seat.id), ...watchers.sort()];
}
/**
 * Who runs the room for the players: the one name the screens show as HOST, and the one the room commands are gated on.
 * It is the log's own answer — the creator while the room counts it present, otherwise whoever the duties fall to — so
 * every replica names the same member from the same fold.
 *
 * It does not try to be cleverer than the log about a creator the room has no record of, which is a host driving a
 * shared screen from a page that took no seat. There the crown goes to the player in the first seat, beside the
 * creator's own page, which keeps its controls because it knows it is the creator (`RoomRuntime.managing`). That is
 * what the log has always permitted there (`permitted` accepts every management kind from that player, ADR 047 §9),
 * and the alternative is worse: any rule that keeps the crown on an unrecorded creator also keeps it on one that has
 * left, and a room whose crown sits on a member no device answers for cannot be started, rematched or emptied by
 * anyone. A creator that means to hand the room over for good is ADR 047 N5.
 */
export function roomManager(seats: Iterable<Seat>, creatorId: string): string {
  const all = [...seats];
  // Looking at another window is not leaving the room. A creator that stepped away (ADR 047 §12: its page is hidden,
  // so it logged its own `PRESENCE false`) keeps the crown, because the crown is a claim about a person — whose room
  // this is — and an alt-tab says nothing about that. Without this the badge moved to the next rider a second after
  // the host glanced at their mail, and that rider's page grew ROOM SETTINGS, ADD AI and START RACE while the host
  // still had them too: two devices both running one room.
  //
  // The log duties are not the crown and still delegate on the same step away (`actingCreator`, and the `manager`
  // that reads it), because those are a claim about a *page*: a hidden one's world is frozen where it hid, so it
  // cannot seat a joiner or log a departure and something else must. That split is the whole point of this function
  // existing beside `actingCreator`.
  //
  // A creator that is genuinely gone still hands the crown on, because `away` is the member's own mark and only its
  // own entry sets it: when a page really goes, the manager logs `PRESENCE false` *about* it, and that rewrites the
  // fold without the mark (or frees the seat outright in the lobby). So this cannot strand a room on a member no
  // device answers for — the case the paragraph above refuses to risk.
  if (all.some((seat) => seat.id === creatorId && seat.away)) return creatorId;
  return actingCreator(all, creatorId) ?? creatorId;
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
 * delegate that drop together are both marked absent by the next member rather than leaving the room stalled. Any
 * member may log its own presence: `PRESENCE false` about itself while connected steps it away (`Seat.away`), and
 * `PRESENCE true` about itself while away brings it back; nothing else from an away member applies.
 */
export function permitted(
  seats: Iterable<Seat>,
  creatorId: string,
  manager: string,
  entry: LogEntry,
): boolean {
  const all = [...seats],
    own = all.find((seat) => seat.id === manager);
  if (entry[2] === PRESENCE && entry[3] === manager) {
    // Stepping away needs a place in the room, not presence: see the Fuse Riders reducer.
    if (entry[4] === false) return own !== undefined && !own.bot && !own.away;
    if (own?.away) return true;
  }
  // An away member steps back in before anything else it logs applies, the creator included — except the one entry
  // §9 gives every ranked member: the absence of someone ahead of it. Without it, a member whose last peer died
  // unlogged while it was away could neither record that death nor return, and the room stood still (#361 review).
  if (own?.away)
    return (
      entry[2] === PRESENCE &&
      entry[4] === false &&
      ahead(all, creatorId, manager, entry[3] as string)
    );
  if (manager === creatorId) return true;
  const order = successionOrder(all, creatorId),
    rank = order.indexOf(manager);
  if (rank < 0) return false;
  if (entry[2] === PRESENCE && entry[4] === false) {
    const target = order.indexOf(entry[3] as string);
    if (target >= 0 && target < rank) return true;
  }
  return actingCreator(all, creatorId) === manager;
}
/** Whether `manager` ranks behind `target` in the order that ranks away members as if present. */
function ahead(
  seats: readonly Seat[],
  creatorId: string,
  manager: string,
  target: string,
): boolean {
  const order = successionOrder(seats, creatorId, true),
    rank = order.indexOf(manager),
    at = order.indexOf(target);
  return rank > 0 && at >= 0 && at < rank;
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
  /** Logged itself away: `connected` is false, but the seat is kept wherever an absent one would be dropped. */
  away?: boolean;
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
  const order = successionOrder(seats(), creatorId);
  // Everyone else seated or listed is read after the order, for the entries only they may log about themselves: an away
  // member's return, and an absent member's step away (`permitted`).
  const others = seats()
    .filter((seat) => !seat.bot && !order.includes(seat.id))
    .map((seat) => seat.id)
    .sort();
  for (const manager of [...order, ...others]) {
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
      applyManagementEntry(
        room,
        entry as ManagementEntry<Settings>,
        hooks,
        manager,
      );
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
  /** The member whose stream carried the entry: its own `PRESENCE false` is a step away, not a departure. */
  author?: string,
): void {
  const reclaimable = hooks.stage(room) !== "running",
    all = () => [...room.seats.values()],
    slotTaken = (slot: number) =>
      all().some((seat) => !seat.watcher && seat.slot === slot),
    dropAbsent = (watchersOnly: boolean) => {
      for (const seat of all())
        if (!seat.connected && !seat.away && (seat.watcher || !watchersOnly))
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
        delete existing.away;
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
      else {
        seat.connected = false;
        delete seat.away;
      }
      return;
    }
    case PRESENCE: {
      const [, , , id, connected, generation] = entry;
      const seat = room.seats.get(id);
      if (!seat || seat.bot) return;
      seat.connected = connected;
      seat.generation = generation;
      if (id === author && !connected) seat.away = true;
      else delete seat.away;
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
        delete existing.away;
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
