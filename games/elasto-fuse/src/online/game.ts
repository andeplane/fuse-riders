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
  CAPACITY,
  COUNTDOWN,
  FINISHED,
  INPUT_MASK,
  LEVEL_COUNT,
  RULES,
  SOLO_COUNTDOWN,
  STEPS_PER_TICK,
  createWorld,
  decodeWorld,
  encodeWorld,
  isInput,
  isLevel,
  ranking,
  stepWorld,
  toView,
  type World,
  type WorldView,
} from "../engine/index.js";
import { BOT_PREFIX, GAME_ID, PLACE_POINTS, validName } from "../basics.js";
import {
  AVATAR,
  BOT_NAMES,
  isAvatar,
  playerKey,
  seatName,
  validMatchId,
} from "./names.js";

/**
 * Elasto Fuse behind the netcode's `RollbackGame`. The room keeps the seats, the lobby's settings and one match: a
 * race on one level, or the tour, a race on every level in turn with points for the places. One log tick folds the
 * management entries and each rider's held controls, then runs the tick's steps of the race; between two races of a
 * tour the room rests on the finished one for a few seconds.
 */
export const TOUR = -1;
export interface Settings {
  /** One shared screen with phones as controllers. */
  display: boolean;
  /** The level to race, or `TOUR` for all of them in order. */
  level: number;
}
export const DEFAULT_SETTINGS: Settings = { display: false, level: TOUR };
const SETTING_KEYS = ["display", "level"];
/** The settings boundary, for a logged entry, a command and a checkpoint alike: exactly the fields, each checked. */
export function parseSettings(raw: unknown): Settings | undefined {
  if (!plain(raw)) return;
  const keys = Object.keys(raw);
  if (
    keys.length !== SETTING_KEYS.length ||
    !SETTING_KEYS.every((key) => Object.hasOwn(raw, key))
  )
    return;
  const { display, level } = raw;
  if (typeof display !== "boolean" || !(level === TOUR || isLevel(level)))
    return;
  return { display, level: level as number };
}
/** The levels a match under `settings` races, in order. */
export const levelsOf = (settings: Settings): number[] =>
  settings.level === TOUR
    ? Array.from({ length: LEVEL_COUNT }, (_, index) => index)
    : [settings.level];

export const PLAY = 0;
/**
 * A seat's held control bits, for the match it names, from step `step` of this tick on (its first when absent): a
 * key acts on the step it went down, not on the next tick. A new race keeps what is held.
 */
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof PLAY,
  matchId: string,
  bits: number,
  step?: number,
];
export type Entry = ManagementEntry<Settings> | PlayEntry;

export const MAX_WATCHERS = 5;
/** Steps a tour rests on a finished race before the next one. */
export const INTERMISSION = 6 * 20 * STEPS_PER_TICK;
export type RoomStage = "lobby" | "running" | "between" | "over";

/** A rider of the current match as it started: the result names them even if the seat is gone by the end. */
export interface Entrant {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
}
/** A rider's match so far, by roster slot. */
export interface Standing {
  points: number;
  /** Races finished first. */
  wins: number;
  /** Races finished at all. */
  finishes: number;
  /** Crashes and restarts. */
  deaths: number;
  /** Race steps over the races finished, and the full limit for each one not: the tie-break, lower is better. */
  clock: number;
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
  /** The match's riders in slot order; empty in the lobby. */
  roster: Entrant[];
  /** Which of the match's levels is being raced, from 0. */
  round: number;
  standings: Standing[];
  /** Between two races: steps until the next one. */
  pause: number;
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
  /** The game clock: steps simulated, `STEPS_PER_TICK` per log tick. */
  tick: number;
  logTick: number;
  stage: RoomStage;
  matchId: string;
  /** The lobby's settings: what the next match races. */
  settings: Settings;
  /** The settings of the match being played. */
  play: Settings;
  seats: SeatView[];
  /** The match's riders in slot order, named as they started. */
  roster: Entrant[];
  /** The race being run, from 0, of `rounds`. */
  round: number;
  rounds: number;
  /** By roster slot. */
  standings: Standing[];
  /** Roster slots from the leader down. */
  order: number[];
  /** Between two races: steps until the next one; 0 otherwise. */
  pause: number;
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
    (raw.length === 5 ||
      (raw.length === 6 &&
        Number.isInteger(raw[5]) &&
        raw[5] >= 0 &&
        raw[5] < STEPS_PER_TICK)) &&
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
    round: 0,
    standings: [],
    pause: 0,
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
  room.round = 0;
  room.standings = [];
  room.pause = 0;
  room.decided = null;
  room.world = null;
}
const emptyStanding = (): Standing => ({
  points: 0,
  wins: 0,
  finishes: 0,
  deaths: 0,
  clock: 0,
});
/** The race for the room's current round: a rider alone gets a short countdown. */
function beginRace(room: Room): void {
  room.stage = "running";
  room.pause = 0;
  room.world = createWorld(
    room.roster.map((entrant) => entrant.id),
    levelsOf(room.play)[room.round]!,
    room.roster.length === 1 ? SOLO_COUNTDOWN : COUNTDOWN,
  );
}
/** Starts a match for the seats, in seat order, or leaves the room in its lobby when nobody is seated. */
function beginMatch(room: Room): void {
  const seated = riders(room);
  if (seated.length < 1) return;
  room.roster = seated.map((seat, index) => ({
    id: seat.id,
    name: seat.name,
    slot: index,
    bot: seat.bot,
  }));
  room.standings = room.roster.map(emptyStanding);
  room.round = 0;
  beginRace(room);
}

export const lifecycle: LifecycleHooks<Room, Settings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: AVATAR,
  start(room, matchId) {
    resetMatch(room, matchId);
    beginMatch(room);
  },
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
 * What the tick's first step sees, given what was held before the tick, what is held at its end and every state the
 * seat logged in between. A bit tapped shorter than a tick is still down for the first step, so a turn or a volt
 * pressed and let go inside one tick still happens; a bit let go and pressed again inside the tick is up for the
 * first step, so the engine sees it go down again on the second.
 */
export function firstStepBits(
  before: number,
  states: readonly number[],
  held: number,
): number {
  let tapped = 0,
    released = 0,
    current = before;
  for (const bits of states) {
    released |= current & ~bits;
    tapped |= bits;
    current = bits;
  }
  return (held | tapped) & ~(released & before & held);
}

/**
 * What each step of a tick sees, given what was held before the tick and every state the seat logged in it, in the
 * order written, each with the step it took hold on. A state never takes hold before one written ahead of it.
 */
export function stepBits(
  before: number,
  entries: readonly (readonly [bits: number, step: number])[],
): number[] {
  const out: number[] = [];
  let current = before,
    next = 0,
    floor = 0;
  for (let step = 0; step < STEPS_PER_TICK; step++) {
    const states: number[] = [];
    while (next < entries.length) {
      const at = Math.max(floor, entries[next]![1]);
      if (at > step) break;
      floor = at;
      states.push(entries[next++]![0]);
    }
    const held = states[states.length - 1] ?? current;
    out.push(firstStepBits(current, states, held));
    current = held;
  }
  return out;
}

export const MAX_STEPS_PER_TICK = STEPS_PER_TICK;
export const steps = (_room: Room): number => STEPS_PER_TICK;

/** Roster slots from the leader down: points, then wins, then the lower clock, then the seat. */
export function order(standings: readonly Standing[]): number[] {
  return standings
    .map((_, slot) => slot)
    .sort((a, b) => {
      const sa = standings[a]!,
        sb = standings[b]!;
      return (
        sb.points - sa.points ||
        sb.wins - sa.wins ||
        sa.clock - sb.clock ||
        a - b
      );
    });
}

/** Books a finished race into the standings, then rests before the next one or decides the match. */
function closeRace(room: Room, world: World, clock: number): void {
  let place = 0;
  for (const slot of ranking(world)) {
    const rider = world.riders[slot]!,
      standing = room.standings[slot]!;
    standing.deaths += rider.deaths;
    if (rider.status === FINISHED) {
      standing.points += PLACE_POINTS[place] ?? 0;
      standing.finishes++;
      standing.clock += rider.finish;
      if (place === 0) standing.wins++;
      place++;
    } else standing.clock += world.close;
  }
  if (room.round + 1 < levelsOf(room.play).length) {
    room.stage = "between";
    room.pause = INTERMISSION;
    return;
  }
  room.stage = "over";
  // The match is done with its controls: the next one starts with nothing held.
  room.held = {};
  room.decided = {
    clock,
    winner: room.roster[order(room.standings)[0]!]!.id,
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
): never[] {
  const tick = room.tick + 1;
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  const world = room.world;
  if (room.stage === "between" && world) {
    // Controls let go (or taken up) between two races still count: the next race starts on what is held then.
    for (const rider of world.riders) {
      const seat = room.seats.get(rider.id);
      if (!seat || seat.bot || !seat.connected) continue;
      for (const entry of playEntries(room, seat, streams, tick)) {
        const bits = entry[4] & INPUT_MASK;
        if (bits) room.held[rider.id] = bits;
        else delete room.held[rider.id];
      }
    }
    room.pause -= STEPS_PER_TICK;
    if (room.pause <= 0) {
      room.round++;
      beginRace(room);
    }
  } else if (room.stage === "running" && world) {
    const bySteps = Array.from({ length: STEPS_PER_TICK }, () =>
        world.riders.map(() => 0),
      ),
      present = world.riders.map(() => false);
    for (const [slot, rider] of world.riders.entries()) {
      const seat = room.seats.get(rider.id);
      const before = room.held[rider.id] ?? 0;
      let bits = 0;
      const states: [number, number][] = [];
      // A bot's seat rides nothing: its bike coasts and the race does not wait for it.
      if (seat && !seat.bot && seat.connected) {
        present[slot] = true;
        bits = before;
        for (const entry of playEntries(room, seat, streams, tick)) {
          bits = entry[4] & INPUT_MASK;
          states.push([bits, entry[5] ?? 0]);
        }
        for (const [step, at] of stepBits(before, states).entries())
          bySteps[step]![slot] = at;
      }
      if (bits) room.held[rider.id] = bits;
      else delete room.held[rider.id];
    }
    for (let step = 0; step < STEPS_PER_TICK; step++)
      stepWorld(world, bySteps[step]!, present);
    if (world.phase === "over")
      closeRace(room, world, room.simulationTick + STEPS_PER_TICK);
  }
  room.tick = tick;
  room.simulationTick += STEPS_PER_TICK;
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
const STAGES: readonly RoomStage[] = ["lobby", "running", "between", "over"];
const FIELDS = 13;
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
    room.round,
    room.standings.map((standing) => [
      standing.points,
      standing.wins,
      standing.finishes,
      standing.deaths,
      standing.clock,
    ]),
    room.pause,
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
  if (!Array.isArray(raw) || raw.length > CAPACITY) return;
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
    roster.push({ id, name, slot: roster.length, bot });
  }
  return roster;
}

const MOST_CLOCK = 0xffff_ffff;
function decodeStandings(
  raw: unknown,
  riders: number,
  rounds: number,
): Standing[] | undefined {
  if (!Array.isArray(raw) || raw.length !== riders) return;
  const standings: Standing[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 5 || !item.every(uint32))
      return;
    const [points, wins, finishes, deaths, clock] = item as number[];
    if (
      finishes! > rounds ||
      wins! > finishes! ||
      points! > finishes! * PLACE_POINTS[0] ||
      clock! > MOST_CLOCK
    )
      return;
    standings.push({
      points: points!,
      wins: wins!,
      finishes: finishes!,
      deaths: deaths!,
      clock: clock!,
    });
  }
  return standings;
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
    round,
    rawStandings,
    pause,
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
    // The clock moves the same steps every log tick, whatever the room is doing.
    simulationTick !== tick * STEPS_PER_TICK ||
    !STAGES.some((known) => known === stage) ||
    !settings ||
    !play ||
    !seats ||
    !held ||
    !roster ||
    !uint32(round) ||
    !uint32(pause)
  )
    return;
  const levels = levelsOf(play);
  const standings = decodeStandings(rawStandings, roster.length, levels.length);
  const decided = decodeDecided(rawDecided, roster);
  const world = rawWorld === null ? null : decodeWorld(rawWorld);
  if (!standings || decided === undefined || world === undefined) return;
  if (world === null) {
    // The lobby has no match: no world, no riders, nothing held and nothing decided.
    if (
      stage !== "lobby" ||
      roster.length ||
      decided ||
      round !== 0 ||
      pause !== 0 ||
      Object.keys(held).length
    )
      return;
  } else {
    const raceOver = world.phase === "over";
    if (
      stage === "lobby" ||
      roster.length === 0 ||
      round >= levels.length ||
      world.level !== levels[round] ||
      (stage === "running") === raceOver ||
      (stage === "over") !== (decided !== null) ||
      (stage === "over" && round !== levels.length - 1) ||
      (stage === "between"
        ? pause === 0 || pause > INTERMISSION || round === levels.length - 1
        : pause !== 0) ||
      world.riders.length !== roster.length ||
      world.riders.some((rider, slot) => rider.id !== roster[slot]!.id) ||
      Object.keys(held).some(
        (id) => !roster.some((entrant) => entrant.id === id && !entrant.bot),
      ) ||
      (stage === "over" && Object.keys(held).length > 0) ||
      (decided !== null &&
        (decided.clock > simulationTick ||
          decided.winner !== roster[order(standings)[0]!]!.id))
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
    round,
    standings,
    pause,
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
    round: room.round,
    rounds: levelsOf(room.play).length,
    standings: room.standings.map((standing) => ({ ...standing })),
    order: order(room.standings),
    pause: room.pause,
    winner: room.decided?.winner ?? "",
    world: room.world ? toView(room.world) : null,
  };
}

export type ElastoFuseGame = RollbackGame<Room, Entry, View, never, Settings>;

export const elastoFuseGame: ElastoFuseGame = {
  id: GAME_ID,
  rules: RULES,
  isEntry,
  createRoom,
  createTicker: () => foldTick,
  // One race is one scope: the tour's next level is the next round.
  scope: (room) => ({ matchId: room.matchId, round: room.round }),
  clock: (room) => room.simulationTick,
  steps,
  maxSteps: MAX_STEPS_PER_TICK,
  view,
  hash,
  checkpoint: { leading: 6, encode, decode },
  // Slot then id: an order that depends only on the room, so a device that recovered it from a checkpoint names
  // members exactly as the devices that folded it.
  members: (room) => [...room.seats.values()].sort(seatOrder),
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
    solo: { name: "You", bots: 0 },
  },
  text: {
    ...defaultText,
    solo: "Solo · time trial",
    needTwo: "Take a seat to start.",
  },
};
