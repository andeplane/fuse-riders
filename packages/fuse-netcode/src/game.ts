/**
 * The contract between a game and the netcode. The netcode owns streams, their order and repair, the shared clock,
 * rollback, event deduplication, snapshot transfer and the desync hash; the game owns its whole room state and folds
 * one log tick of entries into it. Every member is derived from what `games/fuse-riders/src/online/` read from Fuse Riders' engine
 * before the extraction (see `docs/design/multi-game.md`).
 */

/** Every log entry starts with its stream seq (from 1) and the log tick it applies at (from 1); the game owns the rest. */
export type LogEntry = readonly [seq: number, tick: number, ...body: unknown[]];

/** The room state as the netcode sees it: the log tick it has folded through. The game's ticker advances it by exactly one. */
export interface RoomClock {
  tick: number;
}

/** A member's entries for one tick from its current stream, plus any retired (older-generation) streams still replayable, oldest first. */
export interface StreamEntries<Entry extends LogEntry = LogEntry> {
  generation: number;
  entries: readonly Entry[];
  retired?: readonly { generation: number; entries: readonly Entry[] }[];
}

/** One seat as the room runtime reads it: who sits there, whether the log has them connected, and the stream generation their controls follow. */
export interface Seat {
  id: string;
  name: string;
  slot: number;
  connected: boolean;
  bot: boolean;
  /** A member that watches from the room's list: it ranks last in succession, holds no slot and nothing waits on its stream. */
  watcher?: boolean;
  /** The stream generation the seat's controls follow (Fuse Riders: `folds`); absent for a bot or a seat without one. */
  generation?: number;
}

/**
 * Where a room is in its match, for the decisions the runtime makes about seats: `lobby` (a departure frees the seat;
 * start is allowed), `running` (seats are held for absent members), `between` rounds, and `over` (rematch is allowed).
 * Seats can be reclaimed in every stage but `running`.
 */
export type Stage = "lobby" | "running" | "between" | "over";

/**
 * One stateful fold of log tick `room.tick + 1`: it applies the tick's entries, sets `room.tick` to that tick and moves
 * the game's clock by `steps(room)` as read before it. The game keeps whatever it needs across ticks (Fuse Riders: its
 * bot controller) inside the closure.
 */
export type Ticker<Room, Entry extends LogEntry, Event> = (
  room: Room,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
) => Event[];

/** Which entries a stream accepts: shape and bounds, and an optional id that must strictly increase along a stream. */
export interface EntryRules<Entry extends LogEntry> {
  /** The wire boundary: shape and bounds only. Seq, tick order and ordinals are stream properties the netcode checks. */
  isEntry(raw: unknown): raw is Entry;
  /**
   * A per-stream id that must strictly increase across the entries that carry one, and is never reused after a
   * resync (Fuse Riders: the press gesture id). Undefined for entries without one.
   */
  ordinal?(entry: Entry): number | undefined;
}

export interface RollbackGame<
  Room extends RoomClock,
  Entry extends LogEntry,
  View extends { tick: number },
  Event,
  Settings = unknown,
> extends EntryRules<Entry> {
  /** The game id, used in log prefixes (and, later, the room service and the history backend). */
  id: string;
  /** The rules identifier, `<prefix>-<n>`: peers on different rules refuse each other, and `n` says which one is newer. */
  rules: string;
  createRoom(matchId: string, settings: Settings): Room;
  /** A fresh fold; the runtime keeps one per world, across rollbacks. */
  createTicker(): Ticker<Room, Entry, Event>;
  /**
   * Event dedupe and stale-message fencing: an event is emitted once per (matchId, round, log tick, index), by position
   * and not by content. A rollback that changes what the event at a position says does not emit it again, so a screen
   * that must show the corrected outcome reads it from `view`.
   */
  scope(room: Room): { matchId: string; round: number };
  /** The game's own clock, which a log tick may advance by several steps; frames and events are stamped with it. */
  clock(room: Room): number;
  /**
   * Simulation steps the next log tick will run, read off the room as the fold reads it (at least 1, at most
   * `maxSteps`). The runtime paces catch-up and rollback re-runs by steps, not log ticks.
   */
  steps(room: Room): number;
  maxSteps: number;
  /** What the presentation reads. `tick` is the game's clock (`clock(room)`). */
  view(room: Room): View;
  /** 16 hex characters over the whole room state, compared at retained snapshot ticks. */
  hash(room: Room): string;
  /**
   * The room as the snapshot's game fields: plain data MessagePack can carry. `decode` validates every field against
   * the room it describes (including that `tick` is a log tick its clock can belong to) and never returns a partial room.
   */
  checkpoint: {
    /** How many of the fields travel before the streams and the hash; the rest follow the hash. */
    leading: number;
    encode(room: Room): unknown[];
    decode(fields: readonly unknown[], tick: number): Room | undefined;
  };
  /** Seats in the game's own order: the stall rule names the first member it waits for in this order. */
  members(room: Room): Iterable<Seat>;
  seat(room: Room, id: string): Seat | undefined;
  stage(room: Room): Stage;
  /** The room's settings: what the next match starts with, and what `Callbacks.state` hands the screen. */
  settings(room: Room): Settings;
  /** The settings the current match runs with, when a game applies new settings only between matches; defaults to `settings`. */
  matchSettings?(room: Room): Settings;
  /** The room management a game offers through the generic management entries (`management.ts`). */
  seating: Seating<Room, Settings>;
  /** Every line the runtime shows a player. */
  text: RuntimeText;
}

export interface Seating<Room, Settings> {
  /** Seats per room; slots are 0 to capacity − 1. */
  capacity: number;
  /** Places in the watching list beside the seats. */
  maxWatchers: number;
  /** The one normaliser for a requested name: what is logged in a join, or undefined to refuse it. */
  seatName(raw: string): string | undefined;
  isAvatar(value: unknown): value is string;
  defaultAvatar: string;
  parseSettings(raw: unknown): Settings | undefined;
  /** A settings value a solo room may hold (Fuse Riders: always `devices`). */
  soloSettings(settings: Settings): Settings;
  /** Whether the room's settings make it one shared screen with phones as controllers. */
  sharedScreen(settings: Settings): boolean;
  /** A new bot's id, unused in `room` (including ids it remembers from departed seats) and not in `pending`. */
  botId(room: Room, pending: ReadonlySet<string>): string;
  botName(slot: number): string;
  /** A solo room: the fallback seat name and how many bots join before the match starts (at least one: a start needs two seats). */
  solo: { name: string; bots: number };
}

/** Player-facing lines; `{name}`, `{who}` and `{peer}` are filled in by the runtime. `defaultText` has neutral wording. */
export interface RuntimeText {
  solo: string;
  connected: string;
  preparing: string;
  waitingForGame: string;
  /** `{name}` */
  waitingFor: string;
  /** `{name}` */
  lagging: string;
  waitingForDisplay: string;
  /** `{who}` is `recoverFromOne` or `recoverFromAll`; `{peer}` is the transport's explanation. */
  recovering: string;
  recoverFromOne: string;
  recoverFromAll: string;
  /** `{peer}` */
  waitingForHost: string;
  loading: string;
  hostOnly: string;
  invalidSettings: string;
  matchRunning: string;
  needTwo: string;
  rematchLater: string;
  full: string;
  fullWithBots: string;
  botNotFound: string;
  botBetweenRounds: string;
  /** A kick naming a member the room no longer lists. */
  kickGone: string;
  /** A kick naming an AI player, which has its own button. */
  kickBot: string;
  /** A kick of a seated player while a round runs, which the fold would only mark absent. */
  kickBetweenRounds: string;
  /** A kick whose entry landed inside a round after all: the fold kept the seat, so it is worth another try. */
  kickInRound: string;
  /** What the removed device is told. */
  kicked: string;
  stillLoading: string;
  chooseName: string;
  reconnectFirst: string;
  stopWatching: string;
  leaveSeat: string;
  watchersFull: string;
  hostReplaced: string;
  couldNotLoad: string;
  outOfSync: string;
  resyncing: string;
  mismatch: RulesMismatchText;
}

/**
 * What a rules mismatch tells each side. Reloading only helps the page that is behind, so only its lines say "reload this
 * page". `staleRoom` and `replyToNewer` are for the page that is current and stuck. `staleRider` is a passing notice
 * on a page that has nothing to do.
 */
export interface RulesMismatchText {
  stale: string;
  staleRider: string;
  staleRoom: string;
  unknown: string;
  replyToStale: string;
  replyToNewer: string;
  replyToUnknown: string;
}
