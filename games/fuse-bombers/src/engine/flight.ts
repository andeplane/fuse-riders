// Flight for gunships and ghosts: held-direction thrust with momentum, drag, a speed cap and collisions against a
// solid field. Plain arithmetic and `Math.sqrt` only, so a replay on any browser gives the same floats. Not wired into
// the round yet; see docs/engine.md.

import { thrustDirection } from "./input.js";
import { DT } from "./tuning.js";

/** One flying body as plain data: centre and velocity in logical pixels and pixels per second, y down. */
export interface FlightBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * What a body flies in. `solidAt` answers for one point; the bitmap terrain provides it. Flight only asks about points
 * inside `[0, width] × [0, height]` (edges included), and relies on rock never growing: carving only removes it.
 */
export interface FlightWorld {
  readonly width: number;
  readonly height: number;
  solidAt(x: number, y: number): boolean;
}

export interface FlightTuning {
  /** Acceleration while a direction is held, px/s². */
  readonly thrust: number;
  /** Speed cap, px/s. Thrust against drag alone would settle a little above it, so the cap is reached in finite time. */
  readonly topSpeed: number;
  /** Linear drag while a direction is held: each step the velocity loses `drag · DT` of itself. Per second. */
  readonly drag: number;
  /** Linear drag while no direction is held (the pilot lets go and the ship brakes). Per second. */
  readonly brakeDrag: number;
  /** With no direction held, a body slower than this stops dead, px/s, so coasting ends instead of creeping. */
  readonly stopSpeed: number;
  /** Collision circle radius, px. */
  readonly radius: number;
  /** Fraction of the blocked velocity component kept, reversed, when the body hits rock or the world edge. */
  readonly bounce: number;
  /** A blocked component slower than this stops instead of bouncing, px/s, so a ship pressed against rock is still. */
  readonly bounceMinSpeed: number;
}

/**
 * A gunship: slow and heavy, with momentum. At 60 Hz (asserted in tests/engine-flight.test.ts) it reaches half its top
 * speed in 0.33 s and top speed in 1.07 s, reverses from top speed one way to top speed the other in 1.45 s, and coasts
 * from top speed to rest in 1.6 s.
 */
export const GUNSHIP_FLIGHT: FlightTuning = Object.freeze({
  thrust: 400,
  topSpeed: 200,
  drag: 1.6,
  brakeDrag: 2.4,
  stopSpeed: 4,
  radius: 30,
  bounce: 0.35,
  bounceMinSpeed: 40,
});

/**
 * A ghost: lighter and faster than a gunship (top speed in 0.78 s, reversal in 1.05 s, coasts to rest in 1.47 s). It
 * flies through rock (fly it in `openSky`) but not through the world edge.
 */
export const GHOST_FLIGHT: FlightTuning = Object.freeze({
  thrust: 720,
  topSpeed: 260,
  drag: 2.2,
  brakeDrag: 2.8,
  stopSpeed: 4,
  radius: 18,
  bounce: 0.5,
  bounceMinSpeed: 40,
});

/** The world without rock, for ghosts: the same edges, nothing solid. */
export function openSky(width: number, height: number): FlightWorld {
  return { width, height, solidAt: () => false };
}

/**
 * Longest move tested at once, px. Rock comes in 4 px cells and a wall can be one cell thick; a rim probe that moves at
 * most 2 px cannot step over a cell, so a body never tunnels, whatever its speed.
 */
export const MAX_SUBSTEP = 2;
/** Neighbouring rim probes are at most this far apart, px (half a cell, so no cell fits between two). */
const PROBE_SPACING = 2;
/** Halvings when searching for the contact point of a blocked move (2 px / 64 ≈ 0.03 px). */
const CONTACT_ITERATIONS = 6;
/** A buried body is moved out by up to its radius, testing rings this far apart, px. */
const PUSH_OUT_STEP = 2;
/** Push-out tries straight up first (open sky is mostly above), then the upper diagonals, sideways and down. */
const PUSH_OUT_DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-1, 0],
  [1, 0],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
];
/** Most passes of `separate` over every pair: one parts a pair, a tight cluster of four needs about a dozen. */
const SEPARATION_PASSES = 12;
/** Overlaps and separation shortfalls below this, px, are rounding, not a collision or a ship stopped by rock. */
const PUSH_EPSILON = 1e-9;

/** Interior probes are a lattice closer than a cell, so any cell wholly inside the circle holds one, px. */
const INTERIOR_SPACING = 3.5;

/** Probe offsets of one radius, interleaved x, y: the rim on a ring of radius `ring`, and the inside of the disc. */
interface Probes {
  readonly ring: number;
  readonly rim: Float64Array;
  readonly interior: Float64Array;
}

const probeCache = new Map<number, Probes>();

/**
 * Offsets tested against rock. The rim: points at most `PROBE_SPACING` apart on a ring a little wider than the circle,
 * so wide that a cell corner poking between two neighbouring probes (at most half their spacing past the chord between
 * them) still stays outside the circle; the circle itself never overlaps rock, and rests within about a pixel of it.
 * The ring is built per octant from the rational parametrisation of the circle, which needs no trigonometry, and
 * mirrored. Moves test only the rim: a body that starts clear and moves at most `MAX_SUBSTEP` cannot get rock inside
 * without the rim meeting it first. The interior lattice is for the start-of-step check of a body that may be buried.
 * A memo only: a radius always gives the same offsets.
 */
function probesFor(radius: number): Probes {
  const cached = probeCache.get(radius);
  if (cached) return cached;
  const rim: number[] = [];
  const seen = new Set<string>();
  const add = (x: number, y: number): void => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    rim.push(x, y);
  };
  const ring =
    radius +
    PROBE_SPACING / 2 +
    (PROBE_SPACING * PROBE_SPACING) / (8 * Math.max(radius, 1));
  // t = tan(θ / 2) from 0 to tan(π / 8) sweeps one octant; dθ/dt <= 2, so steps of `spacing / (2 · ring)` in t keep
  // neighbouring probes at most `PROBE_SPACING` apart along the ring.
  const octant = Math.SQRT2 - 1;
  const steps = Math.max(1, Math.ceil((2 * ring * octant) / PROBE_SPACING));
  for (let i = 0; i <= steps; i++) {
    const t = (octant * i) / steps;
    const x = (ring * (1 - t * t)) / (1 + t * t),
      y = (ring * 2 * t) / (1 + t * t);
    for (const [a, b] of [
      [x, y],
      [y, x],
    ] as const) {
      add(a, b);
      add(-a, b);
      add(a, -b);
      add(-a, -b);
    }
  }
  const interior: number[] = [];
  const m = Math.max(1, Math.ceil((2 * radius) / INTERIOR_SPACING));
  const step = (2 * radius) / m;
  for (let i = 0; i < m; i++)
    for (let j = 0; j < m; j++) {
      const x = -radius + step * (i + 0.5),
        y = -radius + step * (j + 0.5);
      if (x * x + y * y < radius * radius) interior.push(x, y);
    }
  const probes = {
    ring,
    rim: Float64Array.from(rim),
    interior: Float64Array.from(interior),
  };
  probeCache.set(radius, probes);
  return probes;
}

/** One body's collision context for a step: its circle, the world's edges and what counts as rock. */
interface Space {
  readonly radius: number;
  readonly width: number;
  readonly height: number;
  readonly probes: Probes;
  readonly solidAt: (x: number, y: number) => boolean;
}

const space = (radius: number, world: FlightWorld, rock = true): Space => ({
  radius,
  width: world.width,
  height: world.height,
  probes: probesFor(radius),
  solidAt: rock ? (x, y) => world.solidAt(x, y) : () => false,
});

const anySolid = (
  s: Space,
  x: number,
  y: number,
  probes: Float64Array,
): boolean => {
  for (let i = 0; i < probes.length; i += 2)
    if (s.solidAt(x + probes[i]!, y + probes[i + 1]!)) return true;
  return false;
};

/**
 * True when a body centred at (x, y) has its probe ring inside the world (so the world edge, like rock, stays about a
 * pixel outside the circle and probes never leave the world) and its rim, and for `whole` its inside, out of rock.
 */
function clearAt(s: Space, x: number, y: number, whole = false): boolean {
  const r = s.probes.ring;
  if (x - r < 0 || x + r > s.width || y - r < 0 || y + r > s.height)
    return false;
  return (
    !anySolid(s, x, y, s.probes.rim) &&
    !(whole && anySolid(s, x, y, s.probes.interior))
  );
}

/**
 * Moves a clear body as far along (dx, dy) as it can go, at most `MAX_SUBSTEP`, and returns the fraction moved: 1, or
 * the last clear point of a bisection toward the contact. The body only ever lands on positions tested clear.
 */
function sweep(s: Space, body: FlightBody, dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 1;
  if (clearAt(s, body.x + dx, body.y + dy)) {
    body.x += dx;
    body.y += dy;
    return 1;
  }
  let lo = 0,
    hi = 1;
  for (let i = 0; i < CONTACT_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (clearAt(s, body.x + dx * mid, body.y + dy * mid)) lo = mid;
    else hi = mid;
  }
  body.x += dx * lo;
  body.y += dy * lo;
  return lo;
}

/** Moves the body by (dx, dy) in sub-steps, stopping at rock and the world edge; returns the distance covered. */
function push(s: Space, body: FlightBody, dx: number, dy: number): number {
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return 0;
  const n = Math.ceil(length / MAX_SUBSTEP);
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const t = sweep(s, body, dx / n, dy / n);
    moved += (t * length) / n;
    if (t < 1) break;
  }
  return moved;
}

const clampAxis = (value: number, radius: number, size: number): number =>
  size < 2 * radius
    ? size / 2
    : value < radius
      ? radius
      : value > size - radius
        ? size - radius
        : value;

/**
 * Makes sure the body starts its step clear: inside the world, and with no rock on or inside its circle. A buried body
 * (a bad spawn, or a caller that placed it in rock) moves to the nearest wholly clear spot within its radius (rings
 * 2 px apart, eight directions, up first). Returns false when there is none: the body then flies through rock this
 * step, as a ghost does, so it can never be stuck, and collides again once it is clear. Rock never grows, so a body
 * that only ever moves by `flyStep` and `separate` is always clear and this costs one check.
 */
function settle(s: Space, body: FlightBody): boolean {
  body.x = clampAxis(body.x, s.probes.ring, s.width);
  body.y = clampAxis(body.y, s.probes.ring, s.height);
  if (clearAt(s, body.x, body.y, true)) return true;
  for (let d = PUSH_OUT_STEP; d <= s.radius; d += PUSH_OUT_STEP)
    for (const [ux, uy] of PUSH_OUT_DIRECTIONS) {
      const x = body.x + ux * d,
        y = body.y + uy * d;
      if (clearAt(s, x, y, true)) {
        body.x = x;
        body.y = y;
        return true;
      }
    }
  return false;
}

/** A blocked velocity component: reversed and scaled by `bounce`, or stopped when it hit slowly. */
const blocked = (v: number, tuning: FlightTuning): number =>
  v >= tuning.bounceMinSpeed || v <= -tuning.bounceMinSpeed
    ? -v * tuning.bounce
    : 0;

/**
 * Advances one body by one fixed step (`DT`) under the held input `bits` (only the direction bits matter), mutating it
 * in place. Thrust accelerates along the held direction (diagonals normalised, opposites cancel), drag slows the body
 * (`brakeDrag` when nothing is held), the speed is capped at `topSpeed`, and the body moves in sub-steps of at most
 * `MAX_SUBSTEP` px. A blocked sub-step goes to the contact point, then tries the rest of the move along x and along y
 * separately, so the body slides along walls and floors and keeps its parallel velocity; a blocked component bounces
 * or stops. The world edge is a wall too. The circle never ends a step overlapping rock (it rests within about a pixel
 * of it), unless it started buried too deep to push out (see `settle`). Returns the fastest blocked speed of the step
 * (0 when nothing was hit), for a bump sound or damage later.
 */
export function flyStep(
  body: FlightBody,
  bits: number,
  tuning: FlightTuning,
  world: FlightWorld,
): number {
  let s = space(tuning.radius, world);
  if (!settle(s, body)) s = space(tuning.radius, world, false);

  const direction = thrustDirection(bits);
  const idle = direction.x === 0 && direction.y === 0;
  let vx = body.vx + direction.x * tuning.thrust * DT,
    vy = body.vy + direction.y * tuning.thrust * DT;
  const keep = Math.max(0, 1 - (idle ? tuning.brakeDrag : tuning.drag) * DT);
  vx *= keep;
  vy *= keep;
  const speed2 = vx * vx + vy * vy;
  if (idle && speed2 < tuning.stopSpeed * tuning.stopSpeed) {
    vx = 0;
    vy = 0;
  } else if (speed2 > tuning.topSpeed * tuning.topSpeed) {
    const scale = tuning.topSpeed / Math.sqrt(speed2);
    vx *= scale;
    vy *= scale;
  }
  body.vx = vx;
  body.vy = vy;

  const distance = Math.sqrt(vx * vx + vy * vy) * DT;
  const substeps = Math.max(1, Math.ceil(distance / MAX_SUBSTEP));
  const h = DT / substeps;
  let impact = 0;
  for (let i = 0; i < substeps; i++) {
    const dx = body.vx * h,
      dy = body.vy * h;
    const rest = 1 - sweep(s, body, dx, dy);
    if (rest === 0) continue;
    if (dx !== 0 && sweep(s, body, dx * rest, 0) < 1) {
      impact = Math.max(impact, Math.abs(body.vx));
      body.vx = blocked(body.vx, tuning);
    }
    if (dy !== 0 && sweep(s, body, 0, dy * rest) < 1) {
      impact = Math.max(impact, Math.abs(body.vy));
      body.vy = blocked(body.vy, tuning);
    }
  }
  return impact;
}

/**
 * Pushes overlapping gunships (circles of `radius`) apart and damps their approach, mutating them. Pairs go in index
 * order, a few passes over all pairs. Each ship of a pair moves half the overlap; when rock or the world edge stops one,
 * the other takes the rest. Pushes are sub-stepped moves like flight, so nobody is pushed into rock or through a wall.
 * The approach part of the pair's relative velocity is removed equally from both; a separating velocity is kept.
 * Ships exactly on top of each other part along x, the later one to the right.
 */
export function separate(
  bodies: readonly FlightBody[],
  radius: number,
  world: FlightWorld,
): void {
  const s = space(radius, world);
  const min = 2 * radius;
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    let overlapped = false;
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]!,
          b = bodies[j]!;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= (min - PUSH_EPSILON) * (min - PUSH_EPSILON)) continue;
        overlapped = true;
        const d = Math.sqrt(d2);
        const nx = d > 0 ? dx / d : 1,
          ny = d > 0 ? dy / d : 0;
        const approach = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (approach < 0) {
          const share = approach / 2;
          a.vx += share * nx;
          a.vy += share * ny;
          b.vx -= share * nx;
          b.vy -= share * ny;
        }
        const half = (min - d) / 2;
        const shortA = half - push(s, a, -nx * half, -ny * half);
        const shortB = half - push(s, b, nx * half, ny * half);
        if (shortA > PUSH_EPSILON) push(s, b, nx * shortA, ny * shortA);
        if (shortB > PUSH_EPSILON) push(s, a, -nx * shortB, -ny * shortB);
      }
    if (!overlapped) return;
  }
}
