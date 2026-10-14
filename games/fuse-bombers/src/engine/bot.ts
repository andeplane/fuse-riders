// Bots inside the round. `step` plays the seats `RoundConfig.bots` names: each tick `botInput` decides a bot's bits
// from the read-only view and the bot's memory (`state.bots`, plain data, so a clone or rollback carries it). A bot
// flies to a spot in range of its target (behind a gate if one is handy, round the temple on the flyway when rock is
// in the way), works out when the turning launcher will point at someone, checks that shot with `predictTrajectory`,
// lets go of the stick so it coasts there, and presses. Its ghost flies over a target and drops when
// `predictGhostBomb` says the bomb lands on it.

import { atan2, cos, hypot, sin } from "./det-math.js";
import { GHOST_FLIGHT, GUNSHIP_FLIGHT } from "./flight.js";
import { TAU, turnLauncher } from "./geometry.js";
import { circleOverlapsSolid, solidAt, type ReadGrid } from "./grid.js";
import { DOWN, FIRE, LEFT, RIGHT, thrustDirection, UP } from "./input.js";
import { predictGhostBomb, predictTrajectory } from "./predict.js";
import type { Trajectory } from "./predict.js";
import { hashSeed, int, random } from "./rng.js";
import { TEMPLE_FLYWAY } from "./temple-map.js";
import { DT, type Card } from "./tuning.js";
import type { CastleView, RoundView, Vec2 } from "./types.js";

export type BotDifficulty = "easy" | "normal" | "hard";
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = [
  "easy",
  "normal",
  "hard",
];

/** A seat the engine plays (`RoundConfig.bots`). */
export interface BotSeat {
  readonly id: number;
  readonly difficulty: BotDifficulty;
}

/**
 * What a bot remembers between ticks, in `RoundState.bots`: plain data that clones, checkpoints and hashes carry. A
 * checkpoint codec must refuse non-finite numbers and a seat or difficulty other than `config.bots` says.
 */
export interface BotMemory {
  id: number;
  difficulty: BotDifficulty;
  /** Its own PRNG state (see rng.ts), apart from the round's. */
  rng: number;
  /** Set once it flies its ghost (its gunship's plans are dropped then). */
  ghost: boolean;
  /** The castle it is after, or -1. */
  target: number;
  /** Where it wants to be, and where it steers now (there, or the flyway). */
  spotX: number;
  spotY: number;
  wayX: number;
  wayY: number;
  /** Tick it next picks a target and a spot. */
  planTick: number;
  /** Tick it presses fire, or -1; until then it holds nothing and coasts. */
  pressTick: number;
  /** Direction bits it holds to dodge a rocket, until `dodgeTick`. */
  dodgeBits: number;
  dodgeTick: number;
}

// How a difficulty plays. Ticks: `reaction` (deciding to pressing), `timingError` (a press lands up to this early or
// late), `thinkEvery` (between looks for a shot; at most `checks` predicted per look), `planEvery` and `routeEvery`.
// Then its range (px), the share of a target's motion it leads by, the least a volley must promise (1 = a direct
// hit), what crates, gates, weak castles, the leader and its last attacker are worth, its chance to `dodge`, how hard
// it brakes into its spot (1/s), how far it looks ahead for rock (s) and how near a ghost bomb must land (px).
// prettier-ignore
const PROFILES = {
  easy: { reaction: 22, timingError: 6, thinkEvery: 6, checks: 1, planEvery: 150, routeEvery: 30, range: 650,
    lead: 0, minValue: 0.25, crateLove: 0.2, gateLove: 0.2, focusWeak: 0, focusLeader: 0, grudge: 0.5, dodge: 0,
    arrive: 1.2, lookAhead: 0.15, ghostSlack: 70 },
  normal: { reaction: 15, timingError: 2, thinkEvery: 4, checks: 2, planEvery: 100, routeEvery: 20, range: 500,
    lead: 0.8, minValue: 0.35, crateLove: 0.5, gateLove: 0.6, focusWeak: 0.5, focusLeader: 0.3, grudge: 0.3,
    dodge: 0.25, arrive: 1.8, lookAhead: 0.3, ghostSlack: 40 },
  hard: { reaction: 10, timingError: 1, thinkEvery: 3, checks: 3, planEvery: 70, routeEvery: 12, range: 420,
    lead: 0.9, minValue: 0.45, crateLove: 1, gateLove: 1, focusWeak: 1.2, focusLeader: 0.4, grudge: 0.2, dodge: 0.6,
    arrive: 2.2, lookAhead: 0.4, ghostSlack: 25 },
} as const;
type Profile = (typeof PROFILES)[BotDifficulty];
/** One bot's turn: what it sees, remembers and is. */
type Turn = { view: RoundView; m: BotMemory; me: CastleView; p: Profile };
type Body = Vec2 & { vx: number; vy: number };

// prettier-ignore
const CARD_VALUE: Readonly<Record<Card, number>> =
  { unit: 1, rapid: 0.8, mega: 0.7, shield: 0.5, repair: 0.3 };
/** Rockets beyond which more gate splits add nothing (the swarm is plenty). */
const SWARM_CAP = 250;
const RADIUS = GUNSHIP_FLIGHT.shape.radius;
// Px: half a route's lane, a gate spot's distance behind its gate, the distance ships steer apart within, and how far
// above its target a ghost waits.
const [LANE, GATE_GAP, SPACING, HOVER] = [RADIUS + 4, 260, 170, 260];
/** Ticks a ghost leads its target by: about a bomb's fall from `HOVER`. */
const FALL = 55;
/** Twelve directions round a point (y down). */
const AROUND: readonly Vec2[] = Array.from({ length: 12 }, (_, i) => ({
  x: cos((i * TAU) / 12),
  y: -sin((i * TAU) / 12),
}));
/** The eight directions, each with points just ahead of the hull's front and shoulders to test for rock. */
// prettier-ignore
const WHISKERS = [UP, UP | RIGHT, RIGHT, DOWN | RIGHT, DOWN, DOWN | LEFT, LEFT, UP | LEFT].map((bits) => {
  const { x, y } = thrustDirection(bits);
  const [f, s, n] = [0.6 * RADIUS + 16, 0.8 * RADIUS, RADIUS + 26];
  const probes: [number, number][] = [[x * n, y * n], [x * f - y * s, y * f + x * s], [x * f + y * s, y * f - x * s]];
  return { bits, x, y, probes };
});

/** `bots` checked against the seat count and sorted by seat; `RangeError` when malformed. */
export function validateBots(bots: unknown, playerCount: number): BotSeat[] {
  if (bots === undefined) return [];
  if (!Array.isArray(bots)) throw new RangeError("bots must be an array");
  const seats = Array.from(bots, (b: unknown): BotSeat => {
    const { id, difficulty: d } = Object(b) as Partial<BotSeat>;
    const ok = typeof id === "number" && Number.isInteger(id) && id >= 0;
    if (!ok || id >= playerCount || !BOT_DIFFICULTIES.some((k) => k === d))
      throw new RangeError("a bot needs a seat below playerCount and a level");
    return { id: id + 0, difficulty: d as BotDifficulty }; // no -0
  });
  seats.sort((a, b) => a.id - b.id);
  if (seats.some((s, i) => seats[i - 1]?.id === s.id))
    throw new RangeError("two bots in one seat");
  return seats;
}

/** A bot's memory at the start of a round, seeded from the round's seed. */
export function createBotMemory(s: BotSeat, seed: number, at: Vec2): BotMemory {
  // prettier-ignore
  return { id: s.id, difficulty: s.difficulty, rng: hashSeed(seed, 0xb07 + s.id), ghost: false, target: -1,
    spotX: at.x, spotY: at.y, wayX: at.x, wayY: at.y, planTick: 0, pressTick: -1, dodgeBits: 0, dodgeTick: 0 };
}

/**
 * The bits bot `m` holds this tick, decided from the view (the state before this tick's step) and its memory, which
 * it updates. Nothing else is read or kept, so a state always gives the same bits.
 */
export function botInput(view: RoundView, m: BotMemory): number {
  const me = view.castles[m.id];
  if (!me || view.result) return 0;
  const b: Turn = { view, m, me, p: PROFILES[m.difficulty] };
  if (!me.alive) return ghostInput(b);
  const tick = view.tick;
  if (m.pressTick >= 0) {
    if (tick < m.pressTick) return 0; // coast to where the shot was planned
    if (me.reloadTicks === 0 && me.volleyLeft === 0) {
      m.pressTick = -1;
      return FIRE;
    }
    if (tick < m.pressTick + 10) return 0; // not quite loaded: wait a moment
    m.pressTick = -1;
  }
  if (tick >= m.planTick) plan(b);
  if ((tick + m.id * 5) % b.p.thinkEvery === 0) {
    aim(b);
    if (m.pressTick >= 0) return 0;
    dodge(b);
  }
  if ((tick + m.id * 7) % b.p.routeEvery === 0) route(b);
  return steer(b);
}

/** Whom to go after: weak castles, the leader and whoever hit it last count more, far ones less. */
function pickTarget({ view, m, p }: Turn, from: Vec2): number {
  let leaderHp = -1;
  for (const o of view.castles)
    if (o.alive && o.id !== m.id)
      leaderHp = Math.max(leaderHp, o.hp + o.shieldHp);
  let [best, bestWeight] = [-1, -Infinity];
  for (const o of view.castles) {
    if (!o.alive || o.id === m.id) continue;
    let w = 1 + p.focusWeak * (1 - o.hp / o.maxHp) + 0.3 * random(m);
    w -= hypot(o.x - from.x, o.y - from.y) / 2500;
    if (o.hp + o.shieldHp === leaderHp) w += p.focusLeader;
    if (o.id === view.castles[m.id]?.lastHitBy) w += p.grudge;
    if (o.id === m.target) w += 0.3; // stay on one target a while
    if (w > bestWeight) [best, bestWeight] = [o.id, w];
  }
  return best;
}

/**
 * Picks a target and the spot to fight it from: at the bot's range round it (or behind a gate as the target sees it,
 * so the shot goes through the gate), the nearest in open air with a clear line to it, not below it, not crowded.
 */
function plan(b: Turn): void {
  const { view, m, me, p } = b;
  m.planTick = view.tick + p.planEvery + int(m, 0, 20);
  m.target = pickTarget(b, me);
  const t = view.castles[m.target];
  if (!t) return;
  const range = p.range * (0.85 + 0.3 * random(m));
  let best = Infinity;
  const consider = (x: number, y: number, bonus: number) => {
    if (blocked(view.terrain, x, y, RADIUS + 20)) return;
    let cost = hypot(x - me.x, y - me.y) - bonus;
    if (y > t.y + 0.6 * range) cost += 300;
    if (!clearLine(view.terrain, { x, y }, t, 0)) cost += 2000;
    for (const o of view.castles)
      if (o.alive && o.id !== me.id && o.id !== t.id)
        if (hypot(o.x - x, o.y - y) < 250) cost += 500;
    if (cost < best) [best, m.spotX, m.spotY] = [cost, x, y];
  };
  for (const u of AROUND) consider(t.x + u.x * range, t.y + u.y * range, 0);
  for (const g of view.gates) {
    const [gx, gy] = [g.x - t.x, g.y - t.y];
    const d = hypot(gx, gy);
    const [x, y] = [g.x + (gx / d) * GATE_GAP, g.y + (gy / d) * GATE_GAP];
    if (d > 250 && d < range + 300)
      consider(x, y, 150 * p.gateLove * g.multiplier);
  }
  route(b);
}

/**
 * Sets the waypoint: the spot when a lane to it is clear of rock, else round the flyway the shorter way, to the
 * furthest of the next three points in sight; out of a pocket with no flyway point in sight, the longest clear lane.
 */
function route(b: Turn): void {
  const { view, m, me } = b;
  let way: Vec2 = { x: m.spotX, y: m.spotY };
  const clear = (q: Vec2 = me) => clearLine(view.terrain, me, q, LANE);
  if (!clear(way)) {
    const [ring, n] = [TEMPLE_FLYWAY, TEMPLE_FLYWAY.length];
    const z = byDistance(way)[0] ?? 0;
    const near = byDistance(me);
    const a = near.slice(0, 5).find((i) => clear(ring[i]));
    if (a === undefined) way = openest(b, ring[near[0] ?? 0] ?? way);
    const dir = (z - (a ?? z) + n) % n <= n / 2 ? 1 : n - 1;
    for (let i = a ?? z, hop = 0; a !== undefined && hop < 4; hop++) {
      if (clear(ring[i])) way = ring[i] ?? way;
      if (i === z) break;
      i = (i + dir) % n;
    }
  }
  [m.wayX, m.wayY] = [way.x, way.y];
}

/** The end of the longest clear lane out (up to 600 px), lanes toward `goal` favoured. */
function openest({ view, me }: Turn, goal: Vec2): Vec2 {
  const [gx, gy] = [goal.x - me.x, goal.y - me.y];
  const d = hypot(gx, gy) || 1;
  let [best, way] = [0, goal];
  for (const u of AROUND)
    for (const length of [600, 300, 150]) {
      const end = { x: me.x + u.x * length, y: me.y + u.y * length };
      if (!clearLine(view.terrain, me, end, LANE)) continue;
      const score = length * (2 + (u.x * gx + u.y * gy) / d);
      if (score > best) [best, way] = [score, end];
      break;
    }
  return way;
}

/** The flyway's points, nearest to `at` first. */
function byDistance(at: Vec2): number[] {
  const d = TEMPLE_FLYWAY.map((q) => hypot(q.x - at.x, q.y - at.y));
  return d.map((_, i) => i).sort((i, j) => (d[i] ?? 0) - (d[j] ?? 0));
}

/**
 * Bits that fly the gunship to its waypoint (braking into the spot), apart from other ships, braking for rock its
 * coasting path runs into.
 */
function steer({ view, m, me, p }: Turn): number {
  const top = GUNSHIP_FLIGHT.topSpeed;
  if (view.tick < m.dodgeTick) {
    const d = thrustDirection(m.dodgeBits);
    return drive(me, { x: d.x * top, y: d.y * top }, view.terrain);
  }
  const atSpot = m.wayX === m.spotX && m.wayY === m.spotY;
  const way = { x: m.wayX, y: m.wayY };
  const w = toward(me, way, top, atSpot ? p.arrive : 9);
  for (const o of view.castles) {
    const [ox, oy] = [me.x - o.x, me.y - o.y];
    const od = hypot(ox, oy);
    if (!o.alive || o.id === me.id || od >= SPACING || od === 0) continue;
    w.x += (ox / od) * top * (1 - od / SPACING);
    w.y += (oy / od) * top * (1 - od / SPACING);
  }
  const v = hypot(me.vx, me.vy);
  const ahead = (RADIUS + 12) / v + p.lookAhead; // s of coasting
  const [ax, ay] = [me.x + me.vx * ahead, me.y + me.vy * ahead];
  if (v > 30 && blocked(view.terrain, ax, ay, 0)) {
    const back = (w.x * me.vx + w.y * me.vy) / v + v; // to back off at speed v
    if (back > 0)
      [w.x, w.y] = [w.x - (me.vx / v) * back, w.y - (me.vy / v) * back];
  }
  return drive(me, w, view.terrain);
}

/** Velocity toward `goal`: `top` px/s, slowing by `arrive` px/s per px near it. */
function toward(body: Vec2, goal: Vec2, top: number, arrive: number): Vec2 {
  const [dx, dy] = [goal.x - body.x, goal.y - body.y];
  const d = hypot(dx, dy);
  const speed = Math.min(top, d * arrive);
  return d > 1 ? { x: (dx / d) * speed, y: (dy / d) * speed } : { x: 0, y: 0 };
}

/** The bits that turn the body's velocity toward `w` (none to brake when close). */
function drive(body: Body, w: Vec2, grid?: ReadGrid): number {
  let [ex, ey] = [w.x - body.vx, w.y - body.vy];
  if (ex * ex + ey * ey < 900) {
    if (w.x * w.x + w.y * w.y < 1600) return 0; // there: let go and brake
    [ex, ey] = [w.x, w.y]; // at speed: keep thrusting that way
  }
  return eight(ex, ey, grid, body);
}

/**
 * The one of the eight directions nearest (x, y); with `grid`, the nearest with no rock just ahead of `at` (0 when
 * none within 120° of it is clear).
 */
function eight(x: number, y: number, grid?: ReadGrid, at = { x: 0, y: 0 }) {
  const d = hypot(x, y);
  let [bits, best] = [0, grid ? -0.5 : -2];
  for (const w of d > 0 ? WHISKERS : []) {
    const dot = (w.x * x + w.y * y) / d;
    const clear = (g: ReadGrid) =>
      !w.probes.some(([px, py]) => blocked(g, at.x + px, at.y + py, 0));
    if (dot > best && (!grid || clear(grid))) [bits, best] = [w.bits, dot];
  }
  return bits;
}

/** Rock within `r` px of (x, y), or the world's edge. */
function blocked(grid: ReadGrid, x: number, y: number, r: number): boolean {
  if (x < r || y < r || x > grid.width - r || y > grid.height - r) return true;
  return circleOverlapsSolid(grid, x, y, r);
}

/** No rock along a to b (sampled every 12 px), nor `half` px either side. */
function clearLine(grid: ReadGrid, a: Vec2, b: Vec2, half: number): boolean {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const d = hypot(dx, dy);
  const n = Math.max(1, Math.ceil(d / 12));
  const [px, py] = d > 0 ? [(-dy / d) * half, (dx / d) * half] : [0, 0];
  for (let i = 0; i <= n; i++) {
    const [x, y] = [a.x + (dx * i) / n, a.y + (dy * i) / n];
    if (blocked(grid, x, y, 0)) return false;
    if (half > 0 && blocked(grid, x + px, y + py, 0)) return false;
    if (half > 0 && blocked(grid, x - px, y - py, 0)) return false;
  }
  return true;
}

/** Where a gunship coasting with nothing held is `ticks` steps on, braking as `flyStep` does (rock ignored). */
function coast(c: CastleView, ticks: number): Vec2 {
  const { brakeDrag, stopSpeed } = GUNSHIP_FLIGHT;
  const keep = Math.max(0, 1 - brakeDrag * DT);
  let [x, y, vx, vy] = [c.x, c.y, c.vx, c.vy];
  for (let i = 0; i < ticks; i++) {
    [vx, vy] = [vx * keep, vy * keep];
    if (vx * vx + vy * vy < stopSpeed * stopSpeed) break;
    [x, y] = [x + vx * DT, y + vy * DT];
  }
  return { x, y };
}

/** A shot: ticks from now to press, the seconds it leads castles by, and how much the bot hopes of it. */
type Shot = { k: number; lead: number; hope: number };

/**
 * Looks for a shot the launcher comes round to in this look's window (`reaction` to `reaction + thinkEvery` ticks on,
 * once loaded): the low and high arcs to each opponent in range, leading it, and to each crate near. The likeliest
 * are checked with `predictTrajectory` from where the gunship coasts to; the first worth a volley sets `pressTick`.
 */
function aim(b: Turn): void {
  const { view, m, me, p } = b;
  const t = view.tuning;
  if (me.volleyLeft > 0 || me.reloadTicks > p.reaction + p.thinkEvery) return;
  const lo = Math.max(p.reaction, me.reloadTicks);
  const at = coast(me, lo);
  const [fx, fy] = [at.x, at.y - t.launcherOffset];
  const [v, g] = [t.launchSpeed, t.gravity];
  const shots: Shot[] = [];
  const consider = (o: Vec2, vx: number, vy: number, hope: number) => {
    arcs: for (const high of [-1, 1]) {
      // Lead by the flight, twice: the flight depends on the arc, the arc on the lead.
      let [lead, angle] = [lo * DT + hypot(o.x - fx, o.y - fy) / v, 0];
      for (let i = 0; i < 2; i++) {
        const [X, Y] = [o.x + vx * lead - fx, fy - o.y - vy * lead];
        const disc = v * v * v * v - g * (g * X * X + 2 * Y * v * v);
        if (disc < 0) continue arcs;
        angle = atan2(v * v + high * Math.sqrt(disc), g * X);
        const c = Math.abs(cos(angle));
        lead = lo * DT + (c > 0.15 ? Math.abs(X) / c : hypot(X, Y)) / v;
      }
      const turns = (angle - me.angle) / TAU;
      const k = Math.round(((turns - Math.floor(turns)) * t.aimPeriod) / DT);
      const shot = { k, lead, hope: high > 0 ? hope / 2 : hope };
      if (k >= lo && k < lo + p.thinkEvery) shots.push(shot);
    }
  };
  for (const o of view.castles)
    if (o.alive && o.id !== m.id && hypot(o.x - fx, o.y - fy) < 1300)
      consider(o, o.vx * p.lead, o.vy * p.lead, o.id === m.target ? 1.5 : 1);
  for (const c of view.crates)
    if (hypot(c.x - fx, c.y - fy) < 900)
      consider(c, 0, 0, p.crateLove * CARD_VALUE[c.card]);
  shots.sort((x, y) => y.hope - x.hope || x.k - y.k);
  for (const shot of shots.slice(0, p.checks)) {
    if (judge(b, shot) < p.minValue) continue;
    const err = int(m, -p.timingError, p.timingError);
    m.pressTick = view.tick + Math.max(1, shot.k + err);
    return;
  }
}

/**
 * What a shot is worth, predicted from where the gunship coasts to, with the castles led as aimed: 1 for a direct
 * hit, splash partly, times the gates' multipliers, plus the crates it takes.
 */
function judge({ view, m, me, p }: Turn, shot: Shot): number {
  const at = coast(me, shot.k);
  const lead = p.lead * shot.lead;
  const castles = view.castles.map((o) =>
    o.id === me.id
      ? { ...o, x: at.x, y: at.y }
      : { ...o, x: o.x + o.vx * lead, y: o.y + o.vy * lead },
  );
  const future: RoundView = { ...view, tick: view.tick + shot.k, castles };
  let angle = me.angle;
  for (let i = 0; i < shot.k; i++) angle = turnLauncher(angle, view.tuning);
  const path = predictTrajectory(future, me.id, angle, { maxTicks: 180 });
  let mult = 1;
  for (const gate of path.gates) mult *= gate.multiplier;
  const swarm = Math.min(mult, Math.max(1, SWARM_CAP / me.units));
  const { kind, castleId } = path.impact;
  let hit = 0.6 - missBy(future, m, path) / (55 + 20 * swarm); // splash
  if (kind === "castle" || kind === "shield")
    hit = (castleId === m.target ? 1.2 : 1) * (kind === "shield" ? 0.7 : 1);
  let crates = 0;
  for (const c of path.crates) crates += CARD_VALUE[c.card];
  return (
    Math.max(0, hit) * (1 + p.gateLove * (swarm - 1)) + p.crateLove * crates
  );
}

/** How far a predicted impact lands from the nearest opponent: 0 on a castle or shield, Infinity off the rock. */
function missBy(view: RoundView, m: BotMemory, path: Trajectory): number {
  const { kind, x, y } = path.impact;
  if (kind === "castle" || kind === "shield") return 0;
  let miss = Infinity;
  for (const o of view.castles)
    if (kind === "terrain" && o.alive && o.id !== m.id)
      miss = Math.min(miss, hypot(x - o.x, y - o.y));
  return miss;
}

/** At each look, with its `dodge` chance, sidesteps a rocket about to pass within 70 px in the next half second. */
function dodge({ view, m, me, p }: Turn): void {
  if (p.dodge === 0 || view.tick < m.dodgeTick) return;
  for (const r of view.rockets) {
    const [dx, dy] = [me.x - r.x, me.y - r.y];
    if (r.owner === m.id || Math.abs(dx) > 300 || Math.abs(dy) > 300) continue;
    const time = (dx * r.vx + dy * r.vy) / (r.vx * r.vx + r.vy * r.vy);
    const [cx, cy] = [dx - r.vx * time, dy - r.vy * time];
    if (!(time > 0 && time < 0.5) || cx * cx + cy * cy > 70 * 70) continue;
    if (random(m) < p.dodge)
      [m.dodgeBits, m.dodgeTick] = [eight(cx, cy) || UP, view.tick + 18];
    return;
  }
}

/** A knocked-out bot's ghost: fly above a target, where the bomb will fall, and drop when it would hit. */
function ghostInput(b: Turn): number {
  const { view, m, p } = b;
  const g = view.ghosts.find((h) => h.owner === m.id);
  const tick = view.tick;
  if (!g || g.spawnTick > tick) return 0;
  if (!m.ghost) [m.ghost, m.pressTick, m.planTick] = [true, -1, tick];
  if (m.pressTick >= 0) {
    if (tick < m.pressTick) return 0; // coast, as the drop was predicted
    m.pressTick = -1;
    if (g.reloadTicks === 0 && !solidAt(view.terrain, g.x, g.y)) return FIRE;
  }
  if (tick >= m.planTick)
    [m.target, m.planTick] = [pickTarget(b, g), tick + p.planEvery];
  const t = view.castles[m.target];
  if (!t?.alive) {
    m.planTick = tick;
    return 0;
  }
  const lead = p.lead * FALL * DT;
  const over = { x: t.x + t.vx * lead, y: Math.max(60, t.y - HOVER) };
  const look = (tick + m.id * 5) % p.thinkEvery === 0;
  if (
    look &&
    g.reloadTicks <= p.reaction - p.timingError &&
    Math.abs(g.x - over.x) < 160
  ) {
    const drop = predictGhostBomb(view, m.id, p.reaction, 150);
    if (drop && missBy(view, m, drop) < p.ghostSlack) {
      const err = int(m, -p.timingError, p.timingError);
      m.pressTick = tick + Math.max(1, p.reaction + err);
      return 0;
    }
  }
  return drive(g, toward(g, over, GHOST_FLIGHT.topSpeed, 2.5));
}
