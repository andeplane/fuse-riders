import { config } from './config.js';
import { crosses } from './geometry.js';
import { NEUTRAL_INPUT, type TruckInput } from './input.js';
import type { RaceState } from './race.js';
import type { Point, Track } from './track.js';
import { wrapAngle, type Truck } from './truck.js';
import { atan2, cos, hypot, sin } from './deterministic-math.js';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface BotMemory {
  /** Pending steering decisions, oldest first, for the difficulty delay. */
  queue: TruckInput[];
  lateral: number;
  /** Wedge detection: where the truck was a second ago; if it is still there with wall contact, back out until reverseUntilTick. */
  anchorX: number;
  anchorY: number;
  anchorTick: number;
  reverseUntilTick: number;
}

const DELAY: Record<Difficulty, number> = { easy: 6, normal: 3, hard: 0 };
const BRAKE_TAP: Record<Difficulty, number> = { easy: 3, normal: 1, hard: 0 };
const STEER_DEADBAND = (6 * Math.PI) / 180;
const STRAIGHT_CONE = (15 * Math.PI) / 180;
const STRAIGHT_LENGTH = 375;
const SHARP_TURN = (70 * Math.PI) / 180;

export function createBotMemory(seed: number, slot: number): BotMemory {
  const lateral = ((((seed >>> 0) * 7919 + slot * 104729) >>> 0) % 49) - 24;
  return { queue: [], lateral, anchorX: 0, anchorY: 0, anchorTick: 0, reverseUntilTick: 0 };
}

// Waypoints form a closed ring of at least three points (the parser enforces it), so every index taken
// modulo the ring length below names a point that exists.
/** Nearest waypoint segment among `count` segments from `first`, and the distance along it of the projection. */
function closestSegment(wp: Point[], p: Point, first: number, count: number): { i: number; along: number } {
  const n = wp.length;
  let best = first % n, bestAlong = 0, bestD = Infinity;
  for (let k = 0; k < count; k++) {
    const i = (first + k) % n;
    const a = wp[i]!, b = wp[(i + 1) % n]!;
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    if (d < bestD) { bestD = d; best = i; bestAlong = t * Math.sqrt(len2); }
  }
  return { i: best, along: bestAlong };
}

const segmentLength = (wp: Point[], i: number) => { const a = wp[i % wp.length]!, b = wp[(i + 1) % wp.length]!; return hypot(b.x - a.x, b.y - a.y) || 1; };
const tangentOf = (wp: Point[], i: number) => { const a = wp[i % wp.length]!, b = wp[(i + 1) % wp.length]!; return atan2(b.y - a.y, b.x - a.x); };

/** Walk `distance` units forward along the closed polyline from segment `i`; returns the point and its tangent. */
function ahead(wp: Point[], i: number, distance: number): { p: Point; tangent: number } {
  const n = wp.length;
  let perimeter = 0;
  for (let k = 0; k < n; k++) perimeter += segmentLength(wp, k);
  let remaining = distance % perimeter;
  for (let k = 0; k < n; k++) {
    const a = wp[(i + k) % n]!, b = wp[(i + k + 1) % n]!;
    const len = hypot(b.x - a.x, b.y - a.y) || 1;
    if (remaining <= len) {
      const t = remaining / len;
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, tangent: atan2(b.y - a.y, b.x - a.x) };
    }
    remaining -= len;
  }
  return { p: wp[i % n]!, tangent: tangentOf(wp, i) };
}

/** ADR 007 item rules: missile at a truck ahead in the cone, mine at a truck behind, shield when locked, nitro at once. */
function wantsItem(state: RaceState, t: Truck): boolean {
  if (!t.item || state.tick < t.airborneUntilTick) return false;
  const others = state.trucks.filter((o) => o.slot !== t.slot && !o.respawnAtTick && !o.finishedTick && state.tick >= o.invulnerableUntilTick);
  const rel = (o: Truck) => ({ d: hypot(o.x - t.x, o.y - t.y), a: Math.abs(wrapAngle(atan2(o.y - t.y, o.x - t.x) - t.heading)) });
  switch (t.item) {
    case 'missile': return others.some((o) => { const r = rel(o); return (r.d < 500 && r.a < config.items.missile.lockCone) || (r.d < 300 && r.a > Math.PI / 2); });
    case 'mine': case 'oil': return others.some((o) => { const r = rel(o); return r.d < 300 && r.a > Math.PI / 2; });
    case 'shield': return t.lockedUntilTick > state.tick;
    case 'emp': return others.filter((o) => rel(o).d <= config.items.emp.range).length >= 2;
    case 'nitro': case 'drone': return true;
    default: return false;
  }
}

/** Ordinary inputs only (ADR 007). Pure: returns the input and the next memory. */
export function botInput(state: RaceState, slot: number, memory: BotMemory, track: Track, difficulty: Difficulty): [TruckInput, BotMemory] {
  const t = state.trucks[slot]!; // A bot is wired to a slot that this race has a truck for.
  if (state.phase === 'countdown') {
    return [{ ...NEUTRAL_INPUT, nitro: state.tick >= state.countdownEndTick - config.truck.rocketStartWindow }, memory];
  }
  const wp = track.waypoints;
  // Only the stretch of the polyline between the last and the next checkpoint counts, so where the line
  // crosses itself (a bridge) the bot never follows the other level's branch through an under or deck wall.
  const cps = track.checkpoints, n = cps.length;
  // Nearest waypoint to a checkpoint's midpoint; a line through a vertex never strictly crosses a segment.
  const vertexOf = (c: number) => { const m = cps[(c + n) % n]!.mid; let best = 0; wp.forEach((p, i) => { if (hypot(p.x - m.x, p.y - m.y) < hypot(wp[best]!.x - m.x, wp[best]!.y - m.y)) best = i; }); return best; };
  const from = vertexOf(t.checkpoint - 1), to = vertexOf(t.checkpoint);
  const { i: segment, along } = closestSegment(wp, t, (from - 1 + wp.length) % wp.length, ((to - from + wp.length) % wp.length) + 2);
  // Shorten the lookahead until the target is visible, so a hairpin never aims through its inside wall.
  // The sight line is tested at both flanks of the truck too, so a target just past a wall tip is not "visible".
  const flank = 0.8 * config.truck.radius;
  const visible = (p: Point) => {
    const len = hypot(p.x - t.x, p.y - t.y) || 1, ox = (-(p.y - t.y) / len) * flank, oy = ((p.x - t.x) / len) * flank;
    return [0, 1, -1].every((s) => !track.walls.some((w) => !(w.under && t.onBridge) && !(w.deck && !t.onBridge) && crosses({ x: t.x + ox * s, y: t.y + oy * s }, { x: p.x + ox * s, y: p.y + oy * s }, w)));
  };
  let target = t as Point;
  for (let d = Math.max(80, 0.35 * t.speed); d >= 30; d /= 2) {
    const look = ahead(wp, segment, along + d);
    const nx = -sin(look.tangent), ny = cos(look.tangent);
    target = { x: look.p.x + nx * memory.lateral, y: look.p.y + ny * memory.lateral };
    if (visible(target)) break;
  }
  const err = wrapAngle(atan2(target.y - t.y, target.x - t.x) - t.heading);

  const here = tangentOf(wp, segment);
  let straight = true, sharp = false;
  // Lanes are only 115 u apart, so a hairpin arrives quickly: brake when the line turns more than 70 degrees within
  // the distance the truck covers in about half a second.
  const brakeLook = 40 + 0.45 * t.speed;
  for (let k = 1, d = segmentLength(wp, segment) - along; (d < STRAIGHT_LENGTH || d < brakeLook) && k < wp.length; d += segmentLength(wp, segment + k), k++) {
    const turn = Math.abs(wrapAngle(tangentOf(wp, segment + k) - here));
    if (d < STRAIGHT_LENGTH && turn > STRAIGHT_CONE) straight = false;
    if (d < brakeLook && turn > SHARP_TURN) sharp = true;
  }
  const cornerBrake = sharp && t.speed > 0.6 * t.stats.topSpeed;
  const airborneOrSpun = state.tick < t.airborneUntilTick || state.tick < t.spinUntilTick;
  // Wedged against a wall with the throttle on (still within 20 u of where it was a second ago, oscillating included):
  // back out for a second.
  let { anchorX, anchorY, anchorTick, reverseUntilTick } = memory;
  if (state.tick - anchorTick >= 30) {
    const wedged = t.wallTicks >= 30 && hypot(t.x - anchorX, t.y - anchorY) < 20 && !airborneOrSpun;
    if (wedged && state.tick >= reverseUntilTick) reverseUntilTick = state.tick + 30;
    anchorX = t.x; anchorY = t.y; anchorTick = state.tick;
  }
  // Facing the wrong way for a second while pressed against a wall (blocked at a crossing): back out and swing round.
  if (t.wrongWayTicks >= 30 && t.wallTicks >= 10 && state.tick >= reverseUntilTick && !airborneOrSpun) {
    reverseUntilTick = state.tick + 30;
    anchorX = t.x; anchorY = t.y; anchorTick = state.tick;
  }
  const nextMemory = { ...memory, anchorX, anchorY, anchorTick, reverseUntilTick };
  if (state.tick < reverseUntilTick) {
    // Reverse with the nose swinging towards the target (heading turns the same way at any speed), so the
    // truck drives out of the corner rather than back into it.
    const backOut: TruckInput = { ...NEUTRAL_INPUT, brake: true, left: err < -STEER_DEADBAND, right: err > STEER_DEADBAND };
    return [backOut, nextMemory];
  }
  // A drift only ends when both turn buttons are released (ADR 004); countersteering just slows it, so a bot
  // drifting away from its target lets go instead of circling.
  const release = t.driftDir !== 0 && Math.sign(err) !== t.driftDir;
  const decided: TruckInput = {
    ...NEUTRAL_INPUT,
    left: !release && err < -STEER_DEADBAND,
    right: !release && err > STEER_DEADBAND,
    nitro: straight && !airborneOrSpun && t.nitros > 0 && !t.prevNitro && state.tick >= t.nitroUntilTick,
    brake: cornerBrake || (straight && state.tick % 30 < BRAKE_TAP[difficulty]),
    item: wantsItem(state, t),
    // Fire a missile backwards when the threat is behind and nobody is ahead in the cone.
    itemAlt: t.item === 'missile' && !state.trucks.some((o) => o.slot !== t.slot && !o.respawnAtTick && hypot(o.x - t.x, o.y - t.y) < 500 && Math.abs(wrapAngle(atan2(o.y - t.y, o.x - t.x) - t.heading)) < config.items.missile.lockCone),
  };
  const delay = DELAY[difficulty];
  const queue = [...memory.queue, decided].slice(-(delay + 1));
  const input = queue.length > delay ? queue.shift()! : NEUTRAL_INPUT;
  return [input, { ...nextMemory, queue }];
}
