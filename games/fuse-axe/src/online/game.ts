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
  RULES,
  STEPS_PER_TICK,
  createWorld,
  decodeWorld,
  encodeWorld,
  isInput,
  seedOf,
  stepTick,
  toView,
  type HeroKind,
  type World,
  type WorldView,
} from "../engine/index.js";
import {
  BOT_AVATAR,
  BOT_NAMES,
  BOT_PREFIX,
  DEFAULT_HERO,
  isHero,
  playerKey,
  seatHero,
  seatName,
  validMatchId,
  validName,
} from "./names.js";

/**
 * Fuse Axe behind the netcode's `RollbackGame`. The room keeps the seats and the run: the stage the party is on
 * (`round`) and that stage's world. One log tick folds the management entries; then, in a run, each hero's held
 * controls and `STEPS_PER_TICK` simulation steps, or, in the lobby and once the run is over, each member's hero pick.
 */
export const PLAY = 0,
  PICK = 1;
/** A seat's held control bits from this tick on, for the run and stage it names. */
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof PLAY,
  matchId: string,
  round: number,
  bits: number,
];
/**
 * A seated member's hero for the next run: its own entry, applied only in the lobby or once the run is over. Camp
 * between stages is part of the run, whose heroes are the ones it set out with, so a pick there changes nothing.
 */
export type PickEntry = [
  seq: number,
  tick: number,
  kind: typeof PICK,
  hero: HeroKind,
];
export type Entry = ManagementEntry<Settings> | PlayEntry | PickEntry;
/** Whether the fold applies `PICK` entries in `stage`: in the lobby and once the run is over, never in a run or camp. */
export const picksApply = (stage: Stage): boolean =>
  stage === "lobby" || stage === "over";

export const MAX_WATCHERS = 5;
/** A run's stages, in order: Ashen Village only, so far. The stage flow (camp, then the next stage) raises it. */
export const LAST_STAGE = 1;

/** The room's settings: so far only whether it is one shared screen with phones as controllers. */
export interface Settings {
  display: boolean;
}
export const DEFAULT_SETTINGS: Settings = { display: false };
/** The settings a log entry or a checkpoint carries, exactly; anything else is refused. */
export function parseSettings(raw: unknown): Settings | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  const { display } = raw as Record<string, unknown>;
  return Object.keys(raw).length === 1 && typeof display === "boolean"
    ? { display }
    : undefined;
}

export interface Room extends ManagedRoom<Settings> {
  tick: number;
  /** The run's id, which seeds its worlds. */
  matchId: string;
  /** The stage the run is on, from 1; 0 in the lobby. */
  round: number;
  stage: Stage;
  /** Each hero's held bits by member id, from the latest entry its seat logged this stage. */
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
  /** The hero this seat plays in the next run (in a run, the one it plays now); null for a watcher. */
  hero: HeroKind | null;
}
/** What the screen renders. */
export interface View {
  /** The game clock: simulation steps. */
  tick: number;
  logTick: number;
  stage: Stage;
  matchId: string;
  round: number;
  settings: Settings;
  seats: SeatView[];
  world: WorldView | null;
}

const payloads = {
  name: validName,
  avatar: isHero,
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
  if (
    !Array.isArray(raw) ||
    !uint32(raw[0]) ||
    raw[0] === 0 ||
    !uint32(raw[1]) ||
    raw[1] === 0
  )
    return false;
  return raw[2] === PLAY
    ? raw.length === 6 &&
        validMatchId(raw[3]) &&
        uint32(raw[4]) &&
        isInput(raw[5])
    : raw[2] === PICK && raw.length === 4 && isHero(raw[3]);
}

export function createRoom(matchId: string, settings: Settings): Room {
  return {
    tick: 0,
    matchId,
    round: 0,
    stage: "lobby",
    seats: new Map(),
    settings: { ...settings },
    held: {},
    world: null,
  };
}

const bySlot = (a: SeatRecord, b: SeatRecord) =>
  a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Seats in slot order, watchers excluded. */
const riders = (room: Room): SeatRecord[] =>
  [...room.seats.values()].filter((seat) => !seat.watcher).sort(bySlot);
/** The rider in `slot`, if any. A scan, not `riders`: the fold asks for every hero's seat on every tick. */
function seatAt(room: Room, slot: number): SeatRecord | undefined {
  for (const seat of room.seats.values())
    if (!seat.watcher && seat.slot === slot) return seat;
  return undefined;
}
/** Who sets out on a new run: every seat that is here, stepped away or a bot. */
const entrants = (room: Room) =>
  riders(room).filter((seat) => seat.connected || seat.away || seat.bot);
/** The hero a seat plays: its own pick (the log guard and the checkpoint only let a hero in), or a bot its seat's. */
export const heroOf = (seat: SeatRecord): HeroKind =>
  seat.bot ? seatHero(seat.slot) : (seat.avatarId as HeroKind);

function toLobby(room: Room, matchId: string): void {
  room.matchId = matchId;
  room.stage = "lobby";
  room.round = 0;
  room.held = {};
  room.world = null;
}
/** Stage 1 for everyone seated, or (nobody left to play) an empty lobby again. */
function startRun(room: Room, matchId: string): void {
  const seats = entrants(room);
  if (!seats.length) return toLobby(room, matchId);
  room.matchId = matchId;
  room.stage = "running";
  room.round = 1;
  room.held = {};
  room.world = createWorld({
    seed: seedOf(`${matchId}:${room.round}`),
    heroes: seats.map((seat) => ({ seat: seat.slot, kind: heroOf(seat) })),
  });
}

export const lifecycle: LifecycleHooks<Room, Settings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: BOT_AVATAR,
  start(room, matchId) {
    if (entrants(room).length) startRun(room, matchId);
  },
  // From "over", which game over will reach once the stage flow lands.
  rematch: startRun,
  lobby: toLobby,
};

/** The seat's own entries at `tick`, from the stream generation its controls follow, in seq order. */
function ownEntries(
  seat: SeatRecord,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): Entry[] {
  const stream = streams.get(seat.id);
  const source =
    stream?.generation === seat.generation
      ? stream
      : stream?.retired?.find((old) => old.generation === seat.generation);
  return (source?.entries ?? [])
    .filter((entry) => entry[1] === tick)
    .sort((a, b) => a[0] - b[0]);
}

/**
 * Every hero's controls for one tick and its steps: a seat's latest bits this stage are held for every step, and
 * every entry it logged this tick is folded into the first (`first = last | every tap`), so a tap shorter than a
 * tick still presses. Bots stand still until they get a controller; an absent or away seat holds nothing.
 */
function playTick(
  room: Room,
  world: World,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): World {
  const held: number[] = [],
    first: number[] = [];
  for (const hero of world.heroes) {
    // A run holds every hero's seat for it (`consistent`), so a hero always has one.
    const seat = seatAt(room, hero.seat)!;
    let bits = 0,
      tapped = 0;
    if (!seat.bot && seat.connected) {
      bits = room.held[seat.id] ?? 0;
      for (const entry of ownEntries(seat, streams, tick))
        if (
          entry[2] === PLAY &&
          entry[3] === room.matchId &&
          entry[4] === room.round
        ) {
          tapped |= entry[5] & INPUT_MASK;
          bits = entry[5] & INPUT_MASK;
        }
    }
    if (bits) room.held[seat.id] = bits;
    else delete room.held[seat.id];
    held[hero.seat] = bits;
    first[hero.seat] = bits | tapped;
  }
  // The stage flow hooks in after the steps: a cleared stage goes to camp and the next `round` (stage "between"),
  // and a party with every hero out goes to "over".
  return stepTick(world, held, first);
}

/** One log tick: management first, then the heroes' controls and steps in a run, or hero picks in the lobby and after it. */
export function foldTick(
  room: Room,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
): never[] {
  const tick = room.tick + 1;
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  if (room.stage === "running")
    room.world = playTick(room, room.world!, streams, tick);
  else if (picksApply(room.stage))
    // Each pick touches only its own seat, so the seats need no order.
    for (const seat of room.seats.values())
      if (!seat.watcher && !seat.bot && seat.connected)
        for (const entry of ownEntries(seat, streams, tick))
          if (entry[2] === PICK) seat.avatarId = entry[3];
  room.tick = tick;
  return [];
}

// ---- checkpoint ----
const FIELDS = 7;
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

export function encode(room: Room): unknown[] {
  return [
    room.matchId,
    room.round,
    room.stage,
    { ...room.settings },
    [...room.seats.values()].sort(bySlot).map((seat) => ({ ...seat })),
    Object.entries(room.held).sort(([a], [b]) => (a < b ? -1 : 1)),
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
    (watcher
      ? avatarId !== ""
      : bot
        ? avatarId !== BOT_AVATAR
        : !isHero(avatarId)) ||
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

/**
 * What spans the fields. The lobby has no stage, no world and nothing held. A run has both: its world is the one
 * `startRun` seeds for this run and stage and has run whole log ticks no later than this one, every hero's seat is
 * held for it by a member playing that hero, and only a human playing a hero holds bits. A run that is over holds
 * none (the stage flow clears them), so a pick after game over leaves a checkpoint that still decodes.
 */
function consistent(room: Room): boolean {
  const world = room.world;
  if (!world)
    return (
      room.stage === "lobby" &&
      room.round === 0 &&
      Object.keys(room.held).length === 0
    );
  if (
    room.stage === "lobby" ||
    room.round === 0 ||
    world.step % STEPS_PER_TICK !== 0 ||
    world.step > room.tick * STEPS_PER_TICK ||
    world.seed !== seedOf(`${room.matchId}:${room.round}`) ||
    (room.stage === "over" && Object.keys(room.held).length > 0)
  )
    return false;
  const plays = (seat: SeatRecord | undefined) =>
    !!seat &&
    !seat.watcher &&
    world.heroes.some(
      (hero) => hero.seat === seat.slot && hero.kind === heroOf(seat),
    );
  return (
    Object.keys(room.held).every((id) => {
      const seat = room.seats.get(id);
      return plays(seat) && !seat!.bot;
    }) &&
    (room.stage !== "running" ||
      world.heroes.every((hero) => plays(seatAt(room, hero.seat))))
  );
}

export function decode(
  fields: readonly unknown[],
  tick: number,
): Room | undefined {
  if (fields.length !== FIELDS || !uint32(tick)) return;
  const [matchId, round, stage, rawSettings, rawSeats, rawHeld, rawWorld] =
    fields;
  const settings = parseSettings(rawSettings);
  if (
    !validMatchId(matchId) ||
    !uint32(round) ||
    round > LAST_STAGE ||
    !STAGES.includes(stage as Stage) ||
    !settings ||
    !Array.isArray(rawSeats) ||
    rawSeats.length > CAPACITY + MAX_WATCHERS ||
    !Array.isArray(rawHeld) ||
    rawHeld.length > CAPACITY
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
  const held: Record<string, number> = {};
  for (const pair of rawHeld) {
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
  const world = rawWorld === null ? null : decodeWorld(rawWorld);
  if (world === undefined) return;
  const room: Room = {
    tick,
    matchId,
    round,
    stage: stage as Stage,
    seats,
    settings,
    held,
    world,
  };
  return consistent(room) ? room : undefined;
}

/** Two FNV-1a lanes over the whole room, keys sorted: 16 hex characters. */
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
    seats: [...room.seats.values()].sort(bySlot).map((seat) => ({
      id: seat.id,
      name: seat.name,
      slot: seat.slot,
      bot: seat.bot,
      connected: seat.connected,
      away: seat.away === true,
      watcher: seat.watcher === true,
      hero: seat.watcher ? null : heroOf(seat),
    })),
    world: room.world ? toView(room.world) : null,
  };
}

export const axeGame: RollbackGame<Room, Entry, View, never, Settings> = {
  id: "fuse-axe",
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
  checkpoint: { leading: FIELDS, encode, decode },
  members: (room) => [...room.seats.values()].sort(bySlot),
  seat: (room, id) => room.seats.get(id),
  stage: (room) => room.stage,
  settings: (room) => room.settings,
  seating: {
    capacity: CAPACITY,
    minPlayers: 1,
    maxWatchers: MAX_WATCHERS,
    seatName,
    isAvatar: isHero,
    defaultAvatar: DEFAULT_HERO,
    parseSettings,
    soloSettings: (settings) => ({ ...settings, display: false }),
    sharedScreen: (settings) => settings.display,
    botId(room, pending) {
      let number = 1;
      while (
        room.seats.has(`${BOT_PREFIX}${number}`) ||
        pending.has(`${BOT_PREFIX}${number}`)
      )
        number++;
      return `${BOT_PREFIX}${number}`;
    },
    botName: (slot) => BOT_NAMES[slot % BOT_NAMES.length]!,
    // Bots stand still until they get a controller, so a solo hero sets out alone and adds companions by hand.
    solo: { name: "Hero", bots: 0 },
  },
  text: {
    ...defaultText,
    needTwo: "At least one hero must be seated to set out.",
  },
};
