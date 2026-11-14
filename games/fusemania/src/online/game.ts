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
  FULL_RATING,
  LEAD_IN_MS,
  MAX_SONG_MS,
  MIN_SONG_MS,
  MODES,
  RELEASE,
  RULES,
  SCORE_MODE,
  SOLO_LEAD_IN_MS,
  TICK_MS,
  UP,
  createWorld,
  decodeWorld,
  encodeWorld,
  isCode,
  ranking,
  rating,
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
  /** How many songs one session plays: one of `SESSION_LENGTHS`. One is a single song with no session around it. */
  songs: number;
  /** A session's songs are drawn at random instead of picked by the host. */
  random: boolean;
}
/** The most charts one song offers a room. */
export const MAX_CHARTS = 16;
/** How long a session can be, in songs. */
export const SESSION_LENGTHS: readonly number[] = [1, 3, 5, 10];
/** The most riders a session keeps a total for: the ones who left longest ago and scored least make room. */
export const SESSION_SCORES = 16;
const SETTING_KEYS = ["display", "song", "mode", "chart", "songs", "random"];

export const PLAY = 0,
  PICK = 1,
  READY = 2;
/**
 * The longest a started song waits for its devices to have the audio, in log ticks (30 s): a device that never
 * answers, a tab left in the background, does not keep the room from its song.
 */
export const HOLD_TICKS = Math.round(30000 / TICK_MS);
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
/**
 * This device is done getting the song of the match numbered `epoch`: it has the audio, or it will not play any
 * (muted, a phone that is a pad, a file that would not load).
 */
export type ReadyEntry = [
  seq: number,
  tick: number,
  kind: typeof READY,
  epoch: number,
];
export type Entry =
  ManagementEntry<Settings> | PlayEntry | PickEntry | ReadyEntry;
/** A started song that stands at its first moment until every device has its audio. */
export interface Hold {
  /** Log ticks waited so far: at most `HOLD_TICKS`. */
  ticks: number;
  /** The members whose devices are done, sorted. */
  ready: string[];
  /**
   * The shared screen is waited for too: the room's creator when it holds no seat, which is the TV of a shared
   * screen room. It plays the song for everyone, and the seats cannot speak for it.
   */
  screen: boolean;
}

export const MAX_WATCHERS = 5;
/** The room's size, whatever library the game is made with: what the service sizes its rooms by. */
export const ROOM = {
  seating: { capacity: CAPACITY, maxWatchers: MAX_WATCHERS },
} as const;
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

/** One rider's total over a session's songs. */
export interface SessionScore {
  id: string;
  name: string;
  /** The ratings of the songs it finished, added up. */
  points: number;
  /** The songs it won. */
  wins: number;
}
/** Several songs played as one contest: the room adds every finished song's ratings up. */
export interface Session {
  /** Songs the session plays: 3, 5 or 10. */
  length: number;
  /** Songs finished. */
  done: number;
  /** The songs started, in order: the finished ones, then the one being played. A song given up is not kept. */
  songs: string[];
  /** A total per rider, in the order they first finished a song. */
  scores: SessionScore[];
}
/** A session as the screen shows it. */
export interface SessionView {
  length: number;
  done: number;
  songs: string[];
  /** The totals, the leader's first: by points, then by songs won. */
  standings: SessionScore[];
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
  /** The session the room is in the middle of, or just finished; null when it plays single songs. */
  session: Session | null;
  /** The running song waits for its devices to have the audio; null once it moves, and outside a match. */
  hold: Hold | null;
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
  session: SessionView | null;
  /**
   * Who a started song still waits for (their devices are getting its audio): the seats by id and whether the
   * shared screen is one of them. Null when the song is not held.
   */
  waiting: { ids: string[]; screen: boolean } | null;
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
const FIELDS = 12;
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

/** The standings of a session's totals: by points, then by songs won, then in the order riders joined it. */
export const standings = (scores: readonly SessionScore[]): SessionScore[] =>
  scores
    .map((score, index) => ({ score, index }))
    .sort(
      (a, b) =>
        b.score.points - a.score.points ||
        b.score.wins - a.score.wins ||
        a.index - b.index,
    )
    .map(({ score }) => ({ ...score }));

function decodeSession(
  raw: unknown,
  known: (song: string) => boolean,
): Session | null | undefined {
  if (raw === null) return null;
  if (!Array.isArray(raw) || raw.length !== 4) return;
  const [length, done, songs, scores] = raw as unknown[];
  if (
    !Number.isInteger(length) ||
    length === 1 ||
    !SESSION_LENGTHS.includes(length as number) ||
    !uint32(done) ||
    done > (length as number) ||
    !Array.isArray(songs) ||
    (songs.length !== done && songs.length !== done + 1) ||
    songs.length > (length as number) ||
    !songs.every((song) => typeof song === "string" && known(song)) ||
    !Array.isArray(scores) ||
    scores.length > SESSION_SCORES ||
    (done === 0 && scores.length > 0)
  )
    return;
  const list: SessionScore[] = [];
  let won = 0;
  for (const item of scores as unknown[]) {
    if (!Array.isArray(item) || item.length !== 4) return;
    const [id, name, points, wins] = item as unknown[];
    if (
      !playerKey(id) ||
      !validName(name) ||
      !uint32(points) ||
      // A doubled stretch can take one song's rating past the full one, never past twice it.
      points > done * 2 * FULL_RATING ||
      !uint32(wins) ||
      list.some((score) => score.id === id)
    )
      return;
    won += wins;
    list.push({ id, name, points, wins });
  }
  // Every finished song had one winner; a rider dropped from the list took its wins along.
  if (won > done) return;
  return {
    length: length as number,
    done,
    songs: [...(songs as string[])],
    scores: list,
  };
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
    const { display, song, mode, chart, songs, random } = raw;
    if (
      typeof display !== "boolean" ||
      typeof song !== "string" ||
      !library.song(song) ||
      !Number.isInteger(mode) ||
      (mode as number) < 0 ||
      (mode as number) >= MODES ||
      !chartIndex(chart) ||
      !SESSION_LENGTHS.includes(songs as number) ||
      typeof random !== "boolean"
    )
      return;
    return {
      display,
      song,
      mode: mode as number,
      chart,
      songs: songs as number,
      random,
    };
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
    if (raw[2] === READY) return raw.length === 4 && uint32(raw[3]);
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
      session: null,
      hold: null,
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
    room.hold = null;
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
    room.hold = { ticks: 0, ready: [], screen: false };
  }
  /** The members a held song waits for: every device that is in the room and not done getting the audio. */
  const awaited = (room: Room, hold: Hold): string[] =>
    [...room.seats.values()]
      .filter(
        (seat) =>
          !seat.bot &&
          seat.connected &&
          seat.away !== true &&
          !hold.ready.includes(seat.id),
      )
      .sort(seatOrder)
      .map((seat) => seat.id);
  const matchId = (room: Room) => room.matchId;

  /**
   * The song a random session plays next, from the match's id: one it has not played yet while there is one, and
   * otherwise any but the last.
   */
  function draw(session: Session, id: string): string | undefined {
    const all = library.songs.map((song) => song.id);
    const last = session.songs[session.songs.length - 1];
    let pool = all.filter((song) => !session.songs.includes(song));
    if (!pool.length) pool = all.filter((song) => song !== last);
    if (!pool.length) pool = all;
    return pool[seedOf(id) % pool.length];
  }
  /**
   * Starts the next song. With more than one song a session it is a song of the session: the one the room is in the
   * middle of, or a new session when there is none, the last one is finished or the host changed its length.
   */
  function startSong(room: Room, id: string): void {
    resetMatch(room, id);
    let session = room.play.songs > 1 ? room.session : null;
    if (
      room.play.songs > 1 &&
      (!session ||
        session.done >= session.length ||
        session.length !== room.play.songs)
    )
      session = { length: room.play.songs, done: 0, songs: [], scores: [] };
    if (session) {
      // A song that was given up is not one of the session's.
      session.songs.length = session.done;
      const song = room.play.random ? draw(session, id) : undefined;
      if (song !== undefined) {
        // The lobby shows the song that was drawn, as it shows one the host picked.
        room.play.song = song;
        room.settings = { ...room.settings, song };
      }
    }
    room.session = session;
    beginMatch(room);
    if (session && room.stage === "running") session.songs.push(room.play.song);
  }
  /** Adds a finished song to the session's totals. */
  function settle(room: Room, world: World, winner: string): void {
    const session = room.session;
    if (!session) return;
    session.done++;
    for (const entrant of room.roster) {
      const player = world.players[entrant.slot]!;
      let score = session.scores.find((each) => each.id === entrant.id);
      if (!score) {
        if (session.scores.length >= SESSION_SCORES) {
          // Full: the rider who is gone and has the least makes room.
          let out = -1;
          session.scores.forEach((each, index) => {
            if (room.roster.some((other) => other.id === each.id)) return;
            if (out < 0 || each.points < session.scores[out]!.points)
              out = index;
          });
          if (out < 0) continue;
          session.scores.splice(out, 1);
        }
        score = { id: entrant.id, name: entrant.name, points: 0, wins: 0 };
        session.scores.push(score);
      }
      score.name = entrant.name;
      score.points += rating(
        library.steps(world.song, player.chart)!,
        player.score,
      );
      if (entrant.id === winner) score.wins++;
    }
  }

  const lifecycle: LifecycleHooks<Room, Settings> = {
    stage: (room) => room.stage,
    maxWatchers: MAX_WATCHERS,
    parseSettings,
    botAvatar: AVATAR,
    start: startSong,
    rematch: startSong,
    lobby(room, id) {
      resetMatch(room, id);
      const session = room.session;
      // A finished session is over; one in the middle waits in the lobby for its next song.
      if (session && session.done >= session.length) room.session = null;
      else if (session) session.songs.length = session.done;
    },
  };

  /** The seat's own entries for this tick, from the stream generation its controls follow, in the order written. */
  function ownEntries(
    seat: Pick<SeatRecord, "id" | "generation">,
    streams: ReadonlyMap<string, StreamEntries<Entry>>,
    tick: number,
  ): (PlayEntry | PickEntry | ReadyEntry)[] {
    const stream = streams.get(seat.id);
    const source =
      stream?.generation === seat.generation
        ? stream
        : stream?.retired?.find((old) => old.generation === seat.generation);
    return (source?.entries ?? [])
      .filter(
        (entry): entry is PlayEntry | PickEntry | ReadyEntry =>
          entry[1] === tick &&
          (entry[2] === PLAY || entry[2] === PICK || entry[2] === READY),
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
        else if (entry[2] === READY) continue;
        else if (
          slot >= 0 &&
          room.stage === "running" &&
          entry[3] === room.epoch
        )
          inputs.push({ slot, code: entry[4], ms: entry[5] });
      }
    }
    const hold = room.stage === "running" ? room.hold : null;
    if (hold) {
      // Anyone in the room says so, a watcher and the shared screen too: they hear the song as the riders do.
      const said = (seat: Pick<SeatRecord, "id" | "generation">) =>
        ownEntries(seat, streams, tick).some(
          (entry) => entry[2] === READY && entry[3] === room.epoch,
        );
      for (const seat of room.seats.values())
        if (
          !seat.bot &&
          seat.connected &&
          !hold.ready.includes(seat.id) &&
          said(seat)
        )
          hold.ready.push(seat.id);
      // A shared screen room's TV is its creator and holds no seat: its own stream speaks for it.
      const tv = room.play.display && !room.seats.has(creatorId);
      if (
        tv &&
        !hold.ready.includes(creatorId) &&
        said({
          id: creatorId,
          generation: streams.get(creatorId)?.generation ?? 0,
        })
      )
        hold.ready.push(creatorId);
      hold.ready = hold.ready
        .filter((id) => room.seats.has(id) || (tv && id === creatorId))
        .sort();
      hold.screen = tv && !hold.ready.includes(creatorId);
      if (
        (!hold.screen && !awaited(room, hold).length) ||
        hold.ticks >= HOLD_TICKS
      )
        room.hold = null;
      else hold.ticks++;
    }
    const world = room.world;
    // A held song stands at its first moment: nothing is judged and the song time does not move.
    if (room.stage === "running" && world && !room.hold) {
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
        settle(room, world, room.decided.winner);
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
      room.session
        ? [
            room.session.length,
            room.session.done,
            [...room.session.songs],
            room.session.scores.map((score) => [
              score.id,
              score.name,
              score.points,
              score.wins,
            ]),
          ]
        : null,
      room.hold
        ? [room.hold.ticks, [...room.hold.ready], room.hold.screen]
        : null,
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
      rawSession,
      rawHold,
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
    const session = decodeSession(
      rawSession,
      (song) => library.song(song) !== undefined,
    );
    if (
      !picks ||
      decided === undefined ||
      world === undefined ||
      session === undefined
    )
      return;
    if (world === null) {
      // The lobby has no match: no world, no riders and nothing decided, and a session there is between two songs.
      if (stage !== "lobby" || roster.length || decided) return;
      if (
        session &&
        (session.done >= session.length ||
          session.songs.length !== session.done)
      )
        return;
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
      // A match of several songs a session is one of its session's songs, and a single song has no session.
      if (play.songs > 1 !== (session !== null)) return;
      if (session) {
        const at = stage === "running" ? session.done : session.done - 1;
        if (
          session.length !== play.songs ||
          session.songs.length !== at + 1 ||
          session.songs[at] !== play.song ||
          (decided !== null &&
            // The song just decided is in the totals: every rider has one, no less than this song gave it.
            world.players.some((player, slot) => {
              const score = session.scores.find(
                (each) => each.id === roster[slot]!.id,
              );
              return (
                !score ||
                score.points <
                  rating(library.steps(world.song, player.chart)!, player.score)
              );
            }))
        )
          return;
      }
    }
    let hold: Hold | null = null;
    if (rawHold !== null) {
      // Only a running song is held, by members of the room, each named once and in order.
      if (
        stage !== "running" ||
        !Array.isArray(rawHold) ||
        rawHold.length !== 3 ||
        !uint32(rawHold[0]) ||
        rawHold[0] > HOLD_TICKS ||
        !Array.isArray(rawHold[1]) ||
        typeof rawHold[2] !== "boolean" ||
        (rawHold[2] && !play.display)
      )
        return;
      const ready: unknown[] = rawHold[1];
      // At most one of them is no seat: the shared screen, which only a shared screen room has.
      if (
        ready.length > seats.size + 1 ||
        !ready.every(
          (member, index): member is string =>
            playerKey(member) &&
            seats.get(member)?.bot !== true &&
            (index === 0 || (ready[index - 1] as string) < member),
        ) ||
        ready.filter((member) => !seats.has(member)).length >
          (play.display && !rawHold[2] ? 1 : 0)
      )
        return;
      hold = { ticks: rawHold[0], ready: [...ready], screen: rawHold[2] };
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
      session,
      hold,
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
      session: room.session
        ? {
            length: room.session.length,
            done: room.session.done,
            songs: [...room.session.songs],
            standings: standings(room.session.scores),
          }
        : null,
      waiting:
        room.stage === "running" && room.hold
          ? { ids: awaited(room, room.hold), screen: room.hold.screen }
          : null,
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
      ...ROOM.seating,
      minPlayers: 1,
      seatName,
      isAvatar,
      defaultAvatar: AVATAR,
      parseSettings,
      soloSettings: (settings) => ({ ...settings, display: false }),
      sharedScreen: (settings) => settings.display,
      botId(room, pending) {
        // Never an id the match or the session remembers, so a new bot is not mistaken for a departed one in the
        // result, and does not start with a departed one's session total.
        let number = 1;
        const taken = (id: string) =>
          room.seats.has(id) ||
          pending.has(id) ||
          room.roster.some((entrant) => entrant.id === id) ||
          room.session?.scores.some((score) => score.id === id) === true;
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
  songs: 1,
  random: false,
});
