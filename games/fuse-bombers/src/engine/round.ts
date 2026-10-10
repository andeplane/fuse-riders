// The round simulation: `createRound` builds the initial state, `step` advances it one tick.

import {
  arcFor,
  castleCenter,
  crateYAt,
  DEG,
  gatePositionAt,
  ghostPositionAt,
  insideGate,
  integrate,
  isOffscreen,
  launchState,
} from "./geometry.js";
import { everyPairReachable } from "./reach.js";
import { hashSeed, int, random, range, weighted } from "./rng.js";
import {
  carveCrater,
  castlePositions,
  generateTerrain,
  highestGround,
  surfaceAt,
} from "./terrain.js";
import {
  ARENA_WIDTH,
  CARDS,
  DT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  resolveTuning,
  secondsToTicks,
  SUBSTEPS,
  type Card,
  type Tuning,
} from "./tuning.js";
import type {
  Castle,
  CastleView,
  Crate,
  Gate,
  Ghost,
  GhostView,
  RoundConfig,
  RoundResult,
  RoundState,
  RoundView,
  Rocket,
  TickEvent,
} from "./types.js";

const NO_GATES: readonly number[] = [];
const NO_GATE_LIST: readonly Gate[] = [];

// ---------------------------------------------------------------------------------------------
// Creation

export function createRound(config: RoundConfig): RoundState {
  const n = config.playerCount;
  if (!Number.isInteger(n) || n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new RangeError(
      `playerCount must be an integer in ${MIN_PLAYERS}..${MAX_PLAYERS}`,
    );
  }
  if (!Number.isFinite(config.seed))
    throw new RangeError("seed must be a finite number");
  const tuning = resolveTuning(config.tuning);
  const { holder, spots, terrain } = generateArena(config.seed, n, tuning);

  const hp = tuning.castleHp[n] ?? 200;
  const castles: Castle[] = spots.map(({ x, y }, id) => ({
    id,
    x,
    y,
    hp,
    maxHp: hp,
    alive: true,
    angle: 0,
    arcMin: 0,
    arcMax: 0,
    sweepDir: 1,
    facing: "both",
    reloadTicks: secondsToTicks(tuning.initialReload),
    reloadTotalTicks: secondsToTicks(tuning.initialReload),
    reloadTime: tuning.reloadTime,
    units: tuning.startUnits,
    shieldHp: 0,
    megaReady: false,
    volleyLeft: 0,
    volleyAngle: 0,
    volleyMega: false,
    volleyCooldown: 0,
    fallSpeed: 0,
    lastHitBy: -1,
    stats: {
      volleys: 0,
      rocketsFired: 0,
      damageDealt: 0,
      kills: 0,
      gateSplits: 0,
      crates: 0,
      ghostBombs: 0,
      ghostDamage: 0,
    },
  }));

  const state: RoundState = {
    config,
    tuning,
    tick: 0,
    phase: "playing",
    result: null,
    fuseTicks: secondsToTicks(tuning.fuseTime),
    maxTicks: secondsToTicks(tuning.maxRoundTime),
    terrain,
    castles,
    rockets: [],
    gates: [],
    crates: [],
    ghosts: [],
    events: [],
    nextCrateTick: secondsToTicks(tuning.firstCrateDelay),
    nextBombTick: 0,
    nextId: 1,
    rng: holder.rng,
  };

  for (const c of castles) {
    updateArc(state, c, true);
    // Start somewhere random on the arc so castles do not tick in lockstep.
    c.angle = range(state, c.arcMin, c.arcMax);
    c.sweepDir = random(state) < 0.5 ? 1 : -1;
  }
  const gateCount = tuning.gateCounts[n] ?? 3;
  for (let i = 0; i < gateCount; i++) {
    // Stagger initial lifetimes so gates do not all respawn at once.
    spawnGate(state, (i + 1) / gateCount);
  }
  state.events = [];
  return state;
}

/** Arena attempts before `createRound` settles for the last one (peaks shrink as attempts fail). */
const ARENA_ATTEMPTS = 12;

/**
 * Castle spots and terrain for a seed. An arena where some castle could never hit some other castle
 * (at spawn, or in the duel the two would end up in) is re-rolled with a derived seed, and after a
 * few failures the peaks are lowered, so every seed deterministically yields a fair arena.
 */
function generateArena(seed: number, n: number, tuning: Tuning) {
  let arena;
  for (let attempt = 0; attempt < ARENA_ATTEMPTS; attempt++) {
    const holder = { rng: hashSeed(seed, 0x5eed + attempt) };
    const xs = castlePositions(holder, n);
    const peakScale = Math.max(0, 1 - 0.1 * Math.max(0, attempt - 3));
    const terrain = generateTerrain(holder, xs, peakScale);
    const spots = xs.map((x) => ({
      x,
      y: highestGround(
        terrain,
        x - tuning.castleHalfWidth,
        x + tuning.castleHalfWidth,
      ),
    }));
    arena = { holder, spots, terrain };
    if (everyPairReachable(terrain, tuning, spots)) break;
  }
  if (!arena) throw new Error("unreachable: no arena attempts");
  return arena;
}

/** The read-only view of a round (the same object, typed so consumers cannot mutate it). */
export function view(state: RoundState): RoundView {
  return state;
}

/** True when the castle would fire if its button were pressed this tick. */
export function isLoaded(c: CastleView): boolean {
  return c.alive && c.reloadTicks === 0 && c.volleyLeft === 0;
}

/** The ghost bomber of player `owner`, if their castle has been destroyed. */
export function ghostOf(
  state: RoundView,
  owner: number,
): GhostView | undefined {
  return state.ghosts.find((g) => g.owner === owner);
}

/** True when the ghost would drop a bomb if its button were pressed this tick. */
export function isGhostLoaded(g: GhostView): boolean {
  return g.reloadTicks === 0;
}

/** Fuse progress in [0, 1] (1 = burnt out, sudden death). */
export function fuseProgress(state: RoundView): number {
  return Math.min(1, state.tick / Math.max(1, state.fuseTicks));
}

/** Damage multiplier currently applied to everything (grows during sudden death). */
export function damageScale(state: RoundView): number {
  const sd = Math.max(0, state.tick - state.fuseTicks) * DT;
  return 1 + sd / state.tuning.damageRampTime;
}

// ---------------------------------------------------------------------------------------------
// Step

/**
 * Advances the round by one tick. `pressed[i]` is true when player i's button went down this
 * tick (edge, not level). Mutates `state` in place and returns this tick's events (also stored on
 * `state.events`). Stepping a finished round keeps rockets flying for the aftermath but no longer
 * fires, damages or changes the result.
 */
export function step(
  state: RoundState,
  pressed: readonly boolean[] = [],
): readonly TickEvent[] {
  state.events = [];
  const tick = state.tick;

  if (state.phase === "playing" && tick >= state.fuseTicks) {
    state.phase = "sudden-death";
    state.nextBombTick = tick;
    state.events.push({ type: "sudden-death-started", tick });
  }

  updateCastles(state, pressed);
  updateGhosts(state, pressed);
  updateGates(state);
  updateCrates(state);
  if (state.phase === "sudden-death") dropBombs(state);
  updateRockets(state);
  settleCastles(state);
  checkRoundOver(state);

  state.tick = tick + 1;
  return state.events;
}

// ---------------------------------------------------------------------------------------------
// Castles

/** Castles aim at the side(s) where living opponents are; the arc narrows as the field thins. */
function updateArc(state: RoundState, c: Castle, force = false): void {
  let left = false;
  let right = false;
  for (const o of state.castles) {
    if (o === c || !o.alive) continue;
    if (o.x < c.x) left = true;
    else right = true;
  }
  if (!left && !right) return;
  const facing = left && right ? "both" : left ? "left" : "right";
  if (!force && facing === c.facing) return;
  c.facing = facing;
  [c.arcMin, c.arcMax] = arcFor(facing, state.tuning);
  c.angle = Math.min(c.arcMax, Math.max(c.arcMin, c.angle));
}

function volleyInterval(c: Castle, t: Tuning): number {
  const fit = Math.floor(t.volleyMaxTime / DT / Math.max(1, c.units));
  return Math.max(2, Math.min(t.volleyIntervalTicks, fit));
}

function updateCastles(state: RoundState, pressed: readonly boolean[]): void {
  const t = state.tuning;
  const tick = state.tick;
  const over = state.phase === "over";
  for (const c of state.castles) {
    if (!c.alive) continue;
    updateArc(state, c);

    // Fire at the angle the player saw when pressing (the angle after the previous tick).
    if (!over && pressed[c.id] === true && isLoaded(c)) {
      c.volleyLeft = c.units;
      c.volleyAngle = c.angle;
      c.volleyMega = c.megaReady;
      c.megaReady = false;
      c.volleyCooldown = 0;
      c.reloadTicks = secondsToTicks(c.reloadTime);
      c.reloadTotalTicks = c.reloadTicks;
      c.stats.volleys++;
      state.events.push({
        type: "fired",
        tick,
        castleId: c.id,
        angle: c.angle,
        units: c.units,
        mega: c.volleyMega,
      });
    }

    if (c.volleyLeft > 0) {
      if (over) c.volleyLeft = 0;
      else if (c.volleyCooldown > 0) c.volleyCooldown--;
      else {
        launchRocket(state, c);
        c.volleyLeft--;
        c.volleyCooldown = volleyInterval(c, t) - 1;
      }
    }

    sweep(c, t);
    if (c.reloadTicks > 0) c.reloadTicks--;
  }
}

/** Advances a launcher angle by one tick of its metronome sweep. */
function sweep(
  c: Pick<Castle, "angle" | "sweepDir" | "arcMin" | "arcMax" | "facing">,
  t: Tuning,
): void {
  const sweepTime = c.facing === "both" ? t.sweepTimeWide : t.sweepTimeNarrow;
  c.angle += (c.sweepDir * (c.arcMax - c.arcMin) * DT) / sweepTime;
  if (c.angle >= c.arcMax) {
    c.angle = Math.max(c.arcMin, 2 * c.arcMax - c.angle);
    c.sweepDir = -1;
  } else if (c.angle <= c.arcMin) {
    c.angle = Math.min(c.arcMax, 2 * c.arcMin - c.angle);
    c.sweepDir = 1;
  }
}

/**
 * The launcher angle a castle will have after `ticks` more steps, assuming its arc does not change
 * (it only changes when a castle dies). `futureAngle(state, id, 0)` is the current angle, the one a
 * press on the next step fires at. Bots use this to plan around their reaction time.
 */
export function futureAngle(
  state: RoundView,
  castleId: number,
  ticks: number,
): number {
  const c = state.castles[castleId];
  if (!c) throw new RangeError(`no castle ${castleId}`);
  const probe = {
    angle: c.angle,
    sweepDir: c.sweepDir,
    arcMin: c.arcMin,
    arcMax: c.arcMax,
    facing: c.facing,
  };
  for (let i = 0; i < ticks; i++) sweep(probe, state.tuning);
  return probe.angle;
}

function launchRocket(state: RoundState, c: Castle): void {
  const t = state.tuning;
  if (state.rockets.length >= t.maxRockets) return;
  const angle = c.volleyAngle + range(state, -t.spreadDeg, t.spreadDeg) * DEG;
  const speed =
    t.launchSpeed * (1 + range(state, -t.speedJitter, t.speedJitter));
  const l = launchState(c, t, angle, speed);
  state.rockets.push({
    id: state.nextId++,
    owner: c.id,
    x: l.x,
    y: l.y,
    vx: l.vx,
    vy: l.vy,
    power: 1,
    mega: c.volleyMega,
    bomb: false,
    ghost: false,
    gates: NO_GATES,
    age: 0,
  });
  c.stats.rocketsFired++;
}

function settleCastles(state: RoundState): void {
  const t = state.tuning;
  for (const c of state.castles) {
    const ground = highestGround(
      state.terrain,
      c.x - t.castleHalfWidth,
      c.x + t.castleHalfWidth,
    );
    if (c.y < ground) {
      c.fallSpeed += t.castleFallGravity * DT;
      c.y = Math.min(ground, c.y + c.fallSpeed * DT);
    }
    if (c.y >= ground) {
      c.y = ground;
      c.fallSpeed = 0;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Ghost bombers

function spawnGhost(state: RoundState, c: Castle): void {
  const t = state.tuning;
  if (!t.ghosts || state.ghosts.some((g) => g.owner === c.id)) return;
  const minX = t.ghostMargin;
  const maxX = ARENA_WIDTH - t.ghostMargin;
  const x0 = Math.min(maxX, Math.max(minX, c.x));
  const reload = secondsToTicks(t.ghostFirstReload);
  const ghost: Ghost = {
    owner: c.id,
    x: x0,
    y: t.ghostY,
    vx: 0,
    reloadTicks: reload,
    reloadTotalTicks: reload,
    // It is at `x0` when the next step starts (see `ghostPositionAt`).
    spawnTick: state.tick + 1,
    x0,
    // Head for the middle of the arena first.
    speed: x0 < ARENA_WIDTH / 2 ? t.ghostSpeed : -t.ghostSpeed,
    minX,
    maxX,
  };
  ghost.vx = ghost.speed;
  state.ghosts.push(ghost);
  state.events.push({
    type: "ghost-spawned",
    tick: state.tick,
    owner: c.id,
    x: ghost.x,
    y: ghost.y,
  });
}

function updateGhosts(state: RoundState, pressed: readonly boolean[]): void {
  for (const g of state.ghosts) {
    // Drop from where the player saw the blimp (its position after the previous tick).
    if (state.phase !== "over" && pressed[g.owner] === true && isGhostLoaded(g))
      dropGhostBomb(state, g);
    const p = ghostPositionAt(g, state.tick + 1);
    g.x = p.x;
    g.vx = p.vx;
    if (g.reloadTicks > 0) g.reloadTicks--;
  }
}

function dropGhostBomb(state: RoundState, g: Ghost): void {
  const t = state.tuning;
  g.reloadTicks = secondsToTicks(t.ghostReload);
  g.reloadTotalTicks = g.reloadTicks;
  // Ghost bombs bypass `maxRockets`: there are at most a handful, and a press must never be eaten.
  const id = state.nextId++;
  state.rockets.push({
    id,
    owner: g.owner,
    x: g.x,
    y: g.y,
    vx: g.vx,
    vy: t.ghostBombSpeed,
    power: 1,
    mega: false,
    bomb: false,
    ghost: true,
    gates: NO_GATES,
    age: 0,
  });
  const owner = state.castles[g.owner];
  if (owner) owner.stats.ghostBombs++;
  state.events.push({
    type: "ghost-bomb-dropped",
    tick: state.tick,
    owner: g.owner,
    rocketId: id,
    x: g.x,
    y: g.y,
  });
}

function ghostBombHit(
  state: RoundState,
  r: Rocket,
  castleIds: number[],
  damage: number,
): void {
  // Aftermath bombs still carve craters, but gameplay events stop with the round.
  if (state.phase === "over") return;
  state.events.push({
    type: "ghost-bomb-hit",
    tick: state.tick,
    owner: r.owner,
    rocketId: r.id,
    x: r.x,
    y: r.y,
    castleIds,
    damage,
  });
}

// ---------------------------------------------------------------------------------------------
// Gates and crates

function sideBounds(state: RoundState, inset: number): [number, number] {
  const first = state.castles[0];
  const last = state.castles[state.castles.length - 1];
  const lo = (first?.x ?? 0) + inset;
  const hi = (last?.x ?? ARENA_WIDTH) - inset;
  return hi > lo ? [lo, hi] : [ARENA_WIDTH / 2 - 1, ARENA_WIDTH / 2 + 1];
}

type Span = readonly [number, number];

/** `[lo, hi]` minus the open `blocked` spans, as disjoint spans. */
function freeSpans(lo: number, hi: number, blocked: readonly Span[]): Span[] {
  let free: Span[] = [[lo, hi]];
  for (const [a, b] of blocked) {
    free = free.flatMap(([l, h]): Span[] => {
      if (b <= l || a >= h) return [[l, h]];
      const out: Span[] = [];
      if (a > l) out.push([l, a]);
      if (b < h) out.push([b, h]);
      return out;
    });
  }
  return free;
}

const spanLength = (spans: readonly Span[]): number =>
  spans.reduce((sum, [l, h]) => sum + h - l, 0);

/** A uniformly random point of `spans` (one RNG draw). */
function pickIn(state: RoundState, spans: readonly Span[]): number {
  let u = range(state, 0, spanLength(spans));
  for (const [l, h] of spans) {
    if (u <= h - l) return l + u;
    u -= h - l;
  }
  return spans[spans.length - 1]?.[1] ?? ARENA_WIDTH / 2;
}

/**
 * Every gate drifts in its own lane `[minX, maxX]`, at least `gateSpacing` from every other live
 * gate's lane, so two gates never overlap. A lane is at most `1/count` of the sky minus the
 * spacing, which always leaves room for one more lane. Drifting clear of crates and spawning clear
 * of castles are preferences, dropped when there is no room.
 */
function spawnGate(state: RoundState, lifeFraction = 1): void {
  const t = state.tuning;
  const [leftX, rightX] = sideBounds(state, 130);
  const lanes = state.gates.map((g): Span => [
    g.minX - t.gateSpacing,
    g.maxX + t.gateSpacing,
  ]);
  const crates = state.crates.map((k): Span => [
    k.x - k.radius - t.gateWidth,
    k.x + k.radius + t.gateWidth,
  ]);
  const castles = state.castles.map((c): Span => [c.x - 90, c.x + 90]);
  let free = freeSpans(leftX, rightX, [...lanes, ...crates]);
  if (spanLength(free) <= 0) free = freeSpans(leftX, rightX, lanes);
  if (spanLength(free) <= 0) free = [[leftX, rightX]]; // only with extreme tuning
  let spawnable = free.flatMap(([l, h]) => freeSpans(l, h, castles));
  if (spanLength(spawnable) <= 0) spawnable = free;
  const x0 = pickIn(state, spawnable);
  const lane = free.find(([l, h]) => l <= x0 && x0 <= h) ?? [x0, x0];
  const count = t.gateCounts[state.castles.length] ?? 3;
  const half = Math.min(
    t.gateDriftRange,
    Math.max(0, (rightX - leftX) / count - t.gateSpacing) / 2,
  );
  const minX = Math.max(lane[0], x0 - half);
  const maxX = Math.min(lane[1], x0 + half);
  const ground = highestGround(
    state.terrain,
    minX - t.gateWidth,
    maxX + t.gateWidth,
  );
  const loY = 110;
  const hiY = Math.max(
    loY,
    Math.min(470, ground - t.gateHeight / 2 - t.gateBobAmp - 25),
  );
  const { multiplier } = weighted(state, t.gateMultipliers, (m) => m.weight);
  const life = range(state, t.gateLife[0], t.gateLife[1]) * lifeFraction;
  const gate: Gate = {
    id: state.nextId++,
    multiplier,
    x: x0,
    y: 0,
    width: t.gateWidth,
    height: t.gateHeight,
    spawnTick: state.tick,
    expireTick: state.tick + Math.max(1, secondsToTicks(life)),
    x0,
    vx:
      range(state, t.gateDriftSpeed[0], t.gateDriftSpeed[1]) *
      (random(state) < 0.5 ? -1 : 1),
    minX,
    maxX,
    // Prefer the band rockets actually fly through rather than the very top of the sky.
    baseY: range(state, Math.max(loY, hiY - 260), hiY),
    bobAmp: t.gateBobAmp,
    bobPeriodTicks: secondsToTicks(t.gateBobPeriod * range(state, 0.8, 1.2)),
    bobPhase: range(state, 0, Math.PI * 2),
  };
  const p = gatePositionAt(gate, state.tick);
  gate.x = p.x;
  gate.y = p.y;
  state.gates.push(gate);
  state.events.push({
    type: "gate-spawned",
    tick: state.tick,
    gateId: gate.id,
    multiplier,
  });
}

function updateGates(state: RoundState): void {
  const tick = state.tick;
  let expired = 0;
  for (let i = 0; i < state.gates.length; i++) {
    const g = state.gates[i];
    if (!g) continue;
    if (tick >= g.expireTick) {
      state.events.push({ type: "gate-expired", tick, gateId: g.id });
      state.gates.splice(i, 1);
      i--;
      expired++;
      continue;
    }
    const p = gatePositionAt(g, tick);
    g.x = p.x;
    g.y = p.y;
  }
  for (let i = 0; i < expired; i++) spawnGate(state);
}

function spawnCrate(state: RoundState): void {
  const t = state.tuning;
  const [leftX, rightX] = sideBounds(state, 90);
  let x = range(state, leftX, rightX);
  for (let attempt = 0; attempt < 10; attempt++) {
    const clear =
      state.castles.every((c) => Math.abs(c.x - x) > 80) &&
      state.crates.every((k) => Math.abs(k.x - x) > 120) &&
      state.gates.every((g) => Math.abs(g.x - x) > 50);
    if (clear) break;
    x = range(state, leftX, rightX);
  }
  const ground = highestGround(
    state.terrain,
    x - t.crateRadius,
    x + t.crateRadius,
  );
  const loY = 130;
  const hiY = Math.max(loY, Math.min(520, ground - t.crateRadius - 50));
  const card = weighted(state, CARDS, (c) => t.cardWeights[c]);
  const crate: Crate = {
    id: state.nextId++,
    card,
    x,
    y: 0,
    radius: t.crateRadius,
    baseY: range(state, loY, hiY),
    bobPhase: range(state, 0, Math.PI * 2),
    spawnTick: state.tick,
  };
  crate.y = crateYAt(crate.baseY, crate.bobPhase, crate.spawnTick, state.tick);
  state.crates.push(crate);
  state.events.push({
    type: "crate-spawned",
    tick: state.tick,
    crateId: crate.id,
    card,
    x,
    y: crate.y,
  });
}

function updateCrates(state: RoundState): void {
  const t = state.tuning;
  const max = t.crateCounts[state.castles.length] ?? 2;
  if (
    state.phase !== "over" &&
    state.crates.length < max &&
    state.tick >= state.nextCrateTick
  ) {
    spawnCrate(state);
    state.nextCrateTick =
      state.tick +
      secondsToTicks(range(state, t.crateRespawn[0], t.crateRespawn[1]));
  }
  for (const k of state.crates)
    k.y = crateYAt(k.baseY, k.bobPhase, k.spawnTick, state.tick);
}

function applyCard(state: RoundState, c: Castle, card: Card): void {
  const t = state.tuning;
  switch (card) {
    case "unit":
      c.units = Math.min(t.maxUnits, c.units + 1);
      break;
    case "shield":
      c.shieldHp = Math.min(t.shieldMax, c.shieldHp + t.shieldPerCard);
      break;
    case "rapid":
      c.reloadTime = Math.max(t.minReloadTime, c.reloadTime * t.rapidFactor);
      break;
    case "repair":
      c.hp = Math.min(c.maxHp, c.hp + t.repairAmount);
      break;
    case "mega":
      c.megaReady = true;
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Sudden death

function dropBombs(state: RoundState): void {
  const t = state.tuning;
  if (state.tick < state.nextBombTick) return;
  const sd = (state.tick - state.fuseTicks) * DT;
  const u = Math.min(1, sd / t.bombRampTime);
  const interval =
    t.bombIntervalStart + (t.bombIntervalMin - t.bombIntervalStart) * u;
  state.nextBombTick = state.tick + Math.max(1, secondsToTicks(interval));
  const alive = state.castles.filter((c) => c.alive);
  if (alive.length === 0 || state.rockets.length >= t.maxRockets) return;
  const target = alive[int(state, 0, alive.length - 1)];
  if (!target) return;
  const scatter = t.bombScatter[0] + (t.bombScatter[1] - t.bombScatter[0]) * u;
  const x = Math.min(
    ARENA_WIDTH - 10,
    Math.max(10, target.x + range(state, -scatter, scatter)),
  );
  state.rockets.push({
    id: state.nextId++,
    owner: -1,
    x,
    y: -30,
    vx: range(state, -40, 40),
    vy: range(state, 40, 120),
    power: 1,
    mega: false,
    bomb: true,
    ghost: false,
    gates: NO_GATES,
    age: 0,
  });
}

// ---------------------------------------------------------------------------------------------
// Rockets

function rocketDamage(state: RoundState, r: Rocket): number {
  const t = state.tuning;
  const base = r.ghost
    ? t.ghostBombDamage
    : r.bomb
      ? t.bombDamage
      : t.rocketDamage;
  return (
    base * r.power * (r.mega ? t.megaDamageFactor : 1) * damageScale(state)
  );
}

function updateRockets(state: RoundState): void {
  const rockets = state.rockets;
  const count = rockets.length;
  const born: Rocket[] = [];
  const maxAge = secondsToTicks(state.tuning.rocketMaxAge);
  let write = 0;
  for (let i = 0; i < count; i++) {
    const r = rockets[i];
    if (!r) continue;
    if (!simulateRocket(state, r, born, count)) continue;
    if (r.age <= maxAge) rockets[write++] = r;
    else rocketExploded(state, r, "expired");
  }
  rockets.length = write;
  for (const r of born) rockets.push(r);
}

/** Moves one rocket through this tick's sub-steps. Returns false when it is gone. */
function simulateRocket(
  state: RoundState,
  r: Rocket,
  born: Rocket[],
  liveCount: number,
): boolean {
  const t = state.tuning;
  const terrain = state.terrain;
  const halfH = t.castleHeight / 2;
  const shieldR = t.shieldRadius + t.rocketRadius;
  const castleR = t.castleRadius + t.rocketRadius;
  const crateR = t.crateRadius + t.rocketRadius;
  for (let s = 0; s < SUBSTEPS; s++) {
    integrate(r, t.gravity);
    if (isOffscreen(r.x, r.y, terrain.width, terrain.height)) return false;

    for (const c of state.castles) {
      if (!c.alive || c.id === r.owner) continue;
      const dx = r.x - c.x;
      const dy = r.y - (c.y - halfH);
      const d2 = dx * dx + dy * dy;
      if (
        (c.shieldHp > 0 && d2 < shieldR * shieldR) ||
        d2 < castleR * castleR
      ) {
        const damage = rocketDamage(state, r);
        const dealt = damageCastle(state, c, damage, r, r.x, r.y, false);
        if (r.ghost) ghostBombHit(state, r, dealt ? [c.id] : [], dealt);
        return false;
      }
    }

    if (r.y >= surfaceAt(terrain, r.x)) {
      explode(state, r);
      return false;
    }

    for (const g of r.ghost ? NO_GATE_LIST : state.gates) {
      if (insideGate(g.x, g.y, g, r.x, r.y) && !r.gates.includes(g.id)) {
        splitRocket(state, r, g, born, liveCount);
      }
    }

    if (r.owner >= 0 && !r.ghost && state.phase !== "over") {
      for (let k = 0; k < state.crates.length; k++) {
        const crate = state.crates[k];
        if (!crate) continue;
        const dx = r.x - crate.x;
        const dy = r.y - crate.y;
        if (dx * dx + dy * dy < crateR * crateR) {
          const owner = state.castles[r.owner];
          if (!owner?.alive) continue;
          state.crates.splice(k, 1);
          k--;
          applyCard(state, owner, crate.card);
          owner.stats.crates++;
          state.nextCrateTick = Math.max(
            state.nextCrateTick,
            state.tick +
              secondsToTicks(
                range(state, t.crateRespawn[0], t.crateRespawn[1]),
              ),
          );
          state.events.push({
            type: "crate-taken",
            tick: state.tick,
            crateId: crate.id,
            card: crate.card,
            castleId: owner.id,
            x: crate.x,
            y: crate.y,
          });
        }
      }
    }
  }
  r.age++;
  return true;
}

function splitRocket(
  state: RoundState,
  r: Rocket,
  g: Gate,
  born: Rocket[],
  liveCount: number,
): void {
  const t = state.tuning;
  r.gates = [...r.gates, g.id];
  const n = g.multiplier;
  const room = Math.max(
    0,
    t.maxRockets - t.splitReserve - (liveCount + born.length),
  );
  const created = Math.min(n - 1, room);
  // Children the cap would not allow are folded into the power of the ones that exist, so the
  // swarm hits just as hard even when it is drawn with fewer rockets.
  r.power *= n / (created + 1);
  if (r.owner >= 0) {
    const owner = state.castles[r.owner];
    if (owner) owner.stats.gateSplits++;
  }
  state.events.push({
    type: "gate-split",
    tick: state.tick,
    gateId: g.id,
    multiplier: n,
    owner: r.owner,
    x: r.x,
    y: r.y,
    created,
  });
  if (created === 0) return;

  const speed = Math.hypot(r.vx, r.vy);
  const dir = Math.atan2(r.vy, r.vx);
  const fan = Math.min(t.splitFanMaxDeg, t.splitFanPerChildDeg * (n - 1)) * DEG;
  const slots = created + 1;
  const parentSlot = Math.floor(created / 2);
  for (let j = 0; j < slots; j++) {
    const a = dir + fan * (j / created - 0.5) + range(state, -0.3, 0.3) * DEG;
    const v =
      speed * (1 + range(state, -t.splitSpeedJitter, t.splitSpeedJitter));
    if (j === parentSlot) {
      r.vx = Math.cos(a) * v;
      r.vy = Math.sin(a) * v;
      continue;
    }
    born.push({
      id: state.nextId++,
      owner: r.owner,
      x: r.x,
      y: r.y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      power: r.power,
      mega: r.mega,
      bomb: r.bomb,
      ghost: r.ghost,
      gates: r.gates,
      age: r.age,
    });
  }
}

function explode(state: RoundState, r: Rocket): void {
  const t = state.tuning;
  const base = r.ghost
    ? t.ghostCraterRadius
    : r.bomb
      ? t.bombCraterRadius
      : t.craterRadius * (r.mega ? t.megaCraterFactor : 1);
  const radius = base * Math.min(2.5, Math.sqrt(r.power));
  if (!crater(state, r.x, r.y, radius, r.owner))
    rocketExploded(state, r, "ground");
  const reach = radius + t.castleRadius;
  const damage = rocketDamage(state, r) * t.splashFactor;
  const hits: number[] = [];
  let dealt = 0;
  for (const c of state.castles) {
    if (!c.alive || c.id === r.owner) continue;
    const center = castleCenter(c, t);
    const dx = r.x - center.x;
    const dy = r.y - center.y;
    if (dx * dx + dy * dy >= reach * reach) continue;
    const d = damageCastle(state, c, damage, r, r.x, r.y, true);
    if (d > 0) hits.push(c.id);
    dealt += d;
  }
  if (r.ghost) ghostBombHit(state, r, hits, dealt);
}

function rocketExploded(
  state: RoundState,
  r: Rocket,
  cause: "ground" | "expired",
): void {
  state.events.push({
    type: "rocket-exploded",
    tick: state.tick,
    owner: r.owner,
    x: r.x,
    y: r.y,
    cause,
  });
}

/** Carves a crater and reports it. Returns false when the terrain did not change. */
function crater(
  state: RoundState,
  x: number,
  y: number,
  radius: number,
  owner: number,
): boolean {
  const changed = carveCrater(state.terrain, x, y, radius);
  if (!changed) return false;
  state.events.push({
    type: "crater",
    tick: state.tick,
    owner,
    x,
    y,
    radius,
    x0: changed.x0,
    x1: changed.x1,
  });
  return true;
}

/** Damages a castle with rocket `r`'s explosion; returns the damage dealt (0 when it had no effect). */
function damageCastle(
  state: RoundState,
  c: Castle,
  amount: number,
  r: Rocket,
  x: number,
  y: number,
  splash: boolean,
): number {
  if (state.phase === "over" || !c.alive || amount <= 0) return 0;
  const owner = r.owner;
  const attacker = owner >= 0 ? state.castles[owner] : undefined;
  if (attacker) {
    attacker.stats.damageDealt += amount;
    if (r.ghost) attacker.stats.ghostDamage += amount;
  }
  const base = {
    type: "hit" as const,
    tick: state.tick,
    castleId: c.id,
    owner,
    x,
    y,
    splash,
  };
  if (c.shieldHp > 0) {
    c.shieldHp = Math.max(0, c.shieldHp - amount);
    state.events.push({ ...base, damage: amount, shielded: true });
    if (c.shieldHp === 0)
      state.events.push({
        type: "shield-popped",
        tick: state.tick,
        castleId: c.id,
      });
    return amount;
  }
  c.hp = Math.max(0, c.hp - amount);
  c.lastHitBy = owner;
  state.events.push({ ...base, damage: amount, shielded: false });
  if (c.hp > 0) return amount;

  c.alive = false;
  c.shieldHp = 0;
  c.volleyLeft = 0;
  if (attacker && attacker !== c) attacker.stats.kills++;
  state.events.push({
    type: "castle-destroyed",
    tick: state.tick,
    castleId: c.id,
    by: owner,
    x: c.x,
    y: c.y,
  });
  crater(state, c.x, c.y - 8, state.tuning.wreckCraterRadius, owner);
  spawnGhost(state, c);
  return amount;
}

// ---------------------------------------------------------------------------------------------
// Round end

function checkRoundOver(state: RoundState): void {
  if (state.phase === "over") return;
  const alive = state.castles.filter((c) => c.alive);
  let result: RoundResult | null = null;
  const tick = state.tick;
  if (alive.length === 1 && alive[0]) {
    result = { winner: alive[0].id, reason: "last-standing", tick };
  } else if (alive.length === 0) {
    result = { winner: null, reason: "wipeout", tick };
  } else if (tick + 1 >= state.maxTicks) {
    let best = -1;
    let winner: number | null = null;
    for (const c of alive) {
      if (c.hp > best) {
        best = c.hp;
        winner = c.id;
      } else if (c.hp === best) {
        winner = null;
      }
    }
    result = { winner, reason: "timeout", tick };
  }
  if (!result) return;
  state.phase = "over";
  state.result = result;
  for (const c of state.castles) c.volleyLeft = 0;
  state.events.push({ type: "round-over", tick, result });
}
