// A round as checkpoint fields: arrays of numbers, booleans and strings that MessagePack carries exactly (−0 arrives as
// 0, as the hash already counts it), and a decoder that takes them as hostile. See docs/engine.md, "Online".

import { BOT_DIFFICULTIES, type BotMemory, type BotSeat } from "./bot.js";
import { GHOST_FLIGHT, GUNSHIP_FLIGHT } from "./flight.js";
import { crateYAt, gatePositionAt, isOffscreen } from "./geometry.js";
import { decodeGrid, encodeGrid, type Grid } from "./grid.js";
import { DOWN, LEFT, RIGHT, UP, isInput } from "./input.js";
import { buildTempleGrid } from "./temple-map.js";
import { CARDS, MAX_PLAYERS, MIN_PLAYERS, type Tuning } from "./tuning.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "./tuning.js";
import { resolveTuning, secondsToTicks } from "./tuning.js";
import type { Castle, Crate, Gate, Ghost, Rocket } from "./types.js";
import type { RoundConfig, RoundResult, RoundState } from "./types.js";

export const ROUND_FORMAT = 1;
// prettier-ignore
export const ROUND_REASONS: readonly RoundResult["reason"][] = ["last-standing", "wipeout", "timeout"];
const PHASES = ["playing", "sudden-death", "over"] as const;
const TAU = 2 * Math.PI;
const STEER = UP | DOWN | LEFT | RIGHT;
// Every range below is one the engine keeps itself in (a position inside the world, a speed under its cap, a count no
// round reaches), so that what a peer accepts it can fold and checkpoint again. Only a value put at the very edge of a
// range (a tally at 2^30, a lineage of 64 gates) can step out of it, and then the room after it is not checkpointed.
/** A tally, id or tick: far past what a round counts to, and 2^30 short of where a step could push it out of range. */
const BIG = 0x3fff_ffff;
/** Gates one rocket lineage may have passed: it lives `rocketMaxAge` (12 s), in which at most ~21 gates live. */
const MAX_LINEAGE = 64;
/** A damage tally: a gate multiplies a rocket's power by 10 at most, so even a lineage of 64 deals far less. */
const TALLY = 1e100;
/** Rounding room on the power a lineage can have made: repeated products and `**` can differ in the last bits. */
const POWER_SLACK = 1 + 1e-9;
/** Rockets leave the world sideways and below (`isOffscreen`), and above it they fall back, never nearly this far. */
const SKY = 1e5;
/** A rocket's speed (px/s): a launch is 900, a fall from the sky's top about 2,400. */
const ROCKET_SPEED = 1e4;
/** Ticks a bot may have scheduled its next plan, press or dodge ahead of the round (the longest is ~170). */
const BOT_AHEAD = 512;
/** Ghost bombs a ghost can have in the air: one per reload over a bomb's life, and one to spare. */
const ghostBombs = (t: Tuning) =>
  2 +
  Math.floor(secondsToTicks(t.rocketMaxAge) / secondsToTicks(t.ghostReload));
/** Terrain runs per array: `unpackMessage` refuses longer arrays. */
const RUN_CHUNK = 4096;

/** An array without holes: MessagePack makes none, but `decodeRound` can be handed a value from anywhere. */
const dense = (items: readonly unknown[]): boolean => {
  let seen = 0;
  items.forEach(() => seen++);
  return seen === items.length;
};

/** Reads a record's fields in order; a field of the wrong type or out of its range marks the record bad. */
class Fields {
  private ok = true;
  private at = 0;
  private constructor(private readonly items: readonly unknown[]) {}
  static of(raw: unknown, length: number): Fields | undefined {
    return Array.isArray(raw) && raw.length === length && dense(raw)
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
  num(lo: number, hi: number): number {
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
  /** A coordinate inside the world: `flyStep` and `settle` keep every body in it, and a gate or crate is placed in it. */
  x(): number {
    return this.num(0, WORLD_WIDTH);
  }
  y(): number {
    return this.num(0, WORLD_HEIGHT);
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
    return Array.isArray(v) && v.length <= max && dense(v) ? v : this.fail([]);
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
    !dense(raw) ||
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
  // Flight caps a gunship at `topSpeed` and a bounce or a shove never adds to it; twice is rounding room.
  const speed = 2 * GUNSHIP_FLIGHT.topSpeed;
  const reload = Math.max(secondsToTicks(t.reloadTime), secondsToTicks(t.initialReload));
  const c: Castle = { id, x: f.x(), y: f.y(), vx: f.num(-speed, speed), vy: f.num(-speed, speed),
    thrust: f.int(0, STEER), hp: f.num(0, maxHp), maxHp, alive: f.bool(), angle: f.angle(),
    reloadTicks: f.int(0, reload), reloadTotalTicks: f.int(0, reload), reloadTime: f.num(t.minReloadTime, t.reloadTime),
    units: f.int(t.startUnits, t.maxUnits), shieldHp: f.num(0, t.shieldMax), megaReady: f.bool(),
    volleyLeft: f.int(0, t.maxUnits), volleyAngle: f.angle(), volleyMega: f.bool(),
    volleyCooldown: f.int(0, Math.max(2, t.volleyIntervalTicks)), lastHitBy: f.int(-1, n - 1),
    stats: { volleys: f.int(0, BIG), rocketsFired: f.int(0, BIG), damageDealt: f.num(0, TALLY),
      kills: f.int(0, BIG), gateSplits: f.int(0, BIG), crates: f.int(0, BIG), ghostBombs: f.int(0, BIG),
      ghostDamage: f.num(0, TALLY) } };
  // A castle is alive while it has HP; a wreck holds no shield, volley or motion.
  const wreck = c.shieldHp === 0 && c.volleyLeft === 0 && c.vx === 0 && c.vy === 0 && c.thrust === 0;
  if (f.done && c.alive === c.hp > 0 && (c.alive || wreck) && c.reloadTicks <= c.reloadTotalTicks) return c;
}

// prettier-ignore
function readRocket(raw: unknown, n: number, nextId: number, t: Tuning): Rocket | undefined {
  const f = Fields.of(raw, 12);
  if (!f) return;
  const r: Rocket = { id: f.int(1, nextId - 1), owner: f.int(-1, n - 1), x: f.num(-SKY, SKY), y: f.num(-SKY, SKY),
    vx: f.num(-ROCKET_SPEED, ROCKET_SPEED), vy: f.num(-ROCKET_SPEED, ROCKET_SPEED), power: f.num(1, Number.MAX_VALUE),
    mega: f.bool(), bomb: f.bool(), ghost: f.bool(), gates: [...f.list(MAX_LINEAGE)] as number[],
    age: f.int(0, secondsToTicks(t.rocketMaxAge)) };
  // A ghost bomb is its owner's, plain and never split; a sudden-death bomb nobody's and never mega.
  const kind = r.ghost ? r.owner >= 0 && !r.bomb && !r.mega && r.gates.length === 0
    : r.bomb ? r.owner === -1 && !r.mega : r.owner >= 0;
  const lineage = r.gates.every((id) => Number.isInteger(id) && id >= 1 && id < nextId) &&
    new Set(r.gates).size === r.gates.length;
  // Each gate passed multiplies the power by at most the largest multiplier (by less when children take a share): more
  // than the lineage can have made, and a few gates carry it to Infinity.
  const top = Math.max(...t.gateMultipliers.map((m) => m.multiplier));
  const power = r.power <= top ** r.gates.length * POWER_SLACK;
  // In the world, as `isOffscreen` leaves every rocket at the end of a step.
  const inside = !isOffscreen(r.x, r.y, WORLD_WIDTH, WORLD_HEIGHT);
  if (f.done && kind && lineage && power && inside) return r;
}

// prettier-ignore
function readGate(raw: unknown, tick: number, t: Tuning, nextId: number): Gate | undefined {
  const f = Fields.of(raw, 11);
  if (!f) return;
  const life = secondsToTicks(t.gateLife[1]), drift = t.gateDriftSpeed[1];
  const g: Gate = { id: f.int(1, nextId - 1), multiplier: f.pick(t.gateMultipliers.map((m) => m.multiplier)),
    x: 0, y: 0, width: t.gateWidth, height: t.gateHeight, spawnTick: f.int(0, tick), expireTick: f.int(tick, tick + life),
    x0: f.x(), vx: f.num(-drift, drift), minX: f.x(), maxX: f.x(), baseY: f.y(), bobAmp: t.gateBobAmp,
    bobPeriodTicks: f.int(1, 2 * secondsToTicks(t.gateBobPeriod)), bobPhase: f.angle() };
  // It drifts between its ends from where it started, and lives no longer than a gate's longest life.
  if (!f.done || g.expireTick <= g.spawnTick || g.expireTick - g.spawnTick > life) return;
  if (!(g.minX <= g.x0 && g.x0 <= g.maxX)) return;
  // Where the latest step put it (`updateGates`, or `spawnGate` in the step or at creation).
  return Object.assign(g, gatePositionAt(g, Math.max(0, tick - 1)));
}

// prettier-ignore
function readCrate(raw: unknown, tick: number, t: Tuning, nextId: number): Crate | undefined {
  const f = Fields.of(raw, 6);
  if (!f) return;
  const k: Crate = { id: f.int(1, nextId - 1), card: f.pick(CARDS), x: f.x(), y: 0, radius: t.crateRadius,
    baseY: f.y(), bobPhase: f.angle(), spawnTick: f.int(0, tick) };
  k.y = crateYAt(k.baseY, k.bobPhase, k.spawnTick, Math.max(0, tick - 1));
  if (f.done) return k;
}

// prettier-ignore
function readGhost(raw: unknown, n: number, tick: number, t: Tuning): Ghost | undefined {
  const f = Fields.of(raw, 9);
  if (!f) return;
  const speed = 2 * GHOST_FLIGHT.topSpeed;
  const reload = Math.max(secondsToTicks(t.ghostReload), secondsToTicks(t.ghostFirstReload));
  const g: Ghost = { owner: f.int(0, n - 1), x: f.x(), y: f.y(), vx: f.num(-speed, speed), vy: f.num(-speed, speed),
    thrust: f.int(0, STEER), reloadTicks: f.int(0, reload), reloadTotalTicks: f.int(0, reload),
    spawnTick: f.int(1, tick) };
  if (f.done && g.reloadTicks <= g.reloadTotalTicks) return g;
}

// prettier-ignore
function readMemory(raw: unknown, seat: BotSeat, n: number, tick: number): BotMemory | undefined {
  const f = Fields.of(raw, 11);
  if (!f) return;
  const ahead = tick + BOT_AHEAD;
  const m: BotMemory = { id: seat.id, difficulty: seat.difficulty, rng: f.int(-0x8000_0000, 0xffff_ffff),
    ghost: f.bool(), target: f.int(-1, n - 1), spotX: f.x(), spotY: f.y(), wayX: f.x(), wayY: f.y(),
    planTick: f.int(0, ahead), pressTick: f.int(-1, ahead), dodgeBits: f.int(0, STEER), dodgeTick: f.int(0, ahead) };
  if (f.done) return m;
}

/** The bot seats of a config: distinct seats below `n`, in seat order, each with a difficulty. */
function readSeats(raw: unknown, n: number): BotSeat[] | undefined {
  if (!Array.isArray(raw) || raw.length > n || !dense(raw)) return;
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
    maxTicks = secondsToTicks(t.maxRoundTime);
  // prettier-ignore
  const [tick, phase, rawResult, terrain, rawCastles, rawRockets, rawGates, rawCrates, rawGhosts, lastHeld, rawMemory,
    nextCrateTick, nextBombTick, nextId, rng] = [f.int(0, BIG), f.pick(PHASES), f.raw(), readTerrain(f.raw()),
    f.list(n), f.list(t.maxRockets + MAX_PLAYERS * ghostBombs(t)), f.list(t.gateCounts[n] ?? 0),
    f.list(t.crateCounts[n] ?? 0), f.list(n), f.list(n), f.list(n), f.int(0, BIG), f.int(0, BIG), f.int(1, BIG),
    f.int(-0x8000_0000, 0xffff_ffff)] as const;
  if (
    !f.done ||
    (rawSeats !== null && !seats) ||
    !terrain ||
    rawCastles.length !== n ||
    lastHeld.length !== n ||
    !lastHeld.every(isInput) ||
    rawMemory.length !== (seats?.length ?? 0) ||
    // A round still undecided is under its time limit: the step that reaches it decides it.
    (phase !== "over" && tick >= maxTicks)
  )
    return;
  const maxHp = t.castleHp[n] ?? 200;
  const castles = every(
    rawCastles.map((c, id) => readCastle(c, id, n, t, maxHp)),
  );
  const rockets = every(rawRockets.map((r) => readRocket(r, n, nextId, t)));
  const gates = every(rawGates.map((g) => readGate(g, tick, t, nextId)));
  const crates = every(rawCrates.map((k) => readCrate(k, tick, t, nextId)));
  const ghosts = every(rawGhosts.map((g) => readGhost(g, n, tick, t)));
  const bots = every(
    rawMemory.map((m, i) => readMemory(m, seats![i]!, n, tick)),
  );
  const result = readResult(rawResult, n, maxTicks);
  if (!castles || !rockets || !gates || !crates || !ghosts || !bots) return;
  if (result === undefined) return;
  // Ids are handed out once, rockets, gates and crates alike.
  const ids = [...rockets, ...gates, ...crates].map((x) => x.id);
  // A ghost flies for each fallen castle, one each; ghost bombs come from ghosts only, and only they pass the rocket
  // cap. A bot flies its ghost only once its castle has fallen, and sudden-death bombs drop in sudden death only.
  const fallen = castles.filter((c) => !c.alive).length;
  const flying = new Set(ghosts.map((g) => g.owner));
  const bombs = rockets.filter((r) => r.ghost);
  const fuseTicks = secondsToTicks(t.fuseTime);
  if (
    new Set(ids).size !== ids.length ||
    flying.size !== ghosts.length ||
    ghosts.length !== (t.ghosts ? fallen : 0) ||
    ghosts.some((g) => castles[g.owner]!.alive) ||
    bots.some((m) => m.ghost && castles[m.id]!.alive) ||
    bombs.some((r) => !flying.has(r.owner)) ||
    bombs.length > ghosts.length * ghostBombs(t) ||
    rockets.length - bombs.length > t.maxRockets ||
    (phase === "playing" && rockets.some((r) => r.bomb)) ||
    (phase === "over") !== (result !== null) ||
    (phase === "playing" && tick > fuseTicks) ||
    (phase === "sudden-death" && tick <= fuseTicks) ||
    (result && !decided(result, tick, castles, maxTicks))
  )
    return;
  const config: RoundConfig = { seed, playerCount: n };
  if (seats) config.bots = seats;
  // prettier-ignore
  return { config, tuning: t, tick, phase, result, fuseTicks, maxTicks, terrain, castles, rockets, gates, crates, ghosts,
    lastHeld: lastHeld.map((bits) => (bits as number) + 0), bots, events: [], nextCrateTick, nextBombTick, nextId, rng };
}

/** `[winner or null, reason, tick]` of the step that decided the round, or null when it is undecided. */
// prettier-ignore
function readResult(raw: unknown, n: number, maxTicks: number): RoundResult | null | undefined {
  if (raw === null) return null;
  const f = Fields.of(raw, 3);
  if (!f) return;
  const result = { winner: f.intOrNull(0, n - 1), reason: f.pick(ROUND_REASONS), tick: f.int(0, maxTicks - 1) };
  if (f.done) return result;
}

/**
 * A finished round's result is what `checkRoundOver` made of who was left, at a step before the round's `tick`: the one
 * survivor, nobody, or at the time limit (the last step `maxTicks` allows) the survivor with the most HP, and a draw
 * when the best are level. Nothing changes HP once the round is decided.
 */
function decided(
  result: RoundResult,
  tick: number,
  castles: readonly Castle[],
  maxTicks: number,
): boolean {
  const alive = castles.filter((c) => c.alive);
  if (result.tick >= tick) return false;
  if (result.reason === "last-standing")
    return alive.length === 1 && result.winner === alive[0]!.id;
  if (result.reason === "wipeout")
    return alive.length === 0 && result.winner === null;
  const best = Math.max(...alive.map((c) => c.hp)),
    leaders = alive.filter((c) => c.hp === best);
  return (
    alive.length > 1 &&
    result.tick === maxTicks - 1 &&
    result.winner === (leaders.length === 1 ? leaders[0]!.id : null)
  );
}
