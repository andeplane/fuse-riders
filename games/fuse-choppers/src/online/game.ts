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
  COUNTDOWN_STEPS,
  INPUT_MASK,
  RULES,
  STEPS_PER_TICK,
  botInput,
  chopperId,
  createWorld,
  decodeWorld,
  encodeWorld,
  isInput,
  parseSettings,
  roundDone,
  seedOf,
  stepWorld,
  toView,
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
 * Fuse Choppers behind the netcode's `RollbackGame`. The room keeps the seats, the match (crowns and round results)
 * and the current round's world; one log tick folds the management entries, each seat's held controls and the
 * bots' answers, then runs `STEPS_PER_TICK` simulation steps.
 */
export const PLAY = 0;
/** A seat's held control bits from this tick on, for the match and round it names. */
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
export const BETWEEN_TICKS = 50;
export const MAX_WATCHERS = 5;

export interface Placing {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
  /** How the round ended for it. */
  state: "flying" | "crashed" | "escaped";
  /** Steps of play it lasted. */
  lasted: number;
}
export interface RoundResult {
  round: number;
  /** The round's winner, or "" when nobody won it. */
  winner: string;
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
  /** Crowns this match, by member id. */
  wins: Record<string, number>;
  results: RoundResult[];
  /** The match winner once `stage` is "over". */
  winner: string;
  /** The log tick the next round starts at, while `between`. */
  resumeAt: number;
  /** Each chopper's held bits, from the latest entry its seat logged this round. */
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
  results: RoundResult[];
  winner: string;
  /** Log ticks until the next round, between rounds. */
  resumeIn: number;
  world: WorldView | null;
}

/** The most rounds a match plays: past it the leader wins. */
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
    winner: "",
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
/** Who flies a new round: every seat that is here, stepped away or a bot. */
const entrants = (room: Room) =>
  riders(room).filter((seat) => seat.connected || seat.away || seat.bot);

function startRound(room: Room): void {
  const seats = entrants(room);
  // Nobody left to fly (every rider went, watchers stayed): back to an empty lobby, crowns and all cleared.
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
  room.winner = "";
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

function leader(room: Room): string {
  const last = (id: string) => {
    for (let i = room.results.length - 1; i >= 0; i--) {
      const at = room.results[i]!.placings.findIndex((p) => p.id === id);
      if (at >= 0) return at;
    }
    return CAPACITY;
  };
  return (
    Object.keys(room.wins).sort(
      (a, b) =>
        room.wins[b]! - room.wins[a]! || last(a) - last(b) || (a < b ? -1 : 1),
    )[0] ?? ""
  );
}

function placings(room: Room, world: World): Placing[] {
  const lasted = (endedAt: number) =>
    Math.max(0, (endedAt >= 0 ? endedAt : world.step) - COUNTDOWN_STEPS);
  const rank = (c: World["choppers"][number]) =>
    c.id === world.winner ? 0 : c.exited ? 1 : c.alive ? 2 : 3;
  return [...world.choppers]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.exited && b.exited
          ? a.endedAt - b.endedAt
          : lasted(b.endedAt) - lasted(a.endedAt)) ||
        a.slot - b.slot,
    )
    .map((c) => {
      const seat = room.seats.get(c.id);
      return {
        id: c.id,
        name: seat?.name ?? "Pilot",
        slot: c.slot,
        bot: seat?.bot ?? false,
        state: c.alive ? (c.exited ? "escaped" : "flying") : "crashed",
        lasted: lasted(c.endedAt),
      };
    });
}

function endRound(room: Room, tick: number): void {
  const world = room.world!;
  const winner = world.winner ?? "";
  if (winner) room.wins[winner] = (room.wins[winner] ?? 0) + 1;
  room.results.push({
    round: room.round,
    winner,
    placings: placings(room, world),
  });
  if (
    (winner && room.wins[winner]! >= room.play.wins) ||
    room.round >= maxRounds(room.play)
  ) {
    room.stage = "over";
    room.winner =
      winner && room.wins[winner]! >= room.play.wins ? winner : leader(room);
  } else {
    room.stage = "between";
    room.resumeAt = tick + BETWEEN_TICKS;
  }
}

/**
 * One log tick: management first; then, in a round, every chopper's controls (a seat's latest entry this tick, a
 * tap shorter than a tick still counted on the first step; a bot's answer to the world as it stands) and three
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
    for (const chopper of world.choppers) {
      const seat = room.seats.get(chopper.id);
      let bits = 0,
        tapped = 0;
      if (seat?.bot) bits = botInput(world, chopper);
      else if (seat?.connected) {
        bits = room.held[chopper.id] ?? 0;
        for (const entry of playEntries(room, seat, streams, tick)) {
          tapped |= entry[5] & INPUT_MASK;
          bits = entry[5] & INPUT_MASK;
        }
      }
      // Only what a seat logged is held: a bot answers afresh every tick.
      if (bits && !seat?.bot) room.held[chopper.id] = bits;
      else delete room.held[chopper.id];
      held.set(chopper.id, bits);
      first.set(chopper.id, bits | tapped);
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
      winner: result.winner,
      placings: result.placings.map((p) => ({ ...p })),
    })),
    room.winner,
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

function decodePlacing(raw: unknown): Placing | undefined {
  if (!plain(raw) || Object.keys(raw).length !== 6) return;
  const { id, name, slot, bot, state, lasted } = raw;
  if (
    !chopperId(id) ||
    !validName(name) ||
    !uint32(slot) ||
    slot >= CAPACITY ||
    typeof bot !== "boolean" ||
    (state !== "flying" && state !== "crashed" && state !== "escaped") ||
    !uint32(lasted)
  )
    return;
  return { id, name, slot, bot, state, lasted };
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
    winner,
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
    typeof winner !== "string" ||
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
  const wins = counts(rawWins, maxRounds(play)),
    held = counts(rawHeld, CAPACITY);
  if (!wins || !held || Object.values(held).some((bits) => !isInput(bits)))
    return;
  const results: RoundResult[] = [];
  for (const raw of rawResults) {
    if (
      !plain(raw) ||
      Object.keys(raw).length !== 3 ||
      !uint32(raw.round) ||
      typeof raw.winner !== "string" ||
      !Array.isArray(raw.placings) ||
      raw.placings.length > CAPACITY
    )
      return;
    const placed = raw.placings.map(decodePlacing);
    if (placed.some((p) => !p)) return;
    results.push({
      round: raw.round,
      winner: raw.winner,
      placings: placed as Placing[],
    });
  }
  const world = rawWorld === null ? null : decodeWorld(rawWorld);
  if (world === undefined) return;
  // The lobby has no round and no world; a round in play or between rounds has both; only a finished match has a
  // winner (a match of nothing but draws ends with none).
  if (
    (stage === "lobby") !== (round === 0) ||
    (stage === "lobby" && world !== null) ||
    ((stage === "running" || stage === "between") && world === null) ||
    (winner !== "" && stage !== "over") ||
    Object.keys(held).some((id) => !world?.choppers.some((c) => c.id === id)) ||
    // Between rounds, the next one is due within the break; the round's world keeps the match's rules; every
    // chopper and placing names a member id that is safe as a record key.
    (stage === "between" &&
      (resumeAt <= tick || resumeAt > tick + BETWEEN_TICKS)) ||
    (world &&
      (world.lift !== play.lift ||
        world.combat !== play.combat ||
        world.powerUps !== play.powerUps)) ||
    world?.choppers.some((c) => !playerKey(c.id)) ||
    results.some((r) => r.placings.some((p) => !playerKey(p.id)))
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
    winner,
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
    results: room.results.map((result) => ({
      ...result,
      placings: result.placings.map((p) => ({ ...p })),
    })),
    winner: room.winner,
    resumeIn:
      room.stage === "between" ? Math.max(0, room.resumeAt - room.tick) : 0,
    world: room.world ? toView(room.world) : null,
  };
}

export const chopperGame: RollbackGame<Room, Entry, View, never, Settings> = {
  id: "fuse-choppers",
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
    solo: { name: "Pilot", bots: 3 },
  },
  text: {
    ...defaultText,
    needTwo: "At least one pilot must be seated to take off.",
  },
};
