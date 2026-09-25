import {
  applyManagementTick,
  defaultText,
  isManagementEntry,
  uint32,
  type ManagementEntry,
  type RollbackGame,
  type SeatRecord,
  type Stage,
} from "fuse-netcode";
import {
  createMatch,
  step,
  loadMap,
  encodeState,
  decodeState,
  isAction,
  type Action,
  type World,
  type MapDefinition,
  type MatchSettings,
  type Command,
} from "../engine/index.js";
import { prepareCombatLab, labCommands } from "./combat-lab.js";

export interface NeuralSettings {
  map: MapDefinition;
  slot: number;
  mode: "sandbox" | "combat-lab";
  engine: MatchSettings;
}
export interface NeuralRoom {
  tick: number;
  matchId: string;
  stage: Stage;
  seats: Map<string, SeatRecord>;
  settings: NeuralSettings;
  world: World;
}
export type PlayEntry = [number, number, 1, string, Action];
export type NeuralEntry = ManagementEntry<NeuralSettings> | PlayEntry;
const record = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
export function parseSettings(x: unknown): NeuralSettings | undefined {
  if (
    !record(x) ||
    !Number.isInteger(x.slot) ||
    Number(x.slot) < 0 ||
    Number(x.slot) > 3 ||
    (x.mode !== "sandbox" && x.mode !== "combat-lab") ||
    !record(x.engine)
  )
    return;
  if (
    Object.keys(x.engine).some(
      (k) => !["instantConstruction", "instantResearch"].includes(k),
    ) ||
    Object.values(x.engine).some((v) => typeof v !== "boolean")
  )
    return;
  try {
    const map = loadMap(x.map);
    if (!map.spawns.some((s) => s.slot === x.slot)) return;
    return { map, slot: Number(x.slot), mode: x.mode, engine: { ...x.engine } };
  } catch {
    return;
  }
}
const name = (s: string) => s.trim().slice(0, 32) || undefined;
const avatar = (x: unknown): x is string => x === "brain";
function roomHash(room: NeuralRoom): string {
  const encoded = JSON.stringify(
    canonical({
      tick: room.tick,
      matchId: room.matchId,
      stage: room.stage,
      settings: room.settings,
      seats: [...room.seats.values()].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
      world: encodeState(room.world),
    }),
  );
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < encoded.length; i++)
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(encoded.charCodeAt(i))) * 0x100000001b3n,
    );
  return hash.toString(16).padStart(16, "0");
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value))
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function isEntry(x: unknown): x is NeuralEntry {
  return (
    isManagementEntry(x, {
      capacity: 4,
      name: (value) => typeof value === "string" && name(value) === value,
      avatar,
      settings: (value) => parseSettings(value) !== undefined,
    }) ||
    (Array.isArray(x) &&
      x.length === 5 &&
      uint32(x[0]) &&
      x[0] > 0 &&
      uint32(x[1]) &&
      x[1] > 0 &&
      x[2] === 1 &&
      typeof x[3] === "string" &&
      x[3].length > 0 &&
      x[3].length <= 128 &&
      isAction(x[4]))
  );
}
function initial(settings: NeuralSettings, matchId: string): World {
  return createMatch(settings.map, { ...settings.engine, matchId }, [
    { id: "solo", slot: settings.slot },
  ]);
}
function start(room: NeuralRoom, matchId: string) {
  const players = [...room.seats.values()]
    .filter((s) => s.connected && !s.watcher)
    .sort((a, b) => a.slot - b.slot);
  if (
    !players.length ||
    (room.settings.mode === "combat-lab" &&
      (players.length !== 1 || players[0]!.bot))
  )
    return;
  const spawnSlots = new Set(
    room.settings.map.spawns.map((spawn) => spawn.slot),
  );
  const roster = players.map((p) => ({
    id: p.id,
    slot: players.length === 1 ? room.settings.slot : p.slot,
  }));
  if (roster.some((player) => !spawnSlots.has(player.slot))) return;
  if (room.settings.mode === "combat-lab" && room.seats.has("lab-opponent"))
    return;
  let world: World | undefined;
  try {
    if (room.settings.mode === "sandbox") {
      world = createMatch(
        room.settings.map,
        { ...room.settings.engine, matchId },
        roster,
      );
    } else {
      for (const spawn of room.settings.map.spawns) {
        if (spawn.slot === roster[0]!.slot) continue;
        const candidate = createMatch(
          room.settings.map,
          { ...room.settings.engine, matchId },
          [...roster, { id: "lab-opponent", slot: spawn.slot }],
        );
        prepareCombatLab(candidate);
        if (
          candidate.structures.filter((structure) => structure.kind === "tower")
            .length === 1
        ) {
          world = candidate;
          break;
        }
      }
    }
  } catch {
    return;
  }
  if (!world) return;
  room.matchId = matchId;
  room.world = world;
  room.stage = "running";
}
export const neuralGame: RollbackGame<
  NeuralRoom,
  NeuralEntry,
  World,
  never,
  NeuralSettings
> = {
  id: "neural-defence",
  rules: "neural-defence-1",
  isEntry,
  createRoom: (matchId, settings) => ({
    tick: 0,
    matchId,
    stage: "lobby",
    seats: new Map(),
    settings,
    world: initial(settings, matchId),
  }),
  createTicker: () => (room, creator, streams) => {
    const tick = room.tick + 1;
    applyManagementTick(room, tick, creator, streams, {
      stage: (r) => r.stage,
      maxWatchers: 4,
      parseSettings,
      botAvatar: "brain",
      start,
      rematch: start,
      lobby: (r, id) => {
        r.stage = "lobby";
        r.matchId = id;
        r.world = initial(r.settings, id);
      },
    });
    if (room.stage === "running") {
      const commands: Command[] = [];
      for (const seat of [...room.seats.values()].sort(
        (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )) {
        if (!seat.connected || seat.watcher) continue;
        const stream = streams.get(seat.id);
        const source =
          stream?.generation === seat.generation
            ? stream
            : stream?.retired?.find((s) => s.generation === seat.generation);
        let sequence =
          room.world.players.find((p) => p.id === seat.id)?.sequence ?? 0;
        for (const entry of source?.entries ?? [])
          if (entry[1] === tick && entry[2] === 1 && entry[3] === room.matchId)
            commands.push({
              playerId: seat.id,
              sequence: ++sequence,
              matchId: room.matchId,
              action: entry[4],
            });
      }
      if (room.settings.mode === "combat-lab")
        commands.push(...labCommands(room.world));
      room.world = step(room.world, commands);
      if (room.world.finished) room.stage = "over";
    }
    room.tick = tick;
    return [];
  },
  scope: (r) => ({ matchId: r.matchId, round: 1 }),
  clock: (r) => r.world.tick,
  steps: () => 1,
  maxSteps: 1,
  view: (r) => r.world,
  hash: roomHash,
  checkpoint: {
    leading: 1,
    encode: (r) => [
      JSON.stringify({
        tick: r.tick,
        matchId: r.matchId,
        stage: r.stage,
        seats: [...r.seats.values()],
        settings: r.settings,
        world: encodeState(r.world),
      }),
    ],
    decode: (fields, tick) => {
      try {
        if (
          fields.length !== 1 ||
          typeof fields[0] !== "string" ||
          fields[0].length > 4_000_000
        )
          return;
        const raw: unknown = JSON.parse(fields[0]);
        if (
          !record(raw) ||
          !uint32(raw.tick) ||
          raw.tick !== tick ||
          typeof raw.matchId !== "string" ||
          raw.matchId.length > 128 ||
          !["lobby", "running", "over"].includes(String(raw.stage)) ||
          !Array.isArray(raw.seats) ||
          raw.seats.length > 8 ||
          typeof raw.world !== "string"
        )
          return;
        const settings = parseSettings(raw.settings);
        if (!settings) return;
        const seats = new Map<string, SeatRecord>();
        const slots = new Set<number>();
        for (const s of raw.seats) {
          if (
            !record(s) ||
            typeof s.id !== "string" ||
            !s.id ||
            s.id.length > 128 ||
            typeof s.name !== "string" ||
            !name(s.name) ||
            !Number.isInteger(s.slot) ||
            typeof s.connected !== "boolean" ||
            typeof s.bot !== "boolean" ||
            (s.generation !== undefined && !uint32(s.generation)) ||
            seats.has(s.id)
          )
            return;
          if (s.watcher !== undefined && typeof s.watcher !== "boolean") return;
          if (s.away !== undefined && typeof s.away !== "boolean") return;
          if (s.watcher === true ? s.avatarId !== "" : !avatar(s.avatarId))
            return;
          if (s.bot ? s.generation !== undefined : !uint32(s.generation))
            return;
          if (s.watcher === true && s.bot) return;
          if (s.away === true && s.connected) return;
          if (
            s.watcher
              ? s.slot !== -1
              : Number(s.slot) < 0 ||
                Number(s.slot) > 3 ||
                slots.has(Number(s.slot))
          )
            return;
          if (!s.watcher) slots.add(Number(s.slot));
          seats.set(s.id, {
            id: s.id,
            name: s.name,
            slot: Number(s.slot),
            connected: s.connected,
            bot: s.bot,
            avatarId: s.watcher === true ? "" : "brain",
            ...(s.watcher === true ? { watcher: true } : {}),
            ...(s.away === true ? { away: true } : {}),
            ...(typeof s.generation === "number"
              ? { generation: s.generation }
              : {}),
          });
        }
        const world = decodeState(raw.world);
        if (
          world.matchId !== raw.matchId ||
          world.tick > tick ||
          JSON.stringify(canonical(world.map)) !==
            JSON.stringify(canonical(settings.map)) ||
          JSON.stringify(canonical(world.settings)) !==
            JSON.stringify(
              canonical({ ...settings.engine, matchId: raw.matchId }),
            ) ||
          (raw.stage === "lobby" && (world.tick !== 0 || world.finished)) ||
          (raw.stage === "running" && world.finished) ||
          (raw.stage === "over" && !world.finished)
        )
          return;
        if (raw.stage !== "lobby") {
          const participants = world.players.filter(
            (p) => p.id !== "lab-opponent",
          );
          if (
            participants.length === 0 ||
            participants.some((p) => {
              const seat = seats.get(p.id);
              return (
                !seat ||
                seat.watcher ||
                (participants.length === 1
                  ? p.slot !== settings.slot
                  : seat.slot !== p.slot)
              );
            }) ||
            (settings.mode === "combat-lab" &&
              (participants.length !== 1 ||
                world.players.length !== 2 ||
                !world.players.some((p) => p.id === "lab-opponent"))) ||
            (settings.mode === "sandbox" &&
              world.players.some((p) => p.id === "lab-opponent"))
          )
            return;
        }
        return {
          tick,
          matchId: raw.matchId,
          stage: raw.stage as Stage,
          seats,
          settings,
          world,
        };
      } catch {
        return;
      }
    },
  },
  members: (r) => [...r.seats.values()].sort((a, b) => a.slot - b.slot),
  seat: (r, id) => r.seats.get(id),
  stage: (r) => r.stage,
  settings: (r) => r.settings,
  seating: {
    capacity: 4,
    maxWatchers: 4,
    minimumParticipants: () => 1,
    seatName: name,
    isAvatar: avatar,
    defaultAvatar: "brain",
    parseSettings,
    soloSettings: (s) => s,
    sharedScreen: () => false,
    botId: () => "",
    botName: () => "",
    solo: { name: "You", bots: 0 },
  },
  text: defaultText,
};
