import {
  applyManagementTick,
  isManagementEntry,
  memberId,
  uint32,
  defaultText,
  SPECTATOR,
  type ManagementEntry,
  type SeatRecord,
  type LifecycleHooks,
  type StreamEntries,
  type RollbackGame,
} from "fuse-netcode";
import {
  createWorld,
  NEUTRAL,
  RULES,
  S,
  type Input,
  type Tuning,
} from "../engine/world.js";
import { COOLDOWN_TICKS } from "../engine/bomb-rules.js";
import {
  createArena,
  stepArena,
  syncKeepers,
  encodeArena,
  decodeArena,
  type Arena,
} from "../engine/arena.js";
import { parseInput, parseTuning, plain, integer } from "../engine/codec.js";
import { POWER_PADS } from "../engine/power-ups.js";
import { planBots } from "../engine/bot.js";
import {
  toView,
  contestView,
  type WorldView,
  type KeeperView,
} from "../engine/view.js";
export type Entry =
  ManagementEntry<Tuning> | [number, number, 0, string, number, Input];
export interface Room {
  tick: number;
  matchId: string;
  round: number;
  stage: "lobby" | "running";
  settings: Tuning;
  seats: Map<string, SeatRecord>;
  simulation: Arena;
}
export interface View extends WorldView {
  stage: Room["stage"];
  seated: boolean;
  seats: SeatRecord[];
  round: number;
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
/** AI seats are `bot:1`, `bot:2`, …; the room service gives people UUIDs. */
const BOT_ID = /^bot:[1-9]\d?$/;
/** AI keepers are named for the belfry's odd residents, one per seat. */
export const BOT_NAMES = ["Clapper", "Wick", "Rook", "Tallow", "Gargoyle"];
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
    raw[2] !== SPECTATOR &&
    isManagementEntry(raw, {
      name,
      avatar,
      settings: (v) => !!parseTuning(v),
      capacity: 5,
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
    simulation: createArena(settings),
  };
}
const lifecycle: LifecycleHooks<Room, Tuning> = {
  stage: (r) => r.stage,
  maxWatchers: 0,
  botAvatar: "keeper",
  parseSettings: parseTuning,
  start(r, id) {
    if (r.stage !== "lobby" || ![...r.seats.values()].some((s) => s.connected))
      return;
    r.matchId = id;
    r.round = 1;
    r.stage = "running";
    r.simulation = createArena(r.settings, r.simulation.tick);
  },
  rematch() {},
  lobby(r, id) {
    r.stage = "lobby";
    r.matchId = id;
    r.round = 0;
    r.simulation = createArena(r.settings, r.simulation.tick);
  },
};
/**
 * The inputs of one log tick's three engine steps, from the input the last
 * step held and the tick's inputs in log order. Every step takes the tick's
 * last input, with these exceptions so quick taps are not lost:
 * - A press released inside the tick (jump, drop, fire, bomb, reset) is
 *   held on the first step and released on the next, so a tapped bomb is
 *   still thrown.
 * - The bomb also keeps a release: each change of the bomb button inside the
 *   tick gets a step of its own, up to three, ending on the last state. A
 *   release and re-press inside one tick reads `bomb: false` on the first
 *   step, so that throw is thrown and a new charge starts on the next.
 * - A step that releases the bomb aims where the releasing input aimed: the
 *   engine reads a throw's aim on its release, and a later input in the same
 *   tick (lifting a direction key after K, say) must not steer it.
 * Other buttons keep press edges only: a hook released and pressed again
 * inside one tick stays held, and keeps its rope.
 */
export function stepInputs(
  held: Input,
  inputs: readonly Input[],
): [Input, Input, Input] {
  let final = held;
  const pulse = { jump: false, drop: false, fire: false, reset: false },
    changes: Input[] = [];
  for (const input of inputs) {
    for (const key of ["jump", "drop", "fire", "reset"] as const)
      pulse[key] ||= input[key] && !final[key];
    if (input.bomb !== final.bomb) changes.push(input);
    final = input;
  }
  // Each step's bomb state and the input that set it.
  const sources = [changes[0], changes[1], changes.at(-1)],
    steps: [Input, Input, Input] = [
      {
        ...final,
        jump: final.jump || pulse.jump,
        drop: final.drop || pulse.drop,
        fire: final.fire || pulse.fire,
        reset: final.reset || pulse.reset,
        bomb: changes[0]?.bomb ?? final.bomb,
      },
      { ...final, bomb: changes[1]?.bomb ?? final.bomb },
      { ...final },
    ];
  let before = held.bomb;
  steps.forEach((step, i) => {
    const source = sources[i];
    if (before && !step.bomb && source && !source.bomb) {
      step.aimX = source.aimX;
      step.aimY = source.aimY;
    }
    before = step.bomb;
  });
  return steps;
}
export function foldTick(
  r: Room,
  creator: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
): never[] {
  const tick = r.tick + 1,
    oldSettings = JSON.stringify(r.settings);
  applyManagementTick(r, tick, creator, streams, lifecycle);
  if (JSON.stringify(r.settings) !== oldSettings) {
    r.simulation = createArena(r.settings, r.simulation.tick);
    r.round++;
  }
  syncKeepers(
    r.simulation,
    [...r.seats.values()].map((s) => ({ ...s, generation: s.generation ?? 0 })),
  );
  // Bots play from the arena alone, on every peer; no stream carries their input.
  const bots =
    r.stage === "running" ? planBots(r.simulation) : new Map<string, Input>();
  const controls = r.simulation.keepers.map((keeper) => {
    if (keeper.mind) {
      // A bot holds one input for the whole log tick, as a person's
      // unchanged input does.
      const planned = bots.get(keeper.id) ?? {
        ...NEUTRAL,
        aimX: keeper.world.input.aimX,
        aimY: keeper.world.input.aimY,
      };
      return {
        keeper,
        steps: [planned, planned, planned] as [Input, Input, Input],
      };
    }
    const stream = streams.get(keeper.id),
      generation = keeper.generation;
    const source =
      stream?.generation === generation
        ? stream
        : stream?.retired?.find((s) => s.generation === generation);
    const inputs =
      keeper.connected && r.stage === "running"
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
    return { keeper, steps: stepInputs(keeper.world.input, inputs) };
  });
  for (let i = 0; i < 3; i++) {
    for (const { keeper, steps } of controls)
      keeper.world.input = { ...steps[i]! };
    stepArena(r.simulation, r.stage === "running");
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
    [...r.seats.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((s) => ({ ...s })),
    encodeArena(r.simulation),
  ];
}
export function decode(f: readonly unknown[], tick: number): Room | undefined {
  if (
    f.length !== 6 ||
    !uint32(tick) ||
    !match(f[0]) ||
    !uint32(f[1]) ||
    (f[2] !== "lobby" && f[2] !== "running") ||
    !Array.isArray(f[4]) ||
    f[4].length > 5
  )
    return;
  const settings = parseTuning(f[3]),
    simulation = decodeArena(f[5]);
  if (
    !settings ||
    !simulation ||
    simulation.tick !== tick * 3 ||
    JSON.stringify(settings) !== JSON.stringify(simulation.tuning) ||
    // The lobby holds a fresh arena that never runs: no bomb state at all.
    (f[2] === "lobby" &&
      (simulation.bombs.length ||
        simulation.blasts.length ||
        simulation.knockouts.length ||
        simulation.keepers.some((k) => k.world.charge)))
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
      !integer(s.slot, 0, 4) ||
      seats.has(s.id) ||
      [...seats.values()].some((old) => old.slot === s.slot) ||
      !avatar(s.avatarId) ||
      typeof s.connected !== "boolean" ||
      typeof s.bot !== "boolean" ||
      // A bot seat: a bot id, no stream generation, never away. A person: the reverse.
      (s.bot
        ? !BOT_ID.test(s.id) ||
          Object.hasOwn(s, "generation") ||
          Object.hasOwn(s, "away")
        : !uint32(s.generation) ||
          (s.away !== undefined && s.away !== true) ||
          (s.away && s.connected))
    )
      return;
    seats.set(
      s.id,
      s.bot
        ? {
            id: s.id,
            name: s.name,
            slot: s.slot,
            avatarId: s.avatarId,
            connected: s.connected,
            bot: true,
          }
        : {
            id: s.id,
            name: s.name,
            slot: s.slot,
            avatarId: s.avatarId,
            connected: s.connected,
            bot: false,
            generation: s.generation as number,
            ...(s.away ? { away: true } : {}),
          },
    );
  }
  if (
    simulation.keepers.length !== seats.size ||
    simulation.keepers.some((k) => {
      const seat = seats.get(k.id);
      return (
        !seat ||
        seat.slot !== k.slot ||
        (seat.generation ?? 0) !== k.generation ||
        seat.connected !== k.connected ||
        seat.bot !== (k.mind !== null)
      );
    }) ||
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
    ...toView(
      r.simulation.keepers[0]?.world ?? {
        ...createWorld(r.settings),
        tick: r.simulation.tick,
        combat: r.simulation.combat,
      },
    ),
    keepers: r.simulation.keepers.map((k): KeeperView => ({
      cooldown: k.bomb.cooldown / COOLDOWN_TICKS,
      tally: {
        thrown: k.bomb.thrown,
        knockouts: k.bomb.knockouts,
        selfKnockouts: k.bomb.selfKnockouts,
        bombed: k.bomb.bombed,
        falls: Math.max(
          0,
          k.world.deaths - k.bomb.bombed - k.bomb.selfKnockouts,
        ),
        fate: k.bomb.fate,
        by: k.bomb.by,
      },
      ward: Math.ceil(k.ward / 60),
      playing:
        r.settings.rules === "free" ||
        r.simulation.contest.entries.some((e) => e.id === k.id && !e.out),
      id: k.id,
      slot: k.slot,
      name: r.seats.get(k.id)!.name,
      bot: k.mind !== null,
      connected: k.connected,
      shield: k.shield,
      hits: k.hits,
      body: toView(k.world),
    })),
    hit: r.simulation.hit && {
      ...r.simulation.hit,
      x: r.simulation.hit.x / 1024,
      y: r.simulation.hit.y / 1024,
    },
    bombs: r.simulation.bombs.map((b) => ({
      ...b,
      x: b.x / S,
      y: b.y / S,
      vx: (b.vx * 60) / S,
      vy: (b.vy * 60) / S,
    })),
    blasts: r.simulation.blasts.map((e) => ({ ...e, x: e.x / S, y: e.y / S })),
    knockouts: r.simulation.knockouts.map((e) => ({
      ...e,
      x: e.x / S,
      y: e.y / S,
    })),
    pickups:
      r.settings.powerUps === "on"
        ? POWER_PADS[r.settings.map].map((p, i) => ({
            ...p,
            cooldown: Math.ceil(r.simulation.powerCooldowns[i]! / 60),
          }))
        : [],
    pickupEvents: r.simulation.pickupEvents.map((e) => ({
      tick: e.tick,
      by: e.by,
      ...POWER_PADS[r.settings.map][e.pad]!,
    })),
    contest: contestView(r.simulation.contest, r.settings.rules),
    stage: r.stage,
    seated: [...r.seats.values()].some((s) => s.connected),
    seats: [...r.seats.values()].map((s) => ({ ...s })),
    round: r.round,
  }),
  hash,
  checkpoint: { leading: 5, encode, decode },
  members: (r) => r.seats.values(),
  seat: (r, id) => r.seats.get(id),
  stage: (r) => r.stage,
  settings: (r) => r.settings,
  seating: {
    capacity: 5,
    minPlayers: 1,
    maxWatchers: 0,
    seatName: (v) => (name(v.trim()) ? v.trim() : undefined),
    isAvatar: avatar,
    defaultAvatar: "keeper",
    parseSettings: parseTuning,
    soloSettings: (s) => ({ ...s }),
    sharedScreen: () => false,
    botId(room, pending) {
      const taken = (id: string) =>
        room.seats.has(id) ||
        pending.has(id) ||
        room.simulation.keepers.some((k) => k.id === id) ||
        room.simulation.contest.entries.some((e) => e.id === id);
      let n = 1;
      while (taken(`bot:${n}`)) n++;
      return `bot:${n}`;
    },
    botName: (slot) => BOT_NAMES[slot] ?? "Bell bot",
    solo: { name: "Lantern keeper", bots: 0 },
  },
  text: {
    ...defaultText,
    needTwo: "The keeper must be connected before starting.",
  },
};
