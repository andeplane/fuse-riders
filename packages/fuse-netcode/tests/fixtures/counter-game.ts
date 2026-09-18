import {
  applyManagementTick,
  defaultText,
  isManagementEntry,
  memberId,
  uint32,
  type LifecycleHooks,
  type ManagedRoom,
  type ManagementEntry,
  type RollbackGame,
  type SeatRecord,
  type Stage,
} from "../../src/index.js";

/**
 * A tiny game on the netcode, to prove the contract is not Fuse Riders': each member adds 1–9 to its own total and the
 * first to reach the target wins the match. `MARK` carries an ordinal, like Fuse Riders' press gesture. Bots add 1
 * every tenth log tick. The seats, succession and lifecycle are the package's own `applyManagementTick`.
 */
export const ADD = 0,
  MARK = 1;
export interface CounterSettings {
  target: number;
}
export type CounterEntry =
  | ManagementEntry<CounterSettings>
  | [seq: number, tick: number, kind: 0, amount: number]
  | [seq: number, tick: number, kind: 1, ordinal: number];
export interface CounterRoom extends ManagedRoom<CounterSettings> {
  tick: number;
  /** The game clock: two steps per log tick, so frames and events are stamped apart from the log tick. */
  clock: number;
  matchId: string;
  round: number;
  stage: Stage;
  totals: Record<string, number>;
  marks: Record<string, number>;
}
export interface CounterView {
  tick: number;
  stage: Stage;
  totals: Record<string, number>;
}
export type CounterEvent =
  { type: "add"; id: string; amount: number } | { type: "win"; id: string };

const settingsOf = (raw: unknown): CounterSettings | undefined =>
  raw !== null &&
  typeof raw === "object" &&
  !Array.isArray(raw) &&
  Object.keys(raw).length === 1 &&
  uint32((raw as CounterSettings).target) &&
  (raw as CounterSettings).target > 0 &&
  (raw as CounterSettings).target <= 1000
    ? { target: (raw as CounterSettings).target }
    : undefined;
const nameOf = (raw: unknown): raw is string =>
  typeof raw === "string" && raw.length > 0 && raw.length <= 12;
const AVATARS = ["fox", "robot"];
const CAPACITY = 4;

function isCounterEntry(raw: unknown): raw is CounterEntry {
  if (
    isManagementEntry(raw, {
      name: nameOf,
      avatar: (value) => AVATARS.includes(value as string),
      settings: (value) => settingsOf(value) !== undefined,
      capacity: CAPACITY,
    })
  )
    return true;
  return (
    Array.isArray(raw) &&
    raw.length === 4 &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    ((raw[2] === ADD && uint32(raw[3]) && raw[3] >= 1 && raw[3] <= 9) ||
      (raw[2] === MARK && uint32(raw[3]) && raw[3] > 0))
  );
}

const reset = (room: CounterRoom): void => {
  room.totals = {};
  room.marks = {};
};
const hooks: LifecycleHooks<CounterRoom, CounterSettings> = {
  stage: (room) => room.stage,
  maxWatchers: 2,
  parseSettings: settingsOf,
  start(room, matchId) {
    reset(room);
    room.matchId = matchId;
    room.stage = "running";
  },
  rematch(room, matchId) {
    reset(room);
    room.matchId = matchId;
    room.round = 1;
    room.stage = "running";
  },
  lobby(room, matchId) {
    reset(room);
    room.matchId = matchId;
    room.round = 1;
    room.stage = "lobby";
  },
};

const sortedSeats = (room: CounterRoom): SeatRecord[] =>
  [...room.seats.values()].sort(
    (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
/** Canonical JSON with sorted keys and seats, then FNV-1a in two lanes: 16 hex characters. */
export function hashCounter(room: CounterRoom): string {
  const text = JSON.stringify(
    { ...room, seats: sortedSeats(room) },
    (_key, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
          )
        : value,
  );
  let a = 0x811c9dc5,
    b = 0x9747b28c;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x01000193) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

const record = (value: unknown): value is Record<string, number> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.entries(value).every(([key, count]) => memberId(key) && uint32(count));
function decodeSeat(raw: unknown): SeatRecord | undefined {
  if (!Array.isArray(raw) || raw.length !== 7) return;
  const [id, name, slot, avatarId, connected, role, generation] = raw;
  const watcher = role === "watcher";
  if (
    !memberId(id) ||
    !nameOf(name) ||
    !(watcher ? slot === -1 : uint32(slot) && slot < CAPACITY) ||
    typeof avatarId !== "string" ||
    typeof connected !== "boolean" ||
    (!watcher && typeof role !== "boolean") ||
    (generation !== null && !uint32(generation))
  )
    return;
  return {
    id,
    name,
    slot,
    avatarId,
    connected,
    bot: role === true,
    ...(watcher ? { watcher } : {}),
    ...(generation === null ? {} : { generation }),
  };
}
const STAGES: readonly Stage[] = ["lobby", "running", "between", "over"];

export const counterGame: RollbackGame<
  CounterRoom,
  CounterEntry,
  CounterView,
  CounterEvent,
  CounterSettings
> = {
  id: "counter",
  rules: "counter-3",
  isEntry: isCounterEntry,
  ordinal: (entry) => (entry[2] === MARK ? entry[3] : undefined),
  createRoom: (matchId, settings) => ({
    tick: 0,
    clock: 0,
    matchId,
    round: 1,
    stage: "lobby",
    seats: new Map(),
    settings,
    totals: {},
    marks: {},
  }),
  createTicker: () => (room, creatorId, streams) => {
    const tick = room.tick + 1,
      events: CounterEvent[] = [];
    applyManagementTick(room, tick, creatorId, streams, hooks);
    for (const seat of sortedSeats(room)) {
      if (room.stage !== "running") break;
      if (seat.watcher) continue;
      let added = 0;
      if (seat.bot) added = tick % 10 === 0 ? 1 : 0;
      else if (seat.connected) {
        const stream = streams.get(seat.id),
          source =
            stream?.generation === seat.generation
              ? stream
              : stream?.retired?.find(
                  (old) => old.generation === seat.generation,
                );
        for (const entry of source?.entries ?? []) {
          if (entry[1] !== tick) continue;
          if (entry[2] === ADD) added += entry[3];
          if (entry[2] === MARK) room.marks[seat.id] = entry[3];
        }
      }
      if (!added) continue;
      room.totals[seat.id] = (room.totals[seat.id] ?? 0) + added;
      events.push({ type: "add", id: seat.id, amount: added });
      if (room.totals[seat.id]! >= room.settings.target) {
        room.stage = "over";
        events.push({ type: "win", id: seat.id });
      }
    }
    room.clock += 2;
    room.tick = tick;
    return events;
  },
  scope: (room) => ({ matchId: room.matchId, round: room.round }),
  clock: (room) => room.clock,
  steps: () => 2,
  maxSteps: 2,
  view: (room) => ({
    tick: room.clock,
    stage: room.stage,
    totals: { ...room.totals },
  }),
  hash: hashCounter,
  checkpoint: {
    // The totals and marks follow the streams and the hash, as Fuse Riders' spectators do.
    leading: 3,
    encode: (room) => [
      [room.clock, room.matchId, room.round, room.stage],
      sortedSeats(room).map((seat) => [
        seat.id,
        seat.name,
        seat.slot,
        seat.avatarId,
        seat.connected,
        seat.watcher === true ? "watcher" : seat.bot,
        seat.generation ?? null,
      ]),
      room.settings,
      room.totals,
      room.marks,
    ],
    decode(fields, tick) {
      if (fields.length !== 5) return;
      const [header, rawSeats, rawSettings, totals, marks] = fields;
      if (!Array.isArray(header) || header.length !== 4) return;
      const [clock, matchId, round, stage] = header;
      const settings = settingsOf(rawSettings);
      if (
        !uint32(clock) ||
        clock !== tick * 2 ||
        typeof matchId !== "string" ||
        !uint32(round) ||
        !STAGES.includes(stage as Stage) ||
        !settings ||
        !Array.isArray(rawSeats) ||
        !record(totals) ||
        !record(marks)
      )
        return;
      const seats = new Map<string, SeatRecord>();
      for (const raw of rawSeats) {
        const seat = decodeSeat(raw);
        if (!seat || seats.has(seat.id)) return;
        seats.set(seat.id, seat);
      }
      return {
        tick,
        clock,
        matchId,
        round,
        stage: stage as Stage,
        seats,
        settings,
        totals: { ...totals },
        marks: { ...marks },
      };
    },
  },
  members: (room) => [...room.seats.values()],
  seat: (room, id) => room.seats.get(id),
  stage: (room) => room.stage,
  settings: (room) => room.settings,
  seating: {
    capacity: CAPACITY,
    maxWatchers: 2,
    seatName: (raw) => {
      const name = raw.trim();
      return nameOf(name) ? name : undefined;
    },
    isAvatar: (value): value is string => AVATARS.includes(value as string),
    defaultAvatar: "fox",
    parseSettings: settingsOf,
    soloSettings: (settings) => settings,
    sharedScreen: () => false,
    botId(room, pending) {
      let number = 1;
      while (room.seats.has(`bot:${number}`) || pending.has(`bot:${number}`))
        number++;
      return `bot:${number}`;
    },
    botName: (slot) => `AI ${slot}`,
    solo: { name: "You", bots: 1 },
  },
  text: defaultText,
};
