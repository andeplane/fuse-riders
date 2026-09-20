import { BASE_STATS, config, type TruckStats } from './config.js';
import { closestOnSegment, crosses, reaches } from './geometry.js';
import { NEUTRAL_INPUT, type TruckInput } from './input.js';
import { applyHit, rollItem, stepDrones, stepMines, stepMissiles, useItem, type Drone, type Hit, type Mine, type Missile, type OilSlick } from './items.js';
import { createTruck, stepTruck, wrapAngle, type ItemKind, type Truck } from './truck.js';
import { insideAnyBridge, surfaceAt, type Point, type Track } from './track.js';
import { atan2, cos, hypot, sin } from './deterministic-math.js';

export { crosses } from './geometry.js';

export type Phase = 'countdown' | 'racing' | 'finished';

/** Plain JSON race snapshot (ADR 002). */
export interface RaceState {
  tick: number;
  phase: Phase;
  rngState: number;
  trackName: string;
  trucks: Truck[];
  countdownEndTick: number;
  raceEndTick: number;
  /** Slots ordered by placement, best first. */
  placements: number[];
  missiles: Missile[];
  mines: Mine[];
  oils: OilSlick[];
  drones: Drone[];
  /** Per box, per slot: tick until which that box is inert for that truck; flat [box * slots + slot]. */
  boxCooldowns: number[];
  /** Whether each slot held the item button last tick, for edge detection. */
  itemHeld: boolean[];
  nextId: number;
}

export type RaceEvent =
  | { tick: number; type: 'lap'; slot: number; lap: number }
  | { tick: number; type: 'finish'; slot: number; place: number }
  | { tick: number; type: 'wrongWay'; slot: number }
  | { tick: number; type: 'wall'; slot: number }
  | { tick: number; type: 'land'; slot: number }
  | { tick: number; type: 'start' }
  | { tick: number; type: 'pickup'; slot: number; item: ItemKind }
  | { tick: number; type: 'fire'; slot: number; item: ItemKind }
  | { tick: number; type: 'hit'; slot: number; by: number; item: ItemKind | 'landing'; absorbed: boolean }
  | { tick: number; type: 'kill'; slot: number; by: number };

export interface StepResult { state: RaceState; events: RaceEvent[] }

export function createRace(track: Track, seed: number, stats: TruckStats[] = [BASE_STATS]): RaceState {
  const trucks = stats.map((s, i) => {
    const sp = track.spawns[i];
    return createTruck(i, sp.x, sp.y, sp.heading, s);
  });
  return {
    tick: 0, phase: 'countdown', rngState: seed >>> 0, trackName: track.name, trucks, countdownEndTick: config.countdownTicks, raceEndTick: 0,
    placements: trucks.map((t) => t.slot), missiles: [], mines: [], oils: [], drones: [], boxCooldowns: Array(track.items.length * trucks.length).fill(0), itemHeld: trucks.map(() => false), nextId: 1,
  };
}

const dot = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by;

function resolveWalls(t: Truck, from: Point, track: Track, wasTouching: boolean): [Truck, boolean] {
  const r = config.truck.radius;
  let x = t.x, y = t.y, touched = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const w of track.walls) {
      if ((w.under && t.onBridge) || (w.deck && !t.onBridge)) continue;
      const ex = w.b.x - w.a.x, ey = w.b.y - w.a.y;
      const startSide = Math.sign(ex * (from.y - w.a.y) - ey * (from.x - w.a.x)) || 1;
      const c = closestOnSegment({ x, y }, w);
      const dx = x - c.x, dy = y - c.y;
      const d = hypot(dx, dy);
      const tunneled = crosses(from, { x, y }, w);
      if (d >= r && !tunneled) continue;
      touched = true;
      const len = hypot(ex, ey) || 1;
      const nx = (-ey / len) * startSide, ny = (ex / len) * startSide;
      // Snap back to the start side only when the path really crossed this segment. Crossing just the infinite line beside a
      // short segment (the sharp tip of a hairpin barrier) would otherwise throw the truck through the neighbouring segments.
      if (tunneled || d < 1e-9) { x = c.x + nx * r; y = c.y + ny * r; continue; }
      x += (dx / d) * (r - d);
      y += (dy / d) * (r - d);
    }
  }
  // The 4-unit strip below the map and anything outside it counts as wall (ADR 003).
  const maxX = track.cols * track.tile, maxY = track.rows * track.tile;
  if (x < r || y < r || x > maxX - r || y > maxY - r) {
    touched = true;
    x = Math.max(r, Math.min(maxX - r, x));
    y = Math.max(r, Math.min(maxY - r, y));
  }
  if (!touched) return [t.x === x && t.y === y ? t : { ...t, x, y }, false];
  const speed = t.speed * (wasTouching ? config.truck.wallSlideTick : config.truck.wallFirstHit);
  return [{ ...t, x, y, speed }, true];
}

function resolveContacts(trucks: Truck[]): Truck[] {
  const out = trucks.slice();
  const r2 = config.truck.radius * 2;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (a.respawnAtTick || b.respawnAtTick || a.finishedTick || b.finishedTick || a.onBridge !== b.onBridge) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = hypot(dx, dy);
      if (d >= r2) continue;
      const nx = d < 1e-9 ? 1 : dx / d, ny = d < 1e-9 ? 0 : dy / d;
      const push = r2 - d;
      const total = a.stats.mass + b.stats.mass;
      const aShare = b.stats.mass / total, bShare = a.stats.mass / total;
      out[i] = { ...a, x: a.x - nx * push * aShare, y: a.y - ny * push * aShare };
      out[j] = { ...b, x: b.x + nx * push * bShare, y: b.y + ny * push * bShare };
    }
  }
  return out;
}

function applySurface(t: Truck, track: Track, tick: number, events: RaceEvent[], oils: OilSlick[]): Truck {
  const c = config.truck;
  const kind = surfaceAt(track, t.x, t.y);
  const airborne = tick < t.airborneUntilTick;
  let n = t;
  if (n.landAtTick === tick) {
    n = { ...n, speed: n.speed * n.stats.landingMul, landAtTick: 0 };
    events.push({ tick, type: 'land', slot: n.slot });
  }
  if (airborne) return n;
  if (oils.some((o) => hypot(o.x - t.x, o.y - t.y) <= config.items.oil.radius)) n = { ...n, oilUntilTick: tick + c.oilTicks };
  if (kind !== 'toxic' && n.toxicNextTick) n = { ...n, toxicNextTick: 0 };
  switch (kind) {
    case 'oil': return { ...n, oilUntilTick: tick + c.oilTicks };
    case 'boost': return { ...n, padUntilTick: tick + c.boostPadTicks };
    case 'ramp': {
      const frac = Math.max(0, Math.min(1, n.speed / n.stats.topSpeed));
      const until = tick + c.airborneBase + Math.round(c.airborneSpeedTicks * frac);
      return { ...n, airborneUntilTick: until, landAtTick: until };
    }
    case 'mogul': return { ...n, airborneUntilTick: tick + c.mogulHopTicks };
    case 'toxic': {
      if (tick < n.toxicNextTick) return n;
      return { ...n, armor: Math.max(1, n.armor - 1), toxicNextTick: tick + c.toxicIntervalTicks };
    }
    default: return n;
  }
}

/** Entering a bridge rectangle across its entry side sets onBridge; leaving the rectangle clears it (ADR 003). */
function updateBridge(t: Truck, prev: Truck, track: Track): Truck {
  let onBridge = t.onBridge;
  for (const b of track.bridges) {
    const inside = t.x >= b.x0 && t.x <= b.x1 && t.y >= b.y0 && t.y <= b.y1;
    const wasInside = prev.x >= b.x0 && prev.x <= b.x1 && prev.y >= b.y0 && prev.y <= b.y1;
    if (inside && !wasInside) {
      const fromEntry = (b.entry === 'left' && prev.x < b.x0) || (b.entry === 'right' && prev.x > b.x1) || (b.entry === 'top' && prev.y < b.y0) || (b.entry === 'bottom' && prev.y > b.y1);
      if (fromEntry) onBridge = true;
    } else if (!inside && wasInside) onBridge = false;
  }
  return onBridge === t.onBridge ? t : { ...t, onBridge };
}

/** Unit tangent of the nearest waypoint segment: the direction the track is meant to be driven here. */
export function trackDirectionAt(track: Track, p: Point): Point {
  const wp = track.waypoints;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < wp.length; i++) {
    const c = closestOnSegment(p, { a: wp[i], b: wp[(i + 1) % wp.length] });
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  const a = wp[best], b = wp[(best + 1) % wp.length];
  const len = hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

export function progressOf(t: Truck, track: Track): number {
  const n = track.checkpoints.length;
  const next = track.checkpoints[t.checkpoint];
  const last = track.checkpoints[(t.checkpoint - 1 + n) % n];
  const span = hypot(next.mid.x - last.mid.x, next.mid.y - last.mid.y) || 1;
  const d = Math.max(0, Math.min(1, hypot(next.mid.x - t.x, next.mid.y - t.y) / span));
  return t.laps * n + t.checkpoint + (1 - d);
}

function applyCheckpoints(prev: Truck, t: Truck, track: Track, tick: number, events: RaceEvent[], state: RaceState): Truck {
  const n = track.checkpoints.length;
  let n2 = t;
  if (!t.finishedTick) {
    const cp = track.checkpoints[t.checkpoint];
    if (reaches({ x: prev.x, y: prev.y }, { x: t.x, y: t.y }, cp)) {
      if (t.checkpoint === n - 1) {
        const laps = t.laps + 1;
        n2 = { ...t, laps, checkpoint: 0 };
        events.push({ tick, type: 'lap', slot: t.slot, lap: laps });
        if (state.placements[0] === t.slot) n2 = { ...n2, lapsLed: n2.lapsLed + 1 };
        if (laps >= config.laps) n2 = { ...n2, finishedTick: tick };
      } else {
        n2 = { ...t, checkpoint: t.checkpoint + 1 };
      }
    }
  }
  const along = trackDirectionAt(track, n2);
  const facing = dot(cos(n2.heading), sin(n2.heading), along.x, along.y);
  const wrongWayTicks = facing < 0 && !n2.finishedTick ? n2.wrongWayTicks + 1 : 0;
  if (wrongWayTicks === config.truck.wrongWayTicks) events.push({ tick, type: 'wrongWay', slot: n2.slot });
  return { ...n2, wrongWayTicks, progress: progressOf(n2, track) };
}

export function respawnPose(t: Truck, track: Track): { x: number; y: number; heading: number } {
  const n = track.checkpoints.length;
  const last = track.checkpoints[(t.checkpoint - 1 + n) % n];
  const next = track.checkpoints[t.checkpoint];
  return { x: last.mid.x, y: last.mid.y, heading: atan2(next.mid.y - last.mid.y, next.mid.x - last.mid.x) };
}

function rank(trucks: Truck[]): number[] {
  return trucks
    .slice()
    .sort((a, b) => {
      if (a.finishedTick && b.finishedTick) return a.finishedTick - b.finishedTick || a.slot - b.slot;
      if (a.finishedTick !== b.finishedTick) return a.finishedTick ? -1 : 1;
      return b.progress - a.progress || a.slot - b.slot;
    })
    .map((t) => t.slot);
}

/** One deterministic tick (ADR 002). Never mutates `state`. */
export function step(state: RaceState, inputs: readonly TruckInput[], track: Track): StepResult {
  const tick = state.tick + 1;
  const events: RaceEvent[] = [];
  const c = config.truck;
  let rng = state.rngState;

  if (state.phase === 'countdown') {
    const trucks = state.trucks.map((t, i) => {
      const input = inputs[i] ?? NEUTRAL_INPUT;
      const armed = input.nitro && !t.prevNitro && tick > state.countdownEndTick - c.rocketStartWindow;
      return { ...t, prevNitro: input.nitro, boostUntilTick: armed ? state.countdownEndTick + c.boostTicks : t.boostUntilTick };
    });
    if (tick >= state.countdownEndTick) events.push({ tick, type: 'start' });
    return { state: { ...state, tick, trucks, phase: tick >= state.countdownEndTick ? 'racing' : 'countdown' }, events };
  }

  const prev = state.trucks;
  let trucks = prev.map((t, i) => {
    if (t.finishedTick) return t.speed === 0 ? t : { ...t, speed: 0 };
    if (t.respawnAtTick) {
      if (tick < t.respawnAtTick) return t;
      const pose = respawnPose(t, track);
      return { ...t, ...pose, speed: 0, respawnAtTick: 0, respawnedTick: tick, armor: t.stats.maxArmor, invulnerableUntilTick: tick + c.invulnerableTicks, item: null, shieldUntilTick: 0, spinUntilTick: 0, airborneUntilTick: 0, landAtTick: 0, oilUntilTick: 0, nitroUntilTick: 0, boostUntilTick: 0, padUntilTick: 0, driftDir: 0 as const, driftTicks: 0, onBridge: false };
    }
    const input = inputs[i] ?? NEUTRAL_INPUT;
    const surface = surfaceAt(track, t.x, t.y);
    const [moved, r] = stepTruck(t, input, surface, tick, rng);
    rng = r;
    return moved;
  });

  const parked = (t: Truck) => t.respawnAtTick !== 0 || t.finishedTick !== 0;
  // A respawn is a teleport, not a movement: its chord must not be treated as tunnelling.
  const from = (t: Truck, i: number): Point => (t.respawnedTick === tick ? t : prev[i]);
  trucks = trucks.map((t, i) => {
    if (parked(t)) return t;
    const [resolved, touching] = resolveWalls(t, from(t, i), track, prev[i].wallTicks > 0);
    if (touching && prev[i].wallTicks === 0) events.push({ tick, type: 'wall', slot: t.slot });
    return { ...resolved, wallTicks: touching ? prev[i].wallTicks + 1 : 0 };
  });
  trucks = resolveContacts(trucks);
  // Contacts can push a truck into a wall; settle position again without a second speed penalty.
  trucks = trucks.map((t, i) => (parked(t) ? t : { ...resolveWalls(t, from(t, i), track, true)[0], speed: t.speed }));
  // Bridge level is decided from the committed position, so walls resolve with last tick's level (review of ADR 003).
  trucks = trucks.map((t, i) => (parked(t) ? t : updateBridge(t, prev[i], track)));

  // Step 4: item use on a press edge, then projectiles, then hits in launch order (ADR 005).
  let world = { missiles: state.missiles, mines: state.mines, oils: state.oils.filter((o) => tick - o.droppedTick <= config.items.oil.lifeTicks), drones: state.drones, nextId: state.nextId };
  const itemHeld = trucks.map((t, i) => (inputs[i] ?? NEUTRAL_INPUT).item);
  for (let i = 0; i < trucks.length; i++) {
    const t = trucks[i];
    if (parked(t) || !itemHeld[i] || state.itemHeld[i] || !t.item) continue;
    const item = t.item;
    const r = useItem(t, (inputs[i] ?? NEUTRAL_INPUT).itemAlt, trucks, world, tick, track);
    world = { missiles: r.missiles, mines: r.mines, oils: r.oils, drones: r.drones, nextId: r.nextId };
    trucks[i] = r.truck;
    events.push({ tick, type: 'fire', slot: t.slot, item });
    if (r.lockedSlot !== null) trucks[r.lockedSlot] = { ...trucks[r.lockedSlot], lockedUntilTick: tick + config.items.missile.lifeTicks };
    for (const s of r.stunned) {
      const o = trucks[s];
      if (tick < o.shieldUntilTick) { trucks[s] = { ...o, shieldUntilTick: 0 }; events.push({ tick, type: 'hit', slot: s, by: t.slot, item: 'emp', absorbed: true }); continue; }
      trucks[s] = { ...o, stunUntilTick: tick + config.items.emp.stunTicks, item: null, driftDir: 0, driftTicks: 0 };
      events.push({ tick, type: 'hit', slot: s, by: t.slot, item: 'emp', absorbed: false });
    }
  }
  const mv = stepMissiles(world.missiles, trucks, track, tick);
  const mn = stepMines(world.mines, trucks, tick);
  const dr = stepDrones(world.drones, trucks, tick);
  const missiles = mv.missiles, mines = mn.mines, oils = world.oils, drones = dr.drones, nextId = world.nextId;
  const hits: Hit[] = [...mv.hits, ...mn.hits, ...dr.hits].sort((a, b) => a.id - b.id);
  for (const h of hits) {
    const before = trucks[h.slot];
    if (before.respawnAtTick) continue;
    const r = applyHit(before, tick, h.item);
    trucks[h.slot] = r.truck;
    events.push({ tick, type: 'hit', slot: h.slot, by: h.by, item: h.item, absorbed: r.absorbed });
    if (r.killed) {
      events.push({ tick, type: 'kill', slot: h.slot, by: h.by });
      if (h.by !== h.slot) trucks[h.by] = { ...trucks[h.by], kills: trucks[h.by].kills + 1 };
    }
  }
  // A missile whose target died or was consumed loses its lock display.
  trucks = trucks.map((t) => (t.lockedUntilTick && !missiles.some((m) => m.target === t.slot) ? { ...t, lockedUntilTick: 0 } : t));

  trucks = trucks.map((t) => (parked(t) ? t : applySurface(t, track, tick, events, oils)));
  // Landing within 28 u of another truck spins that truck out (ADR 004).
  const landers = trucks.filter((t) => !parked(t) && prev[t.slot].landAtTick === tick);
  if (landers.length) {
    trucks = trucks.map((o) => {
      if (parked(o) || tick < o.invulnerableUntilTick || tick < o.spinUntilTick) return o;
      const hit = landers.some((l) => l.slot !== o.slot && l.onBridge === o.onBridge && hypot(l.x - o.x, l.y - o.y) <= config.truck.landingSpinRadius + 0.5);
      if (!hit) return o;
      events.push({ tick, type: 'hit', slot: o.slot, by: -1, item: 'landing', absorbed: false });
      return { ...o, spinUntilTick: tick + config.truck.spinOutTicks, speed: o.speed * config.truck.spinOutSpeedMul, driftDir: 0, driftTicks: 0 };
    });
  }

  // Step 6: item boxes, rolled in slot order; boxes are never consumed, each truck has a per-box cooldown.
  const boxCooldowns = state.boxCooldowns.slice();
  const slots = trucks.length;
  trucks = trucks.map((t, i) => {
    if (parked(t) || t.item) return t;
    const b = track.items.findIndex((box, k) => tick >= boxCooldowns[k * slots + i] && hypot(box.x - t.x, box.y - t.y) < config.truck.radius + config.items.boxRadius);
    if (b < 0) return t;
    const position = state.placements.indexOf(t.slot) + 1;
    const [item, next] = rollItem(position, slots, rng);
    rng = next;
    boxCooldowns[b * slots + i] = tick + config.items.boxCooldownTicks;
    events.push({ tick, type: 'pickup', slot: t.slot, item });
    return { ...t, item };
  });
  // A respawn teleport is not a crossing: compare the truck with itself so the chord has zero length.
  trucks = trucks.map((t, i) => (parked(t) ? t : applyCheckpoints(t.respawnedTick === tick ? t : prev[i], t, track, tick, events, state)));

  const placements = rank(trucks);
  let raceEndTick = state.raceEndTick;
  for (const t of trucks) {
    if (t.finishedTick === tick) {
      events.push({ tick, type: 'finish', slot: t.slot, place: placements.indexOf(t.slot) + 1 });
      if (!raceEndTick) raceEndTick = tick + config.raceEndGraceTicks;
    }
  }
  const allDone = trucks.every((t) => t.finishedTick);
  const phase: Phase = allDone || (raceEndTick && tick >= raceEndTick) ? 'finished' : 'racing';
  const heading = trucks.map((t) => wrapAngle(t.heading));
  trucks = trucks.map((t, i) => (t.heading === heading[i] ? t : { ...t, heading: heading[i] }));

  return { state: { ...state, tick, rngState: rng, trucks, placements, raceEndTick, phase, missiles, mines, oils, drones, boxCooldowns, itemHeld, nextId }, events };
}
