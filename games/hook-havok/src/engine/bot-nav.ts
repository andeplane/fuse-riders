/**
 * Bot navigation (11C): a graph of ledge-to-ledge moves for one map and its
 * movement tuning, and the pilot that flies them. The graph is found, not
 * drawn: when a map is first used, every plausible move is flown by this same
 * pilot through the real keeper step, and only the moves that land are kept.
 * Everything here is a pure function of the map, the tuning and the keeper,
 * using the engine's own arithmetic (+, −, ×, ÷, sqrt and rounding), so every
 * peer builds the same graph and steers the same way.
 */
import { MAPS, type Platform } from "./maps.js";
import {
  BODY,
  HALF,
  HEIGHT,
  NEUTRAL,
  ROPE_MIN,
  S,
  WIDTH,
  createWorld,
  type Input,
  type Tuning,
  type World,
} from "./world.js";
import { step } from "./step.js";
import { sweep } from "./collision.js";

/** Run and jump, walk off an edge, drop through the ledge, or hook and climb. */
export const JUMP = 1,
  FALL = 2,
  DROP = 3,
  HOOK = 4;
export type EdgeKind = typeof JUMP | typeof FALL | typeof DROP | typeof HOOK;
export interface Edge {
  from: number;
  to: number;
  kind: EdgeKind;
  /** Launch point on `from`, world units, and the run-up direction (0: from a standstill). */
  x: number;
  dir: -1 | 0 | 1;
  /** Where a HOOK edge aims, world units. */
  ax: number;
  ay: number;
  /** Measured ticks from a standing launch to landing on `to`. */
  cost: number;
}
export interface NavGraph {
  edges: readonly Edge[];
  /** Edge indices leaving each ledge. */
  out: readonly (readonly number[])[];
  /** Shortest ticks from ledge to ledge (Infinity when unreachable). */
  dist: readonly (readonly number[])[];
}
/** The pilot's own memory; a bot's mind holds it in checkpointed state. */
export interface Course {
  /** The edge being flown, or −1. */
  edge: number;
  /** The ledge a rescue aims for when no edge is being flown, or −1. */
  hop: number;
  /** What the hook is doing: nothing, climbing, or striking (the caller's). */
  task: number;
}
export const TASK_NONE = 0,
  TASK_HOOK = 1,
  TASK_STRIKE = 2;
/** At most this many edges; the checkpoint bounds an edge index by the real count. */
export const MAX_EDGES = 1024;
/** Edges kept per ordered pair of ledges. */
const PER_PAIR = 2;
const TRIAL_TICKS = 240;

/** Keeper motion constants in subunits per tick, as `step` derives them. */
export interface Physics {
  gravity: number;
  run: number;
  air: number;
  ground: number;
  cap: number;
  range: number;
}
export function physics(t: Tuning): Physics {
  return {
    gravity: Math.round((t.gravity * S) / 3600),
    run: Math.round((t.speed * S) / 60),
    air: Math.round(((2600 * S) / 3600) * (t.air / 100)),
    ground: Math.round((2600 * S) / 3600),
    cap: Math.round((1000 * S) / 60),
    range: t.range * S,
  };
}
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const sign = (v: number): -1 | 0 | 1 => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const chestOf = (w: Pick<World, "feet">) =>
  w.feet - Math.round(BODY * 0.6);

/** The ledge a grounded keeper stands on (lowest index first), or −1. */
export function standingOn(
  w: Pick<World, "x" | "feet" | "grounded">,
  platforms: readonly Platform[],
): number {
  if (!w.grounded) return -1;
  for (let i = 0; i < platforms.length; i++) {
    const [px, py, width] = platforms[i]!;
    if (
      Math.abs(w.feet - py * S) <= 1 &&
      w.x + HALF > px * S &&
      w.x - HALF < (px + width) * S
    )
      return i;
  }
  return -1;
}

/**
 * Whether a keeper in the air can still land on `target` without another
 * jump, steering its hardest either way; with −1, the first ledge it could
 * land on. Returns the ledge, or −1 when the fall ends in the void.
 */
export function landing(
  w: Pick<World, "x" | "feet" | "vx" | "vy">,
  platforms: readonly Platform[],
  ph: Physics,
  target = -1,
): number {
  let feet = w.feet,
    vy = w.vy,
    lo = w.x,
    hi = w.x,
    lv = w.vx,
    hv = w.vx;
  for (let t = 0; t < 180 && feet - BODY <= HEIGHT * S; t++) {
    vy = Math.min(ph.cap, vy + ph.gravity);
    // Air steering never brakes a keeper already faster the held way.
    lv = lv > -ph.run ? Math.max(-ph.run, lv - ph.air) : lv;
    hv = hv < ph.run ? Math.min(ph.run, hv + ph.air) : hv;
    const next = feet + vy;
    if (vy > 0) {
      let best = -1,
        first = Infinity;
      for (let i = 0; i < platforms.length; i++) {
        if (target >= 0 && i !== target) continue;
        const [px, py, width] = platforms[i]!,
          top = py * S;
        if (top < feet || top > next) continue;
        const time = (top - feet) / vy;
        if (
          time < first &&
          hi + hv * time + HALF > px * S &&
          lo + lv * time - HALF < (px + width) * S
        ) {
          best = i;
          first = time;
        }
      }
      if (best >= 0) return best;
    }
    lo = Math.max(HALF, lo + lv);
    hi = Math.min(WIDTH * S - HALF, hi + hv);
    feet = next;
  }
  return -1;
}

/** Air steering onto a ledge: toward a point 36 units inside it, then brake. */
function toward(w: World, p: Platform): -1 | 0 | 1 {
  const [px, , width] = p,
    tx = clamp(w.x, (px + 36) * S, (px + width - 36) * S),
    dx = tx - w.x;
  if (Math.abs(dx) > 12 * S) return sign(dx);
  return Math.abs(w.vx) > 2 * S ? (sign(-w.vx) as -1 | 1) : 0;
}
/** Ground walking to `tx` (subunits), coasting to a stop at the ground's braking. */
export function walk(w: World, tx: number, ph: Physics): -1 | 0 | 1 {
  const dx = tx - w.x;
  if (Math.abs(dx) <= 4 * S) return 0;
  const stopping = (w.vx * w.vx) / (2 * ph.ground);
  if (w.vx * dx > 0 && stopping >= Math.abs(dx) - 2 * S) return 0;
  return sign(dx);
}
/** A fresh press needs the button up on the step before it. */
const press = (held: boolean) => !held;

/**
 * A hook anchor above the keeper that a straight shot reaches first and whose
 * rope would still hold after the fall while the hook flies: the ledge, and the
 * aim point in subunits.
 */
export function anchor(
  w: Pick<World, "x" | "feet" | "vx" | "vy">,
  platforms: readonly Platform[],
  ph: Physics,
  prefer = -1,
): { p: number; x: number; y: number } | undefined {
  const sx = w.x,
    sy = chestOf(w);
  let best: { p: number; x: number; y: number } | undefined,
    score = Infinity;
  for (let i = 0; i < platforms.length; i++) {
    const [px, py, width, height] = platforms[i]!,
      ax = clamp(sx, (px + 14) * S, (px + width - 14) * S),
      ay = Math.round((py + height / 2) * S);
    if (ay > sy - 40 * S) continue;
    const dx = ax - sx,
      dy = ay - sy,
      d = Math.sqrt(dx * dx + dy * dy);
    if (d > ph.range - 24 * S) continue;
    // The keeper keeps falling while the hook flies at 32 units a tick.
    const t = d / (32 * S),
      fx = ax - (sx + w.vx * t),
      fy = ay - (sy + w.vy * t + (ph.gravity * t * t) / 2);
    if (Math.sqrt(fx * fx + fy * fy) > ph.range - 16 * S) continue;
    const hit = sweep(sx, sy, dx, dy, false, platforms);
    if (!hit || hit.platform !== i) continue;
    const value = d - (i === prefer ? 200 * S : 0);
    if (value < score) {
      best = { p: i, x: ax, y: ay };
      score = value;
    }
  }
  return best;
}

/**
 * One log tick of flying a course: follow `edges[course.edge]` from its ledge,
 * steer onto its landing ledge in the air (double jumping when a fall comes up
 * short), climb a hooked rope with a rope jump, and hook an anchor above when
 * nothing below can be reached. Mutates `course`; the caller owns arrivals.
 */
export function pilot(
  w: World,
  course: Course,
  edges: readonly Edge[],
  platforms: readonly Platform[],
  ph: Physics,
): Input {
  const input: Input = { ...NEUTRAL, aimX: w.input.aimX, aimY: w.input.aimY },
    h = w.hook,
    here = standingOn(w, platforms),
    e = course.edge >= 0 ? edges[course.edge] : undefined;
  if (course.task === TASK_HOOK) {
    if (h.phase === "flying") {
      input.fire = true;
      return input;
    }
    if (h.phase === "attached") {
      const dx = h.x - w.x,
        dy = h.y - chestOf(w),
        close = Math.sqrt(dx * dx + dy * dy) <= (ROPE_MIN + 20) * S;
      if (close && here >= 0) {
        // Reeled in on a ledge: let go.
        course.task = TASK_NONE;
        return input;
      }
      input.fire = true;
      // Reeled in: leave the rope with a jump, which also restores the air jump.
      if (close) input.jump = press(w.input.jump);
      return input;
    }
    course.task = TASK_NONE;
  }
  if (here >= 0) {
    if (!e || e.from !== here) return input;
    if (h.phase === "attached") return input; // let a stray rope go
    const launch = e.x * S,
      dx = launch - w.x;
    if (e.kind === FALL) {
      input.move = e.dir;
      return input;
    }
    if (e.kind === JUMP && e.dir) {
      const past = (w.x - launch) * e.dir;
      if (past < -10 * S || w.vx * e.dir < 0) input.move = e.dir;
      else if (past > 40 * S) input.move = -e.dir as -1 | 1;
      else {
        input.move = e.dir;
        input.jump = press(w.input.jump);
      }
      return input;
    }
    if (Math.abs(dx) > 10 * S) {
      input.move = walk(w, launch, ph);
      return input;
    }
    if (e.kind === JUMP) input.jump = press(w.input.jump);
    else if (e.kind === DROP) input.drop = press(w.input.drop);
    else if (h.phase === "ready" && !w.input.fire) {
      input.fire = true;
      input.aimX = e.ax;
      input.aimY = e.ay;
      course.task = TASK_HOOK;
    }
    return input;
  }
  // In the air: rise on a held jump, steer onto the target ledge.
  input.jump = w.vy < 0 && w.input.jump;
  const target = e ? e.to : course.hop;
  if (target >= 0 && landing(w, platforms, ph, target) >= 0) {
    input.move = toward(w, platforms[target]!);
    return input;
  }
  if (target < 0) {
    const below = landing(w, platforms, ph);
    if (below >= 0) {
      course.hop = below;
      input.move = toward(w, platforms[below]!);
      return input;
    }
  }
  // Short of the target, or over the void. With the air jump left: at the top
  // of the rise, let go and jump again.
  if (w.airJump) {
    const aim = target >= 0 ? target : (anchor(w, platforms, ph)?.p ?? -1);
    if (aim >= 0) input.move = toward(w, platforms[aim]!);
    if (w.vy >= 0) input.jump = press(w.input.jump);
    return input;
  }
  // No jump left: land anywhere that can still be reached.
  const other = landing(w, platforms, ph);
  if (other >= 0) {
    course.edge = -1;
    course.hop = other;
    input.move = toward(w, platforms[other]!);
    return input;
  }
  // Nothing below: hook an anchor above and climb.
  const a = anchor(w, platforms, ph, target);
  if (a) input.move = toward(w, platforms[a.p]!);
  if (a && h.phase === "ready" && !w.input.fire) {
    input.fire = true;
    input.aimX = Math.round(a.x / S);
    input.aimY = Math.round(a.y / S);
    course.task = TASK_HOOK;
    course.edge = -1;
    course.hop = a.p;
  }
  return input;
}

/** Arrival bookkeeping, then `pilot`: the one routine both the graph trials and the bots fly. */
export function drive(
  w: World,
  course: Course,
  edges: readonly Edge[],
  platforms: readonly Platform[],
  ph: Physics,
): Input {
  const here = standingOn(w, platforms);
  if (here >= 0) {
    const e = course.edge >= 0 ? edges[course.edge] : undefined;
    if (!e || here !== e.from) course.edge = -1;
    course.hop = -1;
  }
  return pilot(w, course, edges, platforms, ph);
}

function trial(
  tuning: Tuning,
  platforms: readonly Platform[],
  ph: Physics,
  e: Edge,
  startX: number,
): number {
  const w = createWorld(tuning, 0);
  Object.assign(w, {
    x: Math.round(startX * S),
    feet: platforms[e.from]![1] * S - 1,
    vx: 0,
    vy: 0,
    grounded: true,
  });
  const course: Course = { edge: 0, hop: -1, task: TASK_NONE },
    list = [e];
  let left = false;
  for (let t = 0; t < TRIAL_TICKS; t += 3) {
    const here = standingOn(w, platforms);
    if (here === e.to) return t;
    if (w.respawn || w.deaths) return -1;
    if (here >= 0 && here !== e.from) return -1;
    if (here < 0) left = true;
    else if (left) return -1;
    w.input = drive(w, course, list, platforms, ph);
    for (let s = 0; s < 3; s++) step(w);
  }
  return -1;
}
/** Candidate moves from ledge a to ledge b, grouped by preference. */
function candidates(
  platforms: readonly Platform[],
  a: number,
  b: number,
): Edge[][] {
  const [ax, ay, aw] = platforms[a]!,
    [bx, by, bw, bh] = platforms[b]!,
    gap = Math.max(0, bx - (ax + aw), ax - (bx + bw));
  if (gap > 640 || ay - by > 600) return [];
  const side: -1 | 1 = bx + bw / 2 >= ax + aw / 2 ? 1 : -1,
    edgeX = side > 0 ? ax + aw - 20 : ax + 20,
    lo = Math.max(ax, bx) + 20,
    hi = Math.min(ax + aw, bx + bw) - 20,
    mid = hi >= lo ? Math.round((lo + hi) / 2) : undefined;
  const make = (kind: EdgeKind, x: number, dir: -1 | 0 | 1, hx = 0, hy = 0) =>
    ({ from: a, to: b, kind, x, dir, ax: hx, ay: hy, cost: 0 }) as Edge;
  const hook = (x: number) =>
    make(
      HOOK,
      x,
      0,
      Math.round(clamp(x, bx + 14, bx + bw - 14)),
      Math.round(by + bh / 2),
    );
  if (by < ay - 8)
    return [
      [
        ...(mid === undefined ? [] : [make(JUMP, mid, 0)]),
        make(JUMP, edgeX, side),
      ],
      [...(mid === undefined ? [] : [hook(mid)]), hook(edgeX)],
    ];
  if (by > ay + 8)
    return [
      [
        ...(mid === undefined ? [] : [make(DROP, mid, 0)]),
        make(FALL, edgeX, side),
        make(JUMP, edgeX, side),
      ],
    ];
  return [[make(JUMP, edgeX, side)]];
}
/** Kept only if it lands from a run-up and from a standstill at the launch point. */
function verify(
  tuning: Tuning,
  platforms: readonly Platform[],
  ph: Physics,
  e: Edge,
): number {
  const [px, , width] = platforms[e.from]!,
    inside = (x: number) => clamp(x, px + 18, px + width - 18),
    starts = e.dir ? [e.x - e.dir * 60, e.x] : [e.x - 50, e.x + 50];
  let cost = -1;
  for (const start of starts) {
    const ticks = trial(tuning, platforms, ph, e, inside(start));
    if (ticks < 0) return -1;
    cost = Math.max(cost, ticks);
  }
  return cost;
}
function build(tuning: Tuning): NavGraph {
  const platforms = MAPS[tuning.map].platforms,
    ph = physics(tuning),
    sim: Tuning = {
      ...tuning,
      experiment: "movement",
      bomb: "off",
      powerUps: "off",
    },
    edges: Edge[] = [];
  for (let a = 0; a < platforms.length; a++)
    for (let b = 0; b < platforms.length; b++) {
      if (a === b) continue;
      const found: Edge[] = [];
      for (const group of candidates(platforms, a, b)) {
        for (const c of group) {
          const cost = verify(sim, platforms, ph, c);
          if (cost >= 0) found.push({ ...c, cost });
        }
        if (found.length) break;
      }
      found.sort((p, q) => p.cost - q.cost || p.x - q.x);
      for (const e of found.slice(0, PER_PAIR))
        if (edges.length < MAX_EDGES) edges.push(e);
    }
  const n = platforms.length,
    out = platforms.map(() => [] as number[]),
    dist = platforms.map((_, i) =>
      platforms.map((__, j) => (i === j ? 0 : Infinity)),
    ),
    run = ph.run / S;
  edges.forEach((e, i) => {
    out[e.from]!.push(i);
    const [px, , width] = platforms[e.from]!,
      w = e.cost + Math.abs(e.x - (px + width / 2)) / run;
    if (w < dist[e.from]![e.to]!) dist[e.from]![e.to] = w;
  });
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const via = dist[i]![k]! + dist[k]![j]!;
        if (via < dist[i]![j]!) dist[i]![j] = via;
      }
  return { edges, out, dist };
}
const graphs = new Map<string, NavGraph>();
/** The graph for a map and the movement tuning it is flown with; built once per peer. */
export function navGraph(t: Tuning): NavGraph {
  const key = JSON.stringify([
    t.map,
    t.speed,
    t.jump,
    t.gravity,
    t.air,
    t.pull,
    t.range,
    t.jumpMode,
  ]);
  let graph = graphs.get(key);
  if (!graph) {
    graph = build(t);
    if (graphs.size >= 16) graphs.clear();
    graphs.set(key, graph);
  }
  return graph;
}
/** The cheapest edge from ledge `here` at x (subunits) toward `goal`, or −1. */
export function nextEdge(
  graph: NavGraph,
  here: number,
  x: number,
  goal: number,
  ph: Physics,
): number {
  let best = -1,
    cost = Infinity;
  for (const i of graph.out[here] ?? []) {
    const e = graph.edges[i]!,
      c = Math.abs(x - e.x * S) / ph.run + e.cost + graph.dist[e.to]![goal]!;
    if (c < cost) {
      best = i;
      cost = c;
    }
  }
  return best;
}
