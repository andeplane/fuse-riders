import {
  applyManagementTick,
  isManagementEntry,
  memberId,
  uint32,
  defaultText,
  BOT,
  SPECTATOR,
  type ManagementEntry,
  type SeatRecord,
  type LifecycleHooks,
  type StreamEntries,
  type RollbackGame,
} from "fuse-netcode";
import {
  createWorld,
  cancel,
  NEUTRAL,
  RULES,
  type Input,
  type Tuning,
  type World,
} from "../engine/world.js";
import { step, retune } from "../engine/step.js";
import {
  decodeWorld,
  parseInput,
  parseTuning,
  plain,
  integer,
} from "../engine/codec.js";
import { toView, type WorldView } from "../engine/view.js";
export type Entry =
  ManagementEntry<Tuning> | [number, number, 0, string, number, Input];
export interface Room {
  tick: number;
  matchId: string;
  round: number;
  stage: "lobby" | "running";
  settings: Tuning;
  seats: Map<string, SeatRecord>;
  simulation: World;
  generation: number;
}
export interface View extends WorldView {
  stage: Room["stage"];
  seated: boolean;
}
const name = (v: unknown): v is string =>
  typeof v === "string" &&
  v.trim() === v &&
  v.length > 0 &&
  v.length <= 24 &&
  !/[\x00-\x1f\x7f]/.test(v);
const match = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 64;
const avatar = (v: unknown): v is string => v === "keeper";
export function isEntry(raw: unknown): raw is Entry {
  if (
    !Array.isArray(raw) ||
    !uint32(raw[0]) ||
    !raw[0] ||
    !uint32(raw[1]) ||
    !raw[1]
  )
    return false;
  if (raw[2] === 0)
    return (
      raw.length === 6 &&
      match(raw[3]) &&
      uint32(raw[4]) &&
      !!parseInput(raw[5])
    );
  return (
    raw[2] !== BOT &&
    raw[2] !== SPECTATOR &&
    isManagementEntry(raw, {
      name,
      avatar,
      settings: (v) => !!parseTuning(v),
      capacity: 1,
    })
  );
}
export function createRoom(matchId: string, settings: Tuning): Room {
  return {
    tick: 0,
    matchId,
    round: 0,
    stage: "lobby",
    settings: { ...settings },
    seats: new Map(),
    simulation: createWorld(settings),
    generation: -1,
  };
}
const lifecycle: LifecycleHooks<Room, Tuning> = {
  stage: (r) => r.stage,
  maxWatchers: 0,
  parseSettings: parseTuning,
  start(r, id) {
    if (r.stage !== "lobby" || ![...r.seats.values()].some((s) => s.connected))
      return;
    r.matchId = id;
    r.round = 1;
    r.stage = "running";
    r.simulation = retune(r.simulation, r.settings);
  },
  rematch() {},
  lobby(r, id) {
    r.stage = "lobby";
    r.matchId = id;
    r.round = 0;
    cancel(r.simulation);
  },
};
export function foldTick(
  r: Room,
  creator: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
): never[] {
  const tick = r.tick + 1,
    oldSettings = JSON.stringify(r.settings);
  applyManagementTick(r, tick, creator, streams, lifecycle);
  if (JSON.stringify(r.settings) !== oldSettings) {
    r.simulation = retune(r.simulation, r.settings);
    r.round++;
  }
  const seat = [...r.seats.values()][0],
    generation = seat?.generation ?? -1;
  if (!seat?.connected || generation !== r.generation) cancel(r.simulation);
  r.generation = generation;
  const stream = seat && streams.get(seat.id),
    source =
      stream?.generation === generation
        ? stream
        : stream?.retired?.find((s) => s.generation === generation);
  const inputs =
    seat?.connected && r.stage === "running"
      ? (source?.entries ?? [])
          .filter(
            (
              e,
            ): e is Extract<
              Entry,
              [number, number, 0, string, number, Input]
            > =>
              e[1] === tick &&
              e[2] === 0 &&
              e[3] === r.matchId &&
              e[4] === r.round,
          )
          .sort((a, b) => a[0] - b[0])
          .map((e) => e[5])
      : [];
  // Preserve a short press/release inside a 50ms log tick: one pulse in its first physics step.
  let final = { ...r.simulation.input },
    pulse = { jump: false, fire: false, reset: false };
  for (const input of inputs) {
    for (const key of ["jump", "fire", "reset"] as const)
      pulse[key] ||= input[key] && !final[key];
    final = { ...input };
  }
  for (let i = 0; i < 3; i++) {
    r.simulation.input = {
      ...final,
      ...(i === 0
        ? {
            jump: final.jump || pulse.jump,
            fire: final.fire || pulse.fire,
            reset: final.reset || pulse.reset,
          }
        : {}),
    };
    if (r.stage === "running" && seat?.connected) step(r.simulation);
    else r.simulation.tick++;
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
    [...r.seats.values()].map((s) => ({ ...s })),
    structuredClone(r.simulation),
    r.generation,
  ];
}
export function decode(f: readonly unknown[], tick: number): Room | undefined {
  if (
    f.length !== 7 ||
    !uint32(tick) ||
    !match(f[0]) ||
    !uint32(f[1]) ||
    (f[2] !== "lobby" && f[2] !== "running") ||
    !Array.isArray(f[4]) ||
    f[4].length > 1 ||
    !integer(f[6], -1, 0xffffffff)
  )
    return;
  const settings = parseTuning(f[3]),
    simulation = decodeWorld(f[5]);
  if (
    !settings ||
    !simulation ||
    simulation.tick !== tick * 3 ||
    JSON.stringify(settings) !== JSON.stringify(simulation.tuning)
  )
    return;
  const seats = new Map<string, SeatRecord>();
  for (const s of f[4]) {
    if (
      !plain(s) ||
      Object.keys(s).some(
        (k) =>
          ![
            "id",
            "name",
            "slot",
            "avatarId",
            "connected",
            "bot",
            "generation",
            "away",
          ].includes(k),
      ) ||
      !memberId(s.id) ||
      !name(s.name) ||
      s.slot !== 0 ||
      !avatar(s.avatarId) ||
      typeof s.connected !== "boolean" ||
      s.bot !== false ||
      !uint32(s.generation) ||
      (s.away !== undefined && s.away !== true) ||
      (s.away && s.connected)
    )
      return;
    seats.set(s.id, {
      id: s.id,
      name: s.name,
      slot: 0,
      avatarId: s.avatarId,
      connected: s.connected,
      bot: false,
      generation: s.generation,
      ...(s.away ? { away: true } : {}),
    });
  }
  if (
    f[6] !== ([...seats.values()][0]?.generation ?? -1) ||
    (f[2] === "running" && (!seats.size || !f[1]))
  )
    return;
  return {
    tick,
    matchId: f[0],
    round: f[1],
    stage: f[2],
    settings,
    seats,
    simulation,
    generation: f[6],
  };
}
export function hash(r: Room): string {
  const text = JSON.stringify([r.tick, ...encode(r)], (_k, v: unknown) =>
    plain(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
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
export const hookGame: RollbackGame<Room, Entry, View, never, Tuning> = {
  id: "hook-havok",
  rules: RULES,
  isEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (r) => ({ matchId: r.matchId, round: r.round }),
  clock: (r) => r.simulation.tick,
  steps: () => 3,
  maxSteps: 3,
  view: (r) => ({
    ...toView(r.simulation),
    stage: r.stage,
    seated: [...r.seats.values()].some((s) => s.connected),
  }),
  hash,
  checkpoint: { leading: 5, encode, decode },
  members: (r) => r.seats.values(),
  seat: (r, id) => r.seats.get(id),
  stage: (r) => r.stage,
  settings: (r) => r.settings,
  seating: {
    capacity: 1,
    minPlayers: 1,
    maxWatchers: 0,
    seatName: (v) => (name(v.trim()) ? v.trim() : undefined),
    isAvatar: avatar,
    defaultAvatar: "keeper",
    parseSettings: parseTuning,
    soloSettings: (s) => ({ ...s }),
    sharedScreen: () => false,
    botId: () => "unused",
    botName: () => "unused",
    solo: { name: "Lantern keeper", bots: 0 },
  },
  text: {
    ...defaultText,
    needTwo: "The keeper must be connected before starting.",
  },
};
