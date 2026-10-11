// A round as checkpoint fields: arrays of numbers, booleans and strings that MessagePack carries exactly (−0 arrives as
// 0, as the hash already counts it), and a decoder that takes them as hostile. See docs/engine.md, "Online".

import { BOT_DIFFICULTIES, type BotMemory, type BotSeat } from "./bot.js";
import { crateYAt, gatePositionAt } from "./geometry.js";
import { decodeGrid, encodeGrid, type Grid } from "./grid.js";
import { DOWN, LEFT, RIGHT, UP, isInput } from "./input.js";
import { buildTempleGrid } from "./temple-map.js";
import { CARDS, MAX_PLAYERS, MIN_PLAYERS, type Tuning } from "./tuning.js";
import { resolveTuning, secondsToTicks } from "./tuning.js";
import type { Castle, Crate, Gate, Ghost, Rocket } from "./types.js";
import type { RoundConfig, RoundResult, RoundState } from "./types.js";

export const ROUND_FORMAT = 1;
// prettier-ignore
export const ROUND_REASONS: readonly RoundResult["reason"][] = ["last-standing", "wipeout", "timeout"];
const PHASES = ["playing", "sudden-death", "over"] as const;
const TAU = 2 * Math.PI;
/** Any coordinate (px) or velocity (px/s): far past the world, far short of where arithmetic on it overflows. */
const SPAN = 1e6;
const BIG = 0x7fff_ffff;
const STEER = UP | DOWN | LEFT | RIGHT;
/** Gates one rocket lineage may have passed: it lives `rocketMaxAge` (12 s), in which at most ~21 gates live. */
const MAX_LINEAGE = 64;
/** Ghost bombs a ghost can have in the air: one per reload over a bomb's life, and one to spare. */
const ghostBombs = (t: Tuning) =>
  2 +
  Math.floor(secondsToTicks(t.rocketMaxAge) / secondsToTicks(t.ghostReload));
/** Terrain runs per array: `unpackMessage` refuses longer arrays. */
const RUN_CHUNK = 4096;

/** Reads a record's fields in order; a field of the wrong type or out of its range marks the record bad. */
class Fields {
  private ok = true;
  private at = 0;
  private constructor(private readonly items: readonly unknown[]) {}
  static of(raw: unknown, length: number): Fields | undefined {
    return Array.isArray(raw) && raw.length === length
      ? new Fields(raw)
      : undefined;
  }
  fail<T>(fallback: T): T {
    this.ok = false;
    return fallback;
  }
  raw(): unknown {
    return this.items[this.at++];
  }
  /** A number in [lo, hi], so finite; −0 reads as 0. */
  num(lo = -SPAN, hi = SPAN): number {
    const v = this.raw();
    return typeof v === "number" && v >= lo && v <= hi ? v + 0 : this.fail(0);
  }
  int(lo: number, hi: number): number {
    const v = this.raw();
    return Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
      ? (v as number) + 0
      : this.fail(0);
  }
  intOrNull(lo: number, hi: number): number | null {
    if (this.items[this.at] !== null) return this.int(lo, hi);
    this.at++;
    return null;
  }
  angle(): number {
    const v = this.num(0, TAU);
    return v < TAU ? v : this.fail(0);
  }
  bool(): boolean {
    const v = this.raw();
    return typeof v === "boolean" ? v : this.fail(false);
  }
  pick<T>(options: readonly T[]): T {
    const v = this.raw() as T;
    return options.includes(v) ? v : this.fail(options[0]!);
  }
  /** An array of at most `max` items, its length checked before anything reads them. */
  list(max: number): unknown[] {
    const v = this.raw();
    return Array.isArray(v) && v.length <= max ? v : this.fail([]);
  }
  /** Every field read, and every one good. */
  get done(): boolean {
    return this.ok && this.at === this.items.length;
  }
}

const every = <T>(items: readonly (T | undefined)[]): T[] | undefined =>
  items.includes(undefined) ? undefined : (items as T[]);

/**
 * `state` as plain arrays. A round of the default tuning only (what online rooms play): `decodeRound` re-derives the
 * tuning, `fuseTicks`, `maxTicks`, `maxHp` and gate and crate positions rather than reading them; `events` are left
 * out, as the hash leaves them out.
 */
export function encodeRound(state: RoundState): unknown[] {
  const { config, terrain } = state;
  if (config.tuning !== undefined)
    throw new RangeError("a checkpoint carries rounds of the default tuning");
  const runs = encodeGrid(terrain),
    chunks: number[][] = [];
  for (let i = 0; i < runs.length; i += RUN_CHUNK)
    chunks.push(runs.slice(i, i + RUN_CHUNK));
  const result = state.result;
  // prettier-ignore
  return [
    ROUND_FORMAT, config.seed, config.playerCount, config.bots?.map((b) => [b.id, b.difficulty]) ?? null,
    state.tick, state.phase, result && [result.winner, result.reason, result.tick], chunks,
    state.castles.map(({ stats: s, ...c }) => [c.x, c.y, c.vx, c.vy, c.thrust, c.hp, c.alive, c.angle, c.reloadTicks,
      c.reloadTotalTicks, c.reloadTime, c.units, c.shieldHp, c.megaReady, c.volleyLeft, c.volleyAngle, c.volleyMega,
      c.volleyCooldown, c.lastHitBy, s.volleys, s.rocketsFired, s.damageDealt, s.kills, s.gateSplits, s.crates,
      s.ghostBombs, s.ghostDamage]),
    state.rockets.map((r) => [r.id, r.owner, r.x, r.y, r.vx, r.vy, r.power, r.mega, r.bomb, r.ghost, [...r.gates],
      r.age]),
    state.gates.map((g) => [g.id, g.multiplier, g.spawnTick, g.expireTick, g.x0, g.vx, g.minX, g.maxX, g.baseY,
      g.bobPeriodTicks, g.bobPhase]),
    state.crates.map((k) => [k.id, k.card, k.x, k.baseY, k.bobPhase, k.spawnTick]),
    state.ghosts.map((g) => [g.owner, g.x, g.y, g.vx, g.vy, g.thrust, g.reloadTicks, g.reloadTotalTicks, g.spawnTick]),
    [...state.lastHeld],
    state.bots.map((m) => [m.rng, m.ghost, m.target, m.spotX, m.spotY, m.wayX, m.wayY, m.planTick, m.pressTick,
      m.dodgeBits, m.dodgeTick]),
    state.nextCrateTick, state.nextBombTick, state.nextId, state.rng,
  ];
}

let temple: Grid | undefined;
/** The terrain: the temple's size, no rock it lacked (craters only remove rock), exactly its indestructible rock. */
function readTerrain(raw: unknown): Grid | undefined {
  const map = (temple ??= buildTempleGrid());
  if (
    !Array.isArray(raw) ||
    raw.length > (map.cols * map.rows) / RUN_CHUNK + 1 ||
    !raw.every((run) => Array.isArray(run) && run.length <= RUN_CHUNK)
  )
    return;
  const grid = decodeGrid((raw as unknown[][]).flat(), map);
  if (
    grid &&
    grid.hard.every((w, i) => w === map.hard[i]) &&
    grid.solid.every((w, i) => (w & ~map.solid[i]!) === 0)
  )
    return grid;
}

// prettier-ignore
function readCastle(raw: unknown, id: number, n: number, t: Tuning, maxHp: number): Castle | undefined {
  const f = Fields.of(raw, 27);
  if (!f) return;
  const c: Castle = { id, x: f.num(), y: f.num(), vx: f.num(), vy: f.num(), thrust: f.int(0, STEER),
    hp: f.num(0, maxHp), maxHp, alive: f.bool(), angle: f.angle(), reloadTicks: f.int(0, BIG),
    reloadTotalTicks: f.int(0, BIG), reloadTime: f.num(t.minReloadTime, t.reloadTime),
    units: f.int(t.startUnits, t.maxUnits), shieldHp: f.num(0, t.shieldMax), megaReady: f.bool(),
    volleyLeft: f.int(0, t.maxUnits), volleyAngle: f.angle(), volleyMega: f.bool(),
    volleyCooldown: f.int(0, Math.max(2, t.volleyIntervalTicks)), lastHitBy: f.int(-1, n - 1),
    stats: { volleys: f.int(0, BIG), rocketsFired: f.int(0, BIG), damageDealt: f.num(0, Number.MAX_VALUE),
      kills: f.int(0, BIG), gateSplits: f.int(0, BIG), crates: f.int(0, BIG), ghostBombs: f.int(0, BIG),
      ghostDamage: f.num(0, Number.MAX_VALUE) } };
  // A castle is alive while it has HP; a wreck holds no shield, volley or motion.
  const wreck = c.shieldHp === 0 && c.volleyLeft === 0 && c.vx === 0 && c.vy === 0 && c.thrust === 0;
  if (f.done && c.alive === c.hp > 0 && (c.alive || wreck) && c.reloadTicks <= c.reloadTotalTicks) return c;
}

// prettier-ignore
function readRocket(raw: unknown, n: number, nextId: number, maxAge: number): Rocket | undefined {
  const f = Fields.of(raw, 12);
  if (!f) return;
  const r: Rocket = { id: f.int(1, nextId - 1), owner: f.int(-1, n - 1), x: f.num(), y: f.num(), vx: f.num(),
    vy: f.num(), power: f.num(1, 1e300), mega: f.bool(), bomb: f.bool(), ghost: f.bool(),
    gates: [...f.list(MAX_LINEAGE)] as number[], age: f.int(0, maxAge) };
  // A ghost bomb is its owner's, plain and never split; a sudden-death bomb nobody's and never mega.
  const kind = r.ghost ? r.owner >= 0 && !r.bomb && !r.mega && r.gates.length === 0
    : r.bomb ? r.owner === -1 && !r.mega : r.owner >= 0;
  const lineage = r.gates.every((id) => Number.isInteger(id) && id >= 1 && id < nextId) &&
    new Set(r.gates).size === r.gates.length;
  if (f.done && kind && lineage) return r;
}

// prettier-ignore
function readGate(raw: unknown, tick: number, t: Tuning, nextId: number): Gate | undefined {
  const f = Fields.of(raw, 11);
  if (!f) return;
  const g: Gate = { id: f.int(1, nextId - 1), multiplier: f.pick(t.gateMultipliers.map((m) => m.multiplier)),
    x: 0, y: 0, width: t.gateWidth, height: t.gateHeight, spawnTick: f.int(0, tick), expireTick: f.int(tick, BIG),
    x0: f.num(), vx: f.num(), minX: f.num(), maxX: f.num(), baseY: f.num(), bobAmp: t.gateBobAmp,
    bobPeriodTicks: f.int(1, BIG), bobPhase: f.angle() };
  if (!f.done || g.expireTick <= g.spawnTick) return;
  // Where the latest step put it (`updateGates`, or `spawnGate` in the step or at creation).
  return Object.assign(g, gatePositionAt(g, Math.max(0, tick - 1)));
}

// prettier-ignore
function readCrate(raw: unknown, tick: number, t: Tuning, nextId: number): Crate | undefined {
  const f = Fields.of(raw, 6);
  if (!f) return;
  const k: Crate = { id: f.int(1, nextId - 1), card: f.pick(CARDS), x: f.num(), y: 0, radius: t.crateRadius,
    baseY: f.num(), bobPhase: f.angle(), spawnTick: f.int(0, tick) };
  k.y = crateYAt(k.baseY, k.bobPhase, k.spawnTick, Math.max(0, tick - 1));
  if (f.done) return k;
}

// prettier-ignore
function readGhost(raw: unknown, n: number, tick: number): Ghost | undefined {
  const f = Fields.of(raw, 9);
  if (!f) return;
  const g: Ghost = { owner: f.int(0, n - 1), x: f.num(), y: f.num(), vx: f.num(), vy: f.num(),
    thrust: f.int(0, STEER), reloadTicks: f.int(0, BIG), reloadTotalTicks: f.int(0, BIG), spawnTick: f.int(1, tick) };
  if (f.done && g.reloadTicks <= g.reloadTotalTicks) return g;
}

// prettier-ignore
function readMemory(raw: unknown, seat: BotSeat, n: number): BotMemory | undefined {
  const f = Fields.of(raw, 11);
  if (!f) return;
  const m: BotMemory = { id: seat.id, difficulty: seat.difficulty, rng: f.int(-0x8000_0000, 0xffff_ffff),
    ghost: f.bool(), target: f.int(-1, n - 1), spotX: f.num(), spotY: f.num(), wayX: f.num(), wayY: f.num(),
    planTick: f.int(0, BIG), pressTick: f.int(-1, BIG), dodgeBits: f.int(0, STEER), dodgeTick: f.int(0, BIG) };
  if (f.done) return m;
}

/** The bot seats of a config: distinct seats below `n`, in seat order, each with a difficulty. */
function readSeats(raw: unknown, n: number): BotSeat[] | undefined {
  if (!Array.isArray(raw) || raw.length > n) return;
  const seats: BotSeat[] = [];
  for (const item of raw) {
    const f = Fields.of(item, 2);
    if (!f) return;
    const seat = { id: f.int(0, n - 1), difficulty: f.pick(BOT_DIFFICULTIES) };
    if (!f.done || seat.id <= (seats.at(-1)?.id ?? -1)) return;
    seats.push(seat);
  }
  return seats;
}

/**
 * The round `encodeRound` wrote, or undefined: every field is checked for its type and range, every count against its
 * cap before an item is read, every reference (owners, ids, bot seats) against what exists, and the parts against each
 * other. Never a partial round, and never a throw.
 */
export function decodeRound(raw: unknown): RoundState | undefined {
  const f = Fields.of(raw, 19);
  if (!f || f.raw() !== ROUND_FORMAT) return;
  const seed = f.num(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    n = f.int(MIN_PLAYERS, MAX_PLAYERS),
    rawSeats = f.raw(),
    seats = rawSeats === null ? undefined : readSeats(rawSeats, n),
    t = resolveTuning(),
    maxAge = secondsToTicks(t.rocketMaxAge);
  // prettier-ignore
  const [tick, phase, rawResult, terrain, rawCastles, rawRockets, rawGates, rawCrates, rawGhosts, lastHeld, rawMemory,
    nextCrateTick, nextBombTick, nextId, rng] = [f.int(0, BIG), f.pick(PHASES), f.raw(), readTerrain(f.raw()),
    f.list(n), f.list(t.maxRockets + MAX_PLAYERS * ghostBombs(t)), f.list(t.gateCounts[n] ?? 0),
    f.list(t.crateCounts[n] ?? 0), f.list(n), f.list(n), f.list(n), f.int(0, BIG), f.int(0, BIG),
    f.int(1, Number.MAX_SAFE_INTEGER), f.int(-0x8000_0000, 0xffff_ffff)] as const;
  if (
    !f.done ||
    (rawSeats !== null && !seats) ||
    !terrain ||
    rawCastles.length !== n ||
    lastHeld.length !== n ||
    !lastHeld.every(isInput) ||
    rawMemory.length !== (seats?.length ?? 0)
  )
    return;
  const maxHp = t.castleHp[n] ?? 200;
  // prettier-ignore
  const castles = every(rawCastles.map((c, id) => readCastle(c, id, n, t, maxHp)));
  const rockets = every(
    rawRockets.map((r) => readRocket(r, n, nextId, maxAge)),
  );
  const gates = every(rawGates.map((g) => readGate(g, tick, t, nextId)));
  const crates = every(rawCrates.map((k) => readCrate(k, tick, t, nextId)));
  const ghosts = every(rawGhosts.map((g) => readGhost(g, n, tick)));
  const bots = every(rawMemory.map((m, i) => readMemory(m, seats![i]!, n)));
  const result = readResult(rawResult, n, tick);
  if (!castles || !rockets || !gates || !crates || !ghosts || !bots) return;
  if (result === undefined) return;
  // Ids are handed out once, rockets, gates and crates alike.
  const ids = [...rockets, ...gates, ...crates].map((x) => x.id);
  // A ghost flies for a fallen castle, one each; ghost bombs come from ghosts only, and only they pass the rocket cap.
  const flying = new Set(ghosts.map((g) => g.owner));
  const bombs = rockets.filter((r) => r.ghost);
  const fuseTicks = secondsToTicks(t.fuseTime);
  if (
    new Set(ids).size !== ids.length ||
    flying.size !== ghosts.length ||
    ghosts.some((g) => castles[g.owner]!.alive) ||
    bombs.some((r) => !flying.has(r.owner)) ||
    bombs.length > ghosts.length * ghostBombs(t) ||
    rockets.length - bombs.length > t.maxRockets ||
    (phase === "over") !== (result !== null) ||
    (phase === "playing" && tick > fuseTicks) ||
    (phase === "sudden-death" && tick <= fuseTicks) ||
    (result && !decided(result, castles))
  )
    return;
  const config: RoundConfig = { seed, playerCount: n };
  if (seats) config.bots = seats;
  // prettier-ignore
  return { config, tuning: t, tick, phase, result, fuseTicks, maxTicks: secondsToTicks(t.maxRoundTime), terrain,
    castles, rockets, gates, crates, ghosts, lastHeld: lastHeld.map((bits) => (bits as number) + 0), bots, events: [],
    nextCrateTick, nextBombTick, nextId, rng };
}

/** `[winner or null, reason, tick]` before the round's `tick`; null when the round is undecided. */
// prettier-ignore
function readResult(raw: unknown, n: number, tick: number): RoundResult | null | undefined {
  const f = Fields.of(raw, 3);
  if (raw === null || !f) return raw === null ? null : undefined;
  const result = { winner: f.intOrNull(0, n - 1), reason: f.pick(ROUND_REASONS), tick: f.int(0, tick - 1) };
  if (f.done) return result;
}

/** A finished round's result agrees with who is left: the one survivor, nobody, or on time a survivor or a draw. */
function decided(result: RoundResult, castles: readonly Castle[]): boolean {
  const alive = castles.filter((c) => c.alive).map((c) => c.id);
  if (result.reason === "last-standing")
    return alive.length === 1 && result.winner === alive[0];
  if (result.reason === "wipeout")
    return alive.length === 0 && result.winner === null;
  return (
    alive.length > 1 &&
    (result.winner === null || alive.includes(result.winner))
  );
}
