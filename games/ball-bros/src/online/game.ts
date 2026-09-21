import {
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
  createArena,
  control,
  RULES,
  type ArenaState,
  type Impact,
  type Steering,
} from "../engine/state.js";
import { botControl } from "../engine/bots.js";
import { isAvatar } from "../engine/avatars.js";
import { step } from "../engine/step.js";
import {
  decodeArena,
  encodeArena,
  integer,
  matchId,
  validId,
  validName,
} from "../engine/codec.js";
import { view, type BallView } from "../engine/view.js";

export interface Settings {
  display: boolean;
}
export const DEFAULT_SETTINGS: Settings = { display: false };
export interface BallRoom extends ManagedRoom<Settings> {
  tick: number;
  matchId: string;
  stage: Stage;
  arena: ArenaState | null;
}
export interface RoomView extends BallView {
  stage: Stage;
  players: SeatRecord[];
}
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: 0,
  match: string,
  steer: Steering,
  radial: Steering,
  launch: boolean,
];
export type BallEntry = PlayEntry | ManagementEntry<Settings>;
export function parseSettings(raw: unknown): Settings | undefined {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== 1 ||
    !("display" in raw) ||
    typeof raw.display !== "boolean"
  )
    return;
  return { display: raw.display };
}
export function isEntry(raw: unknown): raw is BallEntry {
  if (
    isManagementEntry(raw, {
      name: validName,
      avatar: isAvatar,
      settings: (v) => !!parseSettings(v),
      capacity: 5,
    })
  ) {
    if (raw[2] === 14) return matchId(raw[4]);
    const id =
      raw[2] === 15 || raw[2] === 16 ? raw[4] : raw[2] <= 12 ? raw[3] : null;
    return id === null || validId(id);
  }
  return (
    Array.isArray(raw) &&
    raw.length === 7 &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    raw[2] === 0 &&
    matchId(raw[3]) &&
    [-1, 0, 1].includes(raw[4]) &&
    [-1, 0, 1].includes(raw[5]) &&
    typeof raw[6] === "boolean"
  );
}
export const seats = (room: BallRoom): SeatRecord[] =>
  [...room.seats.values()].sort(
    (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
export function createRoom(id: string, settings: Settings): BallRoom {
  return {
    tick: 0,
    matchId: id,
    stage: "lobby",
    settings: { ...settings },
    seats: new Map(),
    arena: null,
  };
}
function start(room: BallRoom, id: string): void {
  const players = seats(room).filter(
    (s) => !s.watcher && (s.connected || s.bot),
  );
  if (players.length < 2) return;
  room.matchId = id;
  room.stage = "running";
  room.arena = createArena(players);
}
const lifecycle: LifecycleHooks<BallRoom, Settings> = {
  stage: (r) => r.stage,
  maxWatchers: 0,
  parseSettings,
  botAvatar: "robot",
  start,
  rematch: start,
  lobby(r, id) {
    r.matchId = id;
    r.stage = "lobby";
    r.arena = null;
  },
};
export function foldTick(
  room: BallRoom,
  creator: string,
  streams: ReadonlyMap<string, StreamEntries<BallEntry>>,
): Impact[] {
  const tick = room.tick + 1;
  const generations = new Map(
    [...room.seats].map(([id, seat]) => [id, seat.generation]),
  );
  applyManagementTick(room, tick, creator, streams, lifecycle);
  const arena = room.arena;
  let events: Impact[] = [];
  if (room.stage === "running" && arena) {
    for (const base of arena.bases) {
      const seat = room.seats.get(base.id);
      // A refresh may replace a member before any disconnected tick. Never inherit
      // held controls from that member's previous page into its new generation.
      if (generations.get(base.id) !== seat?.generation) {
        base.steer = 0;
        base.radial = 0;
        base.launch = false;
      }
      if (base.bot) {
        control(arena, base.id, botControl(arena, base));
        continue;
      }
      if (!seat?.connected) {
        control(arena, base.id, { steer: 0, radial: 0, launch: false });
        continue;
      }
      const stream = streams.get(base.id);
      const source =
        stream?.generation === seat.generation
          ? stream
          : stream?.retired?.find((s) => s.generation === seat.generation);
      for (const entry of source?.entries ?? []) {
        if (entry[1] === tick && entry[2] === 0 && entry[3] === room.matchId)
          control(arena, base.id, {
            steer: entry[4],
            radial: entry[5],
            launch: entry[6],
          });
      }
    }
    events = step(arena);
    if (arena.phase === "over") room.stage = "over";
  }
  room.tick = tick;
  return events;
}
export function encodeRoom(room: BallRoom): unknown[] {
  return [
    room.matchId,
    room.stage,
    room.settings,
    seats(room).map((s) => [
      s.id,
      s.name,
      s.slot,
      s.bot,
      s.connected,
      s.generation ?? null,
      s.away ?? false,
      s.avatarId,
    ]),
    room.arena ? encodeArena(room.arena) : null,
  ];
}
export function decodeRoom(
  fields: readonly unknown[],
  tick: number,
): BallRoom | undefined {
  if (fields.length !== 5 || !uint32(tick)) return;
  const [id, stage, rawSettings, rawSeats, rawArena] = fields;
  const settings = parseSettings(rawSettings);
  if (
    !matchId(id) ||
    !settings ||
    (stage !== "lobby" && stage !== "running" && stage !== "over") ||
    !Array.isArray(rawSeats) ||
    rawSeats.length > 5
  )
    return;
  const room = createRoom(id, settings);
  room.tick = tick;
  room.stage = stage;
  const slots = new Set<number>();
  for (const s of rawSeats) {
    if (
      !Array.isArray(s) ||
      s.length !== 8 ||
      !isAvatar(s[7]) ||
      !validId(s[0]) ||
      !validName(s[1]) ||
      !integer(s[2], 4) ||
      typeof s[3] !== "boolean" ||
      typeof s[4] !== "boolean" ||
      (s[3] ? s[5] !== null : !uint32(s[5])) ||
      typeof s[6] !== "boolean" ||
      (s[6] && (s[3] || s[4])) ||
      room.seats.has(s[0]) ||
      slots.has(s[2])
    )
      return;
    slots.add(s[2]);
    room.seats.set(s[0], {
      id: s[0],
      name: s[1],
      slot: s[2],
      bot: s[3],
      connected: s[4],
      avatarId: s[7],
      ...(s[5] === null ? {} : { generation: s[5] }),
      ...(s[6] ? { away: true } : {}),
    });
  }
  if (stage === "lobby") {
    if (rawArena !== null) return;
  } else {
    const arena = decodeArena(rawArena);
    if (
      !arena ||
      arena.tick > tick ||
      (stage === "over") !== (arena.phase === "over")
    )
      return;
    if (
      stage === "running" &&
      arena.bases.some((b) => {
        const s = room.seats.get(b.id);
        return !s || s.slot !== b.slot || s.bot !== b.bot;
      })
    )
      return;
    room.arena = arena;
  }
  return room;
}
export function hashRoom(room: BallRoom): string {
  const text = JSON.stringify([room.tick, ...encodeRoom(room)]);
  let a = 0x811c9dc5,
    b = 0x12345678;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
export const ballGame: RollbackGame<
  BallRoom,
  BallEntry,
  RoomView,
  Impact,
  Settings
> = {
  id: "ball-bros",
  rules: RULES,
  isEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (r) => ({ matchId: r.matchId, round: 1 }),
  clock: (r) => r.tick,
  steps: () => 1,
  maxSteps: 1,
  view: (r) => ({
    ...view(r.tick, r.matchId, r.arena),
    stage: r.stage,
    players: seats(r).map((s) => ({ ...s })),
  }),
  hash: hashRoom,
  checkpoint: { leading: 5, encode: encodeRoom, decode: decodeRoom },
  members: seats,
  seat: (r, id) => r.seats.get(id),
  stage: (r) => r.stage,
  settings: (r) => r.settings,
  seating: {
    capacity: 5,
    maxWatchers: 0,
    seatName: (raw) => {
      const name = Array.from(raw.trim()).slice(0, 24).join("");
      return validName(name) ? name : undefined;
    },
    isAvatar,
    defaultAvatar: "fox",
    parseSettings,
    soloSettings: () => ({ display: false }),
    sharedScreen: (s) => s.display,
    botId(r, pending) {
      let n = 1;
      while (r.seats.has(`bot-${n}`) || pending.has(`bot-${n}`)) n++;
      return `bot-${n}`;
    },
    botName: (slot) => ["Orbit", "Sparks", "Ricochet", "Comet", "Pixel"][slot]!,
    solo: { name: "You", bots: 4 },
  },
  text: defaultText,
};
