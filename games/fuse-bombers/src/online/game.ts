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
  ROUND_REASONS,
  RULES,
  UP,
  createRound,
  decodeRound,
  encodeRound,
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
const SETTING_KEYS = ["difficulty", "display", "wins"];
/** The settings a log entry carries, exactly (these three own keys and no other); anything else is refused. */
export function parseSettings(raw: unknown): Settings | undefined {
  if (raw === null || typeof raw !== "object") return;
  // Key by key: a joined string cannot tell two keys from one that holds a comma.
  const keys = Object.keys(raw);
  if (keys.length !== SETTING_KEYS.length) return;
  if (!SETTING_KEYS.every((key) => keys.includes(key))) return;
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
  // Only what `parseSettings` takes: a stray or out-of-range field would make every checkpoint of the room refused.
  const { wins, difficulty, display } = settings,
    valid = parseSettings({ wins, difficulty, display }) ?? DEFAULT_SETTINGS;
  return {
    tick: 0,
    matchId,
    round: 0,
    stage: "lobby",
    seats: new Map(),
    settings: { ...valid },
    play: { ...valid },
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

/** The match winner once its latest round decides it ("" when nobody won a round); undefined while it plays on. */
function verdict({
  wins,
  results,
  round,
  play,
}: Pick<Room, "wins" | "results" | "round" | "play">): string | undefined {
  const winner = results.at(-1)?.winner ?? "";
  const crowned = winner !== "" && wins[winner]! >= play.wins;
  if (!crowned && round < maxRounds(play)) return;
  // Past the round limit: most crowns, then the latest round won (two crowned members never share one), then the id,
  // so the leader never depends on the order the crowns were recorded in.
  const last = (id: string) => results.map((r) => r.winner).lastIndexOf(id);
  const leader = Object.keys(wins).sort(
    (a, b) =>
      wins[b]! - wins[a]! || last(b) - last(a) || (a < b ? -1 : a > b ? 1 : 0),
  )[0];
  return crowned ? winner : (leader ?? "");
}

function endRound(room: Room, tick: number): void {
  const result = room.world!.result!,
    { wins, results } = room;
  const winner = result.winner === null ? "" : room.ships[result.winner]!;
  if (winner) wins[winner] = (wins[winner] ?? 0) + 1;
  results.push({ round: room.round, winner, reason: result.reason });
  const decided = verdict(room);
  if (decided !== undefined) {
    room.stage = "over";
    room.winner = decided;
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
 * round's own `events` are the latest step's output, rebuilt by the next one, not state, so they alone are left out
 * (an undefined field counts as absent); a field named `events` anywhere else is hashed like any other.
 */
export const hash = (room: Room): string =>
  hashPlain({
    ...room,
    world: room.world && { ...room.world, events: undefined },
  });

// ---- checkpoint ----
const STAGES: readonly Stage[] = ["lobby", "running", "between", "over"];
/** An array of at most `max` items without holes (MessagePack makes none, but `decode` can be handed a value from anywhere). */
const list = (raw: unknown, max: number): raw is unknown[] =>
  Array.isArray(raw) &&
  raw.length <= max &&
  Object.keys(raw).length === raw.length;
// prettier-ignore
const SEAT_KEYS = new Set(["id", "name", "slot", "avatarId", "connected", "bot", "watcher", "generation", "away"]);

/**
 * The room as checkpoint fields: `[matchId, round, stage, settings, play]` before the netcode's streams and hash, then
 * `[seats, results, startAt, ships, held, world]`, the world by `encodeRound`. The crowns, the match winner and the
 * aftermath and scoreboard ticks are not sent: `decode` derives them from the results and the round.
 */
export function encode(room: Room): unknown[] {
  return [
    room.matchId,
    room.round,
    room.stage,
    { ...room.settings },
    { ...room.play },
    [...room.seats.values()].map((seat) => ({ ...seat })),
    room.results.map((r) => [r.round, r.winner, r.reason]),
    room.startAt,
    [...room.ships],
    Object.entries(room.held),
    room.world && encodeRound(room.world),
  ];
}

function decodeSeat(raw: unknown): SeatRecord | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  if (Object.keys(raw).some((key) => !SEAT_KEYS.has(key))) return;
  // prettier-ignore
  const { id, name, slot, avatarId, connected, bot, watcher, generation, away } = raw as Record<string, unknown>;
  if (
    !names.playerKey(id) ||
    !names.validName(name) ||
    typeof connected !== "boolean" ||
    typeof bot !== "boolean" ||
    (watcher !== undefined && watcher !== true) ||
    (away !== undefined && away !== true) ||
    (away === true && connected) ||
    (watcher ? slot !== -1 : !uint32(slot) || slot >= CAPACITY) ||
    (watcher ? avatarId !== "" : !names.isAvatar(avatarId)) ||
    (bot ? generation !== undefined || watcher : !uint32(generation))
  )
    return;
  return {
    id,
    name,
    slot: slot as number,
    avatarId: avatarId as string,
    connected,
    bot,
    ...(watcher ? { watcher: true } : {}),
    ...(generation !== undefined ? { generation: generation as number } : {}),
    ...(away ? { away: true } : {}),
  };
}

/**
 * The room `encode` wrote at log tick `tick`, or undefined: every field checked, and the parts against each other —
 * the stage against the round, the results and the world, the world's seed, seats and bots against the match, and its
 * step count against the countdown and the aftermath. Never a partial room, and never a throw.
 */
export function decode(
  fields: readonly unknown[],
  tick: number,
): Room | undefined {
  if (fields.length !== 11 || !uint32(tick)) return;
  // prettier-ignore
  const [matchId, round, stage, rawSettings, rawPlay, rawSeats, rawResults, startAt, ships, rawHeld, rawWorld] = fields;
  const settings = parseSettings(rawSettings),
    play = parseSettings(rawPlay);
  if (
    !names.validMatchId(matchId) ||
    !uint32(round) ||
    !STAGES.includes(stage as Stage) ||
    !settings ||
    !play ||
    round > maxRounds(play) ||
    !uint32(startAt) ||
    !list(rawSeats, CAPACITY + MAX_WATCHERS) ||
    !list(rawResults, round) ||
    !list(ships, CAPACITY) ||
    !ships.every(names.playerKey) ||
    new Set(ships).size !== ships.length ||
    !list(rawHeld, ships.length)
  )
    return;
  const seats = new Map<string, SeatRecord>();
  for (const raw of rawSeats) {
    const seat = decodeSeat(raw),
      taken = (s: SeatRecord) => !s.watcher && s.slot === seat?.slot;
    if (!seat || seats.has(seat.id)) return;
    if (!seat.watcher && [...seats.values()].some(taken)) return;
    seats.set(seat.id, seat);
  }
  const watchers = [...seats.values()].filter((seat) => seat.watcher);
  if (watchers.length > MAX_WATCHERS) return;
  // Round by round from the first; the crowns are counted from them. A decided match plays no further round, so only
  // the latest result of a match that is over or between rounds may decide it (the checks below say which).
  const results: RoundRecord[] = [],
    wins: Record<string, number> = {};
  for (const [i, raw] of rawResults.entries()) {
    if (!list(raw, 3) || raw.length !== 3) return;
    const [number, winner, reason] = raw;
    const kind = ROUND_REASONS.find((r) => r === reason);
    if (number !== i + 1 || !kind || typeof winner !== "string") return;
    if (winner !== "" && !names.playerKey(winner)) return;
    results.push({ round: i + 1, winner, reason: kind });
    if (winner) wins[winner] = (wins[winner] ?? 0) + 1;
    const latest = i === rawResults.length - 1 && stage !== "running";
    if (!latest && verdict({ wins, results, round: i + 1, play }) !== undefined)
      return;
  }
  // Only the round's gunships hold directions, and only while they hold some.
  const held: Record<string, number> = {};
  for (const pair of rawHeld) {
    if (!list(pair, 2) || pair.length !== 2) return;
    const [id, bits] = pair;
    if (typeof id !== "string" || !ships.includes(id)) return;
    if (Object.hasOwn(held, id) || !uint32(bits) || !bits) return;
    if (bits > DIRECTIONS) return;
    held[id] = bits;
  }
  const world = rawWorld === null ? null : decodeRound(rawWorld);
  if (world === undefined) return;
  const result = world?.result,
    running = stage === "running";
  // The aftermath ends `OUTRO_TICKS` after the log tick whose steps decided the round; the scoreboard follows it.
  const endAt = result
    ? startAt + Math.floor(result.tick / STEPS_PER_TICK) + OUTRO_TICKS
    : 0;
  const resumeAt = stage === "between" ? endAt + BETWEEN_TICKS : 0;
  // prettier-ignore
  const room: Room = { tick, matchId, round, stage: stage as Stage, seats, settings, play, wins, results, winner: "",
    startAt, endAt, resumeAt, ships: [...ships], held, world };
  if (stage === "lobby")
    return round === 0 && startAt === 0 && !world && !ships.length
      ? room
      : undefined;
  const config = world?.config;
  if (!world || !config?.bots) return;
  // The round's seed is the match's; its bots play at the match's level, in the seats that are bots.
  const bots = new Set(config.bots.map((b) => b.id));
  const last = results.at(-1),
    decided = running ? undefined : verdict(room);
  // A round folds three steps a log tick from `startAt` until its aftermath ends (or now, while it runs).
  const stepped = Math.max(0, (running ? tick : endAt) - startAt + 1);
  if (
    round === 0 ||
    world.tick !== stepped * STEPS_PER_TICK ||
    config.seed !== roundSeed(matchId, round) ||
    config.playerCount !== ships.length ||
    config.bots.some((b) => b.difficulty !== play.difficulty) ||
    ships.some((id, i) => seats.has(id) && seats.get(id)!.bot !== bots.has(i))
  )
    return;
  // prettier-ignore
  if (running) // in its countdown, or in play until its aftermath ends
    return results.length === round - 1 && startAt <= tick + COUNTDOWN_TICKS && (!result || endAt > tick)
      ? room : undefined;
  // Between rounds and after the match: the latest result is the world's, and the match goes on, or is won.
  const winner = !result || result.winner === null ? "" : ships[result.winner];
  if (
    !result ||
    results.length !== round ||
    !last ||
    last.winner !== winner ||
    last.reason !== result.reason ||
    endAt > tick ||
    (stage === "between"
      ? decided !== undefined || tick >= room.resumeAt
      : decided === undefined)
  )
    return;
  room.winner = decided ?? "";
  return room;
}

const checkpoint = { leading: 5, encode, decode };

/** What the screen renders: a copy of the room (a kept frame must not change under the next fold), seats in order. */
export interface View extends Omit<Room, "tick" | "seats" | "world"> {
  /** The game clock: engine steps. */
  tick: number;
  logTick: number;
  seats: SeatRecord[];
  world: RoundView | null;
}
type Terrain = RoundState["terrain"];
/** Each live grid's latest copy: carving (the one change a round's grid sees) bumps `version`, and a rollback restores
 * another grid, so frames share one copy (about 200 KB) until a carve instead of copying it every frame. */
const terrainCopies = new WeakMap<Terrain, Terrain>();
function terrainCopy(grid: Terrain): Terrain {
  let copy = terrainCopies.get(grid);
  if (copy?.version !== grid.version)
    terrainCopies.set(grid, (copy = structuredClone(grid)));
  return copy;
}
function roundCopy(world: RoundState): RoundView {
  const { terrain, ...round } = world;
  return roundView({
    ...structuredClone(round),
    terrain: terrainCopy(terrain),
  });
}
export function view(room: Room): View {
  const { tick, seats, world, ...rest } = room;
  return {
    ...structuredClone(rest),
    tick: tick * STEPS_PER_TICK,
    logTick: tick,
    seats: structuredClone(seatOrder(seats.values())),
    world: world && roundCopy(world),
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
