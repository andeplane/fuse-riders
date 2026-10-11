import {
  ACTION,
  BOT,
  PRESENCE,
  SPECTATOR,
  applyManagementTick,
  defaultText,
  isManagementEntry,
  uint32,
  type LifecycleHooks,
  type ManagedRoom,
  type ManagementEntry,
  type RollbackGame,
  type SeatRecord,
  type Stage,
  type StreamEntries,
} from "fuse-netcode";
import {
  BOT_DIFFICULTIES,
  DOWN,
  FIRE,
  LEFT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RIGHT,
  RULES,
  UP,
  createRound,
  step,
  view as roundView,
  type BotDifficulty,
  type RoundResult,
  type RoundState,
  type RoundView,
  type TickEvent,
} from "../engine/index.js";
import { hashPlain } from "./hash.js";
import * as names from "./names.js";

/**
 * Fuse Bombers behind the netcode's `RollbackGame`, shaped like Fuse Choppers. The room keeps the seats, the match
 * (crowns and round results) and the current round; one log tick of 50 ms folds the management entries and each
 * seat's controls, then runs `STEPS_PER_TICK` 60 Hz engine steps (the engine plays the bot seats itself).
 */
export interface Settings {
  /** Round wins that take the match, 1 to `MAX_WINS`. */
  wins: number;
  /** How the room's bots play. */
  difficulty: BotDifficulty;
  /** One shared screen, with phones as controllers. */
  display: boolean;
}
export const MAX_WINS = 9;
export const DEFAULT_SETTINGS: Settings = {
  wins: 3,
  difficulty: "normal",
  display: false,
};
/** The settings a log entry carries, exactly; anything else is refused. */
export function parseSettings(raw: unknown): Settings | undefined {
  if (raw === null || typeof raw !== "object" || Object.keys(raw).length !== 3)
    return;
  const { wins, difficulty, display } = raw as Record<string, unknown>;
  const level = BOT_DIFFICULTIES.find((d) => d === difficulty);
  if (uint32(wins) && wins >= 1 && wins <= MAX_WINS && level)
    if (typeof display === "boolean")
      return { wins, difficulty: level, display };
}

export const PLAY = 0,
  PRESS = 1;
/** A control entry starts `[seq, tick, kind, matchId, round]`: it counts only in the match and round it names. */
type Control<Kind> = [number, number, Kind, string, number];
/** `[…, PLAY, matchId, round, bits]`: a seat's held `UP | DOWN | LEFT | RIGHT` from this tick on. */
export type PlayEntry = [...Control<typeof PLAY>, number];
/**
 * `[…, PRESS, matchId, round, ordinal, offset]`: one fire press, its gesture ordinal (rising along the stream)
 * and the step of the log tick (0 to `STEPS_PER_TICK - 1`) it was pressed on.
 */
export type PressEntry = [...Control<typeof PRESS>, number, number];
export type Entry = ManagementEntry<Settings> | PlayEntry | PressEntry;

export const STEPS_PER_TICK = 3;
export const CAPACITY = MAX_PLAYERS;
export const MAX_WATCHERS = 5;
/** Log ticks (of 50 ms) a round shows its gunships before its first step; then the aftermath, then the scoreboard. */
export const COUNTDOWN_TICKS = 60;
export const OUTRO_TICKS = 40;
export const BETWEEN_TICKS = 100;
const DIRECTIONS = UP | DOWN | LEFT | RIGHT;

export interface RoundRecord {
  round: number;
  /** The round's winner, or "" for a draw. */
  winner: string;
  reason: RoundResult["reason"];
}
export interface Room extends ManagedRoom<Settings> {
  tick: number;
  matchId: string;
  round: number;
  stage: Stage;
  /** The settings the current match plays with, fixed at its start. */
  play: Settings;
  /** Crowns this match, by member id. */
  wins: Record<string, number>;
  results: RoundRecord[];
  /** The match winner once `stage` is "over" ("" when nobody won a round). */
  winner: string;
  /** The log tick the round's first step runs on: its countdown ends there. */
  startAt: number;
  /** The log tick the decided round's aftermath ends on; 0 while it is undecided. */
  endAt: number;
  /** The log tick the next round starts on, while `between`. */
  resumeAt: number;
  /** Who flies each gunship of the round: member ids by castle index. */
  ships: string[];
  /** Each seat's held direction bits, from the latest entry it logged this round. */
  held: Record<string, number>;
  world: RoundState | null;
}

/** The most rounds a match plays: past it the leader wins. */
export const maxRounds = (settings: Settings): number =>
  settings.wins * CAPACITY + 3;

const payloads = {
  name: names.validName,
  avatar: names.isAvatar,
  settings: (value: unknown) => parseSettings(value) !== undefined,
  capacity: CAPACITY,
};
export function isEntry(raw: unknown): raw is Entry {
  if (isManagementEntry(raw, payloads)) {
    if (raw[2] === ACTION) return names.validMatchId(raw[4]);
    const at =
      raw[2] === BOT || raw[2] === SPECTATOR ? 4 : raw[2] <= PRESENCE ? 3 : -1;
    return at < 0 || names.playerKey((raw as unknown[])[at]);
  }
  if (!Array.isArray(raw)) return false;
  const [seq, tick, kind, matchId, round, value, offset] = raw as unknown[];
  const positive = (v: unknown): v is number => uint32(v) && v > 0;
  const scoped =
    positive(seq) &&
    positive(tick) &&
    names.validMatchId(matchId) &&
    uint32(round) &&
    uint32(value);
  if (kind === PLAY) return scoped && raw.length === 6 && value <= DIRECTIONS;
  return (
    kind === PRESS &&
    scoped &&
    raw.length === 7 &&
    positive(value) &&
    uint32(offset) &&
    offset < STEPS_PER_TICK
  );
}

export function createRoom(matchId: string, settings: Settings): Room {
  return {
    tick: 0,
    matchId,
    round: 0,
    stage: "lobby",
    seats: new Map(),
    settings: { ...settings },
    play: { ...settings },
    wins: {},
    results: [],
    winner: "",
    startAt: 0,
    endAt: 0,
    resumeAt: 0,
    ships: [],
    held: {},
    world: null,
  };
}

const seatOrder = (seats: Iterable<SeatRecord>) =>
  [...seats].sort(
    (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
/** Who flies a new round, in slot order: every seat that is here, stepped away or a bot. */
const entrants = (room: Room) =>
  seatOrder(room.seats.values()).filter(
    (seat) => !seat.watcher && (seat.connected || seat.away || seat.bot),
  );

/** A round's seed: FNV-1a over its match id and number. */
export function roundSeed(matchId: string, round: number): number {
  let h = 0x811c9dc5;
  for (const c of `${matchId}:${round}`)
    h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

function startRound(room: Room): void {
  const seats = entrants(room);
  // Fewer than two gunships left (riders went, watchers stayed): back to the lobby, crowns and all cleared.
  if (seats.length < MIN_PLAYERS) return resetMatch(room, room.matchId);
  room.round++;
  room.stage = "running";
  room.held = {};
  room.ships = seats.map((seat) => seat.id);
  room.startAt = room.tick + 1 + COUNTDOWN_TICKS;
  room.endAt = room.resumeAt = 0;
  // The engine plays the bot seats inside `step`, their memory in the round state (so hashed and rolled back with it).
  room.world = createRound({
    seed: roundSeed(room.matchId, room.round),
    playerCount: seats.length,
    bots: seats.flatMap((seat, id) =>
      seat.bot ? [{ id, difficulty: room.play.difficulty }] : [],
    ),
  });
}
/** A new match in the lobby: everything but the seats, the settings and the clock starts afresh. */
function resetMatch(room: Room, matchId: string): void {
  const { tick, seats, settings } = room;
  Object.assign(room, { ...createRoom(matchId, settings), tick, seats });
}

export const lifecycle: LifecycleHooks<Room, Settings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: names.AVATAR,
  start(room, matchId) {
    if (entrants(room).length < MIN_PLAYERS) return;
    resetMatch(room, matchId);
    startRound(room);
  },
  rematch(room, matchId) {
    resetMatch(room, matchId);
    startRound(room);
  },
  lobby: resetMatch,
};

/**
 * Every gunship's input bits for each of the tick's steps, from its seat's entries for this tick, match and round (in
 * the stream generation the seat follows). Directions are held from the latest `PLAY` on (a tap shorter than the tick
 * still counts, on its first step). Each `PRESS` sets `FIRE` on exactly the step it names, once per gesture (ordinals
 * rise along a stream, so a repeat in the tick is ignored): a press shorter than the tick fires on the step it was
 * made, and a held button fires nothing more. A bot or an absent seat holds nothing.
 */
function inputs(
  room: Room,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): number[][] {
  const steps: number[][] = [[], [], []];
  room.ships.forEach((id, ship) => {
    const seat = room.seats.get(id),
      stream = streams.get(id),
      fire = [0, 0, 0];
    let bits = 0,
      tapped = 0,
      ordinal = 0;
    if (seat?.connected && !seat.bot) {
      bits = room.held[id] ?? 0;
      const source =
        stream?.generation === seat.generation
          ? stream
          : stream?.retired?.find((old) => old.generation === seat.generation);
      const mine = (e: Entry): e is PlayEntry | PressEntry =>
        e[2] <= PRESS &&
        e[1] === tick &&
        e[3] === room.matchId &&
        e[4] === room.round;
      for (const entry of (source?.entries ?? [])
        .filter(mine)
        .sort((a, b) => a[0] - b[0]))
        if (entry[2] === PLAY) {
          tapped |= entry[5];
          bits = entry[5];
        } else if (entry[5] > ordinal) {
          ordinal = entry[5];
          fire[entry[6]] = FIRE;
        }
    }
    if (bits) room.held[id] = bits;
    else delete room.held[id];
    steps.forEach((held, k) => {
      held[ship] = bits | fire[k]! | (k === 0 ? tapped : 0);
    });
  });
  return steps;
}

function endRound(room: Room, tick: number): void {
  const result = room.world!.result!,
    { wins, results } = room;
  const winner = result.winner === null ? "" : room.ships[result.winner]!;
  if (winner) wins[winner] = (wins[winner] ?? 0) + 1;
  results.push({ round: room.round, winner, reason: result.reason });
  const crowned = winner !== "" && wins[winner]! >= room.play.wins;
  if (crowned || room.round >= maxRounds(room.play)) {
    // Past the round limit: most crowns, then the latest round won.
    const last = (id: string) => results.map((r) => r.winner).lastIndexOf(id);
    const leader = Object.keys(wins).sort(
      (a, b) => wins[b]! - wins[a]! || last(b) - last(a),
    )[0];
    room.stage = "over";
    room.winner = crowned ? winner : (leader ?? "");
  } else {
    room.stage = "between";
    room.resumeAt = tick + BETWEEN_TICKS;
  }
}

/**
 * One log tick: management first; then, in a round past its countdown, three engine steps on the seats' controls,
 * and once the round is decided its aftermath, then the scoreboard; between rounds, the start of the next. Returns
 * the steps' events.
 */
export function foldTick(
  room: Room,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
): TickEvent[] {
  const tick = room.tick + 1;
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  const world = room.world,
    events: TickEvent[] = [];
  if (room.stage === "running" && world) {
    const held = inputs(room, streams, tick);
    if (tick >= room.startAt) {
      for (const bits of held) events.push(...step(world, bits));
      if (world.result && !room.endAt) room.endAt = tick + OUTRO_TICKS;
      else if (room.endAt && tick >= room.endAt) endRound(room, tick);
    }
  } else if (room.stage === "between" && tick >= room.resumeAt)
    startRound(room);
  room.tick = tick;
  return structuredClone(events); // a `round-over` event shares the round's `result`
}

/**
 * The desync hash: the whole room, so whatever the engine adds to the round state later (bot memory) is covered. The
 * round's `events` are the latest step's output, rebuilt by the next one, not state, so they are left out.
 */
const TRANSIENT = new Set(["events"]);
export const hash = (room: Room): string => hashPlain(room, TRANSIENT);

/**
 * NOT YET A CHECKPOINT. The validated codec is the next pull request (`src/engine/codec.ts`: seats, match and round,
 * the terrain through `encodeGrid`/`decodeGrid`, bounded rockets, gates, crates and ghosts, every field checked). Until
 * then a snapshot carries only its format and `decode` refuses every one, so no device restores a room from a peer,
 * whole or in part: a room plays on the devices that have folded it from its first tick.
 */
const checkpoint = {
  leading: 1,
  encode: (): unknown[] => [0],
  decode: (): Room | undefined => undefined,
};

/** What the screen renders: a copy of the room (a kept frame must not change under the next fold), seats in order. */
export interface View extends Omit<Room, "tick" | "seats" | "world"> {
  /** The game clock: engine steps. */
  tick: number;
  logTick: number;
  seats: SeatRecord[];
  world: RoundView | null;
}
export function view(room: Room): View {
  const { tick, seats, world, ...rest } = structuredClone(room);
  return {
    ...rest,
    tick: tick * STEPS_PER_TICK,
    logTick: tick,
    seats: seatOrder(seats.values()),
    world: world && roundView(world),
  };
}

export const bombersGame: RollbackGame<Room, Entry, View, TickEvent, Settings> =
  {
    id: "fuse-bombers",
    rules: RULES,
    isEntry,
    ordinal: (entry) => (entry[2] === PRESS ? entry[5] : undefined),
    createRoom,
    createTicker: () => foldTick,
    scope: (room) => ({ matchId: room.matchId, round: room.round }),
    clock: (room) => room.tick * STEPS_PER_TICK,
    steps: () => STEPS_PER_TICK,
    maxSteps: STEPS_PER_TICK,
    view,
    hash,
    checkpoint,
    members: (room) => seatOrder(room.seats.values()),
    seat: (room, id) => room.seats.get(id),
    stage: (room) => room.stage,
    settings: (room) => room.settings,
    matchSettings: (room) => room.play,
    seating: {
      capacity: CAPACITY,
      minPlayers: MIN_PLAYERS,
      maxWatchers: MAX_WATCHERS,
      seatName: names.seatName,
      isAvatar: names.isAvatar,
      defaultAvatar: names.AVATAR,
      parseSettings,
      soloSettings: (settings) => ({ ...settings, display: false }),
      sharedScreen: (settings) => settings.display,
      botId(room, pending) {
        // Never an id the match still remembers: a new bot must not inherit a departed one's crowns.
        let n = 1;
        const id = () => `${names.BOT_PREFIX}${n}`;
        while (
          room.seats.has(id()) ||
          pending.has(id()) ||
          Object.hasOwn(room.wins, id()) ||
          room.ships.includes(id())
        )
          n++;
        return id();
      },
      botName: (slot) => names.BOT_NAMES[slot % names.BOT_NAMES.length]!,
      solo: { name: "Pilot", bots: 3 },
    },
    text: defaultText,
  };
