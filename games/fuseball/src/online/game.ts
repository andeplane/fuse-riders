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
  type StreamEntries,
} from "fuse-netcode";
import {
  BTN,
  CAPACITY,
  CLOUD_STEPS_PER_TICK,
  DOWN,
  INPUT_MASK,
  LEFT,
  MAP_IDS,
  RIGHT,
  RULES,
  STEPS_PER_TICK,
  UP,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  isInput,
  isMapId,
  stepWorld,
  stepsPerTick,
  toView,
  winnerOf,
  type MapId,
  type Rider,
  type Slot,
  type World,
  type WorldView,
} from "../engine/index.js";
import { BOT_PREFIX, GAME_ID, validName } from "../basics.js";
import {
  AVATAR,
  BOT_NAMES,
  isAvatar,
  playerKey,
  seatName,
  validMatchId,
} from "./names.js";

/**
 * Fuseball behind the netcode's `RollbackGame`. The room keeps the seats, the lobby's settings and one match: its
 * world, who rides in it and, once it is won, who was there to see it. One log tick folds the management entries,
 * each rider's held controls and the bots' answers, then runs the tick's micro-steps (six, or three in slow motion).
 * A match is one world from 0–0 to its third point: points and countdowns are the engine's, so there are no rounds.
 */
export interface Settings {
  /** One shared screen with phones as controllers. */
  display: boolean;
  /** The arena the next match is played in. */
  mapId: MapId;
}
export const DEFAULT_SETTINGS: Settings = {
  display: false,
  mapId: MAP_IDS[0],
};
/** The settings boundary, for a logged entry, a command and a checkpoint alike: exactly the two fields, each checked. */
export function parseSettings(raw: unknown): Settings | undefined {
  if (!plain(raw)) return;
  const keys = Object.keys(raw);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(raw, "display") ||
    !Object.hasOwn(raw, "mapId")
  )
    return;
  const { display, mapId } = raw;
  if (typeof display !== "boolean" || !isMapId(mapId)) return;
  return { display, mapId };
}

export const PLAY = 0;
/** A seat's held control bits from this tick on, for the match it names. A point reset keeps what is held. */
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof PLAY,
  matchId: string,
  bits: number,
];
export type Entry = ManagementEntry<Settings> | PlayEntry;

export const MAX_WATCHERS = 5;
/** A room is in its lobby, in a match, or looking at a finished one; a match has no break between rounds. */
export type RoomStage = "lobby" | "running" | "over";

/**
 * A bot's controls for the tick about to run: ordinary held bits, read off the world like a player reads the screen.
 * It is asked once per log tick, so a bot presses and releases no faster than a device can.
 */
export type BotInput = (world: World, rider: Rider) => number;
/** A bot that holds nothing. */
export const idleBot: BotInput = () => 0;
/** A rider of the current match as it started: the result names them even if the seat is gone by the end. */
export interface Entrant {
  id: string;
  name: string;
  slot: Slot;
  bot: boolean;
}
/** The finished match, frozen on the tick it was decided so every replica reports the same thing. */
export interface Decided {
  /** The game clock (`simulationTick`) as of the deciding tick: a report waits until it is confirmed. */
  clock: number;
  winner: string;
  /** The humans still seated when it ended, sorted: who can attest the result. */
  finishers: string[];
}

export interface Room extends ManagedRoom<Settings> {
  tick: number;
  simulationTick: number;
  matchId: string;
  stage: RoomStage;
  /** The settings the current match plays with, fixed at its start. */
  play: Settings;
  /** Each rider's held bits, from the latest entry its seat logged this match; absent when nothing is held. */
  held: Record<string, number>;
  /** The match's two riders in slot order; empty in the lobby. */
  roster: Entrant[];
  decided: Decided | null;
  world: World | null;
}

export interface SeatView {
  id: string;
  name: string;
  avatarId: string;
  slot: number;
  bot: boolean;
  connected: boolean;
  away: boolean;
  watcher: boolean;
}
/** What the screen renders. Outcomes are read from here, never from events, so a rollback's correction shows. */
export interface View {
  /** The game clock: micro-steps simulated, six per log tick or three in slow motion. */
  tick: number;
  logTick: number;
  stage: RoomStage;
  matchId: string;
  /** The lobby's settings: the next match's map. */
  settings: Settings;
  /** The settings of the match being played. */
  play: Settings;
  seats: SeatView[];
  /** The match's riders in slot order, named as they started. */
  roster: Entrant[];
  /** The winner's id once `stage` is "over", otherwise "". */
  winner: string;
  world: WorldView | null;
}

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (value: unknown) => parseSettings(value) !== undefined,
  capacity: CAPACITY,
};
export function isEntry(raw: unknown): raw is Entry {
  if (isManagementEntry(raw, payloads)) {
    if (raw[2] === ACTION) return validMatchId(raw[4]);
    // Member ids become record keys: one of Object.prototype's names never does.
    const at =
      raw[2] === BOT || raw[2] === SPECTATOR ? 4 : raw[2] <= PRESENCE ? 3 : -1;
    return at < 0 || playerKey((raw as unknown[])[at]);
  }
  return (
    Array.isArray(raw) &&
    raw.length === 5 &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    raw[2] === PLAY &&
    validMatchId(raw[3]) &&
    isInput(raw[4])
  );
}

export function createRoom(matchId: string, settings: Settings): Room {
  return {
    tick: 0,
    simulationTick: 0,
    matchId,
    stage: "lobby",
    seats: new Map(),
    settings: { ...settings },
    play: { ...settings },
    held: {},
    roster: [],
    decided: null,
    world: null,
  };
}

/** Seats in slot order, watchers excluded. */
export const riders = (room: Room): SeatRecord[] =>
  [...room.seats.values()]
    .filter((seat) => !seat.watcher)
    .sort((a, b) => a.slot - b.slot);

function resetMatch(room: Room, matchId: string): void {
  room.matchId = matchId;
  room.play = { ...room.settings };
  room.stage = "lobby";
  room.held = {};
  room.roster = [];
  room.decided = null;
  room.world = null;
}
/** Starts a match for the two seats, or leaves the room in its lobby when it does not have two. */
function beginMatch(room: Room): void {
  const [left, right, ...extra] = riders(room);
  if (!left || !right || extra.length) return;
  room.stage = "running";
  room.roster = [left, right].map((seat, index) => ({
    id: seat.id,
    name: seat.name,
    slot: index === 0 ? 0 : 1,
    bot: seat.bot,
  }));
  room.world = createWorld(room.play.mapId, [left.id, right.id]);
}

export const lifecycle: LifecycleHooks<Room, Settings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: AVATAR,
  start(room, matchId) {
    if (riders(room).length !== CAPACITY) return;
    resetMatch(room, matchId);
    beginMatch(room);
  },
  // A rematch with a rider gone falls back to the lobby, where the room can seat someone or add a bot.
  rematch(room, matchId) {
    resetMatch(room, matchId);
    beginMatch(room);
  },
  lobby(room, matchId) {
    resetMatch(room, matchId);
  },
};

/** The seat's play entries for this tick and match, from the stream generation its controls follow. */
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
        entry[1] === tick && entry[2] === PLAY && entry[3] === room.matchId,
    )
    .sort((a, b) => a[0] - b[0]);
}

/**
 * What the tick's first step sees: everything held at its end plus everything pressed and let go inside it, so a tap
 * shorter than a tick is still a press. Where the two disagree along the stick, what is held at the end wins.
 */
export function firstStepBits(held: number, tapped: number): number {
  let bits = held | tapped;
  if ((bits & (LEFT | RIGHT)) === (LEFT | RIGHT))
    bits = (bits & ~(LEFT | RIGHT)) | (held & (LEFT | RIGHT));
  if ((bits & (UP | DOWN)) === (UP | DOWN))
    bits = (bits & ~(UP | DOWN)) | (held & (UP | DOWN));
  return bits;
}

/** Micro-steps the next log tick runs: the engine's answer in a match, the plain six everywhere else. */
export const MAX_STEPS_PER_TICK = STEPS_PER_TICK;
const MIN_STEPS_PER_TICK = Math.min(STEPS_PER_TICK, CLOUD_STEPS_PER_TICK);
export const steps = (room: Room): number =>
  room.stage === "running" && room.world
    ? stepsPerTick(room.world)
    : STEPS_PER_TICK;

function decide(room: Room, world: World, clock: number): void {
  const slot = winnerOf(world);
  if (slot === -1) return;
  room.stage = "over";
  // The match is done with its controls: the next one starts with nothing held.
  room.held = {};
  room.decided = {
    clock,
    winner: world.riders[slot].id,
    finishers: room.roster
      .filter((entrant) => {
        const seat = room.seats.get(entrant.id);
        return !entrant.bot && seat && (seat.connected || seat.away === true);
      })
      .map((entrant) => entrant.id)
      .sort(),
  };
}

export function foldTick(
  room: Room,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  bot: BotInput = idleBot,
): never[] {
  const tick = room.tick + 1;
  const count = steps(room);
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  const world = room.world;
  if (room.stage === "running" && world) {
    const held = new Map<string, number>(),
      first = new Map<string, number>();
    for (const rider of world.riders) {
      const seat = room.seats.get(rider.id);
      let bits = 0,
        tapped = 0;
      if (seat?.bot) {
        const answer = bot(world, rider);
        bits = isInput(answer) ? answer : 0;
      } else if (seat?.connected) {
        bits = room.held[rider.id] ?? 0;
        for (const entry of playEntries(room, seat, streams, tick)) {
          tapped |= entry[4] & INPUT_MASK;
          bits = entry[4] & INPUT_MASK;
        }
      }
      // Only what a seat logged is held: a bot answers afresh every tick, and a seat that is away holds nothing.
      if (bits && !seat?.bot) room.held[rider.id] = bits;
      else delete room.held[rider.id];
      held.set(rider.id, bits);
      first.set(rider.id, firstStepBits(bits, tapped));
    }
    for (let step = 0; step < count; step++)
      stepWorld(world, step === 0 ? first : held);
    if (world.phase === "over")
      decide(room, world, room.simulationTick + count);
  }
  room.tick = tick;
  room.simulationTick += count;
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
const STAGES: readonly RoomStage[] = ["lobby", "running", "over"];
const FIELDS = 10;
const seatOrder = (a: SeatRecord, b: SeatRecord) =>
  a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function encode(room: Room): unknown[] {
  return [
    room.matchId,
    room.stage,
    { ...room.settings },
    [...room.seats.values()].sort(seatOrder).map((seat) => ({ ...seat })),
    { ...room.play },
    Object.entries(room.held).sort(([a], [b]) => (a < b ? -1 : 1)),
    room.roster.map((entrant) => [entrant.id, entrant.name, entrant.bot]),
    room.decided
      ? [room.decided.clock, room.decided.winner, [...room.decided.finishers]]
      : null,
    room.world ? encodeWorld(room.world) : null,
    room.simulationTick,
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

function decodeSeats(raw: unknown): Map<string, SeatRecord> | undefined {
  if (!Array.isArray(raw) || raw.length > CAPACITY + MAX_WATCHERS) return;
  const seats = new Map<string, SeatRecord>();
  for (const item of raw) {
    const seat = decodeSeat(item);
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
  return seats;
}

function decodeHeld(raw: unknown): Record<string, number> | undefined {
  if (!Array.isArray(raw) || raw.length > CAPACITY) return;
  const held: Record<string, number> = {};
  for (const pair of raw) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !playerKey(pair[0]) ||
      Object.hasOwn(held, pair[0]) ||
      !isInput(pair[1]) ||
      pair[1] === 0
    )
      return;
    held[pair[0]] = pair[1];
  }
  return held;
}

function decodeRoster(raw: unknown): Entrant[] | undefined {
  if (!Array.isArray(raw) || (raw.length !== 0 && raw.length !== CAPACITY))
    return;
  const roster: Entrant[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 3) return;
    const [id, name, bot] = item as unknown[];
    if (
      !playerKey(id) ||
      !validName(name) ||
      typeof bot !== "boolean" ||
      roster.some((entrant) => entrant.id === id)
    )
      return;
    roster.push({ id, name, slot: roster.length === 0 ? 0 : 1, bot });
  }
  return roster;
}

function decodeDecided(
  raw: unknown,
  roster: readonly Entrant[],
): Decided | null | undefined {
  if (raw === null) return null;
  if (!Array.isArray(raw) || raw.length !== 3) return;
  const [clock, winner, finishers] = raw as unknown[];
  if (
    !uint32(clock) ||
    clock === 0 ||
    !roster.some((entrant) => entrant.id === winner) ||
    !Array.isArray(finishers) ||
    finishers.length > roster.length
  )
    return;
  const humans = roster.filter((e) => !e.bot).map((e) => e.id);
  const list: string[] = [];
  for (const id of finishers as unknown[]) {
    // Sorted and without repeats, as the fold writes it.
    if (typeof id !== "string" || !humans.includes(id)) return;
    if (list.length && list[list.length - 1]! >= id) return;
    list.push(id);
  }
  return { clock, winner: winner as string, finishers: list };
}

/**
 * The room a checkpoint describes, or nothing: every field is checked on its own and against the others, and the
 * room is built only once all of them hold, so a refused checkpoint leaves no half-read state behind.
 */
export function decode(
  fields: readonly unknown[],
  tick: number,
): Room | undefined {
  if (fields.length !== FIELDS || !uint32(tick)) return;
  const [
    matchId,
    stage,
    rawSettings,
    rawSeats,
    rawPlay,
    rawHeld,
    rawRoster,
    rawDecided,
    rawWorld,
    simulationTick,
  ] = fields;
  const settings = parseSettings(rawSettings),
    play = parseSettings(rawPlay),
    seats = decodeSeats(rawSeats),
    held = decodeHeld(rawHeld),
    roster = decodeRoster(rawRoster);
  if (
    !validMatchId(matchId) ||
    !uint32(simulationTick) ||
    // The clock moves three to six steps every log tick, whatever the room is doing.
    simulationTick < tick * MIN_STEPS_PER_TICK ||
    simulationTick > tick * MAX_STEPS_PER_TICK ||
    !STAGES.some((known) => known === stage) ||
    !settings ||
    !play ||
    !seats ||
    !held ||
    !roster
  )
    return;
  const decided = decodeDecided(rawDecided, roster);
  const world = rawWorld === null ? null : decodeWorld(rawWorld);
  if (decided === undefined || world === undefined) return;
  if (world === null) {
    // The lobby has no match: no world, no riders, nothing held and nothing decided.
    if (
      stage !== "lobby" ||
      roster.length ||
      decided ||
      Object.keys(held).length
    )
      return;
  } else {
    const over = world.phase === "over";
    if (
      stage === "lobby" ||
      (stage === "over") !== over ||
      (decided !== null) !== over ||
      roster.length !== CAPACITY ||
      world.mapId !== play.mapId ||
      world.riders.some((rider, slot) => rider.id !== roster[slot]!.id) ||
      Object.keys(held).some(
        (id) => !roster.some((entrant) => entrant.id === id && !entrant.bot),
      ) ||
      (over && Object.keys(held).length > 0) ||
      (decided !== null &&
        (decided.clock > simulationTick ||
          decided.winner !== roster[winnerOf(world) === 1 ? 1 : 0]!.id))
    )
      return;
  }
  return {
    tick,
    simulationTick,
    matchId,
    stage: stage as RoomStage,
    seats,
    settings,
    play,
    held,
    roster,
    decided,
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
    tick: room.simulationTick,
    logTick: room.tick,
    stage: room.stage,
    matchId: room.matchId,
    settings: { ...room.settings },
    play: { ...room.play },
    seats: [...room.seats.values()].sort(seatOrder).map((seat) => ({
      id: seat.id,
      name: seat.name,
      avatarId: seat.avatarId,
      slot: seat.slot,
      bot: seat.bot,
      connected: seat.connected,
      away: seat.away === true,
      watcher: seat.watcher === true,
    })),
    roster: room.roster.map((entrant) => ({ ...entrant })),
    winner: room.decided?.winner ?? "",
    world: room.world ? toView(room.world) : null,
  };
}

export type FuseballGame = RollbackGame<Room, Entry, View, never, Settings>;

/**
 * The game with `bot` answering for bot seats. Every device in a room must fold with the same bot, which is why the
 * default is the engine's own (covered by `RULES`); a test passes a typed fake.
 */
export function createFuseballGame(bot: BotInput = botInput): FuseballGame {
  return {
    id: GAME_ID,
    rules: RULES,
    isEntry,
    createRoom,
    createTicker: () => (room, creatorId, streams) =>
      foldTick(room, creatorId, streams, bot),
    // One match is one scope: a point reset inside it is the engine's, not a new round.
    scope: (room) => ({ matchId: room.matchId, round: 0 }),
    clock: (room) => room.simulationTick,
    steps,
    maxSteps: MAX_STEPS_PER_TICK,
    view,
    hash,
    checkpoint: { leading: 5, encode, decode },
    // Slot then id: an order that depends only on the room, so a device that recovered it from a checkpoint names
    // members exactly as the devices that folded it.
    members: (room) => [...room.seats.values()].sort(seatOrder),
    seat: (room, id) => room.seats.get(id),
    stage: (room) => room.stage,
    settings: (room) => room.settings,
    matchSettings: (room) => room.play,
    seating: {
      capacity: CAPACITY,
      maxWatchers: MAX_WATCHERS,
      seatName,
      isAvatar,
      defaultAvatar: AVATAR,
      parseSettings,
      soloSettings: (settings) => ({ ...settings, display: false }),
      sharedScreen: (settings) => settings.display,
      botId(room, pending) {
        // Never an id the match remembers, so a new bot is not mistaken for a departed one in its result.
        let number = 1;
        const taken = (id: string) =>
          room.seats.has(id) ||
          pending.has(id) ||
          room.roster.some((entrant) => entrant.id === id);
        while (taken(`${BOT_PREFIX}${number}`)) number++;
        return `${BOT_PREFIX}${number}`;
      },
      botName: (slot) => BOT_NAMES[slot % BOT_NAMES.length]!,
      solo: { name: "You", bots: 1 },
    },
    text: {
      ...defaultText,
      needTwo: "A duel needs two riders: invite a friend or add a bot.",
    },
  };
}

export const fuseballGame: FuseballGame = createFuseballGame();
