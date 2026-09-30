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
  CAPACITY,
  INPUT_MASK,
  MAX_WAGONS,
  RULES,
  STEPS_PER_SECOND,
  STEPS_PER_TICK,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  isInput,
  parseSettings,
  places,
  roundDone,
  seedOf,
  stepWorld,
  toView,
  trainId,
  type Settings,
  type World,
  type WorldView,
} from "../engine/index.js";
import {
  AVATAR,
  BOT_NAMES,
  BOT_PREFIX,
  isAvatar,
  playerKey,
  seatName,
  validMatchId,
  validName,
} from "./names.js";

/**
 * Fuse Freight behind the netcode's `RollbackGame`. The room keeps the seats, the match (round wins and round
 * results) and the current round's world; one log tick folds the management entries, each seat's held steering and
 * the bots' answers, then runs `STEPS_PER_TICK` simulation steps.
 */
export const PLAY = 0;
/** A seat's held steering bits from this tick on, for the match and round it names. */
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof PLAY,
  matchId: string,
  round: number,
  bits: number,
];
export type Entry = ManagementEntry<Settings> | PlayEntry;

/** Log ticks the scoreboard shows between two rounds. */
export const BETWEEN_TICKS = 100;
export const MAX_WATCHERS = 5;

export interface Placing {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
  /** Wagons delivered. */
  score: number;
  /** 1 for the most; equal scores share a place. */
  place: number;
  /** Rival wagons it cut loose, and wagons it still pulled at the whistle (never banked). */
  stolen: number;
  stranded: number;
}
export interface RoundResult {
  round: number;
  /** Everyone on the top score, sharing the round; none when nobody delivered. */
  winners: string[];
  /** Best first. */
  placings: Placing[];
}

export interface Room extends ManagedRoom<Settings> {
  tick: number;
  matchId: string;
  round: number;
  stage: Stage;
  /** The settings the current match plays with, fixed at its start. */
  play: Settings;
  /** Round wins this match, by member id. */
  wins: Record<string, number>;
  results: RoundResult[];
  /** The match's winners once `stage` is "over": more than one when they finish level. */
  winners: string[];
  /** The log tick the next round starts at, while `between`. */
  resumeAt: number;
  /** Each train's held bits, from the latest entry its seat logged this round. */
  held: Record<string, number>;
  world: World | null;
}

export interface SeatView {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
  connected: boolean;
  away: boolean;
  watcher: boolean;
}
/** What the screen renders. Outcomes are read from here, never from events, so a rollback's correction shows. */
export interface View {
  /** The game clock: simulation steps. */
  tick: number;
  logTick: number;
  stage: Stage;
  matchId: string;
  round: number;
  settings: Settings;
  play: Settings;
  seats: SeatView[];
  wins: Record<string, number>;
  winsNeeded: number;
  /** Wagons delivered over the match's finished rounds, by id. */
  totals: Record<string, number>;
  results: RoundResult[];
  winners: string[];
  /** Log ticks until the next round, between rounds. */
  resumeIn: number;
  world: WorldView | null;
}

/** The most rounds a match plays: past it the leaders win. */
export const maxRounds = (settings: Settings): number =>
  settings.wins * CAPACITY + 3;

const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (value: unknown) => parseSettings(value) !== undefined,
  capacity: CAPACITY,
};
export function isEntry(raw: unknown): raw is Entry {
  if (isManagementEntry(raw, payloads)) {
    if (raw[2] === ACTION) return validMatchId(raw[4]);
    const at =
      raw[2] === BOT || raw[2] === SPECTATOR ? 4 : raw[2] <= PRESENCE ? 3 : -1;
    return at < 0 || playerKey((raw as unknown[])[at]);
  }
  return (
    Array.isArray(raw) &&
    raw.length === 6 &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    raw[2] === PLAY &&
    validMatchId(raw[3]) &&
    uint32(raw[4]) &&
    isInput(raw[5])
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
    winners: [],
    resumeAt: 0,
    held: {},
    world: null,
  };
}

/** Seats in slot order, watchers excluded. */
export const riders = (room: Room): SeatRecord[] =>
  [...room.seats.values()]
    .filter((seat) => !seat.watcher)
    .sort((a, b) => a.slot - b.slot);
/** Who drives a new round: every seat that is here, stepped away or a bot. */
const entrants = (room: Room) =>
  riders(room).filter((seat) => seat.connected || seat.away || seat.bot);

function startRound(room: Room): void {
  const seats = entrants(room);
  // Nobody left to drive (every rider went, watchers stayed): back to an empty lobby, wins and all cleared.
  if (!seats.length) {
    resetMatch(room, room.matchId);
    room.stage = "lobby";
    return;
  }
  room.round++;
  room.stage = "running";
  room.held = {};
  room.world = createWorld(
    seedOf(`${room.matchId}:${room.round}`),
    seats.map((seat) => ({ id: seat.id, slot: seat.slot })),
    room.play,
  );
}
function resetMatch(room: Room, matchId: string): void {
  room.matchId = matchId;
  room.play = { ...room.settings };
  room.round = 0;
  room.wins = {};
  room.results = [];
  room.winners = [];
  room.resumeAt = 0;
  room.held = {};
  room.world = null;
}

export const lifecycle: LifecycleHooks<Room, Settings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: AVATAR,
  start(room, matchId) {
    if (!entrants(room).length) return;
    resetMatch(room, matchId);
    startRound(room);
  },
  rematch(room, matchId) {
    resetMatch(room, matchId);
    startRound(room);
  },
  lobby(room, matchId) {
    resetMatch(room, matchId);
    room.stage = "lobby";
  },
};

/** The seat's play entries for this tick, match and round, from the stream generation its controls follow. */
function playEntries(
  room: Room,
  seat: SeatRecord,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): PlayEntry[] {
  const stream = streams.get(seat.id);
  const source =
    stream?.generation === seat.generation
      ? stream
      : stream?.retired?.find((old) => old.generation === seat.generation);
  return (source?.entries ?? [])
    .filter(
      (entry): entry is PlayEntry =>
        entry[1] === tick &&
        entry[2] === PLAY &&
        entry[3] === room.matchId &&
        entry[4] === room.round,
    )
    .sort((a, b) => a[0] - b[0]);
}

/** Wagons each member delivered over the match's finished rounds. */
export function totals(
  results: readonly RoundResult[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const result of results)
    for (const placing of result.placings)
      out[placing.id] = (out[placing.id] ?? 0) + placing.score;
  return out;
}

/** Everyone level on the most round wins, then on the most wagons delivered over the match. */
export function leaders(
  wins: Record<string, number>,
  results: readonly RoundResult[],
): string[] {
  const ids = Object.keys(wins);
  if (!ids.length) return [];
  const delivered = totals(results);
  const best = Math.max(...ids.map((id) => wins[id]!));
  const level = ids.filter((id) => wins[id] === best);
  const most = Math.max(...level.map((id) => delivered[id] ?? 0));
  return level.filter((id) => (delivered[id] ?? 0) === most).sort();
}

function placings(room: Room, world: World): Placing[] {
  const ranks = places(world.trains.map((t) => t.score));
  return world.trains
    .map((train, index) => {
      const seat = room.seats.get(train.id);
      return {
        id: train.id,
        name: seat?.name ?? "Driver",
        slot: train.slot,
        bot: seat?.bot ?? false,
        score: train.score,
        place: ranks[index]!,
        stolen: train.stolen,
        stranded: train.cargo.length,
      };
    })
    .sort((a, b) => a.place - b.place || a.slot - b.slot);
}

function endRound(room: Room, tick: number): void {
  const world = room.world!;
  const placed = placings(room, world);
  const top = placed[0]?.score ?? 0;
  const winners =
    top > 0 ? placed.filter((p) => p.score === top).map((p) => p.id) : [];
  for (const id of winners) room.wins[id] = (room.wins[id] ?? 0) + 1;
  room.results.push({ round: room.round, winners, placings: placed });
  const reached = Object.values(room.wins).some((w) => w >= room.play.wins);
  if (reached || room.round >= maxRounds(room.play)) {
    room.stage = "over";
    room.winners = leaders(room.wins, room.results);
  } else {
    room.stage = "between";
    room.resumeAt = tick + BETWEEN_TICKS;
  }
}

/**
 * One log tick: management first; then, in a round, every train's steering (a seat's latest entry this tick, a tap
 * shorter than a tick still steering the tick's first step; a bot's answer to the world as it stands) and three
 * steps; then the round's end, or the start of the next.
 */
export function foldTick(
  room: Room,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
): never[] {
  const tick = room.tick + 1;
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  const world = room.world;
  if (room.stage === "running" && world) {
    const held = new Map<string, number>(),
      first = new Map<string, number>();
    for (const train of world.trains) {
      const seat = room.seats.get(train.id);
      let bits = 0,
        tapped = 0;
      if (seat?.bot) bits = botInput(world, train);
      else if (seat?.connected) {
        bits = room.held[train.id] ?? 0;
        for (const entry of playEntries(room, seat, streams, tick)) {
          tapped |= entry[5] & INPUT_MASK;
          bits = entry[5] & INPUT_MASK;
        }
      }
      // Only what a seat logged is held: a bot answers afresh every tick.
      if (bits && !seat?.bot) room.held[train.id] = bits;
      else delete room.held[train.id];
      held.set(train.id, bits);
      // A tap that came and went within the tick still steers its first step; a tap of both sides cancels out.
      first.set(train.id, bits || tapped);
    }
    for (let step = 0; step < STEPS_PER_TICK; step++)
      stepWorld(world, step === 0 ? first : held);
    if (roundDone(world)) endRound(room, tick);
  } else if (room.stage === "between" && tick >= room.resumeAt)
    startRound(room);
  room.tick = tick;
  return [];
}

// ---- checkpoint ----
const SEAT_KEYS = [
  "id",
  "name",
  "slot",
  "avatarId",
  "connected",
  "bot",
  "watcher",
  "generation",
  "away",
];
const STAGES: readonly Stage[] = ["lobby", "running", "between", "over"];
const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sortedEntries = (record: Record<string, number>) =>
  Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1));

export function encode(room: Room): unknown[] {
  return [
    room.matchId,
    room.round,
    room.stage,
    { ...room.settings },
    [...room.seats.values()]
      .sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1))
      .map((seat) => ({ ...seat })),
    { ...room.play },
    sortedEntries(room.wins),
    room.results.map((result) => ({
      round: result.round,
      winners: [...result.winners],
      placings: result.placings.map((p) => ({ ...p })),
    })),
    [...room.winners],
    room.resumeAt,
    sortedEntries(room.held),
    room.world ? encodeWorld(room.world) : null,
  ];
}

function decodeSeat(raw: unknown): SeatRecord | undefined {
  if (!plain(raw) || Object.keys(raw).some((key) => !SEAT_KEYS.includes(key)))
    return;
  const {
    id,
    name,
    slot,
    avatarId,
    connected,
    bot,
    watcher,
    generation,
    away,
  } = raw;
  if (
    !playerKey(id) ||
    !validName(name) ||
    typeof connected !== "boolean" ||
    typeof bot !== "boolean" ||
    (watcher !== undefined && watcher !== true) ||
    (away !== undefined && away !== true) ||
    (away === true && connected) ||
    (watcher ? slot !== -1 : !uint32(slot) || slot >= CAPACITY) ||
    (watcher ? avatarId !== "" : !isAvatar(avatarId)) ||
    (bot ? generation !== undefined || watcher === true : !uint32(generation))
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

const PLACING_KEYS = 8;
function decodePlacing(raw: unknown): Placing | undefined {
  if (!plain(raw) || Object.keys(raw).length !== PLACING_KEYS) return;
  const { id, name, slot, bot, score, place, stolen, stranded } = raw;
  if (
    !trainId(id) ||
    !playerKey(id) ||
    !validName(name) ||
    !uint32(slot) ||
    slot >= CAPACITY ||
    typeof bot !== "boolean" ||
    !uint32(score) ||
    !uint32(place) ||
    place < 1 ||
    place > CAPACITY ||
    !uint32(stolen) ||
    !uint32(stranded) ||
    stranded > MAX_WAGONS
  )
    return;
  return { id, name, slot, bot, score, place, stolen, stranded };
}

/** A result's placings are best first, with places that follow from the scores, and its winners the top scorers. */
function consistent(result: RoundResult): boolean {
  const { placings: placed, winners } = result;
  const ranks = places(placed.map((p) => p.score));
  if (
    placed.some((p, i) => p.place !== ranks[i]) ||
    placed.some((p, i) => i > 0 && p.place < placed[i - 1]!.place) ||
    new Set(placed.map((p) => p.id)).size !== placed.length
  )
    return false;
  const top = placed[0]?.score ?? 0;
  const expected =
    top > 0 ? placed.filter((p) => p.score === top).map((p) => p.id) : [];
  return (
    winners.length === expected.length &&
    winners.every((id, i) => id === expected[i])
  );
}

const counts = (
  raw: unknown,
  max: number,
): Record<string, number> | undefined => {
  if (!Array.isArray(raw) || raw.length > max) return;
  const out: Record<string, number> = {};
  for (const pair of raw) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !playerKey(pair[0]) ||
      Object.hasOwn(out, pair[0]) ||
      !uint32(pair[1]) ||
      pair[1] === 0
    )
      return;
    out[pair[0]] = pair[1];
  }
  return out;
};
const ids = (raw: unknown, max: number): string[] | undefined =>
  Array.isArray(raw) &&
  raw.length <= max &&
  raw.every((id) => playerKey(id)) &&
  new Set(raw).size === raw.length
    ? [...(raw as string[])]
    : undefined;

export function decode(
  fields: readonly unknown[],
  tick: number,
): Room | undefined {
  if (fields.length !== 12 || !uint32(tick)) return;
  const [
    matchId,
    round,
    stage,
    rawSettings,
    rawSeats,
    rawPlay,
    rawWins,
    rawResults,
    rawWinners,
    resumeAt,
    rawHeld,
    rawWorld,
  ] = fields;
  const settings = parseSettings(rawSettings),
    play = parseSettings(rawPlay);
  if (
    !validMatchId(matchId) ||
    !uint32(round) ||
    !STAGES.includes(stage as Stage) ||
    !settings ||
    !play ||
    !Array.isArray(rawSeats) ||
    rawSeats.length > CAPACITY + MAX_WATCHERS ||
    !uint32(resumeAt) ||
    !Array.isArray(rawResults) ||
    rawResults.length > maxRounds(play)
  )
    return;
  const seats = new Map<string, SeatRecord>();
  for (const raw of rawSeats) {
    const seat = decodeSeat(raw);
    if (
      !seat ||
      seats.has(seat.id) ||
      (!seat.watcher &&
        [...seats.values()].some((s) => !s.watcher && s.slot === seat.slot))
    )
      return;
    seats.set(seat.id, seat);
  }
  if ([...seats.values()].filter((s) => s.watcher).length > MAX_WATCHERS)
    return;
  const wins = counts(rawWins, maxRounds(play) * CAPACITY),
    held = counts(rawHeld, CAPACITY),
    winners = ids(rawWinners, maxRounds(play) * CAPACITY);
  if (
    !wins ||
    !held ||
    !winners ||
    Object.values(held).some((bits) => !isInput(bits))
  )
    return;
  const results: RoundResult[] = [];
  for (const raw of rawResults) {
    if (
      !plain(raw) ||
      Object.keys(raw).length !== 3 ||
      !uint32(raw.round) ||
      !Array.isArray(raw.placings) ||
      raw.placings.length > CAPACITY
    )
      return;
    const placed = raw.placings.map(decodePlacing),
      roundWinners = ids(raw.winners, CAPACITY);
    if (placed.some((p) => !p) || !roundWinners) return;
    const result = {
      round: raw.round,
      winners: roundWinners,
      placings: placed as Placing[],
    };
    if (!consistent(result)) return;
    results.push(result);
  }
  // Every round win comes from a result: the wins are the results' winners, counted.
  const counted: Record<string, number> = {};
  for (const result of results)
    for (const id of result.winners) counted[id] = (counted[id] ?? 0) + 1;
  if (
    Object.keys(counted).length !== Object.keys(wins).length ||
    Object.entries(counted).some(([id, count]) => wins[id] !== count)
  )
    return;
  const world = rawWorld === null ? null : decodeWorld(rawWorld);
  if (world === undefined) return;
  // The lobby has no round and no world; a round in play or between rounds has both; only a finished match has
  // winners (a match of nothing but empty rounds ends with none).
  if (
    (stage === "lobby") !== (round === 0) ||
    (stage === "lobby" && world !== null) ||
    ((stage === "running" || stage === "between") && world === null) ||
    (stage === "over"
      ? winners.join() !== leaders(wins, results).join()
      : winners.length > 0) ||
    Object.keys(held).some((id) => !world?.trains.some((t) => t.id === id)) ||
    // Between rounds, the next one is due within the break; the round's world keeps the match's round length;
    // every train names a member id that is safe as a record key.
    (stage === "between" &&
      (resumeAt <= tick || resumeAt > tick + BETWEEN_TICKS)) ||
    (world && world.length !== play.seconds * STEPS_PER_SECOND) ||
    world?.trains.some((t) => !playerKey(t.id))
  )
    return;
  return {
    tick,
    matchId,
    round,
    stage: stage as Stage,
    seats,
    settings,
    play,
    wins,
    results,
    winners,
    resumeAt,
    held,
    world,
  };
}

export function hash(room: Room): string {
  const text = JSON.stringify([room.tick, ...encode(room)], (_key, value) =>
    plain(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : (value as unknown),
  );
  let a = 0x811c9dc5,
    b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export function view(room: Room): View {
  return {
    tick: room.tick * STEPS_PER_TICK,
    logTick: room.tick,
    stage: room.stage,
    matchId: room.matchId,
    round: room.round,
    settings: { ...room.settings },
    play: { ...room.play },
    seats: [...room.seats.values()]
      .sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1))
      .map((seat) => ({
        id: seat.id,
        name: seat.name,
        slot: seat.slot,
        bot: seat.bot,
        connected: seat.connected,
        away: seat.away === true,
        watcher: seat.watcher === true,
      })),
    wins: { ...room.wins },
    winsNeeded: room.play.wins,
    totals: totals(room.results),
    results: room.results.map((result) => ({
      ...result,
      winners: [...result.winners],
      placings: result.placings.map((p) => ({ ...p })),
    })),
    winners: [...room.winners],
    resumeIn:
      room.stage === "between" ? Math.max(0, room.resumeAt - room.tick) : 0,
    world: room.world ? toView(room.world) : null,
  };
}

export const freightGame: RollbackGame<Room, Entry, View, never, Settings> = {
  id: "fuse-freight",
  rules: RULES,
  isEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (room) => ({ matchId: room.matchId, round: room.round }),
  clock: (room) => room.tick * STEPS_PER_TICK,
  steps: () => STEPS_PER_TICK,
  maxSteps: STEPS_PER_TICK,
  view,
  hash,
  checkpoint: { leading: 5, encode, decode },
  members: (room) =>
    [...room.seats.values()].sort(
      (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ),
  seat: (room, id) => room.seats.get(id),
  stage: (room) => room.stage,
  settings: (room) => room.settings,
  matchSettings: (room) => room.play,
  seating: {
    capacity: CAPACITY,
    minPlayers: 1,
    maxWatchers: MAX_WATCHERS,
    seatName,
    isAvatar,
    defaultAvatar: AVATAR,
    parseSettings,
    soloSettings: (settings) => ({ ...settings, display: false }),
    sharedScreen: (settings) => settings.display,
    botId(room, pending) {
      let number = 1;
      const taken = (id: string) =>
        room.seats.has(id) ||
        pending.has(id) ||
        room.results.some((r) => r.placings.some((p) => p.id === id));
      while (taken(`${BOT_PREFIX}${number}`)) number++;
      return `${BOT_PREFIX}${number}`;
    },
    botName: (slot) => BOT_NAMES[slot % BOT_NAMES.length]!,
    solo: { name: "Driver", bots: 3 },
  },
  text: {
    ...defaultText,
    needTwo: "At least one driver must be seated to start the trains.",
  },
};
