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
  PULSE,
  DURATION,
  botInput,
  createWorld,
  isInput,
  parseSettings,
  seedOf,
  stepWorld,
  type Settings,
  type World,
} from "../engine/world.js";
import {
  AVATAR,
  BOT_NAMES,
  isAvatar,
  playerKey,
  seatName,
  validMatchId,
  validName,
} from "./names.js";
import { decodeWorld } from "../engine/codec.js";
import { toView, type WorldView } from "../engine/view.js";
export const PLAY = 0,
  READY = 1,
  CANCEL = 2;
export type Entry =
  | ManagementEntry<Settings>
  | [number, number, typeof PLAY, string, number, number]
  | [number, number, typeof READY, string, boolean]
  | [number, number, typeof CANCEL, string, number];
export interface Room extends ManagedRoom<Settings> {
  tick: number;
  matchId: string;
  round: number;
  stage: Stage;
  held: Record<string, number>;
  ready: Record<string, boolean>;
  world: World | null;
}
export interface View {
  tick: number;
  matchId: string;
  stage: Stage;
  seats: SeatRecord[];
  ready: Record<string, boolean>;
  world: WorldView | null;
}
const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (v: unknown) => !!parseSettings(v),
  capacity: CAPACITY,
};
export function isEntry(v: unknown): v is Entry {
  if (isManagementEntry(v, payloads)) {
    if (v[2] === ACTION) return validMatchId(v[4]);
    const at =
      v[2] === BOT || v[2] === SPECTATOR ? 4 : v[2] <= PRESENCE ? 3 : -1;
    return at < 0 || playerKey((v as unknown[])[at]);
  }
  return (
    Array.isArray(v) &&
    uint32(v[0]) &&
    v[0] > 0 &&
    uint32(v[1]) &&
    v[1] > 0 &&
    validMatchId(v[3]) &&
    ((v.length === 6 && v[2] === PLAY && v[4] === 1 && isInput(v[5])) ||
      (v.length === 5 && v[2] === READY && typeof v[4] === "boolean") ||
      (v.length === 5 && v[2] === CANCEL && v[4] === 1))
  );
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
    ready: {},
    world: null,
  };
}
const seats = (r: Room) =>
  [...r.seats.values()].sort(
    (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
function start(r: Room, id: string) {
  const players = seats(r).filter(
    (s) => !s.watcher && (s.connected || s.away || s.bot),
  );
  if (players.length < 2) return;
  r.matchId = id;
  r.round = 1;
  r.stage = "running";
  r.held = {};
  r.ready = {};
  r.world = createWorld(seedOf(id), players);
}
const hooks: LifecycleHooks<Room, Settings> = {
  stage: (r) => r.stage,
  maxWatchers: 5,
  parseSettings,
  botAvatar: AVATAR,
  start,
  rematch: start,
  lobby(r, id) {
    r.matchId = id;
    r.round = 0;
    r.stage = "lobby";
    r.held = {};
    r.ready = {};
    r.world = null;
  },
};
export function foldTick(
  r: Room,
  creator: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
): never[] {
  const tick = r.tick + 1;
  const generations = new Map(
    seats(r).map((s) => [s.id, `${s.generation}:${s.connected}`]),
  );
  applyManagementTick(r, tick, creator, streams, hooks);
  // Membership changes invalidate the whole vote, and removed seats leave no record keys behind.
  if (
    seats(r).length !== generations.size ||
    seats(r).some(
      (s) => generations.get(s.id) !== `${s.generation}:${s.connected}`,
    )
  )
    r.ready = {};
  for (const id of Object.keys(r.held)) if (!r.seats.has(id)) delete r.held[id];
  const pulseTaps = new Set<string>();
  for (const s of seats(r)) {
    if (generations.get(s.id) !== `${s.generation}:${s.connected}`) {
      delete r.held[s.id];
      delete r.ready[s.id];
    }
    if (!s.connected || s.bot || s.watcher) continue;
    const stream = streams.get(s.id);
    const source =
      stream?.generation === s.generation
        ? stream
        : stream?.retired?.find((v) => v.generation === s.generation);
    for (const e of [...(source?.entries ?? [])].sort((a, b) => a[0] - b[0])) {
      if (e[1] !== tick || e[3] !== r.matchId) continue;
      if (e[2] === PLAY && e[4] === r.round && r.stage === "running") {
        r.held[s.id] = e[5];
        if (e[5] & PULSE) pulseTaps.add(s.id);
      }
      if (e[2] === CANCEL && e[4] === r.round) {
        r.held[s.id] = 0;
        pulseTaps.delete(s.id);
      }
      if (e[2] === READY && r.stage !== "running") r.ready[s.id] = e[4];
    }
  }
  const active = seats(r).filter((s) => !s.watcher && (s.connected || s.bot));
  if (
    r.stage !== "running" &&
    active.length >= 2 &&
    active.some((s) => !s.bot) &&
    active.every((s) => s.bot || r.ready[s.id])
  )
    start(r, `${r.matchId.slice(0, 45)}:${tick}`);
  if (r.stage === "running" && r.world) {
    const inputs = new Map(
      r.world.hunters.map((h) => {
        const s = r.seats.get(h.id);
        return [
          h.id,
          s?.bot
            ? botInput(r.world!, h)
            : s?.connected
              ? (r.held[h.id] ?? 0) | (pulseTaps.has(h.id) ? PULSE : 0)
              : 0,
        ] as const;
      }),
    );
    stepWorld(r.world, inputs);
    if (r.world.tick >= DURATION) {
      r.stage = "over";
      r.ready = {};
      r.held = {};
    }
  }
  r.tick = tick;
  return [];
}
export function encode(r: Room): unknown[] {
  return [
    r.matchId,
    r.round,
    r.stage,
    { ...r.settings },
    seats(r).map((s) => ({ ...s })),
    { ...r.held },
    { ...r.ready },
    r.world ? structuredClone(r.world) : null,
  ];
}
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function decode(a: readonly unknown[], tick: number): Room | undefined {
  if (
    a.length !== 8 ||
    !uint32(tick) ||
    !validMatchId(a[0]) ||
    !["lobby", "running", "over"].includes(String(a[2]))
  )
    return;
  const settings = parseSettings(a[3]);
  if (
    !settings ||
    !Array.isArray(a[4]) ||
    a[4].length > 10 ||
    !plain(a[5]) ||
    !plain(a[6])
  )
    return;
  const r = createRoom(a[0], settings);
  r.tick = tick;
  r.stage = a[2] as Stage;
  r.round = a[1] as number;
  if (r.round !== (r.stage === "lobby" ? 0 : 1)) return;
  const slots = new Set<number>();
  for (const raw of a[4]) {
    if (
      !plain(raw) ||
      Object.keys(raw).some(
        (k) =>
          ![
            "id",
            "name",
            "slot",
            "avatarId",
            "connected",
            "bot",
            "watcher",
            "generation",
            "away",
          ].includes(k),
      )
    )
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
      r.seats.has(id) ||
      (watcher ? slot !== -1 : !uint32(slot) || slot >= 5 || slots.has(slot)) ||
      (watcher ? avatarId !== "" : !isAvatar(avatarId)) ||
      (bot ? generation !== undefined || watcher === true : !uint32(generation))
    )
      return;
    if (!watcher) slots.add(slot as number);
    r.seats.set(id, {
      id,
      name,
      slot: slot as number,
      avatarId: avatarId as string,
      connected,
      bot,
      ...(watcher ? { watcher: true } : {}),
      ...(away ? { away: true } : {}),
      ...(generation !== undefined ? { generation: generation as number } : {}),
    });
  }
  if ([...r.seats.values()].filter((s) => s.watcher).length > 5) return;
  for (const [id, b] of Object.entries(a[5])) {
    if (!r.seats.has(id) || !isInput(b)) return;
    r.held[id] = b;
  }
  for (const [id, b] of Object.entries(a[6])) {
    if (!r.seats.has(id) || typeof b !== "boolean") return;
    r.ready[id] = b;
  }
  if (a[7] !== null) {
    const w = decodeWorld(a[7]);
    if (
      !w ||
      w.tick > tick ||
      (r.stage === "running" &&
        w.hunters.some((h) => r.seats.get(h.id)?.slot !== h.slot)) ||
      r.stage === "lobby" ||
      (r.stage === "over") !== (w.tick === DURATION)
    )
      return;
    r.world = w;
  } else if (r.stage !== "lobby") return;
  return r;
}
export function hash(r: Room): string {
  const s = JSON.stringify([r.tick, ...encode(r)], (_k, v: unknown) =>
    plain(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
  let a = 2166136261,
    b = 2538058380;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0;
    b = Math.imul(b ^ s.charCodeAt(i), 16777619) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
export const view = (r: Room): View => ({
  tick: r.tick,
  matchId: r.matchId,
  stage: r.stage,
  seats: seats(r).map((s) => ({ ...s })),
  ready: { ...r.ready },
  world: r.world ? toView(r.world) : null,
});
export const graveyardGame: RollbackGame<Room, Entry, View, never, Settings> = {
  id: "graveyard-shift",
  rules: "graveyard-shift-1",
  isEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (r) => ({ matchId: r.matchId, round: r.round }),
  clock: (r) => r.tick,
  steps: () => 1,
  maxSteps: 1,
  view,
  hash,
  checkpoint: { leading: 5, encode, decode },
  members: seats,
  seat: (r, id) => r.seats.get(id),
  stage: (r) => r.stage,
  settings: (r) => r.settings,
  seating: {
    capacity: 5,
    maxWatchers: 5,
    seatName,
    isAvatar,
    defaultAvatar: AVATAR,
    parseSettings,
    soloSettings: () => ({ display: false }),
    sharedScreen: (s) => s.display,
    botId(r, pending) {
      let n = 1;
      while (r.seats.has(`bot:${n}`) || pending.has(`bot:${n}`)) n++;
      return `bot:${n}`;
    },
    botName: (s) => BOT_NAMES[s % 5]!,
    solo: { name: "Hunter", bots: 3 },
  },
  text: defaultText,
};
