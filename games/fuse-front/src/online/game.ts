import {
  ACTION,
  BOT,
  PRESENCE,
  SPECTATOR,
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
  COMMANDS_PER_SEAT,
  DIFFICULTIES,
  HERO_KINDS,
  ITEMS,
  ITEM_SLOTS,
  MAP_MAX,
  MARKS,
  MAX_ID,
  MAX_SEATS,
  NO_WINNER,
  RULES,
  STEER_MAX,
  STEPS_PER_TICK,
  botCommands,
  pickHeroes,
  createWorld,
  decodeWorld,
  encodeWorld,
  isInt,
  seedOf,
  step,
  viewOf,
  type CombatEvent,
  type Command,
  type Difficulty,
  type GameMap,
  type HeroKind,
  type World,
  type WorldView,
} from "../engine/index.js";
import { MAP_IDS, mapById, mapChoice, resolveMap } from "./maps.js";

/**
 * Fuse Front behind the netcode's `RollbackGame`. The room keeps the seats, the match and its world. Seats are slots
 * 0–5 and a slot's team is `slot % 2`; a match plays slots 0 to 2·size − 1, and a slot nobody connected sits in is
 * played by `botCommands` at the slot's difficulty, folded in the ticker. So a friend who joins mid-match takes the
 * lowest free slot and with it a bot's hero and army, and a rider who drops hands theirs back to a bot.
 */
export interface Settings {
  /** Riders per team: 1v1, 2v2 or 3v3. A start grows it to fit the highest seated slot. */
  size: number;
  /** The difficulty of the bot that plays each slot (0–5) while nobody does. */
  bots: Difficulty[];
  /** One shared screen, with phones as controllers. */
  display: boolean;
  /**
   * The hero picked for each slot (0–5), or null to take the first free one (`pickHeroes`). A hero is picked once a
   * team (slots of one parity); the other team may pick it too.
   */
  heroes: (HeroKind | null)[];
  /**
   * The map (`maps.ts`), or null for the size's default. A match fixes it at its start: `play.map` names the map the
   * match plays, the default when the chosen one has too few forts for the size it starts at.
   */
  map: string | null;
}
export const DEFAULT_SETTINGS: Settings = {
  size: 1,
  bots: Array<Difficulty>(MAX_SEATS).fill("normal"),
  display: false,
  heroes: Array<HeroKind | null>(MAX_SEATS).fill(null),
  map: null,
};
const SETTING_KEYS = ["bots", "display", "heroes", "map", "size"];
/** Exactly these five own keys, in range; anything else is refused. */
export function parseSettings(raw: unknown): Settings | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  const keys = Object.keys(raw).sort();
  if (keys.join() !== SETTING_KEYS.join()) return;
  const { size, bots, display, heroes, map } = raw as Record<string, unknown>;
  if (map !== null && !MAP_IDS.includes(map as string)) return;
  if (!uint32(size) || size < 1 || size > MAX_SEATS / 2) return;
  if (typeof display !== "boolean" || !Array.isArray(bots)) return;
  if (bots.length !== MAX_SEATS) return;
  if (!Array.isArray(heroes) || heroes.length !== MAX_SEATS) return;
  const picks = heroes.map((h) =>
    h === null ? null : HERO_KINDS.find((k) => k === h),
  );
  const repeated = picks.some(
    (h, slot) =>
      h && picks.findIndex((o, s) => o === h && s % 2 === slot % 2) !== slot,
  );
  if (picks.includes(undefined) || repeated) return;
  const levels = bots.map((b) => DIFFICULTIES.find((d) => d === b));
  if (levels.every((d) => d !== undefined))
    return {
      size,
      bots: levels,
      display,
      heroes: picks as (HeroKind | null)[],
      map: map as string | null,
    };
}

/**
 * Control kinds. A control entry is `[seq, tick, kind, matchId, ...args]` and counts only in the match it names; its
 * seat is the slot its author sits in, never a field. Kinds 0 and 1 (a factory's order and the army's stance) went
 * with v3's waves and are refused at the boundary. Args: MOVE `x, y` (a tile); STEER `dx, dy` (the stick); CAST `slot, x, y` or `slot, x, y, markIndex, id` (a unit spell's
 * chosen target); ATTACK `markIndex, id` (`MARKS`: a unit's id, a hero's seat or a building's site id); ATTACK_MOVE
 * `x, y` (a tile). MOVE, ATTACK, ATTACK_MOVE and CAST take one more arg, `1`, to queue the order behind the hero's
 * current one (shift-click, `orders.ts`) instead of replacing it. BUY `itemId` (`ITEMS`), SELL `slot` and USE_ITEM
 * `slot, x, y` (a tile, for a BLINK) work the shop (`shop.ts`). Whether the target exists and is an enemy, and whether
 * the hero may buy, sell or use, is the engine's to check on the step.
 */
export const MOVE = 2,
  STEER = 3,
  CAST = 4,
  ATTACK = 5,
  ATTACK_MOVE = 6,
  BUY = 7,
  SELL = 8,
  USE_ITEM = 9;
/** The highest control kind. */
const LAST = USE_ITEM;
export type ControlEntry = [number, number, number, string, ...number[]];
export type Entry = ManagementEntry<Settings> | ControlEntry;

export const CAPACITY = MAX_SEATS;
export const MAX_WATCHERS = 6;
/** Log ticks (of 50 ms) between the start and the first step. */
export const COUNTDOWN_TICKS = 60;
export const AVATAR = "brick";
export const BOT_PREFIX = "bot:";
export const BOT_NAMES = "Rivet Sprocket Tread Bolt Gasket Piston".split(" ");

// ---- names and ids ----
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/** Trimmed, 1–18 code points, no control characters or lone surrogates (the rule every Fuse game shares). */
export const validName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 36 &&
  value === value.trim() &&
  Array.from(value).length <= 18 &&
  !CONTROL_CHARS.test(value) &&
  !/\p{Cs}/u.test(value);
export function seatName(raw: string): string | undefined {
  if (CONTROL_CHARS.test(raw)) return;
  const name = Array.from(raw.replace(/\p{Cs}/gu, "").trim())
    .slice(0, 18)
    .join("")
    .trim();
  return validName(name) ? name : undefined;
}
export const validMatchId = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7e]{1,64}$/.test(value);
/** A member id safe as a record key: never one of `Object.prototype`'s names. */
const playerKey = (value: unknown): value is string =>
  memberId(value) && !(value in Object.prototype);
const isAvatar = (value: unknown): value is string => value === AVATAR;

// ---- entries ----
const int = isInt;
/** A target: its `MARKS` index and an id in range. */
const mark = ([of, id]: unknown[]) =>
  int(of, 0, MARKS.length - 1) && int(id, 0, MAX_ID);
/** A tile, then the queued flag when present. */
const tile = ([x, y, ...queued]: unknown[]) =>
  int(x, 0, MAP_MAX - 1) && int(y, 0, MAP_MAX - 1) && flag(queued);
/** The optional trailing queued flag: absent, or exactly 1. */
const flag = (rest: unknown[]) =>
  rest.length === 0 || (rest.length === 1 && rest[0] === 1);
const ARGS: Readonly<Record<number, (args: unknown[]) => boolean>> = {
  [MOVE]: tile,
  [STEER]: ([x, y]) =>
    int(x, -STEER_MAX, STEER_MAX) && int(y, -STEER_MAX, STEER_MAX),
  [CAST]: ([s, x, y, ...rest]) =>
    int(s, 0, 3) &&
    int(x, 0, MAP_MAX - 1) &&
    int(y, 0, MAP_MAX - 1) &&
    (rest.length < 2 ? flag(rest) : mark(rest) && flag(rest.slice(2))),
  [ATTACK]: (args) => mark(args) && flag(args.slice(2)),
  [ATTACK_MOVE]: tile,
  [BUY]: ([id]) => int(id, 0, ITEMS.length - 1),
  [SELL]: ([slot]) => int(slot, 0, ITEM_SLOTS - 1),
  [USE_ITEM]: ([slot, x, y]) =>
    int(slot, 0, ITEM_SLOTS - 1) &&
    int(x, 0, MAP_MAX - 1) &&
    int(y, 0, MAP_MAX - 1),
};
/** The argument counts each control kind takes. */
const ARITY: Readonly<Record<number, readonly number[]>> = {
  [MOVE]: [2, 3],
  [STEER]: [2],
  [CAST]: [3, 4, 5, 6],
  [ATTACK]: [2, 3],
  [ATTACK_MOVE]: [2, 3],
  [BUY]: [1],
  [SELL]: [1],
  [USE_ITEM]: [3],
};
const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (value: unknown) => parseSettings(value) !== undefined,
  capacity: CAPACITY,
};
/** The wire boundary: management entries by the shared rules, controls by shape and integer range. */
export function isEntry(raw: unknown): raw is Entry {
  if (isManagementEntry(raw, payloads)) {
    if (raw[2] === ACTION) return validMatchId(raw[4]);
    const at =
      raw[2] === BOT || raw[2] === SPECTATOR ? 4 : raw[2] <= PRESENCE ? 3 : -1;
    return at < 0 || playerKey((raw as unknown[])[at]);
  }
  if (!Array.isArray(raw)) return false;
  const [seq, tick, kind, matchId, ...args] = raw as unknown[];
  return (
    int(seq, 1, 0xffff_ffff) &&
    int(tick, 1, 0xffff_ffff) &&
    int(kind, MOVE, LAST) &&
    validMatchId(matchId) &&
    ARITY[kind]!.includes(args.length) &&
    ARGS[kind]!(args)
  );
}

/** The engine command an accepted control entry asks of `seat`. */
function command(entry: ControlEntry, seat: number): Command {
  const [, , kind, , a = 0, b = 0, c = 0, d, e, f] = entry;
  if (kind === STEER) return { seat, type: "steer", dx: a, dy: b };
  if (kind === BUY) return { seat, type: "buy", item: a };
  if (kind === SELL) return { seat, type: "sell", slot: a };
  if (kind === USE_ITEM) return { seat, type: "useItem", slot: a, x: b, y: c };
  // The queued flag is the last arg of a queued entry: the third of a MOVE, ATTACK or ATTACK_MOVE, a CAST's fourth or
  // sixth.
  const queued =
    kind === CAST
      ? entry.length === 8 || entry.length === 10
      : entry.length === 7;
  const q = queued ? { queued } : {};
  if (kind === MOVE) return { seat, type: "move", x: a, y: b, ...q };
  if (kind === ATTACK) return { seat, type: "attack", of: a, id: b, ...q };
  if (kind === ATTACK_MOVE)
    return { seat, type: "attackMove", x: a, y: b, ...q };
  if (d !== undefined && e !== undefined && entry.length >= 9)
    return { seat, type: "cast", slot: a, x: b, y: c, of: d, id: e, ...q };
  return { seat, type: "cast", slot: a, x: b, y: c, ...q };
}

// ---- the room ----
export interface Room extends ManagedRoom<Settings> {
  tick: number;
  matchId: string;
  stage: Stage;
  /** The settings the current match plays with, fixed at its start. */
  play: Settings;
  /** The log tick the match's first step runs on; 0 in the lobby. */
  startAt: number;
  world: World | null;
}

export function createRoom(matchId: string, settings: Settings): Room {
  const valid = parseSettings(settings) ?? DEFAULT_SETTINGS;
  return {
    tick: 0,
    matchId,
    stage: "lobby",
    seats: new Map(),
    settings: structuredClone(valid),
    play: structuredClone(valid),
    startAt: 0,
    world: null,
  };
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const seatOrder = (seats: Iterable<SeatRecord>) =>
  [...seats].sort((a, b) => a.slot - b.slot || byId(a.id, b.id));
/** Who sits in `slot`: a rider's or an added bot's seat record, or nobody. */
const sitter = (room: Room, slot: number) =>
  [...room.seats.values()].find((s) => !s.watcher && s.slot === slot);
/** Whether `slot`'s hero and army follow a connected rider (else a bot plays it). */
const ridden = (room: Room, slot: number) => {
  const seat = sitter(room, slot);
  return seat !== undefined && !seat.bot && seat.connected;
};

function resetMatch(room: Room, matchId: string): void {
  const { tick, seats, settings } = room;
  Object.assign(room, { ...createRoom(matchId, settings), tick, seats });
}
/** The map the room's match plays: `play.map`, fixed at its start (the size's default before one). */
export const mapOf = (room: Pick<Room, "play">): GameMap =>
  mapById(room.play.map ?? resolveMap(null, room.play.size));

/**
 * A new match: `size` riders a team, grown to fit the highest seated slot, on the chosen map (or the size's default
 * when it has too few forts), on a world seeded by the match id.
 */
function startMatch(room: Room, matchId: string): void {
  resetMatch(room, matchId);
  const highest = Math.max(
    -1,
    ...[...room.seats.values()].filter((s) => !s.watcher).map((s) => s.slot),
  );
  const size = Math.max(room.play.size, Math.ceil((highest + 1) / 2));
  const slots = Array.from({ length: 2 * size }, (_, slot) => slot);
  const picks = Object.fromEntries(slots.map((s) => [s, room.play.heroes[s]!]));
  room.play.map = resolveMap(room.play.map, size);
  room.world = createWorld(
    mapById(room.play.map),
    slots,
    seedOf(matchId),
    pickHeroes(slots, picks),
  );
  // An added AI seat only reserved its slot: the bot fill plays it from here, so a friend can take it mid-match.
  for (const seat of [...room.seats.values()])
    if (seat.bot) room.seats.delete(seat.id);
  room.stage = "running";
  room.startAt = room.tick + 1 + COUNTDOWN_TICKS;
}

export const lifecycle: LifecycleHooks<Room, Settings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: AVATAR,
  start: startMatch,
  rematch: startMatch,
  lobby: resetMatch,
};

/**
 * The tick's commands, slot by slot: a ridden slot's control entries for this tick and match (from the stream
 * generation its seat follows, in seq order, at most `COMMANDS_PER_SEAT`), else its bot's.
 */
function commands(
  room: Room,
  world: World,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): Command[] {
  const out: Command[] = [];
  const map = mapOf(room);
  for (const { seat: slot } of world.players) {
    if (!ridden(room, slot)) {
      out.push(...botCommands(map, world, slot, room.play.bots[slot]!));
      continue;
    }
    const seat = sitter(room, slot)!,
      stream = streams.get(seat.id);
    const source =
      stream?.generation === seat.generation
        ? stream
        : stream?.retired?.find((old) => old.generation === seat.generation);
    const mine = (source?.entries ?? [])
      .filter(
        (e): e is ControlEntry =>
          e[2] <= LAST && e[1] === tick && e[3] === room.matchId,
      )
      .sort((a, b) => a[0] - b[0])
      .slice(0, COMMANDS_PER_SEAT);
    out.push(...mine.map((entry) => command(entry, slot)));
  }
  return out;
}

/** An engine event and the world step it happened on: presentation dedupes by it across rollback re-runs. */
export interface FrontEvent {
  step: number;
  event: CombatEvent;
}

/**
 * One log tick: management first; then, once the countdown is over, `STEPS_PER_TICK` engine steps with the tick's
 * commands on the first. A decided match goes on stepping (the engine only moves its clock), so the world's step
 * always says how many log ticks it has folded.
 */
export function foldTick(
  room: Room,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
): FrontEvent[] {
  const tick = room.tick + 1;
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  const out: FrontEvent[] = [];
  if (room.world && tick >= room.startAt) {
    const first =
      room.stage === "running" ? commands(room, room.world, streams, tick) : [];
    let world = room.world;
    const map = mapOf(room);
    const events: CombatEvent[] = [];
    for (let index = 0; index < STEPS_PER_TICK; index++) {
      world = step(map, world, index === 0 ? first : []);
      events.push(...world.events);
      for (const event of world.events) out.push({ step: world.step, event });
    }
    room.world = { ...world, events };
    if (world.winner !== NO_WINNER) room.stage = "over";
  }
  room.tick = tick;
  return structuredClone(out);
}

// ---- checkpoint and hash ----
const STAGES: readonly Stage[] = ["lobby", "running", "over"];
/** A seat as a tuple in a fixed order, so the encoding (and so the hash) never depends on key insertion order. */
// prettier-ignore
const seatTuple = (s: SeatRecord) =>
  [s.id, s.name, s.slot, s.avatarId, s.connected, s.bot, s.watcher === true, s.bot ? -1 : (s.generation ?? -1), s.away === true];
function decodeSeat(raw: unknown): SeatRecord | undefined {
  if (!Array.isArray(raw) || raw.length !== 9) return;
  const [id, name, slot, avatarId, connected, bot, watcher, generation, away] =
    raw as unknown[];
  const flags = [connected, bot, watcher, away];
  if (
    !playerKey(id) ||
    !validName(name) ||
    flags.some((f) => typeof f !== "boolean")
  )
    return;
  if (
    watcher
      ? slot !== -1 || avatarId !== ""
      : !int(slot, 0, CAPACITY - 1) || !isAvatar(avatarId)
  )
    return;
  if (bot ? generation !== -1 || watcher : !uint32(generation)) return;
  if (away && connected) return;
  // prettier-ignore
  return { id, name, slot: slot as number, avatarId: avatarId as string, connected: connected as boolean,
    bot: bot as boolean, ...(watcher ? { watcher: true } : {}), ...(bot ? {} : { generation: generation as number }),
    ...(away ? { away: true } : {}) };
}

/** `[matchId, stage, settings, play]` before the netcode's streams and hash, then `[seats, startAt, world]`. */
export function encode(room: Room): unknown[] {
  return [
    room.matchId,
    room.stage,
    structuredClone(room.settings),
    structuredClone(room.play),
    seatOrder(room.seats.values()).map(seatTuple),
    room.startAt,
    room.world && encodeWorld(room.world),
  ];
}

/**
 * The room `encode` wrote at log tick `tick`, or undefined: every field checked, then the world against the room —
 * its players are slots 0 to 2·size − 1, its step is exactly `STEPS_PER_TICK` per log tick folded since `startAt`,
 * and the stage is "over" exactly when it has a winner. Never a partial room, and never a throw.
 */
export function decode(
  fields: readonly unknown[],
  tick: number,
): Room | undefined {
  if (fields.length !== 7 || !uint32(tick)) return;
  const [matchId, stage, rawSettings, rawPlay, rawSeats, startAt, rawWorld] =
    fields;
  const settings = parseSettings(rawSettings),
    play = parseSettings(rawPlay);
  if (!validMatchId(matchId) || !STAGES.includes(stage as Stage)) return;
  if (!settings || !play || !uint32(startAt)) return;
  if (!Array.isArray(rawSeats) || rawSeats.length > CAPACITY + MAX_WATCHERS)
    return;
  const seats = new Map<string, SeatRecord>();
  for (const raw of rawSeats) {
    const seat = decodeSeat(raw);
    if (!seat || seats.has(seat.id)) return;
    if (
      !seat.watcher &&
      [...seats.values()].some((s) => !s.watcher && s.slot === seat.slot)
    )
      return;
    seats.set(seat.id, seat);
  }
  if ([...seats.values()].filter((s) => s.watcher).length > MAX_WATCHERS)
    return;
  // prettier-ignore
  const room: Room = { tick, matchId, stage: stage as Stage, seats, settings, play, startAt, world: null };
  if (stage === "lobby")
    return startAt === 0 && rawWorld === null ? room : undefined;
  if (play.map === null) return;
  const world = decodeWorld(rawWorld, mapById(play.map));
  if (!world || world.players.length % 2 !== 0) return;
  // The map must hold the match: a fort for every slot in play.
  if (world.players.length > 2 * mapChoice(play.map).teams) return;
  if (world.players.length < 2 * play.size) return;
  if (world.players.some((p, index) => p.seat !== index)) return;
  if (startAt < 1 || startAt > tick + COUNTDOWN_TICKS) return;
  const folded = tick >= startAt ? tick - startAt + 1 : 0;
  if (world.step !== folded * STEPS_PER_TICK) return;
  if ((stage === "over") !== (world.winner !== NO_WINNER)) return;
  room.world = world;
  return room;
}

/**
 * 16 hex characters: two 32-bit FNV-1a passes over the canonical JSON of the log tick and the checkpoint, one
 * forward from the standard basis and one backward from another, so a collision has to fool both. The world's
 * `events` are presentation and left out (`encodeWorld` skips them).
 */
export function hash(room: Room): string {
  const text = JSON.stringify([room.tick, ...encode(room)]);
  let a = 0x811c9dc5,
    b = 0x050c5d1f;
  for (let i = 0, j = text.length - 1; i < text.length; i++, j--) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ text.charCodeAt(j), 0x01000193);
  }
  const hex = (h: number) => (h >>> 0).toString(16).padStart(8, "0");
  return hex(a) + hex(b);
}

// ---- view ----
/** What the screen renders: copies, so a kept frame never changes under the next fold. `tick` is the game clock. */
export interface View {
  tick: number;
  logTick: number;
  matchId: string;
  stage: Stage;
  settings: Settings;
  play: Settings;
  startAt: number;
  seats: SeatRecord[];
  /** The slots in play a bot drives this tick, at their difficulty. */
  bots: { slot: number; difficulty: Difficulty }[];
  /** `NO_WINNER`, the winning team, or `DRAW`. */
  winner: number;
  world: WorldView | null;
}
export function view(room: Room): View {
  const { world } = room;
  return {
    tick: room.tick * STEPS_PER_TICK,
    logTick: room.tick,
    matchId: room.matchId,
    stage: room.stage,
    settings: structuredClone(room.settings),
    play: structuredClone(room.play),
    startAt: room.startAt,
    seats: structuredClone(seatOrder(room.seats.values())),
    bots: (world?.players ?? [])
      .filter((p) => !ridden(room, p.seat))
      .map((p) => ({ slot: p.seat, difficulty: room.play.bots[p.seat]! })),
    winner: world?.winner ?? NO_WINNER,
    world: world && viewOf(mapOf(room), world),
  };
}

export const frontGame: RollbackGame<Room, Entry, View, FrontEvent, Settings> =
  {
    id: "fuse-front",
    rules: RULES,
    isEntry,
    createRoom,
    createTicker: () => foldTick,
    scope: (room) => ({
      matchId: room.matchId,
      round: room.stage === "lobby" ? 0 : 1,
    }),
    clock: (room) => room.tick * STEPS_PER_TICK,
    steps: () => STEPS_PER_TICK,
    maxSteps: STEPS_PER_TICK,
    view,
    hash,
    checkpoint: { leading: 4, encode, decode },
    members: (room) => seatOrder(room.seats.values()),
    seat: (room, id) => room.seats.get(id),
    stage: (room) => room.stage,
    settings: (room) => room.settings,
    matchSettings: (room) => room.play,
    seating: {
      capacity: CAPACITY,
      // Bots fill every empty slot, so one rider can start a match.
      minPlayers: 1,
      maxWatchers: MAX_WATCHERS,
      seatName,
      isAvatar,
      defaultAvatar: AVATAR,
      parseSettings,
      soloSettings: (settings) => ({ ...settings, display: false }),
      sharedScreen: (settings) => settings.display,
      botId(room, pending) {
        let n = 1;
        while (
          room.seats.has(`${BOT_PREFIX}${n}`) ||
          pending.has(`${BOT_PREFIX}${n}`)
        )
          n++;
        return `${BOT_PREFIX}${n}`;
      },
      botName: (slot) => BOT_NAMES[slot % BOT_NAMES.length]!,
      solo: { name: "Commander", bots: 0 },
    },
    text: defaultText,
  };
