import { uint32, type SeatRecord, type Stage } from "fuse-netcode";
import {
  BRIEFING_TICKS,
  CAPACITY,
  MAX_WEEKS,
  TICKS_PER_SECOND,
  WEEK_SECONDS,
  WEEK_UNITS,
} from "./basics.js";
import { ASSET_COUNT, CATEGORIES, COMPANIES, HISTORY } from "./data/economy.js";
import { DURABLES, type DurableId } from "./data/items.js";
import { COURSES, JOBS, LESSONS } from "./data/jobs.js";
import { PLACES } from "./data/places.js";
import { STEPS } from "./streets.js";
import {
  IMPACT_MAX,
  IMPACT_MIN,
  type CompanyState,
  type Economy,
} from "./economy.js";
import {
  BRIEFING,
  HANDOFF,
  MAX_PARTICIPANTS,
  MAX_WATCHERS,
  WEEK,
  isAvatar,
  parseSettings,
  playerKey,
  seated,
  validGoal,
  validMatchId,
  type FuseLaneRoom,
  type RosterEntry,
} from "./rules.js";
import { validName } from "./basics.js";
import {
  FLAG_MASK,
  type Goals,
  type Owned,
  type PlayerState,
} from "./state.js";

/**
 * The room as snapshot fields, and back. `decode` checks every field and how the fields fit together and builds a
 * fresh room only once all of them pass: a corrupt or hostile snapshot yields `undefined`, never part of a room.
 */
const STAGES: readonly Stage[] = ["lobby", "running", "between", "over"];
const MONEY = 1e12;
const TEXT = 240;

export function encodeRoom(room: FuseLaneRoom): unknown[] {
  return [
    [room.matchId, room.stage, room.rng, room.weekTicks],
    seated(room)
      .concat([...room.seats.values()].filter((seat) => seat.watcher))
      .map((seat) => [
        seat.id,
        seat.name,
        seat.slot,
        seat.avatarId,
        seat.connected,
        seat.watcher === true ? "watcher" : seat.bot,
        seat.generation ?? null,
        seat.away === true,
      ]),
    { ...room.settings },
    {
      week: room.week,
      phase: room.phase,
      phaseStart: room.phaseStart,
      phaseEnd: room.phaseEnd,
      turns: room.turns,
      level: room.level,
      order: room.order,
      turn: room.turn,
      economy: room.economy,
      players: room.players,
      goals: room.goals,
      roster: room.roster,
      headlines: room.headlines,
      ranking: room.ranking,
      winners: room.winners,
    },
  ];
}

// ---- small validators ----------------------------------------------------------------------------------------

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const int = (value: unknown, lo: number, hi: number): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= lo &&
  (value as number) <= hi;
const num = (value: unknown, lo: number, hi: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= lo &&
  value <= hi;
const bool = (value: unknown): value is boolean => typeof value === "boolean";
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length <= TEXT;
/** Exactly these keys, own and enumerable. */
const keys = (
  value: Record<string, unknown>,
  names: readonly string[],
): boolean =>
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
function list<T>(
  raw: unknown,
  most: number,
  each: (value: unknown) => value is T,
  exact = false,
): T[] | undefined {
  if (
    !Array.isArray(raw) ||
    raw.length > most ||
    (exact && raw.length !== most)
  )
    return;
  return raw.every(each) ? [...(raw as T[])] : undefined;
}

function decodeSeat(raw: unknown): SeatRecord | undefined {
  if (!Array.isArray(raw) || raw.length !== 8) return;
  const [id, name, slot, avatarId, connected, role, generation, away] = raw;
  const watcher = role === "watcher";
  if (
    !playerKey(id) ||
    !validName(name) ||
    !(watcher ? slot === -1 : uint32(slot) && slot < CAPACITY) ||
    !(watcher ? avatarId === "" : isAvatar(avatarId)) ||
    !bool(connected) ||
    (!watcher && !bool(role)) ||
    (role === true ? generation !== null : !uint32(generation)) ||
    !bool(away)
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
    ...(away ? { away } : {}),
  };
}

const COMPANY_KEYS = [
  "revenue",
  "profit",
  "health",
  "earnings",
  "retained",
  "spend",
  "output",
  "wages",
] as const;
function decodeCompany(raw: unknown): CompanyState | undefined {
  if (!plain(raw) || !keys(raw, COMPANY_KEYS)) return;
  const out: Record<string, number> = {};
  for (const name of COMPANY_KEYS) {
    const value = raw[name];
    if (
      !num(
        value,
        name === "health" ? -10 : -MONEY,
        name === "health" ? 10 : MONEY,
      )
    )
      return;
    out[name] = value;
  }
  return out as unknown as CompanyState;
}

const ECONOMY_KEYS = [
  "cycle",
  "growth",
  "inflation",
  "policyRate",
  "unemployment",
  "sentiment",
  "demand",
  "wageIndex",
  "level",
  "prices",
  "spend",
  "companies",
  "price",
  "impact",
  "indexBase",
  "history",
  "weeks",
] as const;
export function decodeEconomy(raw: unknown): Economy | undefined {
  if (!plain(raw) || !keys(raw, ECONOMY_KEYS)) return;
  const positive = (value: unknown): value is number => num(value, 0, MONEY);
  const prices = list(
      raw.prices,
      CATEGORIES.length,
      (value): value is number => num(value, 0.01, 100),
      true,
    ),
    spend = list(raw.spend, CATEGORIES.length, positive, true),
    price = list(raw.price, ASSET_COUNT, positive, true),
    impact = list(
      raw.impact,
      ASSET_COUNT,
      (value): value is number => num(value, IMPACT_MIN, IMPACT_MAX),
      true,
    ),
    history = list(raw.history, HISTORY, positive);
  if (
    !Array.isArray(raw.companies) ||
    raw.companies.length !== COMPANIES.length
  )
    return;
  const companies = raw.companies.map(decodeCompany);
  if (
    !prices ||
    !spend ||
    !price ||
    !impact ||
    !history ||
    !companies.every((company) => company !== undefined) ||
    !int(raw.cycle, 0, 3) ||
    !num(raw.growth, -10, 10) ||
    !num(raw.inflation, -10, 10) ||
    !num(raw.policyRate, 0, 100) ||
    !num(raw.unemployment, 0, 100) ||
    !num(raw.sentiment, -1, 1) ||
    !num(raw.demand, 0, 10) ||
    !num(raw.wageIndex, 0.01, 1000) ||
    !num(raw.level, 0.01, 1000) ||
    !num(raw.indexBase, 1, MONEY) ||
    !int(raw.weeks, 0, MAX_WEEKS + 2)
  )
    return;
  return {
    cycle: raw.cycle as Economy["cycle"],
    growth: raw.growth,
    inflation: raw.inflation,
    policyRate: raw.policyRate,
    unemployment: raw.unemployment,
    sentiment: raw.sentiment,
    demand: raw.demand,
    wageIndex: raw.wageIndex,
    level: raw.level,
    prices,
    spend,
    companies: companies as CompanyState[],
    price,
    impact,
    indexBase: raw.indexBase,
    history,
    weeks: raw.weeks,
  };
}

const goals = (raw: unknown): Goals | undefined => {
  const values = list(raw, 4, validGoal, true);
  return values ? (values as Goals) : undefined;
};

const PLAYER_KEYS = [
  "pos",
  "dest",
  "inside",
  "time",
  "done",
  "ready",
  "penalty",
  "cash",
  "bank",
  "holdings",
  "happiness",
  "relax",
  "home",
  "rent",
  "rentWeeks",
  "rentOwed",
  "rentExt",
  "rentBooked",
  "leaseEnd",
  "groceries",
  "meal",
  "clothes",
  "durables",
  "job",
  "wage",
  "raises",
  "dep",
  "exp",
  "maxExp",
  "minDep",
  "eduCredit",
  "expCredit",
  "failed",
  "courses",
  "flags",
  "goals",
  "finished",
  "notices",
  "msg",
  "msgN",
  "msgBad",
  "botAt",
  "botActs",
  "weekShifts",
  "weekClasses",
  "shifts",
  "bestWorth",
] as const;

function decodeDurables(
  raw: unknown,
): Partial<Record<DurableId, Owned>> | undefined {
  if (!plain(raw)) return;
  const out: Partial<Record<DurableId, Owned>> = {};
  for (const [id, owned] of Object.entries(raw)) {
    if (
      !(DURABLES as readonly string[]).includes(id) ||
      !plain(owned) ||
      !keys(owned, ["n", "paid", "cheap"])
    )
      return;
    if (!int(owned.n, 0, 1) || !int(owned.paid, 0, MONEY) || !bool(owned.cheap))
      return;
    out[id as DurableId] = { n: owned.n, paid: owned.paid, cheap: owned.cheap };
  }
  return out;
}

export function decodePlayer(
  raw: unknown,
  tick: number,
): PlayerState | undefined {
  if (!plain(raw) || !keys(raw, PLAYER_KEYS)) return;
  const r = raw;
  const holdings = list(
      r.holdings,
      ASSET_COUNT,
      (value): value is number => int(value, 0, MONEY),
      true,
    ),
    clothes = list(
      r.clothes,
      3,
      (value): value is number => int(value, 0, 10_000),
      true,
    ),
    failed = list(r.failed, JOBS.length, (value): value is number =>
      int(value, 0, JOBS.length - 1),
    ),
    courses = list(
      r.courses,
      COURSES.length,
      (value): value is number => int(value, -1, LESSONS),
      true,
    ),
    notices = list(r.notices, 12, text),
    durables = decodeDurables(r.durables),
    picked = goals(r.goals);
  const place = (value: unknown) => int(value, -1, PLACES.length - 1);
  if (
    !holdings ||
    !clothes ||
    !failed ||
    !courses ||
    !notices ||
    !durables ||
    !picked ||
    !int(r.pos, 0, STEPS - 1) ||
    !place(r.dest) ||
    !place(r.inside) ||
    (r.dest !== -1 && r.inside !== -1) ||
    !int(r.time, 0, WEEK_UNITS) ||
    !bool(r.done) ||
    !bool(r.ready) ||
    !int(r.penalty, 0, 1000) ||
    !int(r.cash, 0, MONEY) ||
    !int(r.bank, 0, MONEY) ||
    !int(r.happiness, 0, 100) ||
    !int(r.relax, 0, 50) ||
    !int(r.home, 0, 1) ||
    !int(r.rent, 0, MONEY) ||
    !int(r.rentWeeks, 0, 100) ||
    !int(r.rentOwed, 0, MONEY) ||
    !int(r.rentExt, -1, 1000) ||
    !bool(r.rentBooked) ||
    !int(r.leaseEnd, 0, MAX_WEEKS + 20) ||
    !int(r.groceries, 0, 10_000) ||
    !int(r.meal, 0, 1) ||
    !int(r.job, -1, JOBS.length - 1) ||
    !num(r.wage, 0, 1e6) ||
    (r.job === -1 && r.wage !== 0) ||
    !int(r.raises, 0, 1000) ||
    !int(r.dep, 0, 10_000) ||
    !int(r.exp, 0, 10_000) ||
    !int(r.maxExp, 0, 10_000) ||
    !int(r.minDep, 0, 100) ||
    !int(r.eduCredit, 0, 1000) ||
    !int(r.expCredit, 0, 1000) ||
    !int(r.flags, 0, FLAG_MASK) ||
    !int(r.finished, 0, MAX_WEEKS + 2) ||
    !text(r.msg) ||
    !int(r.msgN, 0, 0xffffffff) ||
    !bool(r.msgBad) ||
    !int(r.botAt, 0, tick + 10_000) ||
    !int(r.botActs, 0, 10_000) ||
    !int(r.weekShifts, 0, 100) ||
    !int(r.weekClasses, 0, 100) ||
    !int(r.shifts, 0, 1e7) ||
    !num(r.bestWorth, -MONEY, MONEY)
  )
    return;
  return {
    pos: r.pos,
    dest: r.dest,
    inside: r.inside,
    time: r.time,
    done: r.done,
    ready: r.ready,
    penalty: r.penalty,
    cash: r.cash,
    bank: r.bank,
    holdings,
    happiness: r.happiness,
    relax: r.relax,
    home: r.home,
    rent: r.rent,
    rentWeeks: r.rentWeeks,
    rentOwed: r.rentOwed,
    rentExt: r.rentExt,
    rentBooked: r.rentBooked,
    leaseEnd: r.leaseEnd,
    groceries: r.groceries,
    meal: r.meal,
    clothes,
    durables,
    job: r.job,
    wage: r.wage,
    raises: r.raises,
    dep: r.dep,
    exp: r.exp,
    maxExp: r.maxExp,
    minDep: r.minDep,
    eduCredit: r.eduCredit,
    expCredit: r.expCredit,
    failed,
    courses,
    flags: r.flags,
    goals: picked,
    finished: r.finished,
    notices,
    msg: r.msg,
    msgN: r.msgN,
    msgBad: r.msgBad,
    botAt: r.botAt,
    botActs: r.botActs,
    weekShifts: r.weekShifts,
    weekClasses: r.weekClasses,
    shifts: r.shifts,
    bestWorth: r.bestWorth,
  };
}

const GAME_KEYS = [
  "week",
  "phase",
  "phaseStart",
  "phaseEnd",
  "turns",
  "level",
  "order",
  "turn",
  "economy",
  "players",
  "goals",
  "roster",
  "headlines",
  "ranking",
  "winners",
] as const;

export function decodeRoom(
  fields: readonly unknown[],
  tick: number,
): FuseLaneRoom | undefined {
  if (fields.length !== 4 || !uint32(tick)) return;
  const [header, rawSeats, rawSettings, game] = fields;
  if (
    !Array.isArray(header) ||
    header.length !== 4 ||
    !Array.isArray(rawSeats) ||
    rawSeats.length > CAPACITY + MAX_WATCHERS ||
    !plain(game) ||
    !keys(game, GAME_KEYS)
  )
    return;
  const [matchId, stage, rng, weekTicks] = header;
  const settings = parseSettings(rawSettings);
  if (
    !validMatchId(matchId) ||
    !STAGES.includes(stage as Stage) ||
    stage === "between" ||
    !uint32(rng) ||
    !(WEEK_SECONDS as readonly number[]).some(
      (seconds) => seconds * TICKS_PER_SECOND === weekTicks,
    ) ||
    !settings
  )
    return;

  const seats = new Map<string, SeatRecord>(),
    slots = new Set<number>();
  let watchers = 0;
  for (const raw of rawSeats) {
    const seat = decodeSeat(raw);
    if (!seat || seats.has(seat.id)) return;
    if (seat.watcher) watchers++;
    else if (slots.has(seat.slot)) return;
    else slots.add(seat.slot);
    seats.set(seat.id, seat);
  }
  if (watchers > MAX_WATCHERS) return;

  const { week, phase, phaseStart, phaseEnd } = game;
  const running = stage === "running";
  if (
    !int(week, 0, MAX_WEEKS + 2) ||
    (stage === "lobby") !== (week === 0) ||
    (phase !== WEEK && phase !== BRIEFING && phase !== HANDOFF) ||
    !int(phaseStart, 0, tick) ||
    !int(phaseEnd, 0, tick + Math.max(weekTicks as number, BRIEFING_TICKS)) ||
    (running && phaseEnd < phaseStart)
  )
    return;
  const economy = decodeEconomy(game.economy);
  if (!economy) return;

  if (!plain(game.roster) || Object.keys(game.roster).length > MAX_PARTICIPANTS)
    return;
  const roster: Record<string, RosterEntry> = {};
  for (const [id, entry] of Object.entries(game.roster)) {
    if (!playerKey(id) || !plain(entry) || !keys(entry, ["name", "slot"]))
      return;
    if (!validName(entry.name) || !int(entry.slot, 0, CAPACITY - 1)) return;
    roster[id] = { name: entry.name, slot: entry.slot };
  }
  if (
    !plain(game.players) ||
    Object.keys(game.players).length > MAX_PARTICIPANTS
  )
    return;
  const players: Record<string, PlayerState> = {};
  for (const [id, raw] of Object.entries(game.players)) {
    if (!playerKey(id) || !Object.hasOwn(roster, id)) return;
    const player = decodePlayer(raw, tick);
    if (!player) return;
    players[id] = player;
  }
  // One player per position.
  const held = Object.values(players)
    .map((player) => player.job)
    .filter((job) => job >= 0);
  if (new Set(held).size !== held.length) return;
  if (
    running &&
    [...seats.values()].some((seat) => !seat.watcher && !players[seat.id])
  )
    return;

  if (!plain(game.goals) || Object.keys(game.goals).length > MAX_PARTICIPANTS)
    return;
  const picked: Record<string, Goals> = {};
  for (const [id, raw] of Object.entries(game.goals)) {
    const value = goals(raw);
    if (!playerKey(id) || !value) return;
    picked[id] = value;
  }
  const ids = (raw: unknown) =>
    list(
      raw,
      MAX_PARTICIPANTS,
      (value): value is string =>
        typeof value === "string" && Object.hasOwn(players, value),
    );
  const headlines = list(game.headlines, 8, text),
    ranking = ids(game.ranking),
    winners = ids(game.winners);
  if (
    !headlines ||
    !ranking ||
    !winners ||
    (stage === "over") !== ranking.length > 0 ||
    (stage === "over" && winners.length === 0) ||
    new Set(ranking).size !== ranking.length ||
    !winners.every((id) => ranking.includes(id))
  )
    return;
  // A hot-seat week: each player once, and a turn inside it (or -1); only a turns match has one, and only it hands off.
  const order = ids(game.order),
    { turn, turns, level } = game;
  if (
    !order ||
    typeof turns !== "boolean" ||
    !int(level, 0, 2) ||
    new Set(order).size !== order.length ||
    !(Number.isSafeInteger(turn) && (turn as number) >= -1) ||
    (turn as number) >= Math.max(order.length, 1) ||
    (!turns && (order.length > 0 || turn !== -1)) ||
    (phase === HANDOFF && (!turns || turn === -1)) ||
    // A running hot-seat week always has someone's turn: -1 is only between weeks (the briefing) or before the start.
    (running && turns && phase === WEEK && turn === -1)
  )
    return;

  return {
    tick,
    matchId,
    stage: stage as Stage,
    seats,
    settings,
    weekTicks: weekTicks as number,
    rng,
    week,
    phase,
    phaseStart,
    phaseEnd,
    turns,
    level: level as number,
    order,
    turn: turn as number,
    economy,
    players,
    goals: picked,
    roster,
    headlines,
    ranking,
    winners,
  };
}

/** Canonical JSON (sorted keys, seats in slot then id order), then FNV-1a in two lanes: 16 hex characters. */
export function hashRoom(room: FuseLaneRoom): string {
  const seats = [...room.seats.values()].sort(
    (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const text = JSON.stringify({ ...room, seats }, (_key, value: unknown) =>
    plain(value)
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
