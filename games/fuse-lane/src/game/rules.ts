import {
  ACTION,
  BOT,
  PRESENCE,
  SPECTATOR,
  applyManagementTick,
  isManagementEntry,
  memberId,
  uint32,
  type LifecycleHooks,
  type ManagementEntry,
  type SeatRecord,
  type StreamEntries,
} from "fuse-netcode";
import {
  BRIEFING_TICKS,
  CAPACITY,
  GOAL_MAX,
  GOAL_MIN,
  MAX_NAME,
  TICKS_PER_SECOND,
  WEEK_SECONDS,
  WEEK_UNITS,
  validName,
} from "./basics.js";
import { JOBS } from "./data/jobs.js";
import { PLACES } from "./data/places.js";
import {
  APPLY,
  LAST_ACTION,
  act,
  resolveApplications,
  walkTick,
  walkTo,
} from "./actions.js";
import { BOT_DELAY, botMove } from "./bot.js";
import { createEconomy } from "./economy.js";
import { seedOf } from "./random.js";
import {
  BRIEFING,
  WEEK,
  active,
  playerOrder,
  seated,
  type FuseLaneRoom,
  type FuseLaneSettings,
} from "./room.js";
import { createPlayer, defaultGoals, type Goals } from "./state.js";
import { endWeek } from "./week.js";
export * from "./basics.js";
export * from "./room.js";

/**
 * Fuse Lane on the shared log: one pure fold per log tick. Everyone plays the same week at once; a week ends for a
 * player at 60 hours, on CALL IT A WEEK or when the real-time limit runs out, and when every player is done the week
 * is processed and a Monday briefing shows until everyone is READY or it times out.
 */

/** A player's entry kinds, after the shared management kinds (10–16). */
export const WALK = 0,
  ACT = 1,
  END_WEEK = 2,
  READY = 3,
  GOALS = 4;

/** `[seq, tick, WALK, week, place]`, `[seq, tick, ACT, week, place, action, a, b]`, `[seq, tick, END_WEEK|READY, week]`, `[seq, tick, GOALS, 0, w, h, e, c]`. */
export type PlayEntry =
  | [seq: number, tick: number, kind: typeof WALK, week: number, place: number]
  | [
      seq: number,
      tick: number,
      kind: typeof ACT,
      week: number,
      place: number,
      action: number,
      a: number,
      b: number,
    ]
  | [
      seq: number,
      tick: number,
      kind: typeof END_WEEK | typeof READY,
      week: number,
    ]
  | [
      seq: number,
      tick: number,
      kind: typeof GOALS,
      zero: 0,
      w: number,
      h: number,
      e: number,
      c: number,
    ];
export type FuseLaneEntry = ManagementEntry<FuseLaneSettings> | PlayEntry;

export type FuseLaneEvent =
  | { type: "week"; week: number }
  | { type: "briefing"; week: number }
  | { type: "over"; winners: string[] };

export const MAX_WATCHERS = 8;
/** Everyone who ever sat in a match, departed seats included. */
export const MAX_PARTICIPANTS = 64;
/** The largest amount or quantity an action may name. */
export const MAX_AMOUNT = 1_000_000_000;

export const DEFAULT_SETTINGS: FuseLaneSettings = {
  weekSeconds: 60,
  display: false,
};

const CONTROL = /[\u0000-\u001f\u007f]/;
/** What a player typed, as it is seated: trimmed and cut to `MAX_NAME` code points, or refused. */
export function seatName(raw: string): string | undefined {
  if (CONTROL.test(raw)) return;
  const name = Array.from(raw.replace(/\p{Cs}/gu, "").trim())
    .slice(0, MAX_NAME)
    .join("")
    .trim();
  return validName(name) ? name : undefined;
}
export const AVATARS = [
  "robot",
  "cat",
  "fox",
  "alien",
  "astronaut",
  "skull",
  "octopus",
  "dragon",
  "owl",
  "slime",
] as const;
export const isAvatar = (value: unknown): value is string =>
  (AVATARS as readonly unknown[]).includes(value);

/** A match id as the entry boundary and the checkpoint accept it: 1–64 printable ASCII characters. */
export const validMatchId = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7e]{1,64}$/.test(value);
/** A member id that is safe as a record key: never one of `Object.prototype`'s names. */
export const playerKey = (value: unknown): value is string =>
  memberId(value) && !(value in Object.prototype);
export const validGoal = (value: unknown): value is number =>
  uint32(value) && value >= GOAL_MIN && value <= GOAL_MAX && value % 10 === 0;

export function parseSettings(raw: unknown): FuseLaneSettings | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  const keys = Object.keys(raw);
  const { weekSeconds, display } = raw as Partial<FuseLaneSettings>;
  if (
    keys.length !== 2 ||
    !keys.includes("weekSeconds") ||
    !keys.includes("display") ||
    !(WEEK_SECONDS as readonly unknown[]).includes(weekSeconds) ||
    typeof display !== "boolean"
  )
    return;
  return { weekSeconds: weekSeconds!, display };
}

const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (value: unknown) => parseSettings(value) !== undefined,
  capacity: CAPACITY,
};
const small = (value: unknown, most: number): value is number =>
  uint32(value) && value <= most;
/** The wire boundary for every entry: the shared management entries and the play entries above. */
export function isFuseLaneEntry(raw: unknown): raw is FuseLaneEntry {
  if (isManagementEntry(raw, payloads)) {
    if (raw[2] === ACTION) return validMatchId(raw[4]);
    const at =
      raw[2] === BOT || raw[2] === SPECTATOR ? 4 : raw[2] <= PRESENCE ? 3 : -1;
    return at < 0 || playerKey((raw as unknown[])[at]);
  }
  if (
    !Array.isArray(raw) ||
    raw.length < 4 ||
    !uint32(raw[0]) ||
    raw[0] < 1 ||
    !uint32(raw[1]) ||
    raw[1] < 1 ||
    !small(raw[3], 100_000)
  )
    return false;
  switch (raw[2]) {
    case WALK:
      return raw.length === 5 && small(raw[4], PLACES.length - 1);
    case ACT:
      return (
        raw.length === 8 &&
        small(raw[4], PLACES.length - 1) &&
        uint32(raw[5]) &&
        raw[5] >= 1 &&
        raw[5] <= LAST_ACTION &&
        small(raw[6], MAX_AMOUNT) &&
        small(raw[7], MAX_AMOUNT)
      );
    case END_WEEK:
    case READY:
      return raw.length === 4;
    case GOALS:
      return (
        raw.length === 8 &&
        raw[3] === 0 &&
        validGoal(raw[4]) &&
        validGoal(raw[5]) &&
        validGoal(raw[6]) &&
        validGoal(raw[7])
      );
    default:
      return false;
  }
}

export function createRoom(
  matchId: string,
  settings: FuseLaneSettings,
): FuseLaneRoom {
  return {
    tick: 0,
    matchId,
    stage: "lobby",
    seats: new Map(),
    settings: { ...settings },
    weekTicks: settings.weekSeconds * TICKS_PER_SECOND,
    rng: seedOf(matchId),
    week: 0,
    phase: WEEK,
    phaseStart: 0,
    phaseEnd: 0,
    economy: createEconomy(),
    players: {},
    goals: {},
    roster: {},
    headlines: [],
    ranking: [],
    winners: [],
  };
}

function remember(room: FuseLaneRoom): void {
  for (const seat of seated(room))
    room.roster[seat.id] = { name: seat.name, slot: seat.slot };
}
/** A bot plays for the goals of the first human seated, or the defaults. */
function goalsFor(room: FuseLaneRoom, seat: SeatRecord): Goals {
  const own = room.goals[seat.id];
  if (own) return [...own];
  const human = seated(room).find(
    (other) => !other.bot && room.goals[other.id],
  );
  return human ? [...room.goals[human.id]!] : defaultGoals();
}
/** Every seated player has a life in this match: a seat that joins a running match starts one. */
function enrol(room: FuseLaneRoom, tick: number): void {
  remember(room);
  for (const seat of seated(room))
    if (!room.players[seat.id]) {
      const player = createPlayer(goalsFor(room, seat));
      player.botAt = tick + BOT_DELAY + seat.slot;
      room.players[seat.id] = player;
    }
}
function beginWeek(
  room: FuseLaneRoom,
  tick: number,
  events: FuseLaneEvent[],
): void {
  room.phase = WEEK;
  room.phaseStart = tick;
  room.phaseEnd = tick + room.weekTicks;
  for (const [id, player] of Object.entries(room.players))
    // Who moves first rotates with the week, so no seat always reaches the job board first.
    player.botAt =
      tick +
      BOT_DELAY +
      (((room.roster[id]?.slot ?? 0) * 3 + room.week + (room.rng % 5)) % 5) * 2;
  events.push({ type: "week", week: room.week });
}
function resetMatch(room: FuseLaneRoom, matchId: string): void {
  room.matchId = matchId;
  room.weekTicks = room.settings.weekSeconds * TICKS_PER_SECOND;
  room.rng = seedOf(matchId);
  room.week = 0;
  room.phase = WEEK;
  room.phaseStart = 0;
  room.phaseEnd = 0;
  room.economy = createEconomy();
  room.players = {};
  room.roster = {};
  room.headlines = [];
  room.ranking = [];
  room.winners = [];
}
function startMatch(room: FuseLaneRoom, matchId: string): void {
  resetMatch(room, matchId);
  const tick = room.tick + 1;
  room.stage = "running";
  room.week = 1;
  enrol(room, tick);
  room.headlines = ["Welcome to Lane Street. Rent is due in four weeks"];
  beginWeek(room, tick, []);
}

/** Management hooks; `room.tick + 1` is the tick being folded. */
export const lifecycle: LifecycleHooks<FuseLaneRoom, FuseLaneSettings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: "robot",
  start: startMatch,
  rematch: startMatch,
  lobby(room, matchId) {
    resetMatch(room, matchId);
    room.stage = "lobby";
  },
};

/** The play entries of `seat` at `tick`, from the stream generation its seat follows. */
function playEntries(
  seat: SeatRecord,
  streams: ReadonlyMap<string, StreamEntries<FuseLaneEntry>>,
  tick: number,
): PlayEntry[] {
  const stream = streams.get(seat.id),
    source =
      stream?.generation === seat.generation
        ? stream
        : stream?.retired?.find((old) => old.generation === seat.generation);
  return (source?.entries ?? []).filter(
    (entry): entry is PlayEntry => entry[1] === tick && entry[2] <= GOALS,
  );
}

/** A bot's next move while its week runs, if it is due. */
function botEntries(room: FuseLaneRoom, id: string, tick: number): PlayEntry[] {
  const player = room.players[id]!;
  if (room.phase === BRIEFING)
    return player.ready ? [] : [[0, tick, READY, room.week]];
  if (player.done || player.dest >= 0 || tick < player.botAt) return [];
  player.botAt = tick + BOT_DELAY;
  player.botActs++;
  const move = botMove(room, id);
  if (move.kind === "walk") return [[0, tick, WALK, room.week, move.place]];
  if (move.kind === "act")
    return [[0, tick, ACT, room.week, move.place, move.action, move.a, move.b]];
  return [[0, tick, END_WEEK, room.week]];
}

/**
 * One log tick: management, then (in the lobby) goal picks, or (in a match) every player's entries in slot order,
 * the applications of the tick together, walking, and the week and briefing clocks.
 */
export function foldTick(
  room: FuseLaneRoom,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<FuseLaneEntry>>,
): FuseLaneEvent[] {
  const tick = room.tick + 1,
    events: FuseLaneEvent[] = [];
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  const seats = seated(room);
  if (room.stage === "lobby") {
    for (const seat of seats)
      if (!seat.bot)
        for (const entry of playEntries(seat, streams, tick))
          if (entry[2] === GOALS)
            room.goals[seat.id] = [entry[4], entry[5], entry[6], entry[7]];
  } else if (room.stage === "running") {
    enrol(room, tick);
    const applications: { id: string; job: number; slot: number }[] = [];
    for (const seat of seats) {
      const player = room.players[seat.id]!;
      const entries = seat.bot
        ? botEntries(room, seat.id, tick)
        : seat.connected
          ? playEntries(seat, streams, tick)
          : [];
      for (const entry of entries) {
        if (entry[2] === GOALS || entry[3] !== room.week) continue;
        if (room.phase === BRIEFING) {
          if (entry[2] === READY) player.ready = true;
          continue;
        }
        if (entry[2] === WALK) walkTo(player, entry[4]);
        else if (entry[2] === END_WEEK) {
          if (!player.done) player.done = true;
        } else if (entry[2] === ACT) {
          if (entry[5] === APPLY) {
            if (player.inside === entry[4] && !player.done)
              applications.push({
                id: seat.id,
                job: entry[6],
                slot: seat.slot,
              });
          } else act(room, player, entry[4], entry[5], entry[6], entry[7]);
        }
      }
    }
    if (room.phase === WEEK) {
      resolveApplications(
        room,
        applications.filter(
          (application) =>
            application.job >= 0 && application.job < JOBS.length,
        ),
      );
      for (const id of playerOrder(room)) {
        const player = room.players[id]!;
        walkTick(player);
        // A player who is not here plays no week: nothing waits for an absent seat.
        if (player.time >= WEEK_UNITS || !active(room.seats.get(id)))
          player.done = true;
      }
      const everyone = playerOrder(room).every((id) => room.players[id]!.done);
      if (everyone || tick >= room.phaseEnd) {
        for (const player of Object.values(room.players)) player.done = true;
        if (endWeek(room))
          events.push({ type: "over", winners: [...room.winners] });
        else {
          room.phase = BRIEFING;
          room.phaseStart = tick;
          room.phaseEnd = tick + BRIEFING_TICKS;
          events.push({ type: "briefing", week: room.week });
        }
      }
    } else {
      const ready = seats.every(
        (seat) => !active(seat) || room.players[seat.id]?.ready,
      );
      if (ready || tick >= room.phaseEnd) beginWeek(room, tick, events);
    }
  }
  room.tick = tick;
  return events;
}
