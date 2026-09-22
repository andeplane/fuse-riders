import {
  ACTION,
  BOT,
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
  type StreamEntries,
} from "fuse-netcode";
import {
  advance,
  createMatch,
  decodeState,
  encodeState,
  getView,
  hashState,
  isAction,
  RULES,
  type Action,
  type Fact,
  type Match,
} from "../engine/index.js";
import type { WorldView } from "../engine/view.js";
import { encodeMatch, decodeMatch } from "./terrain-wire.js";

export interface BirdsSettings {
  display: boolean;
}
export const DEFAULT_SETTINGS: BirdsSettings = { display: false };
export interface BirdsRoom extends ManagedRoom<BirdsSettings> {
  tick: number;
  matchId: string;
  stage: Stage;
  startedAt: number;
  match: Match | null;
}
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: 0,
  matchId: string,
  action: Action,
];
export type BirdsEntry = ManagementEntry<BirdsSettings> | PlayEntry;
export interface BirdsView {
  tick: number;
  stage: Stage;
  world: WorldView | null;
  seats: SeatRecord[];
}
const validId = (x: unknown): x is string =>
  typeof x === "string" && /^[\w:-]{1,64}$/.test(x);
const validName = (x: unknown): x is string =>
  typeof x === "string" &&
  x.length > 0 &&
  x.length <= 48 &&
  x.trim() === x &&
  !/[\u0000-\u001f\u007f]/.test(x);
export function seatName(raw: string): string | undefined {
  const value = Array.from(raw.trim()).slice(0, 24).join("");
  return validName(value) ? value : undefined;
}
export function parseSettings(raw: unknown): BirdsSettings | undefined {
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
export function isBirdsEntry(raw: unknown): raw is BirdsEntry {
  if (
    isManagementEntry<BirdsSettings>(raw, {
      name: validName,
      avatar: (x) => x === "owl",
      settings: (x) => !!parseSettings(x),
      capacity: 5,
    })
  )
    return raw[2] !== BOT && (raw[2] !== ACTION || validId(raw[4]));
  return (
    Array.isArray(raw) &&
    raw.length === 5 &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    raw[2] === 0 &&
    validId(raw[3]) &&
    isAction(raw[4])
  );
}
export function orderedSeats(room: BirdsRoom): SeatRecord[] {
  return [...room.seats.values()].sort(
    (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
function start(room: BirdsRoom, id: string): void {
  const players = orderedSeats(room).filter((p) => !p.watcher && p.connected);
  if (players.length < 2 || players.some((p) => p.bot)) return;
  let seed = 2166136261;
  for (const char of id)
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  room.match = createMatch(
    id,
    seed,
    players.map((p) => ({ id: p.id, name: p.name, slot: p.slot })),
    (room.match?.round ?? 0) + 1,
  );
  room.matchId = id;
  room.startedAt = room.tick;
  room.stage = "running";
}
const lifecycle: LifecycleHooks<BirdsRoom, BirdsSettings> = {
  stage: (room) => room.stage,
  maxWatchers: 8,
  parseSettings,
  start,
  rematch: start,
  lobby(room, id) {
    room.matchId = id;
    room.match = null;
    room.startedAt = 0;
    room.stage = "lobby";
  },
};
export function foldTick(
  room: BirdsRoom,
  creator: string,
  streams: ReadonlyMap<string, StreamEntries<BirdsEntry>>,
): Fact[] {
  const tick = room.tick + 1;
  applyManagementTick(room, tick, creator, streams, lifecycle);
  const actions: Action[] = [];
  if (room.match && room.stage === "running") {
    const player = room.match.players[room.match.active]!,
      seat = room.seats.get(player.id),
      stream = streams.get(player.id);
    const source =
      stream?.generation === seat?.generation
        ? stream
        : stream?.retired?.find((s) => s.generation === seat?.generation);
    if (seat?.connected && !seat.watcher)
      for (const entry of source?.entries ?? []) {
        if (
          entry[1] === tick &&
          entry[2] === 0 &&
          entry[3] === room.matchId &&
          entry[4].actor === player.id &&
          actions.length < 32
        )
          actions.push(entry[4]);
      }
  }
  const facts = room.match ? advance(room.match, actions) : [];
  if (room.match?.phase === "over" || room.match?.phase === "fault")
    room.stage = "over";
  room.tick = tick;
  return facts;
}
function roomFields(room: BirdsRoom): unknown[] {
  return [
    [room.matchId, room.stage, room.startedAt],
    orderedSeats(room).map((s) => [
      s.id,
      s.name,
      s.slot,
      s.avatarId,
      s.connected,
      !!s.watcher,
      s.generation,
      !!s.away,
    ]),
    { ...room.settings },
  ];
}
export function encodeRoom(room: BirdsRoom): unknown[] {
  return [...roomFields(room), room.match ? encodeMatch(room.match) : null];
}
export function decodeRoom(
  fields: readonly unknown[],
  tick: number,
): BirdsRoom | undefined {
  if (!uint32(tick) || fields.length !== 4) return;
  const [head, rawSeats, rawSettings, rawMatch] = fields;
  if (
    !Array.isArray(head) ||
    head.length !== 3 ||
    !validId(head[0]) ||
    !["lobby", "running", "over"].includes(head[1]) ||
    !uint32(head[2]) ||
    head[2] > tick
  )
    return;
  const settings = parseSettings(rawSettings);
  if (!settings || !Array.isArray(rawSeats) || rawSeats.length > 13) return;
  const seats = new Map<string, SeatRecord>(),
    slots = new Set<number>();
  let watchers = 0;
  for (const raw of rawSeats) {
    if (!Array.isArray(raw) || raw.length !== 8) return;
    const [id, name, slot, avatarId, connected, watcher, generation, away] =
      raw;
    if (
      !memberId(id) ||
      !validName(name) ||
      typeof connected !== "boolean" ||
      typeof watcher !== "boolean" ||
      typeof away !== "boolean" ||
      !uint32(generation) ||
      seats.has(id) ||
      (away && connected)
    )
      return;
    if (
      watcher
        ? slot !== -1 || avatarId !== "" || ++watchers > 8
        : !uint32(slot) || slot >= 5 || slots.has(slot) || avatarId !== "owl"
    )
      return;
    if (!watcher) slots.add(slot);
    seats.set(id, {
      id,
      name,
      slot,
      avatarId,
      connected,
      bot: false,
      ...(watcher ? { watcher: true } : {}),
      generation,
      ...(away ? { away: true } : {}),
    });
  }
  const match = rawMatch === null ? null : decodeMatch(rawMatch);
  if (match === undefined) return;
  if (head[1] === "lobby") {
    if (match !== null || head[2] !== 0) return;
  } else {
    if (
      !match ||
      match.rules !== RULES ||
      match.id !== head[0] ||
      match.tick !== tick - head[2]
    )
      return;
    if (
      head[1] === "running" &&
      match.players.some(
        (p) =>
          !seats.has(p.id) ||
          seats.get(p.id)!.watcher ||
          seats.get(p.id)!.slot !== p.slot,
      )
    )
      return;
    if (
      (head[1] === "over") !==
      (match.phase === "over" || match.phase === "fault")
    )
      return;
  }
  return {
    tick,
    matchId: head[0],
    stage: head[1],
    startedAt: head[2],
    settings,
    seats,
    match,
  };
}
export function hashRoom(room: BirdsRoom): string {
  const encoded = [
    ...roomFields(room),
    room.match ? hashState(room.match) : null,
  ];
  const value = JSON.stringify([room.tick, ...encoded]);
  let a = 2166136261,
    b = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b ^ value.charCodeAt(i), 0x85ebca6b);
  }
  return (
    (a >>> 0).toString(16).padStart(8, "0") +
    (b >>> 0).toString(16).padStart(8, "0")
  );
}
export const birdsGame: RollbackGame<
  BirdsRoom,
  BirdsEntry,
  BirdsView,
  Fact,
  BirdsSettings
> = {
  id: "fuse-birds",
  rules: `${RULES}-snapshot2`,
  isEntry: isBirdsEntry,
  createRoom: (matchId, settings) => ({
    tick: 0,
    matchId,
    settings: { ...settings },
    seats: new Map(),
    startedAt: 0,
    stage: "lobby",
    match: null,
  }),
  createTicker: () => foldTick,
  scope: (room) => ({ matchId: room.matchId, round: room.match?.round ?? 1 }),
  clock: (room) => room.tick * 3,
  steps: () => 3,
  maxSteps: 3,
  view: (room) => ({
    tick: room.tick * 3,
    stage: room.stage,
    world: room.match ? getView(room.match) : null,
    seats: orderedSeats(room).map((s) => ({ ...s })),
  }),
  hash: hashRoom,
  checkpoint: { leading: 3, encode: encodeRoom, decode: decodeRoom },
  members: orderedSeats,
  seat: (room, id) => room.seats.get(id),
  stage: (room) => room.stage,
  settings: (room) => room.settings,
  seating: {
    capacity: 5,
    maxWatchers: 8,
    seatName,
    isAvatar: (value): value is string => value === "owl",
    defaultAvatar: "owl",
    parseSettings,
    soloSettings: (settings) => ({ ...settings, display: false }),
    sharedScreen: (settings) => settings.display,
    botId: () => "unsupported-bot",
    botName: () => "Bot",
    solo: { name: "You", bots: 1 },
  },
  text: defaultText,
};
