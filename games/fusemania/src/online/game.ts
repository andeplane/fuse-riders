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
  LEAD_IN_MS,
  MAX_SONG_MS,
  MIN_SONG_MS,
  MODES,
  RELEASE,
  RULES,
  SCORE_MODE,
  SOLO_LEAD_IN_MS,
  UP,
  createWorld,
  decodeWorld,
  encodeWorld,
  isCode,
  ranking,
  stepWorld,
  toView,
  type Input,
  type Library,
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
 * Fusemania behind the netcode's `RollbackGame`. The room keeps the seats, the lobby's settings (the song, the mode
 * and the chart a seat plays unless it picked its own) and one match. One log tick folds the management entries and
 * every rider's key presses, each stamped with the song time its device heard, then moves the song by one tick.
 */
export interface Settings {
  /** One shared screen with phones as controllers. */
  display: boolean;
  /** The song's id in the library. */
  song: string;
  /** `SCORE_MODE` or `BATTLE_MODE`. */
  mode: number;
  /** The chart a seat plays unless it picked one: an index into the song's charts, easiest first. */
  chart: number;
}
/** The most charts one song offers a room. */
export const MAX_CHARTS = 16;
const SETTING_KEYS = ["display", "song", "mode", "chart"];

export const PLAY = 0,
  PICK = 1;
/**
 * A key of this seat moved (or its power-up button was pressed) in the match numbered `epoch`, at song time `ms`.
 * The epoch counts the room's matches, so a late entry from the last match never plays in this one.
 */
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof PLAY,
  epoch: number,
  code: number,
  ms: number,
];
/** This seat plays chart `chart` from the next match on. */
export type PickEntry = [
  seq: number,
  tick: number,
  kind: typeof PICK,
  chart: number,
];
export type Entry = ManagementEntry<Settings> | PlayEntry | PickEntry;

export const MAX_WATCHERS = 5;
export type RoomStage = "lobby" | "running" | "over";

/** A rider of the current match as it started: the result names them even if the seat is gone by the end. */
export interface Entrant {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
  chart: number;
}
/** The finished match, frozen on the tick it was decided so every replica reports the same thing. */
export interface Decided {
  /** The log tick it was decided on: a report waits until it is confirmed. */
  clock: number;
  winner: string;
  /** The humans still seated when it ended, sorted: who can attest the result. */
  finishers: string[];
}

export interface Room extends ManagedRoom<Settings> {
  tick: number;
  matchId: string;
  /** Matches this room has started. */
  epoch: number;
  stage: RoomStage;
  /** The settings the current match plays with, fixed at its start. */
  play: Settings;
  /** The chart each seat picked for itself, by member id. */
  picks: Record<string, number>;
  /** The match's riders in slot order; empty in the lobby. */
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
  /** The chart the seat will play in the next match. */
  chart: number;
}
/** What the screen renders. Outcomes are read from here, never from events, so a rollback's correction shows. */
export interface View {
  /** The log tick. */
  tick: number;
  stage: RoomStage;
  matchId: string;
  epoch: number;
  /** The lobby's settings: what the next match plays. */
  settings: Settings;
  /** The settings of the match being played. */
  play: Settings;
  seats: SeatView[];
  roster: Entrant[];
  /** The winner's id once `stage` is "over", otherwise "". */
  winner: string;
  world: WorldView | null;
}

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const chartIndex = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= 0 &&
  (value as number) < MAX_CHARTS;

/** A match's seed, from its id. */
export function seedOf(matchId: string): number {
  let seed = 0x811c9dc5;
  for (let i = 0; i < matchId.length; i++)
    seed = Math.imul(seed ^ matchId.charCodeAt(i), 0x01000193) >>> 0;
  return seed;
}

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

function decodePicks(
  raw: unknown,
  seats: ReadonlyMap<string, SeatRecord>,
): Record<string, number> | undefined {
  if (!Array.isArray(raw) || raw.length > CAPACITY) return;
  const picks: Record<string, number> = {};
  for (const pair of raw) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !playerKey(pair[0]) ||
      Object.hasOwn(picks, pair[0]) ||
      // Only a seated rider has a pick.
      seats.get(pair[0])?.watcher !== undefined ||
      !seats.has(pair[0]) ||
      !chartIndex(pair[1])
    )
      return;
    picks[pair[0]] = pair[1];
  }
  return picks;
}

function decodeRoster(raw: unknown): Entrant[] | undefined {
  if (!Array.isArray(raw) || raw.length > CAPACITY) return;
  const roster: Entrant[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 4) return;
    const [id, name, bot, chart] = item as unknown[];
    if (
      !playerKey(id) ||
      !validName(name) ||
      typeof bot !== "boolean" ||
      !chartIndex(chart) ||
      roster.some((entrant) => entrant.id === id)
    )
      return;
    roster.push({ id, name, slot: roster.length, bot, chart });
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

export type FusemaniaGame = RollbackGame<Room, Entry, View, never, Settings> & {
  /** The songs this game plays. */
  library: Library;
};

/**
 * The game over a library of songs: the bundled one for rooms, or one with a loaded simfile for a solo run.
 * `soloBots` is how many AI rivals a solo run starts with.
 */
export function createFusemaniaGame(
  library: Library,
  soloBots = 0,
): FusemaniaGame {
  /** The settings boundary, for a logged entry, a command and a checkpoint alike: exactly the fields, each checked. */
  function parseSettings(raw: unknown): Settings | undefined {
    if (!plain(raw)) return;
    const keys = Object.keys(raw);
    if (
      keys.length !== SETTING_KEYS.length ||
      !SETTING_KEYS.every((key) => Object.hasOwn(raw, key))
    )
      return;
    const { display, song, mode, chart } = raw;
    if (
      typeof display !== "boolean" ||
      typeof song !== "string" ||
      !library.song(song) ||
      !Number.isInteger(mode) ||
      (mode as number) < 0 ||
      (mode as number) >= MODES ||
      !chartIndex(chart)
    )
      return;
    return { display, song, mode: mode as number, chart };
  }

  const payloads = {
    name: validName,
    avatar: isAvatar,
    settings: (value: unknown) => parseSettings(value) !== undefined,
    capacity: CAPACITY,
  };
  function isEntry(raw: unknown): raw is Entry {
    if (isManagementEntry(raw, payloads)) {
      if (raw[2] === ACTION) return validMatchId(raw[4]);
      // Member ids become record keys: one of Object.prototype's names never does.
      const at =
        raw[2] === BOT || raw[2] === SPECTATOR
          ? 4
          : raw[2] <= PRESENCE
            ? 3
            : -1;
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
    if (raw[2] === PLAY)
      return (
        raw.length === 6 &&
        uint32(raw[3]) &&
        isCode(raw[4]) &&
        Number.isInteger(raw[5]) &&
        raw[5] >= MIN_SONG_MS &&
        raw[5] <= MAX_SONG_MS
      );
    return raw[2] === PICK && raw.length === 4 && chartIndex(raw[3]);
  }

  function createRoom(matchId: string, settings: Settings): Room {
    return {
      tick: 0,
      matchId,
      epoch: 0,
      stage: "lobby",
      seats: new Map(),
      settings: { ...settings },
      play: { ...settings },
      picks: {},
      roster: [],
      decided: null,
      world: null,
    };
  }

  /** Seats in slot order, watchers excluded. */
  const riders = (room: Room): SeatRecord[] =>
    [...room.seats.values()]
      .filter((seat) => !seat.watcher)
      .sort((a, b) => a.slot - b.slot);

  function resetMatch(room: Room, matchId: string): void {
    room.matchId = matchId;
    room.play = { ...room.settings };
    room.stage = "lobby";
    room.roster = [];
    room.decided = null;
    room.world = null;
  }
  /** Starts a match for the seats, in seat order, or leaves the room in its lobby when nobody is seated. */
  function beginMatch(room: Room): void {
    const seated = riders(room);
    if (seated.length < 1) return;
    const charts = library.song(room.play.song)?.charts.length ?? 1;
    const roster = seated.map((seat, index) => ({
      id: seat.id,
      name: seat.name,
      slot: index,
      bot: seat.bot,
      chart: Math.min(
        (seat.bot ? undefined : room.picks[seat.id]) ?? room.play.chart,
        charts - 1,
      ),
    }));
    const world = createWorld(
      library,
      room.play.song,
      room.play.mode,
      seedOf(matchId(room)),
      roster,
      roster.length === 1 ? SOLO_LEAD_IN_MS : LEAD_IN_MS,
    );
    if (!world) return;
    room.roster = roster;
    room.world = world;
    room.stage = "running";
    room.epoch++;
  }
  const matchId = (room: Room) => room.matchId;

  const lifecycle: LifecycleHooks<Room, Settings> = {
    stage: (room) => room.stage,
    maxWatchers: MAX_WATCHERS,
    parseSettings,
    botAvatar: AVATAR,
    start(room, id) {
      resetMatch(room, id);
      beginMatch(room);
    },
    rematch(room, id) {
      resetMatch(room, id);
      beginMatch(room);
    },
    lobby(room, id) {
      resetMatch(room, id);
    },
  };

  /** The seat's own entries for this tick, from the stream generation its controls follow, in the order written. */
  function ownEntries(
    seat: SeatRecord,
    streams: ReadonlyMap<string, StreamEntries<Entry>>,
    tick: number,
  ): (PlayEntry | PickEntry)[] {
    const stream = streams.get(seat.id);
    const source =
      stream?.generation === seat.generation
        ? stream
        : stream?.retired?.find((old) => old.generation === seat.generation);
    return (source?.entries ?? [])
      .filter(
        (entry): entry is PlayEntry | PickEntry =>
          entry[1] === tick && (entry[2] === PLAY || entry[2] === PICK),
      )
      .sort((a, b) => a[0] - b[0]);
  }

  function foldTick(
    room: Room,
    creatorId: string,
    streams: ReadonlyMap<string, StreamEntries<Entry>>,
  ): never[] {
    const tick = room.tick + 1;
    applyManagementTick(room, tick, creatorId, streams, lifecycle);
    // A pick is a seat's own: it lasts while the seat does.
    for (const id of Object.keys(room.picks))
      if (!room.seats.has(id) || room.seats.get(id)!.watcher)
        delete room.picks[id];
    const inputs: Input[] = [];
    for (const seat of riders(room)) {
      if (seat.bot) continue;
      const slot = room.roster.findIndex((entrant) => entrant.id === seat.id);
      if (!seat.connected) {
        // A seat that went away let go of its keys: its key-up is never heard, so nothing of it stays held.
        const player =
          room.stage === "running" ? room.world?.players[slot] : undefined;
        if (player && room.world)
          for (const [column, down] of player.down.entries())
            if (down !== UP)
              inputs.push({ slot, code: RELEASE + column, ms: room.world.ms });
        continue;
      }
      for (const entry of ownEntries(seat, streams, tick)) {
        if (entry[2] === PICK) room.picks[seat.id] = entry[3];
        else if (
          slot >= 0 &&
          room.stage === "running" &&
          entry[3] === room.epoch
        )
          inputs.push({ slot, code: entry[4], ms: entry[5] });
      }
    }
    const world = room.world;
    if (room.stage === "running" && world) {
      // Riders in roster order, each one's inputs as it wrote them.
      inputs.sort((a, b) => a.slot - b.slot);
      stepWorld(library, world, inputs);
      if (world.phase === "over") {
        room.stage = "over";
        room.decided = {
          clock: tick,
          winner: room.roster[ranking(library, world)[0]!]!.id,
          finishers: room.roster
            .filter((entrant) => {
              const seat = room.seats.get(entrant.id);
              return (
                !entrant.bot && seat && (seat.connected || seat.away === true)
              );
            })
            .map((entrant) => entrant.id)
            .sort(),
        };
      }
    }
    room.tick = tick;
    return [];
  }

  function encode(room: Room): unknown[] {
    return [
      room.matchId,
      room.stage,
      { ...room.settings },
      [...room.seats.values()].sort(seatOrder).map((seat) => ({ ...seat })),
      { ...room.play },
      Object.entries(room.picks).sort(([a], [b]) => (a < b ? -1 : 1)),
      room.roster.map((entrant) => [
        entrant.id,
        entrant.name,
        entrant.bot,
        entrant.chart,
      ]),
      room.decided
        ? [room.decided.clock, room.decided.winner, [...room.decided.finishers]]
        : null,
      room.world ? encodeWorld(room.world) : null,
      room.epoch,
    ];
  }

  /**
   * The room a checkpoint describes, or nothing: every field is checked on its own and against the others, and the
   * room is built only once all of them hold, so a refused checkpoint leaves no half-read state behind.
   */
  function decode(fields: readonly unknown[], tick: number): Room | undefined {
    if (fields.length !== FIELDS || !uint32(tick)) return;
    const [
      id,
      stage,
      rawSettings,
      rawSeats,
      rawPlay,
      rawPicks,
      rawRoster,
      rawDecided,
      rawWorld,
      epoch,
    ] = fields;
    const settings = parseSettings(rawSettings),
      play = parseSettings(rawPlay),
      seats = decodeSeats(rawSeats),
      roster = decodeRoster(rawRoster);
    if (
      !validMatchId(id) ||
      !STAGES.some((known) => known === stage) ||
      !settings ||
      !play ||
      !seats ||
      !roster ||
      !uint32(epoch) ||
      epoch > tick
    )
      return;
    const picks = decodePicks(rawPicks, seats);
    const decided = decodeDecided(rawDecided, roster);
    const world = rawWorld === null ? null : decodeWorld(library, rawWorld);
    if (!picks || decided === undefined || world === undefined) return;
    if (world === null) {
      // The lobby has no match: no world, no riders and nothing decided.
      if (stage !== "lobby" || roster.length || decided) return;
    } else {
      const charts = library.song(play.song)?.charts.length ?? 0;
      if (
        stage === "lobby" ||
        epoch === 0 ||
        world.song !== play.song ||
        world.mode !== play.mode ||
        world.seed !== seedOf(id) ||
        (stage === "running") === (world.phase === "over") ||
        (stage === "over") !== (decided !== null) ||
        world.players.length !== roster.length ||
        world.players.some(
          (player, slot) =>
            player.id !== roster[slot]!.id ||
            player.bot !== roster[slot]!.bot ||
            player.chart !== roster[slot]!.chart,
        ) ||
        roster.some((entrant) => entrant.chart >= charts) ||
        (decided !== null &&
          (decided.clock > tick ||
            decided.winner !== roster[ranking(library, world)[0]!]!.id))
      )
        return;
    }
    return {
      tick,
      matchId: id,
      epoch,
      stage: stage as RoomStage,
      seats,
      settings,
      play,
      picks,
      roster,
      decided,
      world,
    };
  }

  function hash(room: Room): string {
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

  function view(room: Room): View {
    const charts = library.song(room.settings.song)?.charts.length ?? 1;
    return {
      tick: room.tick,
      stage: room.stage,
      matchId: room.matchId,
      epoch: room.epoch,
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
        chart: Math.min(
          (seat.bot ? undefined : room.picks[seat.id]) ?? room.settings.chart,
          charts - 1,
        ),
      })),
      roster: room.roster.map((entrant) => ({ ...entrant })),
      winner: room.decided?.winner ?? "",
      world: room.world ? toView(library, room.world) : null,
    };
  }

  return {
    library,
    id: GAME_ID,
    rules: RULES,
    isEntry,
    createRoom,
    createTicker: () => foldTick,
    scope: (room) => ({ matchId: room.matchId, round: 0 }),
    clock: (room) => room.tick,
    steps: () => 1,
    maxSteps: 1,
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
      solo: { name: "You", bots: soloBots },
    },
    text: {
      ...defaultText,
      solo: "Solo",
      needTwo: "Take a seat to start.",
    },
  };
}

/** The settings a library's first song starts a room with. */
export const defaultSettings = (library: Library): Settings => ({
  display: false,
  song: library.songs[0]?.id ?? "",
  mode: SCORE_MODE,
  chart: 1,
});
