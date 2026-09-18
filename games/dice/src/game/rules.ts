import {
  ACTION,
  BOT,
  PRESENCE,
  SPECTATOR,
  applyManagementTick,
  isManagementEntry,
  memberId,
  uint32,
  type LifecycleHooks,
  type ManagedRoom,
  type ManagementEntry,
  type SeatRecord,
  type Stage,
  type StreamEntries,
} from "fuse-netcode";
import {
  CAPACITY,
  MAX_NAME,
  MAX_POINTS,
  MAX_ROUNDS,
  TARGET,
  WINS_NEEDED,
  validName,
} from "./basics.js";
export * from "./basics.js";

/**
 * Pig on the shared log. On your turn you roll a d6 as often as you like, adding each roll to the turn total; a 1 busts
 * (the total is lost and the turn passes) and HOLD banks the total and passes the turn. The first to `TARGET` banked
 * points wins the round and the first to `WINS_NEEDED` round wins takes the match.
 *
 * Everything here is a pure function of the room and the tick's entries, so every replica folds the same room. The
 * dice come from the seeded generator in the room (`rng`): every member can compute the rolls to come, which the trust
 * model allows, since every member is trusted with the shared log.
 */
export const ROLL = 0,
  HOLD = 1;
export type DiceAction = typeof ROLL | typeof HOLD;

export const MAX_WATCHERS = 8;
/** Log ticks are the fixed 50 ms clock: 20 per second. */
export const TICKS_PER_SECOND = 20;
export const MIN_TURN_TICKS = 2 * TICKS_PER_SECOND;
export const MAX_TURN_TICKS = 60 * TICKS_PER_SECOND;
/** Log ticks between a decided round and the next one. */
export const BETWEEN_TICKS = 3 * TICKS_PER_SECOND;
/** Everyone who ever sat in a match, departed seats included. */
export const MAX_PARTICIPANTS = 64;

export interface DiceSettings {
  /** How long a turn waits for its player, in log ticks; running out holds for them. */
  turnTicks: number;
  /** One shared screen with phones as controllers. */
  display: boolean;
}
export const DEFAULT_SETTINGS: DiceSettings = {
  turnTicks: 15 * TICKS_PER_SECOND,
  display: false,
};

/** A player's entry names the turn it is for: it applies only while that turn is the room's current one. */
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: DiceAction,
  turn: number,
];
export type DiceEntry = ManagementEntry<DiceSettings> | PlayEntry;

export interface RosterEntry {
  name: string;
  slot: number;
}
export interface RoundRecord {
  round: number;
  winnerId: string;
  /** The log tick the round was decided at: a device reports the round once its confirmed tick reaches it. */
  tick: number;
  /** Every round player's bank when the round was decided. */
  scores: Record<string, number>;
  /** Seated players taking turns (bots, and humans who were here) when the round was decided; sorted. */
  present: string[];
  /** The humans among `present`: who can report the round, and the match when this round decided it; sorted. */
  finishers: string[];
}

/** One player's play this match, for the result a device reports and the account totals it credits. */
export interface PlayerStats {
  rolls: number;
  holds: number;
  busts: number;
  /** The most banked in one hold. */
  bestTurn: number;
}
export const noStats = (): PlayerStats => ({
  rolls: 0,
  holds: 0,
  busts: 0,
  bestTurn: 0,
});

export interface DiceRoom extends ManagedRoom<DiceSettings> {
  /** The log tick folded through; the game's clock is the same tick (one step per log tick). */
  tick: number;
  matchId: string;
  round: number;
  stage: Stage;
  /**
   * The turn timer this match plays with: `settings.turnTicks` as it was when the match started. A SETTINGS entry
   * changes `settings` at once (the lobby shows it) but a running match keeps its own timer.
   */
  turnTicks: number;
  /** The generator's state (mulberry32), seeded from the match id at start. */
  rng: number;
  /** Turns taken this match; a play entry names the turn it is for. 0 before the first. */
  turnNo: number;
  /** Rolls this match, so two equal rolls in a row still read as two rolls. */
  rolls: number;
  /** The seat whose turn it is, or "" when nobody's. */
  turn: string;
  turnTotal: number;
  /** The log tick at which the current turn holds for its player. */
  deadline: number;
  /** The log tick a bot whose turn it is acts next. */
  nextAct: number;
  lastRoll: number;
  lastRoller: string;
  roundWinner: string;
  winner: string;
  /** Between rounds: the log tick the next round starts. */
  resumeAt: number;
  /** Banked points this round. */
  scores: Record<string, number>;
  /** Round wins this match. */
  wins: Record<string, number>;
  /** Rounds each player finished seated this match. */
  played: Record<string, number>;
  /** Everyone who sat in this match, as they were last seated. */
  roster: Record<string, RosterEntry>;
  history: RoundRecord[];
  /** Each player's play this match, by id: anyone who took a turn. */
  stats: Record<string, PlayerStats>;
}

export type DiceEvent =
  | { type: "roll"; id: string; value: number }
  | { type: "bust"; id: string }
  | { type: "hold"; id: string; banked: number; score: number; auto: boolean }
  | { type: "round"; id: string; round: number }
  | { type: "match"; id: string };

const CONTROL = /[\u0000-\u001f\u007f]/;
/** What a player typed, as it is seated: trimmed and cut to `MAX_NAME` code points, or refused. */
export function seatName(raw: string): string | undefined {
  if (CONTROL.test(raw)) return;
  const name = Array.from(raw.replace(/\p{Cs}/gu, "").trim())
    .slice(0, MAX_NAME)
    .join("")
    .trim();
  return validName(name) ? name : undefined;
}
export const AVATARS = [
  "robot",
  "cat",
  "fox",
  "alien",
  "astronaut",
  "skull",
  "octopus",
  "dragon",
  "owl",
  "slime",
] as const;
export const isAvatar = (value: unknown): value is string =>
  (AVATARS as readonly unknown[]).includes(value);

/** A match id as every replica accepts it, in a logged ACTION entry and in a checkpoint: 1–64 printable ASCII characters. */
export const validMatchId = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7e]{1,64}$/.test(value);

/** A member id that is safe as a record key: never one of `Object.prototype`'s names. */
export const playerKey = (value: unknown): value is string =>
  memberId(value) && !(value in Object.prototype);

export function parseSettings(raw: unknown): DiceSettings | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  const keys = Object.keys(raw);
  const { turnTicks, display } = raw as Partial<DiceSettings>;
  if (
    keys.length !== 2 ||
    !keys.includes("turnTicks") ||
    !keys.includes("display") ||
    !uint32(turnTicks) ||
    turnTicks < MIN_TURN_TICKS ||
    turnTicks > MAX_TURN_TICKS ||
    typeof display !== "boolean"
  )
    return;
  return { turnTicks, display };
}

const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (value: unknown) => parseSettings(value) !== undefined,
  capacity: CAPACITY,
};
/** The wire boundary for every entry: the shared management entries, and ROLL/HOLD naming a turn. */
export function isDiceEntry(raw: unknown): raw is DiceEntry {
  if (isManagementEntry(raw, payloads)) {
    if (raw[2] === ACTION) return validMatchId(raw[4]);
    // Member ids become record keys: one of Object.prototype's names never does.
    const at =
      raw[2] === BOT || raw[2] === SPECTATOR ? 4 : raw[2] <= PRESENCE ? 3 : -1;
    return at < 0 || playerKey((raw as unknown[])[at]);
  }
  return (
    Array.isArray(raw) &&
    raw.length === 4 &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    (raw[2] === ROLL || raw[2] === HOLD) &&
    uint32(raw[3]) &&
    raw[3] > 0
  );
}

/** mulberry32: one step of the room's generator. */
export function nextRandom(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: (t ^ (t >>> 14)) >>> 0, state: next };
}
/** A d6 from the room's generator; advances it. */
export function rollDie(room: DiceRoom): number {
  const { value, state } = nextRandom(room.rng);
  room.rng = state;
  return 1 + Math.floor((value / 0x1_0000_0000) * 6);
}
/** FNV-1a over the match id: the seed every replica derives alike. */
export function seedOf(matchId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < matchId.length; index++)
    hash = Math.imul(hash ^ matchId.charCodeAt(index), 0x01000193) >>> 0;
  return hash;
}

export function createRoom(matchId: string, settings: DiceSettings): DiceRoom {
  return {
    tick: 0,
    matchId,
    round: 1,
    stage: "lobby",
    seats: new Map(),
    settings: { ...settings },
    turnTicks: settings.turnTicks,
    rng: seedOf(matchId),
    turnNo: 0,
    rolls: 0,
    turn: "",
    turnTotal: 0,
    deadline: 0,
    nextAct: 0,
    lastRoll: 0,
    lastRoller: "",
    roundWinner: "",
    winner: "",
    resumeAt: 0,
    scores: {},
    wins: {},
    played: {},
    roster: {},
    history: [],
    stats: {},
  };
}

/** Seated players (no watchers), in slot order: the turn order. */
export function players(room: DiceRoom): SeatRecord[] {
  return [...room.seats.values()]
    .filter((seat) => !seat.watcher)
    .sort((a, b) => a.slot - b.slot);
}
/** A seat that takes its turns: a bot, or a human who is here. */
const active = (seat: SeatRecord) => seat.bot || seat.connected;

/** How long a bot waits before its next entry: 0.6–1.0 s, varied by the turn so it reads as a person pressing. */
export function botDelay(room: DiceRoom): number {
  return 12 + ((room.turnNo * 7 + room.turnTotal) % 9);
}

function beginTurn(room: DiceRoom, id: string, tick: number): void {
  room.turn = id;
  room.turnNo++;
  room.turnTotal = 0;
  room.deadline = tick + room.turnTicks;
  room.nextAct = tick + botDelay(room);
}
/** Pass the turn to the next active seat after the current one, or to the first; nobody's when no seat is active. */
function passTurn(room: DiceRoom, tick: number): void {
  const seats = players(room),
    current = seats.find((seat) => seat.id === room.turn),
    next =
      seats.find(
        (seat) =>
          active(seat) && current !== undefined && seat.slot > current.slot,
      ) ?? seats.find(active);
  if (next) beginTurn(room, next.id, tick);
  else {
    room.turn = "";
    room.turnTotal = 0;
  }
}
function remember(room: DiceRoom): void {
  for (const seat of players(room))
    room.roster[seat.id] = { name: seat.name, slot: seat.slot };
}
function startRound(room: DiceRoom, tick: number): void {
  room.stage = "running";
  room.scores = {};
  room.roundWinner = "";
  room.lastRoll = 0;
  room.lastRoller = "";
  const seats = players(room).filter(active);
  for (const seat of seats) room.scores[seat.id] = 0;
  remember(room);
  // The first turn moves round by round, so nobody always opens.
  const first = seats[(room.round - 1) % Math.max(1, seats.length)];
  if (first) beginTurn(room, first.id, tick);
  else room.turn = "";
}
function resetMatch(room: DiceRoom, matchId: string): void {
  room.matchId = matchId;
  room.turnTicks = room.settings.turnTicks;
  room.round = 1;
  room.rng = seedOf(matchId);
  room.turnNo = 0;
  room.rolls = 0;
  room.turn = "";
  room.turnTotal = 0;
  room.deadline = 0;
  room.nextAct = 0;
  room.lastRoll = 0;
  room.lastRoller = "";
  room.roundWinner = "";
  room.winner = "";
  room.resumeAt = 0;
  room.scores = {};
  room.wins = {};
  room.played = {};
  room.roster = {};
  room.history = [];
  room.stats = {};
}

/** Management hooks; `room.tick + 1` is the tick being folded, since management applies before the fold moves `tick`. */
export const lifecycle: LifecycleHooks<DiceRoom, DiceSettings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: "robot",
  start(room, matchId) {
    resetMatch(room, matchId);
    startRound(room, room.tick + 1);
  },
  rematch(room, matchId) {
    resetMatch(room, matchId);
    startRound(room, room.tick + 1);
  },
  lobby(room, matchId) {
    resetMatch(room, matchId);
    room.stage = "lobby";
  },
};

/** Most round wins, then most points over the decided rounds, then the lower slot, then the lower id. */
function leader(room: DiceRoom): string {
  const points = (id: string) =>
    room.history.reduce((sum, record) => sum + (record.scores[id] ?? 0), 0);
  return Object.keys(room.wins).sort(
    (a, b) =>
      room.wins[b]! - room.wins[a]! ||
      points(b) - points(a) ||
      room.roster[a]!.slot - room.roster[b]!.slot ||
      (a < b ? -1 : 1),
  )[0]!;
}

function endRound(
  room: DiceRoom,
  id: string,
  tick: number,
  events: DiceEvent[],
): void {
  room.wins[id] = (room.wins[id] ?? 0) + 1;
  room.roundWinner = id;
  remember(room);
  for (const seat of players(room))
    if (active(seat) && seat.id in room.scores)
      room.played[seat.id] = (room.played[seat.id] ?? 0) + 1;
  const present = players(room).filter(active);
  room.history.push({
    round: room.round,
    winnerId: id,
    tick,
    scores: { ...room.scores },
    present: present.map((seat) => seat.id).sort(),
    finishers: present
      .filter((seat) => !seat.bot)
      .map((seat) => seat.id)
      .sort(),
  });
  room.turn = "";
  room.turnTotal = 0;
  events.push({ type: "round", id, round: room.round });
  if (room.wins[id]! >= WINS_NEEDED || room.round >= MAX_ROUNDS) {
    const winner = room.wins[id]! >= WINS_NEEDED ? id : leader(room);
    room.stage = "over";
    room.winner = winner;
    events.push({ type: "match", id: winner });
  } else {
    room.stage = "between";
    room.resumeAt = tick + BETWEEN_TICKS;
  }
}

/** One action of the current player, as an entry or the timer applies it. */
export function act(
  room: DiceRoom,
  action: DiceAction,
  tick: number,
  events: DiceEvent[],
  auto = false,
): void {
  const id = room.turn,
    stats = (room.stats[id] ??= noStats());
  if (action === ROLL) {
    const value = rollDie(room);
    room.rolls++;
    stats.rolls++;
    room.lastRoll = value;
    room.lastRoller = id;
    events.push({ type: "roll", id, value });
    if (value === 1) {
      stats.busts++;
      room.turnTotal = 0;
      events.push({ type: "bust", id });
      passTurn(room, tick);
      return;
    }
    room.turnTotal += value;
    // Each roll gives the player the whole timer again to decide.
    room.deadline = tick + room.turnTicks;
    room.nextAct = tick + botDelay(room);
    return;
  }
  const banked = room.turnTotal,
    score = (room.scores[id] ?? 0) + banked;
  room.scores[id] = score;
  stats.holds++;
  stats.bestTurn = Math.max(stats.bestTurn, banked);
  room.turnTotal = 0;
  events.push({ type: "hold", id, banked, score, auto });
  if (score >= TARGET) endRound(room, id, tick, events);
  else passTurn(room, tick);
}

/** A bot holds once its turn total reaches this. */
export const BOT_HOLD_AT = 20;
/**
 * The bot: the entry it logs for the current turn at `tick`, or nothing yet. It holds at `BOT_HOLD_AT` or when the
 * hold would reach `TARGET`, and otherwise rolls, one entry per `botDelay`.
 *
 * A bot logs nothing: `foldTick` asks this function for the bot's entry while folding, as Fuse Riders' bots decide
 * inside the simulation. It reads only the room, so every replica decides the same way at the same tick, and a
 * rollback or a checkpoint recovery replays the bot's play exactly.
 */
export function botEntry(
  room: DiceRoom,
  tick: number,
): [DiceAction, number] | undefined {
  if (room.stage !== "running" || !room.turn || tick < room.nextAct) return;
  const total = room.turnTotal,
    score = room.scores[room.turn] ?? 0;
  const hold = total > 0 && (total >= BOT_HOLD_AT || score + total >= TARGET);
  return [hold ? HOLD : ROLL, room.turnNo];
}

/** The play entries of `seat` at `tick`, from the stream generation its seat follows. */
function playEntries(
  seat: SeatRecord,
  streams: ReadonlyMap<string, StreamEntries<DiceEntry>>,
  tick: number,
): PlayEntry[] {
  const stream = streams.get(seat.id),
    source =
      stream?.generation === seat.generation
        ? stream
        : stream?.retired?.find((old) => old.generation === seat.generation);
  return (source?.entries ?? []).filter(
    (entry): entry is PlayEntry =>
      entry[1] === tick && (entry[2] === ROLL || entry[2] === HOLD),
  );
}

/**
 * One log tick: management first, then the current player's entries (a bot's own), then the turn timer, then the
 * break between rounds. Entries for any turn but the current one, and from anyone but its player, are ignored.
 */
export function foldTick(
  room: DiceRoom,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<DiceEntry>>,
): DiceEvent[] {
  const tick = room.tick + 1,
    events: DiceEvent[] = [];
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  // A seat that joins a running round takes turns in it, so the roster knows it from the tick it sits down.
  if (room.stage === "running") remember(room);
  if (room.stage === "between" && tick >= room.resumeAt) {
    room.round++;
    startRound(room, tick);
  } else if (room.stage === "running") {
    const seat = room.turn ? room.seats.get(room.turn) : undefined;
    if (!seat || seat.watcher) passTurn(room, tick);
    else {
      const turn = room.turnNo;
      const entries: [DiceAction, number][] = seat.bot
        ? [botEntry(room, tick)].filter((entry) => entry !== undefined)
        : seat.connected
          ? playEntries(seat, streams, tick).map((entry) => [
              entry[2],
              entry[3],
            ])
          : [];
      for (const [action, forTurn] of entries) {
        if (room.stage !== "running" || room.turnNo !== turn) break;
        if (forTurn === turn) act(room, action, tick, events);
      }
      if (
        room.stage === "running" &&
        room.turnNo === turn &&
        tick >= room.deadline
      )
        act(room, HOLD, tick, events, true);
    }
  }
  room.tick = tick;
  return events;
}
