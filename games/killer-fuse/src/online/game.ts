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
  BOT_LEVEL_ORDER,
  INPUT_DOWN,
  INPUT_HELD,
  INPUT_LEFT,
  INPUT_RIGHT,
  LESSONS,
  MAP_IDS,
  MAX_PLAYERS,
  RULES,
  createRound,
  isMapId,
  teamOf,
  unpackInput,
  viewOf,
  stepRound,
  type BotLevel,
  type GameEvent,
  type Input,
  type Lesson,
  type MapId,
  type Round,
  type RoundView,
  type VictoryKind,
} from "../engine/index.js";
import { MAX_COUNT, MAX_GAMES, MAX_WINS } from "./basics.js";
import { hashPlain } from "./hash.js";
import * as names from "./names.js";
import { VICTORIES, decodeWorld, encodeWorld } from "./world.js";

/**
 * Killer Fuse behind the netcode's `RollbackGame`. The room keeps the seats, the set (games won per team and each
 * game's record) and the current game; one log tick of 50 ms folds the management entries, the seat choices and each
 * seated player's controls, then runs `STEPS_PER_TICK` 60 Hz engine steps.
 *
 * Only people hold seats. A slot nobody sits in, or whose player is away or disconnected, is played by the engine's
 * bot for as long as that lasts: the fold sets the round's `humans` from the seats before every tick's steps, so a
 * player who joins, drops or returns takes or hands over their unit on that tick, on every replica alike.
 */
export interface Settings {
  /** How the bots that fill the free slots play. */
  botLevel: BotLevel;
  /** The map every game of the set is played on, or 0 to rotate through them. */
  map: 0 | MapId;
  /** Games a team must win to take the set, 1 to `MAX_WINS`. */
  wins: number;
  /** One shared screen, with phones as controllers. */
  display: boolean;
  /** Tutorial rooms: the bots stand still and never attack. */
  passive: boolean;
  /** Tutorial rooms: the lesson every game of the set is set up for (see the engine's `Lesson`), or "" for none. */
  lesson: "" | Lesson;
  /** Tutorial rooms: every game counts down `QUICK_COUNTDOWN_TICKS` instead of the usual 8 s or 3 s. */
  quick: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  botLevel: "medium",
  map: 0,
  wins: 2,
  display: false,
  passive: false,
  lesson: "",
  quick: false,
};
const SETTING_KEYS = [
  "botLevel",
  "display",
  "lesson",
  "map",
  "passive",
  "quick",
  "wins",
];
/** The settings a log entry carries, exactly (these seven own keys and no other); anything else is refused. */
export function parseSettings(raw: unknown): Settings | undefined {
  if (raw === null || typeof raw !== "object") return;
  // Key by key: a joined string cannot tell two keys from one that holds a comma.
  const keys = Object.keys(raw);
  if (keys.length !== SETTING_KEYS.length) return;
  if (!SETTING_KEYS.every((key) => keys.includes(key))) return;
  const { botLevel, map, wins, display, passive, lesson, quick } =
    raw as Record<string, unknown>;
  const level = BOT_LEVEL_ORDER.find((known) => known === botLevel);
  if (!level || typeof display !== "boolean") return;
  if (!uint32(wins) || wins < 1 || wins > MAX_WINS) return;
  if (map !== 0 && !isMapId(map)) return;
  if (typeof passive !== "boolean" || typeof quick !== "boolean") return;
  const known = lesson === "" ? "" : LESSONS.find((id) => id === lesson);
  if (known === undefined) return;
  return {
    botLevel: level,
    map,
    wins,
    display,
    passive,
    lesson: known,
    quick,
  };
}

export const PLAY = 0,
  PRESS = 1,
  SEAT = 2,
  ATTACK = 3;
/** A control entry starts `[seq, tick, kind, matchId, round]`: it counts only in the match and game it names. */
type Control<Kind> = [number, number, Kind, string, number];
/** `[…, PLAY, matchId, round, bits]`: a seat's held `LEFT | RIGHT | DOWN | HELD` (the engine's input bits) from this tick on. */
export type PlayEntry = [...Control<typeof PLAY>, number];
/**
 * `[…, PRESS, matchId, round, ordinal, offset]`: one press of the button, its gesture ordinal (rising along the
 * stream) and the step of the log tick (0 to `STEPS_PER_TICK - 1`) it was pressed on.
 */
export type PressEntry = [...Control<typeof PRESS>, number, number];
/**
 * `[…, ATTACK, matchId, round, ordinal, offset]`: one press of the attack button, carried the way `PRESS` is and
 * counted in the same run of gesture ordinals.
 */
export type AttackEntry = [...Control<typeof ATTACK>, number, number];
/** `[seq, tick, SEAT, slot]`: the seated member who logs it asks for that slot, outside a running game. */
export type SeatEntry = [number, number, typeof SEAT, number];
export type Entry =
  ManagementEntry<Settings> | PlayEntry | PressEntry | AttackEntry | SeatEntry;

export const STEPS_PER_TICK = 3;
export const CAPACITY = MAX_PLAYERS;
export const MAX_WATCHERS = 6;
/** Log ticks (of 50 ms) a game shows its arena before its first step; then the victory, then the pause between games. */
export const COUNTDOWN_TICKS = 60;
/** The first game of a set counts down 8 s, by design, while the card shows the three ways to win. */
export const FIRST_COUNTDOWN_TICKS = 160;
/** A room with the `quick` setting counts every game down for one second. */
export const QUICK_COUNTDOWN_TICKS = 20;
export const countdownTicks = (round: number, quick = false): number =>
  quick
    ? QUICK_COUNTDOWN_TICKS
    : round === 1
      ? FIRST_COUNTDOWN_TICKS
      : COUNTDOWN_TICKS;
/** What the engine needs of the settings to make game `round` of a set: the same on every replica and in a checkpoint. */
export const roundOptions = (
  play: Settings,
  matchId: string,
  round: number,
): {
  seed: number;
  mapId: MapId;
  botLevel: BotLevel;
  passive: boolean;
  lesson?: Lesson;
} => ({
  seed: roundSeed(matchId, round),
  mapId: mapFor(play, matchId, round),
  botLevel: play.botLevel,
  passive: play.passive,
  ...(play.lesson === "" ? {} : { lesson: play.lesson }),
});
export const OUTRO_TICKS = 60;
export const BETWEEN_TICKS = 100;
/** What a `PLAY` entry may hold; the press edges travel as `PRESS` and `ATTACK`. */
export const HELD_BITS = INPUT_LEFT | INPUT_RIGHT | INPUT_DOWN | INPUT_HELD;

/** One decided game of the set, frozen at the tick it was decided on. */
export interface GameRecord {
  round: number;
  mapId: MapId;
  /** The winning team and how it won. */
  team: number;
  kind: VictoryKind;
  /** Engine steps the game took. */
  steps: number;
  /** The log tick it was recorded on: a report waits until that tick is confirmed. */
  tick: number;
  /** Who sat in each slot, "" where a bot played. */
  crew: string[];
  /** The seated members who were connected, sorted. */
  present: string[];
}
/** One member's play over the set. */
export interface Stats {
  games: number;
  gameWins: number;
  kills: number;
  deaths: number;
  berries: number;
}
export const noStats = (): Stats => ({
  games: 0,
  gameWins: 0,
  kills: 0,
  deaths: 0,
  berries: 0,
});
const STAT_KEYS = ["games", "gameWins", "kills", "deaths", "berries"] as const;

export interface Room extends ManagedRoom<Settings> {
  tick: number;
  matchId: string;
  /** The game of the set being played, from 1; 0 in the lobby. */
  round: number;
  stage: Stage;
  /** The settings the current set plays with, fixed at its start. */
  play: Settings;
  /** Games won this set, per team. */
  score: number[];
  results: GameRecord[];
  /** The team that took the set once `stage` is "over", else -1. */
  winner: number;
  /** The log tick the game's first step runs on: its countdown ends there. */
  startAt: number;
  /** The log tick the decided game's victory screen ends on; 0 while it is undecided. */
  endAt: number;
  /** The log tick the next game starts on, while `between`. */
  resumeAt: number;
  /** Each playing member's held bits, from the latest entry it logged this game. */
  held: Record<string, number>;
  /** Seat swaps asked for and not yet answered: member id to the occupied slot it wants. */
  asks: Record<string, number>;
  /** Everyone who sat through the end of a game this set: the name and slot they last had. */
  roster: Record<string, { name: string; slot: number }>;
  stats: Record<string, Stats>;
  world: Round | null;
  /** What the latest log tick's steps did, in order. Output, not state: neither hashed nor checkpointed. */
  events: GameEvent[];
}

const payloads = {
  name: names.validName,
  avatar: names.isAvatar,
  settings: (value: unknown) => parseSettings(value) !== undefined,
  capacity: CAPACITY,
};
export function isEntry(raw: unknown): raw is Entry {
  if (isManagementEntry(raw, payloads)) {
    // No bot holds a seat here: the engine plays every slot without a person.
    if (raw[2] === BOT) return false;
    if (raw[2] === ACTION) return names.validMatchId(raw[4]);
    const at = raw[2] === SPECTATOR ? 4 : raw[2] <= PRESENCE ? 3 : -1;
    return at < 0 || names.playerKey((raw as unknown[])[at]);
  }
  if (!Array.isArray(raw)) return false;
  const [seq, tick, kind, matchId, round, value, offset] = raw as unknown[];
  const positive = (v: unknown): v is number => uint32(v) && v > 0;
  if (!positive(seq) || !positive(tick)) return false;
  if (kind === SEAT)
    return raw.length === 4 && uint32(matchId) && matchId < CAPACITY;
  const scoped = names.validMatchId(matchId) && uint32(round) && uint32(value);
  if (kind === PLAY) return scoped && raw.length === 6 && value <= HELD_BITS;
  return (
    (kind === PRESS || kind === ATTACK) &&
    scoped &&
    raw.length === 7 &&
    positive(value) &&
    uint32(offset) &&
    offset < STEPS_PER_TICK
  );
}

export function createRoom(matchId: string, settings: Settings): Room {
  // Only what `parseSettings` takes: a stray or out-of-range field would make every checkpoint of the room refused.
  const { botLevel, map, wins, display, passive, lesson, quick } = settings,
    valid =
      parseSettings({ botLevel, map, wins, display, passive, lesson, quick }) ??
      DEFAULT_SETTINGS;
  return {
    tick: 0,
    matchId,
    round: 0,
    stage: "lobby",
    seats: new Map(),
    settings: { ...valid },
    play: { ...valid },
    score: [0, 0],
    results: [],
    winner: -1,
    startAt: 0,
    endAt: 0,
    resumeAt: 0,
    held: {},
    asks: {},
    roster: {},
    stats: {},
    world: null,
    events: [],
  };
}

const seatOrder = (seats: Iterable<SeatRecord>) =>
  [...seats].sort(
    (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
/** The member seated in each slot, "" where nobody sits; with `connected`, only those here to play. */
function crewOf(seats: Iterable<SeatRecord>, connected: boolean): string[] {
  const crew = Array.from({ length: CAPACITY }, () => "");
  for (const seat of seats)
    if (!seat.watcher && (!connected || seat.connected))
      crew[seat.slot] = seat.id;
  return crew;
}
/** Who sits in each slot, present or not. */
export const seated = (room: Pick<Room, "seats">): string[] =>
  crewOf(room.seats.values(), false);
/** Who plays each slot right now: the connected seats. Every other slot is the bot's. */
export const pilots = (room: Pick<Room, "seats">): string[] =>
  crewOf(room.seats.values(), true);

/** A game's seed: FNV-1a over its match id and number. */
export function roundSeed(matchId: string, round: number): number {
  let h = 0x811c9dc5;
  for (const c of `${matchId}:${round}`)
    h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return h >>> 0;
}
/** The map game `round` of the set is played on: the chosen one, or a rotation that starts where the match id says. */
export const mapFor = (play: Settings, matchId: string, round: number): MapId =>
  play.map || MAP_IDS[(roundSeed(matchId, 0) + round - 1) % MAP_IDS.length]!;

function startGame(room: Room): void {
  room.round++;
  room.stage = "running";
  room.held = {};
  room.asks = {};
  room.startAt = room.tick + 1 + countdownTicks(room.round, room.play.quick);
  room.endAt = room.resumeAt = 0;
  room.world = createRound({
    ...roundOptions(room.play, room.matchId, room.round),
    humans: pilots(room).map((id) => id !== ""),
  });
}
/** A new set in the lobby: everything but the seats, the settings and the clock starts afresh. */
function resetMatch(room: Room, matchId: string): void {
  const { tick, seats, settings } = room;
  Object.assign(room, { ...createRoom(matchId, settings), tick, seats });
}
function startMatch(room: Room, matchId: string): void {
  // A set needs somebody to play it; a room of watchers stays in the lobby.
  if (!seated(room).some((id) => id !== "")) return;
  resetMatch(room, matchId);
  startGame(room);
}

export const lifecycle: LifecycleHooks<Room, Settings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: names.AVATAR,
  start: startMatch,
  rematch: startMatch,
  lobby: resetMatch,
};

/** The stream a seat's own entries are read from: the generation the seat follows, current or retired. */
function sourceOf(
  seat: SeatRecord,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
): readonly Entry[] {
  const stream = streams.get(seat.id);
  const source =
    stream?.generation === seat.generation
      ? stream
      : stream?.retired?.find((old) => old.generation === seat.generation);
  return source?.entries ?? [];
}

/**
 * Seat choices, outside a running game. A seated member asking for a free slot moves there. Asking for a slot another
 * member holds records the wish; the two swap as soon as the other asks for this member's slot in return. Asking for
 * the slot already held withdraws a wish. Wishes that can no longer come true (a seat left, a slot emptied) are
 * dropped, so the lobby never shows a stale one.
 */
function applySeats(
  room: Room,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): void {
  if (room.stage === "running") return;
  for (const seat of seatOrder(room.seats.values())) {
    if (seat.watcher || !seat.connected) continue;
    const mine = (e: Entry): e is SeatEntry => e[2] === SEAT && e[1] === tick;
    for (const entry of sourceOf(seat, streams)
      .filter(mine)
      .sort((a, b) => a[0] - b[0])) {
      const slot = entry[3],
        holder = room.seats.get(seated(room)[slot]!);
      delete room.asks[seat.id];
      if (slot === seat.slot) continue;
      if (!holder) seat.slot = slot;
      else if (room.asks[holder.id] === seat.slot) {
        delete room.asks[holder.id];
        holder.slot = seat.slot;
        seat.slot = slot;
      } else room.asks[seat.id] = slot;
    }
  }
  const crew = seated(room);
  for (const [id, slot] of Object.entries(room.asks)) {
    const asker = room.seats.get(id);
    if (!asker || asker.watcher || crew[slot] === "" || crew[slot] === id)
      delete room.asks[id];
  }
}

/**
 * Every slot's input for each of the tick's steps, from its pilot's entries for this tick, match and game. The held
 * bits last from the latest `PLAY` on (a tap shorter than the tick still counts, on its first step). Each `PRESS`
 * sets the press edge on exactly the step it names, once per gesture (ordinals rise along a stream, so a repeat in the
 * tick is ignored), and holds the button on that step; each `ATTACK` sets the attack edge the same way. A slot
 * without a pilot gets nothing: the bot plays it.
 */
function inputs(
  room: Room,
  crew: readonly string[],
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): Input[][] {
  const steps: Input[][] = [[], [], []],
    held: Record<string, number> = {};
  crew.forEach((id, slot) => {
    const seat = room.seats.get(id),
      pressed = [false, false, false],
      attack = [false, false, false];
    let bits = 0,
      tapped = 0,
      ordinal = 0;
    if (seat) {
      bits = room.held[id] ?? 0;
      const mine = (e: Entry): e is PlayEntry | PressEntry | AttackEntry =>
        (e[2] === PLAY || e[2] === PRESS || e[2] === ATTACK) &&
        e[1] === tick &&
        e[3] === room.matchId &&
        e[4] === room.round;
      for (const entry of sourceOf(seat, streams)
        .filter(mine)
        .sort((a, b) => a[0] - b[0]))
        if (entry[2] === PLAY) {
          tapped |= entry[5];
          bits = entry[5];
        } else if (entry[5] > ordinal) {
          ordinal = entry[5];
          (entry[2] === PRESS ? pressed : attack)[entry[6]] = true;
        }
      if (bits) held[id] = bits;
    }
    steps.forEach((step, k) => {
      const input = unpackInput(bits | (k === 0 ? tapped : 0));
      step[slot] = {
        ...input,
        held: input.held || pressed[k]!,
        pressed: pressed[k]!,
        attack: attack[k]!,
      };
    });
  });
  room.held = held;
  return steps;
}

const statsOf = (room: Room, id: string | undefined): Stats | undefined =>
  id ? (room.stats[id] ??= noStats()) : undefined;
/** Credits one step's kills, deaths and berries to whoever pilots the slots they name. */
function tally(
  room: Room,
  crew: readonly string[],
  events: readonly GameEvent[],
): void {
  const bump = (slot: number, key: "kills" | "deaths" | "berries") => {
    const stats = statsOf(room, crew[slot]);
    if (stats && stats[key] < MAX_COUNT) stats[key]++;
  };
  for (const event of events)
    // A Queen's death is a `kill` too; `queenKill` only adds the eggs left.
    if (event.type === "kill") {
      bump(event.killer, "kills");
      bump(event.victim, "deaths");
    } else if (event.type === "berryDeposit") bump(event.slot, "berries");
    // A loose berry fills either hive; only one in the sender's own hive is to the sender's credit.
    else if (event.type === "berryKickIn" && teamOf(event.slot) === event.team)
      bump(event.slot, "berries");
}

function endGame(room: Room, tick: number): void {
  const world = room.world!,
    { team, kind } = world.winner!,
    crew = seated(room);
  room.score[team]!++;
  crew.forEach((id, slot) => {
    const stats = statsOf(room, id);
    if (!stats) return;
    room.roster[id] = { name: room.seats.get(id)!.name, slot };
    stats.games++;
    if (teamOf(slot) === team) stats.gameWins++;
  });
  room.results.push({
    round: room.round,
    mapId: world.mapId,
    team,
    kind,
    steps: world.step,
    tick,
    crew,
    present: pilots(room)
      .filter((id) => id !== "")
      .sort(),
  });
  if (room.score[team]! >= room.play.wins) {
    room.stage = "over";
    room.winner = team;
  } else {
    room.stage = "between";
    room.resumeAt = tick + BETWEEN_TICKS;
  }
}

/**
 * One log tick: management and seat choices first; then, in a game past its countdown, three engine steps on the
 * pilots' controls until one decides it, the victory screen, and the record; between games, the start of the next.
 * Returns the steps' events.
 */
export function foldTick(
  room: Room,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
): GameEvent[] {
  const tick = room.tick + 1;
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  applySeats(room, streams, tick);
  room.events = [];
  const world = room.world;
  if (room.stage === "running" && world) {
    const crew = pilots(room);
    world.humans = crew.map((id) => id !== "");
    const steps = inputs(room, crew, streams, tick);
    if (room.endAt) {
      if (tick >= room.endAt) endGame(room, tick);
    } else if (tick >= room.startAt) {
      for (const step of steps) {
        stepRound(world, step);
        tally(room, crew, world.events);
        room.events.push(...world.events);
      }
      if (world.winner) room.endAt = tick + OUTRO_TICKS;
    }
  } else if (room.stage === "between" && tick >= room.resumeAt) startGame(room);
  room.tick = tick;
  return structuredClone(room.events);
}

/**
 * The desync hash: the whole room, so whatever the engine adds to the round state later is covered. The room's and the
 * round's `events` are the latest tick's output, rebuilt by the next one, not state, so they alone are left out (an
 * undefined field counts as absent).
 */
export const hash = (room: Room): string =>
  hashPlain({
    ...room,
    events: undefined,
    world: room.world && { ...room.world, events: undefined },
  });

// ---- checkpoint ----
const STAGES: readonly Stage[] = ["lobby", "running", "between", "over"];
/** An array of at most `max` items without holes (MessagePack makes none, but `decode` can be handed a value from anywhere). */
const list = (raw: unknown, max: number): raw is unknown[] =>
  Array.isArray(raw) &&
  raw.length <= max &&
  Object.keys(raw).length === raw.length;
/** `[key, value]` pairs with distinct keys, at most `max` of them. */
function pairs(raw: unknown, max: number): [string, unknown][] | undefined {
  if (!list(raw, max)) return;
  const out: [string, unknown][] = [];
  for (const pair of raw) {
    if (!list(pair, 2) || pair.length !== 2 || !names.playerKey(pair[0]))
      return;
    if (out.some(([id]) => id === pair[0])) return;
    out.push([pair[0], pair[1]]);
  }
  return out;
}
// prettier-ignore
const SEAT_KEYS = new Set(["id", "name", "slot", "avatarId", "connected", "bot", "watcher", "generation", "away"]);

/**
 * The room as checkpoint fields: `[matchId, round, stage, settings, play]` before the netcode's streams and hash, then
 * `[seats, results, startAt, held, asks, roster, stats, world]`. The score, the set's winner and the victory-screen
 * and pause ticks are not sent: `decode` derives them from the results and the round.
 */
export function encode(room: Room): unknown[] {
  return [
    room.matchId,
    room.round,
    room.stage,
    { ...room.settings },
    { ...room.play },
    [...room.seats.values()].map((seat) => ({ ...seat })),
    // prettier-ignore
    room.results.map((r) => [r.round, r.mapId, r.team, r.kind, r.steps, r.tick, [...r.crew], [...r.present]]),
    room.startAt,
    Object.entries(room.held),
    Object.entries(room.asks),
    Object.entries(room.roster).map(([id, { name, slot }]) => [
      id,
      [name, slot],
    ]),
    Object.entries(room.stats).map(([id, stats]) => [
      id,
      STAT_KEYS.map((key) => stats[key]),
    ]),
    room.world && encodeWorld(room.world),
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
    bot !== false ||
    (watcher !== undefined && watcher !== true) ||
    (away !== undefined && away !== true) ||
    (away === true && connected) ||
    (watcher ? slot !== -1 : !uint32(slot) || slot >= CAPACITY) ||
    (watcher ? avatarId !== "" : !names.isAvatar(avatarId)) ||
    !uint32(generation)
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
    generation,
    ...(away ? { away: true } : {}),
  };
}

function decodeRecord(raw: unknown, round: number): GameRecord | undefined {
  if (!list(raw, 8) || raw.length !== 8) return;
  const [number, mapId, team, kind, steps, tick, crew, present] = raw;
  const how = VICTORIES.find((known) => known === kind);
  if (number !== round || !isMapId(mapId) || !how) return;
  if ((team !== 0 && team !== 1) || !uint32(steps) || !uint32(tick)) return;
  if (!list(crew, CAPACITY) || crew.length !== CAPACITY) return;
  const sat = crew.filter((id): id is string => names.playerKey(id));
  if (crew.some((id) => id !== "" && !names.playerKey(id))) return;
  if (new Set(sat).size !== sat.length) return;
  if (!list(present, CAPACITY)) return;
  const here = present.filter((id): id is string => sat.includes(id as string));
  // Sorted and strictly rising, so no member is named twice.
  if (here.length !== present.length) return;
  if (here.some((id, i) => i > 0 && here[i - 1]! >= id)) return;
  // prettier-ignore
  return { round, mapId, team, kind: how, steps, tick, crew: crew as string[], present: here };
}

/**
 * The room `encode` wrote at log tick `tick`, or undefined: every field checked, and the parts against each other —
 * the stage against the round, the results and the world, the world's seed, map and level against the set, and its
 * step count against the countdown and the victory screen. Never a partial room, and never a throw.
 */
export function decode(
  fields: readonly unknown[],
  tick: number,
): Room | undefined {
  if (fields.length !== 13 || !uint32(tick)) return;
  // prettier-ignore
  const [matchId, round, rawStage, rawSettings, rawPlay, rawSeats, rawResults, startAt, rawHeld, rawAsks, rawRoster,
    rawStats, rawWorld] = fields;
  const settings = parseSettings(rawSettings),
    play = parseSettings(rawPlay),
    stage = STAGES.find((known) => known === rawStage),
    heldPairs = pairs(rawHeld, CAPACITY),
    askPairs = pairs(rawAsks, CAPACITY),
    rosterPairs = pairs(rawRoster, MAX_GAMES * CAPACITY),
    statPairs = pairs(rawStats, (MAX_GAMES + 1) * CAPACITY);
  if (
    !names.validMatchId(matchId) ||
    !uint32(round) ||
    !stage ||
    !settings ||
    !play ||
    round > 2 * play.wins - 1 ||
    !uint32(startAt) ||
    !list(rawSeats, CAPACITY + MAX_WATCHERS) ||
    !list(rawResults, round) ||
    !heldPairs ||
    !askPairs ||
    !rosterPairs ||
    !statPairs
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
  // Game by game from the first; the score is counted from them. A decided set plays no further game, so only the
  // latest result may reach the games a set takes.
  const results: GameRecord[] = [],
    score = [0, 0],
    crewed = new Set<string>();
  for (const [i, raw] of rawResults.entries()) {
    const record = decodeRecord(raw, i + 1);
    if (!record || record.mapId !== mapFor(play, matchId, i + 1)) return;
    if (record.tick > tick || record.tick <= (results.at(-1)?.tick ?? 0))
      return;
    if (score[0]! >= play.wins || score[1]! >= play.wins) return;
    score[record.team]!++;
    results.push(record);
    for (const id of record.crew) if (id) crewed.add(id);
  }
  // The roster is exactly the members the records name.
  const roster: Room["roster"] = {};
  for (const [id, raw] of rosterPairs) {
    if (!crewed.has(id) || !list(raw, 2) || raw.length !== 2) return;
    const [name, slot] = raw;
    if (!names.validName(name) || !uint32(slot) || slot >= CAPACITY) return;
    roster[id] = { name, slot };
  }
  if (rosterPairs.length !== crewed.size) return;
  const stats: Room["stats"] = {};
  for (const [id, raw] of statPairs) {
    if (!list(raw, STAT_KEYS.length) || raw.length !== STAT_KEYS.length) return;
    if (!raw.every((count) => uint32(count) && count <= MAX_COUNT)) return;
    const [games, gameWins, kills, deaths, berries] = raw as number[];
    if (games! > results.length || gameWins! > games!) return;
    // prettier-ignore
    stats[id] = { games: games!, gameWins: gameWins!, kills: kills!, deaths: deaths!, berries: berries! };
  }
  if ([...crewed].some((id) => !stats[id]?.games)) return;
  const held: Record<string, number> = {};
  for (const [id, bits] of heldPairs) {
    if (!uint32(bits) || !bits || bits > HELD_BITS) return;
    held[id] = bits;
  }
  // A wish is a seated member's, for a slot another member holds, and never outlives the lobby or a pause.
  const crew = crewOf(seats.values(), false),
    asks: Record<string, number> = {};
  for (const [id, slot] of askPairs) {
    const asker = seats.get(id);
    if (!asker || asker.watcher || stage === "running") return;
    if (!uint32(slot) || slot >= CAPACITY || !crew[slot] || crew[slot] === id)
      return;
    asks[id] = slot;
  }
  const last = results.at(-1),
    winner = stage === "over" && last ? last.team : -1;
  // prettier-ignore
  const room: Room = { tick, matchId, round, stage, seats, settings, play, score, results, winner, startAt, endAt: 0,
    resumeAt: 0, held, asks, roster, stats, world: null, events: [] };
  if (stage === "lobby")
    return round === 0 &&
      startAt === 0 &&
      rawWorld === null &&
      !heldPairs.length
      ? room
      : undefined;
  if (round === 0) return;
  const world = decodeWorld(rawWorld, roundOptions(play, matchId, round));
  if (!world) return;
  room.world = world;
  // A game folds three steps a log tick from `startAt` until one decides it; its victory screen ends `OUTRO_TICKS`
  // after the tick of the deciding step, and the pause between games follows it.
  const decidedAt = startAt + Math.ceil(world.step / STEPS_PER_TICK) - 1;
  if (world.winner) room.endAt = decidedAt + OUTRO_TICKS;
  if (stage === "running") {
    const stepped = Math.max(0, tick - startAt + 1) * STEPS_PER_TICK;
    return results.length === round - 1 &&
      startAt <= tick + countdownTicks(round, play.quick) &&
      (world.winner
        ? world.step > 0 && decidedAt <= tick && room.endAt > tick
        : world.step === stepped)
      ? room
      : undefined;
  }
  // Between games and after the set: the latest record is the world's, and the set goes on, or is won.
  const won = Math.max(score[0]!, score[1]!) >= play.wins;
  if (
    !world.winner ||
    world.step === 0 ||
    results.length !== round ||
    !last ||
    last.team !== world.winner.team ||
    last.kind !== world.winner.kind ||
    last.steps !== world.step ||
    last.tick !== room.endAt ||
    won !== (stage === "over")
  )
    return;
  if (stage === "between") {
    room.resumeAt = room.endAt + BETWEEN_TICKS;
    if (tick >= room.resumeAt) return;
  }
  return room;
}

const checkpoint = { leading: 5, encode, decode };

/** What the screen renders: a copy of the room (a kept frame must not change under the next fold), seats in order. */
export interface View extends Omit<
  Room,
  "tick" | "seats" | "world" | "events"
> {
  /** The game clock: engine steps. */
  tick: number;
  logTick: number;
  seats: SeatRecord[];
  /** Who plays each slot right now, "" where the bot does. */
  crew: string[];
  /**
   * The current game. Its `events` are everything the latest log tick's three steps did, in order, so a screen that
   * draws one frame per log tick misses none.
   */
  world: RoundView | null;
}
export function view(room: Room): View {
  const { tick, seats, world, events, ...rest } = room;
  return {
    ...structuredClone(rest),
    tick: tick * STEPS_PER_TICK,
    logTick: tick,
    seats: structuredClone(seatOrder(seats.values())),
    crew: pilots(room),
    world: world && {
      ...viewOf(world),
      winner: world.winner && { ...world.winner },
      events: structuredClone(events),
    },
  };
}

export const killerFuseGame: RollbackGame<
  Room,
  Entry,
  View,
  GameEvent,
  Settings
> = {
  id: "killer-fuse",
  rules: RULES,
  isEntry,
  ordinal: (entry) =>
    entry[2] === PRESS || entry[2] === ATTACK ? entry[5] : undefined,
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
    // One person and five bots is a game.
    minPlayers: 1,
    maxWatchers: MAX_WATCHERS,
    seatName: names.seatName,
    isAvatar: names.isAvatar,
    defaultAvatar: names.AVATAR,
    parseSettings,
    soloSettings: (settings) => ({ ...settings, display: false }),
    sharedScreen: (settings) => settings.display,
    // No bot is ever seated (`isEntry` refuses the entry): these only satisfy the contract.
    botId: () => "bot:0",
    botName: names.botName,
    solo: { name: "Player", bots: 0 },
  },
  text: defaultText,
};
