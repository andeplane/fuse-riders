// The round simulation: `createRound` builds the initial state, `step` advances it one tick.

import { atan2, cos, hypot, sin } from "./det-math.js";
import {
  castleCenter,
  CRATE_BOB,
  crateYAt,
  DEG,
  gatePositionAt,
  ghostPositionAt,
  insideGate,
  integrate,
  isOffscreen,
  launchState,
  TAU,
  turnLauncher,
} from "./geometry.js";
import {
  carveCircle,
  cellSolid,
  segmentHit,
  solidAt,
  type Grid,
  type ReadGrid,
} from "./grid.js";
import { hashSeed, int, random, range, weighted } from "./rng.js";
import {
  buildTempleGrid,
  skyZones,
  spawnOrder,
  type Rect,
} from "./temple-map.js";
import {
  CARDS,
  DT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  resolveTuning,
  secondsToTicks,
  SUBSTEPS,
  WORLD_WIDTH,
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
  // The temple, with the castles hovering at a spread set of its spawn anchors.
  const terrain = buildTempleGrid();
  const hp = tuning.castleHp[n] ?? 200;
  const castles: Castle[] = spawnOrder(n, config.seed).map(({ x, y }, id) => ({
    id,
    x,
    y,
    hp,
    maxHp: hp,
    alive: true,
    angle: 0,
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
    rng: hashSeed(config.seed, 0x7e3a1e),
  };

  // Start each launcher somewhere random on its circle so castles do not turn in lockstep.
  for (const c of castles) c.angle = range(state, 0, TAU);
  const gateCount = tuning.gateCounts[n] ?? 3;
  for (let i = 0; i < gateCount; i++) {
    // Stagger initial lifetimes so gates do not all respawn at once.
    spawnGate(state, (i + 1) / gateCount);
  }
  state.events = [];
  return state;
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

/**
 * True when the ghost would drop a bomb if its button were pressed this tick: it is reloaded and the blimp is in
 * the open. A bomb released inside rock would blow up at the drop point that very step, so the press is ignored (and
 * the reload kept) until the blimp, which flies through rock, comes out of it. Pass the round's `terrain`.
 */
export function isGhostLoaded(g: GhostView, terrain: ReadGrid): boolean {
  return g.reloadTicks === 0 && !solidAt(terrain, g.x, g.y);
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
  checkRoundOver(state);

  state.tick = tick + 1;
  return state.events;
}

// ---------------------------------------------------------------------------------------------
// Castles

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

    c.angle = turnLauncher(c.angle, t);
    if (c.reloadTicks > 0) c.reloadTicks--;
  }
}

/**
 * The launcher angle a castle will have after `ticks` more steps (it turns at a steady rate, so this is
 * exact, bit for bit). `futureAngle(state, id, 0)` is the current angle, the one a press on the next
 * step fires at. Bots use this to plan around their reaction time.
 */
export function futureAngle(
  state: RoundView,
  castleId: number,
  ticks: number,
): number {
  const c = state.castles[castleId];
  if (!c) throw new RangeError(`no castle ${castleId}`);
  let angle = c.angle;
  for (let i = 0; i < ticks; i++) angle = turnLauncher(angle, state.tuning);
  return angle;
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

// ---------------------------------------------------------------------------------------------
// Ghost bombers

function spawnGhost(state: RoundState, c: Castle): void {
  const t = state.tuning;
  if (!t.ghosts || state.ghosts.some((g) => g.owner === c.id)) return;
  const minX = t.ghostMargin;
  const maxX = WORLD_WIDTH - t.ghostMargin;
  const x0 = Math.min(maxX, Math.max(minX, c.x));
  const reload = secondsToTicks(t.ghostFirstReload);
  const ghost: Ghost = {
    owner: c.id,
    x: x0,
    // Above the wreck, flying through rock at that height until free flight lands.
    y: Math.max(t.ghostMargin, c.y - t.ghostRise),
    vx: 0,
    reloadTicks: reload,
    reloadTotalTicks: reload,
    // It is at `x0` when the next step starts (see `ghostPositionAt`).
    spawnTick: state.tick + 1,
    x0,
    // Head for the middle of the world first.
    speed: x0 < WORLD_WIDTH / 2 ? t.ghostSpeed : -t.ghostSpeed,
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
    if (
      state.phase !== "over" &&
      pressed[g.owner] === true &&
      isGhostLoaded(g, state.terrain)
    )
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

/** Tries per gate or crate at finding a spot in the sky before giving up until later. */
const PLACE_ATTEMPTS = 16;
/** Gates and crates prefer to keep this far from a living castle's hit circle. */
const CASTLE_CLEARANCE = 60;
/** A gate refill or a crate is tried again this often (in ticks, 0.5 s) when the sky had no room. */
const PLACE_RETRY_TICKS = 30;

/** Whether two boxes are at least `gap` apart along one axis (so they do not overlap). */
function apart(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x1 + gap <= b.x0 ||
    b.x1 + gap <= a.x0 ||
    a.y1 + gap <= b.y0 ||
    b.y1 + gap <= a.y0
  );
}

/** Whether no rock cell touches the box. */
function clearOfRock(grid: Grid, b: Rect): boolean {
  const c = grid.cell;
  for (let row = Math.floor(b.y0 / c); row * c < b.y1; row++)
    for (let col = Math.floor(b.x0 / c); col * c < b.x1; col++)
      if (cellSolid(grid, col, row)) return false;
  return true;
}

/** Whether the box keeps `CASTLE_CLEARANCE` from every living castle's hit circle. */
function clearOfCastles(state: RoundState, b: Rect): boolean {
  const reach = state.tuning.castleRadius + CASTLE_CLEARANCE;
  return state.castles.every((c) => {
    if (!c.alive) return true;
    const dx = Math.max(b.x0 - c.x, 0, c.x - b.x1);
    const dy = Math.max(b.y0 - c.y, 0, c.y - b.y1);
    return dx * dx + dy * dy >= reach * reach;
  });
}

/** The area a gate sweeps while drifting between `minX` and `maxX` and bobbing round `baseY`. */
export function gateBox(
  g: Pick<Gate, "minX" | "maxX" | "baseY" | "width" | "height" | "bobAmp">,
): Rect {
  return {
    x0: g.minX - g.width / 2,
    y0: g.baseY - g.height / 2 - g.bobAmp,
    x1: g.maxX + g.width / 2,
    y1: g.baseY + g.height / 2 + g.bobAmp,
  };
}

/** The area a crate covers while bobbing. */
export function crateBox(k: Pick<Crate, "x" | "baseY" | "radius">): Rect {
  return {
    x0: k.x - k.radius,
    y0: k.baseY - k.radius - CRATE_BOB,
    x1: k.x + k.radius,
    y1: k.baseY + k.radius + CRATE_BOB,
  };
}

/** A sky zone that fits a `w × h` box, picked with odds by area (one RNG draw), or undefined if none fits. */
function pickZone(state: RoundState, w: number, h: number): Rect | undefined {
  const fits = skyZones.filter((z) => z.x1 - z.x0 >= w && z.y1 - z.y0 >= h);
  if (fits.length === 0) return undefined;
  return weighted(state, fits, (z) => (z.x1 - z.x0) * (z.y1 - z.y0));
}

/**
 * Seeded spots in the map's sky zones until one is free: `make` turns a zone into a candidate and its box, which
 * must hold no rock and pass `free`. A spot that also keeps clear of the castles wins; otherwise the first free
 * one does, even when that puts it right over a castle: with 16 tries all near castles, a crate or gate on top of one
 * is intended (a crate there is just a card for whoever's rocket touches it, a gate a multiplier), better than none.
 * Undefined when the sky has no room (the caller tries again later).
 */
function placeInSky<S>(
  state: RoundState,
  size: readonly [number, number],
  make: (zone: Rect) => { spot: S; box: Rect },
  free: (box: Rect) => boolean,
): S | undefined {
  let fallback: S | undefined;
  for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt++) {
    const zone = pickZone(state, size[0], size[1]);
    if (!zone) return undefined;
    const { spot, box } = make(zone);
    if (!free(box) || !clearOfRock(state.terrain, box)) continue;
    if (clearOfCastles(state, box)) return spot;
    fallback ??= spot;
  }
  return fallback;
}

/**
 * A gate drifts and bobs inside one sky zone, in a box that holds no rock and keeps `gateSpacing` from every
 * other live gate's box and clear of the crates present when it spawns (crates avoid gates in turn), so gates
 * never overlap rock, each other or crates. Keeping clear of castles is a preference.
 */
function spawnGate(state: RoundState, lifeFraction = 1): boolean {
  const t = state.tuning;
  const [w, h, bob] = [t.gateWidth, t.gateHeight, t.gateBobAmp];
  const gates = state.gates.map(gateBox);
  const crates = state.crates.map(crateBox);
  const spot = placeInSky(
    state,
    [w, h + 2 * bob],
    (zone) => {
      const half = Math.min(t.gateDriftRange, (zone.x1 - zone.x0 - w) / 2);
      const cx = range(state, zone.x0 + w / 2 + half, zone.x1 - w / 2 - half);
      const baseY = range(state, zone.y0 + h / 2 + bob, zone.y1 - h / 2 - bob);
      const [minX, maxX] = [cx - half, cx + half];
      const shape = { minX, maxX, baseY, width: w, height: h, bobAmp: bob };
      return { spot: { minX, maxX, baseY }, box: gateBox(shape) };
    },
    (box) =>
      gates.every((g) => apart(g, box, t.gateSpacing)) &&
      crates.every((k) => apart(k, box, 10)),
  );
  if (!spot) return false;
  const { multiplier } = weighted(state, t.gateMultipliers, (m) => m.weight);
  const life = range(state, t.gateLife[0], t.gateLife[1]) * lifeFraction;
  const gate: Gate = {
    id: state.nextId++,
    multiplier,
    x: 0,
    y: 0,
    width: w,
    height: h,
    spawnTick: state.tick,
    expireTick: state.tick + Math.max(1, secondsToTicks(life)),
    x0: range(state, spot.minX, spot.maxX),
    vx:
      range(state, t.gateDriftSpeed[0], t.gateDriftSpeed[1]) *
      (random(state) < 0.5 ? -1 : 1),
    minX: spot.minX,
    maxX: spot.maxX,
    baseY: spot.baseY,
    bobAmp: bob,
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
  return true;
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
  // Expired gates respawn at once; gates that found no room earlier try again every so often.
  const count = state.tuning.gateCounts[state.castles.length] ?? 5;
  const retry = tick % PLACE_RETRY_TICKS === 0;
  const missing = count - state.gates.length;
  for (let i = 0; i < missing && (i < expired || retry); i++)
    if (!spawnGate(state)) break;
}

/**
 * A crate bobs in a sky zone, clear of rock, of every live gate's box and of other crates. Returns false when the sky
 * had no room.
 */
function spawnCrate(state: RoundState): boolean {
  const t = state.tuning;
  const r = t.crateRadius;
  const gates = state.gates.map(gateBox);
  const crates = state.crates.map(crateBox);
  const spot = placeInSky(
    state,
    [2 * r, 2 * (r + CRATE_BOB)],
    (zone) => {
      const x = range(state, zone.x0 + r, zone.x1 - r);
      const baseY = range(
        state,
        zone.y0 + r + CRATE_BOB,
        zone.y1 - r - CRATE_BOB,
      );
      return { spot: { x, baseY }, box: crateBox({ x, baseY, radius: r }) };
    },
    (box) =>
      gates.every((g) => apart(g, box, 10)) &&
      crates.every((k) => apart(k, box, 100)),
  );
  if (!spot) return false;
  const card = weighted(state, CARDS, (c) => t.cardWeights[c]);
  const crate: Crate = {
    id: state.nextId++,
    card,
    x: spot.x,
    y: 0,
    radius: r,
    baseY: spot.baseY,
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
    x: crate.x,
    y: crate.y,
  });
  return true;
}

function updateCrates(state: RoundState): void {
  const t = state.tuning;
  const max = t.crateCounts[state.castles.length] ?? 2;
  if (
    state.phase !== "over" &&
    state.crates.length < max &&
    state.tick >= state.nextCrateTick
  ) {
    // A sky with no room (rock carved away, gates in the way) is tried again soon, not after a full respawn wait.
    state.nextCrateTick =
      state.tick +
      (spawnCrate(state)
        ? secondsToTicks(range(state, t.crateRespawn[0], t.crateRespawn[1]))
        : PLACE_RETRY_TICKS);
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
    WORLD_WIDTH - 10,
    Math.max(10, target.x + range(state, -scatter, scatter)),
  );
  state.rockets.push({
    id: state.nextId++,
    owner: -1,
    x,
    y: bombStartY(state.terrain, x, target.y, t.bombHeight),
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

/**
 * Where a sudden-death bomb above a castle at height `y` appears: `height` above it, but never above the top of the
 * world, and just under the rock when the column above the castle has a ceiling.
 */
export function bombStartY(
  grid: ReadGrid,
  x: number,
  y: number,
  height: number,
): number {
  const top = Math.max(grid.cell, y - height);
  const roof = segmentHit(grid, x, y, x, top);
  return roof && roof.t > 0 ? roof.y + grid.cell / 2 : top;
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
  const shieldR = t.shieldRadius + t.rocketRadius;
  const castleR = t.castleRadius + t.rocketRadius;
  const crateR = t.crateRadius + t.rocketRadius;
  for (let s = 0; s < SUBSTEPS; s++) {
    const [px, py] = [r.x, r.y];
    integrate(r, t.gravity);
    if (isOffscreen(r.x, r.y, terrain.width, terrain.height)) return false;

    for (const c of state.castles) {
      if (!c.alive || c.id === r.owner) continue;
      const dx = r.x - c.x;
      const dy = r.y - c.y;
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

    // Rock anywhere along this sub-step's path stops the rocket where it enters.
    const rock = segmentHit(terrain, px, py, r.x, r.y);
    if (rock) {
      r.x = rock.x;
      r.y = rock.y;
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

  const speed = hypot(r.vx, r.vy);
  const dir = atan2(r.vy, r.vx);
  const fan = Math.min(t.splitFanMaxDeg, t.splitFanPerChildDeg * (n - 1)) * DEG;
  const slots = created + 1;
  const parentSlot = Math.floor(created / 2);
  for (let j = 0; j < slots; j++) {
    const a = dir + fan * (j / created - 0.5) + range(state, -0.3, 0.3) * DEG;
    const v =
      speed * (1 + range(state, -t.splitSpeedJitter, t.splitSpeedJitter));
    if (j === parentSlot) {
      r.vx = cos(a) * v;
      r.vy = sin(a) * v;
      continue;
    }
    born.push({
      id: state.nextId++,
      owner: r.owner,
      x: r.x,
      y: r.y,
      vx: cos(a) * v,
      vy: sin(a) * v,
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
    const center = castleCenter(c);
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
  const changed = carveCircle(state.terrain, x, y, radius);
  if (!changed) return false;
  state.events.push({
    type: "crater",
    tick: state.tick,
    owner,
    x,
    y,
    radius,
    col0: changed.col0,
    row0: changed.row0,
    col1: changed.col1,
    row1: changed.row1,
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
  // The wreck blows a big crater where it hovered (harmless in open air).
  crater(state, c.x, c.y, state.tuning.wreckCraterRadius, owner);
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
