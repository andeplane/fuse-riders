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
  type ManagedRoom,
  type ManagementEntry,
  type SeatRecord,
  type Stage,
  type StreamEntries,
} from "fuse-netcode";
import { CAPACITY, MAX_WATCHERS, validName } from "./basics.js";
import { botInput, createBotMemory, type BotMemory } from "./sim/bot.js";
import { BASE_STATS } from "./sim/config.js";
import { NEUTRAL_INPUT, type TruckInput } from "./sim/input.js";
import { createRace, step, type RaceState } from "./sim/race.js";
import { parseTrack, type Track } from "./sim/track.js";
import { TRACK_DATA, TRACK_NAMES } from "./tracks-data.js";

export * from "./basics.js";

/** Every peer parses the same committed maps, so a track is data in the bundle rather than a file read. */
const TRACKS: Record<string, Track> = Object.fromEntries(
  TRACK_NAMES.map((name) => [name, parseTrack(TRACK_DATA[name], name)]),
);
export const trackNames = (): readonly string[] => TRACK_NAMES;
export const trackFor = (name: string): Track =>
  TRACKS[name] ?? TRACKS[TRACK_NAMES[0]]!;

/** The game's own entry kinds; 10-16 are the shared management ones. */
export const CONTROLS = 0;

/**
 * A driver's six controls as one bitmask. Thumbs change rarely, so a seat logs an entry only when its
 * controls differ from the ones it last logged, and a few bytes carry a whole change.
 */
export const LEFT = 1,
  RIGHT = 2,
  BRAKE = 4,
  NITRO = 8,
  ITEM = 16,
  ITEM_ALT = 32;
export const CONTROL_BITS = LEFT | RIGHT | BRAKE | NITRO | ITEM | ITEM_ALT;

export const packControls = (input: TruckInput): number =>
  (input.left ? LEFT : 0) |
  (input.right ? RIGHT : 0) |
  (input.brake ? BRAKE : 0) |
  (input.nitro ? NITRO : 0) |
  (input.item ? ITEM : 0) |
  (input.itemAlt ? ITEM_ALT : 0);

export const unpackControls = (bits: number): TruckInput => ({
  left: (bits & LEFT) !== 0,
  right: (bits & RIGHT) !== 0,
  brake: (bits & BRAKE) !== 0,
  nitro: (bits & NITRO) !== 0,
  item: (bits & ITEM) !== 0,
  itemAlt: (bits & ITEM_ALT) !== 0,
});

export type ControlsEntry = [
  seq: number,
  tick: number,
  kind: typeof CONTROLS,
  bits: number,
];
export type FuseDriversEntry =
  ManagementEntry<FuseDriversSettings> | ControlsEntry;

export type FuseDriversEvent =
  | { type: "hit"; id: string; by: string }
  | { type: "kill"; id: string; by: string }
  | { type: "pickup"; id: string }
  | { type: "lap"; id: string; lap: number }
  | { type: "finish"; id: string; place: number };

export interface FuseDriversSettings {
  /** Which committed map the next race runs on. */
  track: string;
  /** One screen with phones as controllers. */
  display: boolean;
}
export const DEFAULT_SETTINGS: FuseDriversSettings = {
  track: TRACK_NAMES[0],
  display: false,
};

export interface FuseDriversRoom extends ManagedRoom<FuseDriversSettings> {
  /** The log tick, which is the netcode's clock; the race keeps its own simulation tick. */
  tick: number;
  matchId: string;
  round: number;
  stage: Stage;
  /** The seeded race, or undefined in the lobby before the first start. */
  race?: RaceState;
  /** Which seat drives which truck slot, by slot index. */
  grid: string[];
  /** The controls each seat last logged, so a seat that logs nothing keeps driving as it was. */
  controls: Record<string, number>;
  /** Bot memory rides in the room so a rollback reproduces the same driving. */
  bots: Record<string, BotMemory>;
}

export const isAvatar = (value: unknown): value is string =>
  ["robot", "fox", "cat", "alien", "ghost"].includes(value as string);

/** A member id safe to use as a record key: never an inherited Object property name. */
export const playerKey = (value: unknown): value is string =>
  memberId(value) && !(value in Object.prototype);

export const validMatchId = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7e]{1,64}$/.test(value);

export function seatName(raw: string): string | undefined {
  const name = Array.from(raw.replace(/\p{Cs}/gu, "").trim())
    .slice(0, 18)
    .join("")
    .trim();
  return validName(name) ? name : undefined;
}

export function parseSettings(raw: unknown): FuseDriversSettings | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  const keys = Object.keys(raw);
  const { track, display } = raw as Partial<FuseDriversSettings>;
  if (keys.length !== 2 || !keys.includes("track") || !keys.includes("display"))
    return;
  if (typeof display !== "boolean") return;
  if (typeof track !== "string" || !TRACK_NAMES.includes(track as never))
    return;
  return { track, display };
}

const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (value: unknown) => parseSettings(value) !== undefined,
  capacity: CAPACITY,
};

export function isFuseDriversEntry(raw: unknown): raw is FuseDriversEntry {
  if (isManagementEntry(raw, payloads)) {
    if (raw[2] === ACTION) return validMatchId(raw[4]);
    const at =
      raw[2] === BOT || raw[2] === SPECTATOR ? 4 : raw[2] <= PRESENCE ? 3 : -1;
    return at < 0 || playerKey((raw as unknown[])[at]);
  }
  return (
    Array.isArray(raw) &&
    raw.length === 4 &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    raw[2] === CONTROLS &&
    uint32(raw[3]) &&
    (raw[3] & ~CONTROL_BITS) === 0
  );
}

/** Seats in an order derived from the room alone, never from map insertion or packet arrival. */
export function players(room: FuseDriversRoom): SeatRecord[] {
  return [...room.seats.values()]
    .filter((seat) => !seat.watcher)
    .sort(
      (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

export function createRoom(
  matchId: string,
  settings: FuseDriversSettings,
): FuseDriversRoom {
  return {
    tick: 0,
    matchId,
    round: 1,
    stage: "lobby",
    seats: new Map(),
    settings: { ...settings },
    grid: [],
    controls: {},
    bots: {},
  };
}

/** Seeds a race from the match id, so every peer lines up the same grid on the same map. */
function startRace(room: FuseDriversRoom, matchId: string): void {
  room.matchId = matchId;
  const grid = players(room);
  room.grid = grid.map((seat) => seat.id);
  room.controls = {};
  room.bots = {};
  let seed = 0x811c9dc5;
  for (let i = 0; i < matchId.length; i++)
    seed = Math.imul(seed ^ matchId.charCodeAt(i), 0x01000193) >>> 0;
  room.race = createRace(
    trackFor(room.settings.track),
    seed,
    grid.map(() => BASE_STATS),
  );
  for (const [slot, seat] of grid.entries())
    if (seat.bot) room.bots[seat.id] = createBotMemory(seed, slot);
}

export const lifecycle: LifecycleHooks<FuseDriversRoom, FuseDriversSettings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: "robot",
  start(room, matchId) {
    room.round = 1;
    startRace(room, matchId);
    room.stage = "running";
  },
  rematch(room, matchId) {
    room.round = 1;
    startRace(room, matchId);
    room.stage = "running";
  },
  lobby(room, matchId) {
    room.matchId = matchId;
    room.round = 1;
    room.stage = "lobby";
    delete room.race;
    room.grid = [];
    room.controls = {};
    room.bots = {};
  },
};

/** A seat's entries for this tick, read from the stream generation that seat follows. */
function controlEntries(
  seat: SeatRecord,
  streams: ReadonlyMap<string, StreamEntries<FuseDriversEntry>>,
  tick: number,
): ControlsEntry[] {
  const stream = streams.get(seat.id);
  const source =
    stream?.generation === seat.generation
      ? stream
      : stream?.retired?.find((old) => old.generation === seat.generation);
  return (source?.entries ?? []).filter(
    (entry): entry is ControlsEntry =>
      entry[1] === tick && entry[2] === CONTROLS,
  );
}

/**
 * One log tick: management first, then each seat's control changes, then the race steps.
 *
 * The log runs at 20 Hz and the race at 30 Hz, so a tick runs two simulation steps when the log tick is
 * even and one when it is odd. `steps` in `game.ts` reports the same number before the tick runs.
 */
export function foldTick(
  room: FuseDriversRoom,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<FuseDriversEntry>>,
): FuseDriversEvent[] {
  const tick = room.tick + 1;
  const events: FuseDriversEvent[] = [];
  applyManagementTick(room, tick, creatorId, streams, lifecycle);

  const race = room.race;
  if (race && room.stage === "running") {
    const grid = players(room);
    for (const seat of grid) {
      if (seat.bot) continue;
      for (const entry of controlEntries(seat, streams, tick))
        room.controls[seat.id] = entry[3];
      if (!seat.connected) room.controls[seat.id] = 0;
    }
    const inputs: TruckInput[] = room.grid.map((id) => {
      const seat = room.seats.get(id);
      if (!seat || !seat.bot) return unpackControls(room.controls[id] ?? 0);
      return NEUTRAL_INPUT;
    });
    let next = race;
    for (let s = 0; s < stepsForTick(tick); s++) {
      // Bots decide inside the fold from room state alone, so a rollback reproduces their driving.
      const withBots = inputs.map((input, slot) => {
        const id = room.grid[slot];
        const seat = id === undefined ? undefined : room.seats.get(id);
        if (!seat?.bot || id === undefined) return input;
        const memory = room.bots[id];
        if (!memory) return input;
        const [botControls, nextMemory] = botInput(
          next,
          slot,
          memory,
          trackFor(room.settings.track),
          "normal",
        );
        room.bots[id] = nextMemory;
        return botControls;
      });
      const result = step(next, withBots, trackFor(room.settings.track));
      next = result.state;
      for (const event of result.events) {
        const id = "slot" in event ? (room.grid[event.slot] ?? "") : "";
        if (event.type === "lap")
          events.push({ type: "lap", id, lap: event.lap });
        else if (event.type === "finish")
          events.push({ type: "finish", id, place: event.place });
        else if (event.type === "pickup") events.push({ type: "pickup", id });
        else if (event.type === "kill")
          events.push({ type: "kill", id, by: room.grid[event.by] ?? "" });
        else if (event.type === "hit" && !event.absorbed)
          events.push({ type: "hit", id, by: room.grid[event.by] ?? "" });
      }
    }
    room.race = next;
    if (next.phase === "finished") room.stage = "over";
  }

  room.tick = tick;
  return events;
}

/** Two steps on an even log tick and one on an odd: three steps per 100 ms is exactly 30 Hz. */
export const stepsForTick = (tick: number): number => (tick % 2 === 0 ? 2 : 1);
