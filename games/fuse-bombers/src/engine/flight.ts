// Flight for gunships and ghosts: held-direction thrust with momentum, drag, a speed cap and collisions against a
// solid field. Plain arithmetic and `Math.sqrt` only, so a replay on any browser gives the same floats. The round flies
// its gunships and ghosts with it; see docs/engine.md.

import { thrustDirection, type Direction } from "./input.js";
import { DT } from "./tuning.js";

/**
 * One flying body as plain data: centre and velocity in logical pixels and pixels per second, y down. All four numbers
 * must be finite; flight does not repair NaN, so the checkpoint codec has to refuse it.
 */
export interface FlightBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Rock comes in square cells this many pixels wide, aligned to the origin: `solidAt` is constant over each. */
export const CELL_SIZE = 4;

/**
 * What a body flies in. `solidAt` answers for one point and is constant over each `CELL_SIZE` cell; the bitmap terrain
 * will provide it. Flight only asks about points inside `[0, width) × [0, height)` (the far edges excluded, like the
 * last cell's far side), and relies on rock never growing: carving only removes it.
 */
export interface FlightWorld {
  readonly width: number;
  readonly height: number;
  /** True when nothing is ever solid (see `openSky`): flight then never calls `solidAt`. */
  readonly rockless?: boolean;
  solidAt(x: number, y: number): boolean;
}

/** A collision circle and the points around it that are tested against rock. Built once per radius, never mutated. */
export interface FlightShape {
  /** The circle, px. */
  readonly radius: number;
  /** Radius of the ring the rim probes sit on: a little wider than the circle, px. */
  readonly ring: number;
  /** Rim probe offsets from the centre, interleaved x, y. */
  readonly rim: Float64Array;
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
  /** The collision circle. */
  readonly shape: FlightShape;
  /** Fraction of the velocity into rock or the world edge kept, reversed, when the body hits it, 0 to 1. */
  readonly bounce: number;
  /** A body slower than this into a surface stops against it instead of bouncing, px/s, and the hit is not reported. */
  readonly bounceMinSpeed: number;
}

/**
 * Longest move tested at once, px. Rock comes in `CELL_SIZE` cells and a wall can be one cell thick; a rim probe that
 * moves at most half a cell cannot step over one, so a body never tunnels, whatever its speed.
 */
export const MAX_SUBSTEP = 2;
/** Neighbouring rim probes are at most this far apart, px (half a cell, so no cell fits between two). */
const PROBE_SPACING = 2;
/** Halvings when searching for the contact point of a blocked move (2 px / 64 ≈ 0.03 px). */
const CONTACT_ITERATIONS = 6;
/** Surfaces met and slid along within one sub-step: a floor, then a wall of a corner, then one more for a crease. */
const MAX_CONTACTS = 3;
/** A buried body is moved out by up to this many radii, testing rings this far apart, px. */
const PUSH_OUT_STEP = 2;
const PUSH_OUT_RADII = 4;
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
/** The far world edges are kept this far from the probe ring, px, so no probe is asked about `x === width`. */
const EDGE_MARGIN = 1e-6;
/** A contact normal this close to an axis is that axis, so a ship on a flat floor keeps its velocity exactly parallel. */
const AXIS_SNAP = 1e-9;

/**
 * The collision shape of a circle of `radius` px. The rim probes are points at most `PROBE_SPACING` apart on a ring a
 * little wider than the circle, so wide that a cell corner poking between two neighbouring probes (at most half their
 * spacing past the chord between them) still stays outside the circle; the circle itself never overlaps rock, and rests
 * within about a pixel of it. The ring is built per octant from the rational parametrisation of the circle, which needs
 * no trigonometry, and mirrored. Moves test only the rim: a body that starts clear and moves at most `MAX_SUBSTEP`
 * cannot get rock inside without the rim meeting it first. Pure: a radius always gives the same shape.
 */
export function flightShape(radius: number): FlightShape {
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
  return Object.freeze({ radius, ring, rim: Float64Array.from(rim) });
}

/**
 * A gunship: slow and heavy, with momentum. Measured at 60 Hz (tests/engine-flight.test.ts asserts ranges around these)
 * it reaches half its top speed in 0.33 s and top speed in 1.07 s, reverses from top speed one way to top speed the
 * other in 1.45 s, and coasts from top speed to rest in 1.6 s.
 */
export const GUNSHIP_FLIGHT: FlightTuning = Object.freeze({
  thrust: 400,
  topSpeed: 200,
  drag: 1.6,
  brakeDrag: 2.4,
  stopSpeed: 4,
  shape: flightShape(30),
  bounce: 0.35,
  bounceMinSpeed: 40,
});

/**
 * A ghost: lighter and faster than a gunship (half speed in 0.25 s, top speed in 0.78 s, reversal in 1.05 s, coasts to
 * rest in 1.47 s). It flies through rock (fly it in `openSky`) but not through the world edge.
 */
export const GHOST_FLIGHT: FlightTuning = Object.freeze({
  thrust: 720,
  topSpeed: 260,
  drag: 2.2,
  brakeDrag: 2.8,
  stopSpeed: 4,
  shape: flightShape(18),
  bounce: 0.5,
  bounceMinSpeed: 40,
});

/** The world without rock, for ghosts: the same edges, nothing solid, and no probing at all. */
export function openSky(width: number, height: number): FlightWorld {
  return { width, height, rockless: true, solidAt: () => false };
}

/** One body's collision context for a step: its circle and the world, and whether rock counts. */
interface Space {
  readonly shape: FlightShape;
  readonly world: FlightWorld;
  readonly rock: boolean;
}

const space = (shape: FlightShape, world: FlightWorld): Space => ({
  shape,
  world,
  rock: world.rockless !== true,
});

/** True when a body centred at (x, y) has its probe ring strictly inside the world: probes never leave `[0, size)`. */
function insideWorld(s: Space, x: number, y: number): boolean {
  const r = s.shape.ring;
  return (
    x - r >= 0 && x + r < s.world.width && y - r >= 0 && y + r < s.world.height
  );
}

const EDGE_NORMALS = {
  left: Object.freeze({ x: 1, y: 0 }),
  right: Object.freeze({ x: -1, y: 0 }),
  top: Object.freeze({ x: 0, y: 1 }),
  bottom: Object.freeze({ x: 0, y: -1 }),
};

/** The normal of the world edge a body at (x, y) is past (x first), or undefined when it is inside. */
function edgeNormal(s: Space, x: number, y: number): Direction | undefined {
  const r = s.shape.ring;
  if (x - r < 0) return EDGE_NORMALS.left;
  if (x + r >= s.world.width) return EDGE_NORMALS.right;
  if (y - r < 0) return EDGE_NORMALS.top;
  if (y + r >= s.world.height) return EDGE_NORMALS.bottom;
  return undefined;
}

/** True when a body centred at (x, y) has its probe ring inside the world and its rim out of rock. */
function clearAt(s: Space, x: number, y: number): boolean {
  if (!insideWorld(s, x, y)) return false;
  if (!s.rock) return true;
  const rim = s.shape.rim;
  for (let i = 0; i < rim.length; i += 2)
    if (s.world.solidAt(x + rim[i]!, y + rim[i + 1]!)) return false;
  return true;
}

/**
 * True when any rock cell overlaps the disc of a body at (x, y): an exact test of every cell the disc's bounding box
 * touches, by the cell's nearest point to the centre, so a one-cell islet wholly inside the circle is found as well.
 * Touching does not count. Only for placing a body; the rim is enough once a body starts clear.
 */
function rockInDisc(s: Space, x: number, y: number): boolean {
  const r = s.shape.radius;
  for (
    let cx = Math.floor((x - r) / CELL_SIZE);
    cx <= Math.floor((x + r) / CELL_SIZE);
    cx++
  )
    for (
      let cy = Math.floor((y - r) / CELL_SIZE);
      cy <= Math.floor((y + r) / CELL_SIZE);
      cy++
    ) {
      const left = cx * CELL_SIZE,
        top = cy * CELL_SIZE;
      const dx = x - Math.min(Math.max(x, left), left + CELL_SIZE),
        dy = y - Math.min(Math.max(y, top), top + CELL_SIZE);
      if (dx * dx + dy * dy >= r * r) continue;
      const mx = left + CELL_SIZE / 2,
        my = top + CELL_SIZE / 2;
      if (mx < s.world.width && my < s.world.height && s.world.solidAt(mx, my))
        return true;
    }
  return false;
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

/** The unit vector along (x, y), or the axis it is within rounding of. */
function unit(x: number, y: number): Direction {
  const length = Math.sqrt(x * x + y * y);
  const ux = x / length,
    uy = y / length;
  if (Math.abs(ux) < AXIS_SNAP) return { x: 0, y: uy < 0 ? -1 : 1 };
  if (Math.abs(uy) < AXIS_SNAP) return { x: ux < 0 ? -1 : 1, y: 0 };
  return { x: ux, y: uy };
}

/**
 * The unit normal of what blocks a body from (x, y), pointing away from the rock or edge. A world edge gives its axis.
 * Rock gives the direction from the rim probes that hit it to the centre: against a wall or floor the hit probes are
 * symmetric about the axis, against a slope they lean uphill, and against a cell corner they are the few next to it,
 * so a circle sliding over stair-steps feels a smooth surface. `dx`, `dy` is the move that was blocked, the fallback
 * when no probe says (a head-on hit).
 */
function contactNormal(
  s: Space,
  x: number,
  y: number,
  dx: number,
  dy: number,
): Direction {
  const edge = edgeNormal(s, x, y);
  if (edge) return edge;
  const rim = s.shape.rim;
  let sx = 0,
    sy = 0;
  if (s.rock)
    for (let i = 0; i < rim.length; i += 2)
      if (s.world.solidAt(x + rim[i]!, y + rim[i + 1]!)) {
        sx += rim[i]!;
        sy += rim[i + 1]!;
      }
  return sx * sx + sy * sy < PUSH_EPSILON ? unit(-dx, -dy) : unit(-sx, -sy);
}

/**
 * The velocity of `body` answers a hit on a surface with unit normal (nx, ny) pointing out of it: the part into the
 * surface bounces at `bounce`, or stops when it is slower than `bounceMinSpeed`, and the part along it is kept.
 * Returns the speed into the surface when it bounced (a hard hit), else 0.
 */
function bounceOff(
  body: FlightBody,
  tuning: FlightTuning,
  nx: number,
  ny: number,
): number {
  const into = -(body.vx * nx + body.vy * ny);
  if (into <= 0) return 0;
  const away = into >= tuning.bounceMinSpeed ? into * tuning.bounce : 0;
  body.vx += (into + away) * nx;
  body.vy += (into + away) * ny;
  return away > 0 ? into : 0;
}

/**
 * Moves a clear body by (dx, dy), at most `MAX_SUBSTEP` long: to the contact when rock or the edge is in the way, then
 * along the surface for the rest of the move (up to `MAX_CONTACTS` surfaces, so a corner stops it). With a `tuning` the
 * body's velocity answers each contact (see `bounceOff`). The surface normal is an estimate from the rim probes, good
 * enough to ride a ramp but not exact against a cell corner; a slide that is stopped again within half its length (the
 * estimate pointed the wrong way) falls back to moving along each axis alone, as along a wall, so a body never sticks
 * to a surface it could slide along. Returns the fastest hard hit, 0 when nothing hit hard.
 */
function advance(
  s: Space,
  body: FlightBody,
  dx: number,
  dy: number,
  tuning?: FlightTuning,
): number {
  let impact = 0;
  for (let contact = 0; contact < MAX_CONTACTS; contact++) {
    const t = sweep(s, body, dx, dy);
    if (t === 1) break;
    dx *= 1 - t;
    dy *= 1 - t;
    if (contact > 0 && t < 0.5) {
      if (dx !== 0) sweep(s, body, dx, 0);
      if (dy !== 0) sweep(s, body, 0, dy);
      break;
    }
    const n = contactNormal(s, body.x + dx, body.y + dy, dx, dy);
    if (tuning) impact = Math.max(impact, bounceOff(body, tuning, n.x, n.y));
    const along = dx * n.x + dy * n.y;
    if (along < 0) {
      dx -= along * n.x;
      dy -= along * n.y;
    }
  }
  return impact;
}

/**
 * Moves the body `amount` px along the unit vector (ux, uy) in sub-steps, stopping at rock and the world edge and
 * sliding along them; returns how far it got along (ux, uy). Velocity is untouched.
 */
function shove(
  s: Space,
  body: FlightBody,
  ux: number,
  uy: number,
  amount: number,
): number {
  const x0 = body.x,
    y0 = body.y;
  const n = Math.ceil(amount / MAX_SUBSTEP);
  for (let i = 0; i < n; i++) {
    const x = body.x,
      y = body.y;
    advance(s, body, (ux * amount) / n, (uy * amount) / n);
    if (body.x === x && body.y === y) break;
  }
  return (body.x - x0) * ux + (body.y - y0) * uy;
}

const clampAxis = (value: number, ring: number, size: number): number => {
  const high = size - ring - EDGE_MARGIN;
  return high < ring
    ? size / 2
    : value < ring
      ? ring
      : value > high
        ? high
        : value;
};

/**
 * Makes sure the body starts its step clear: inside the world, and with its rim out of rock (`whole`: with no rock
 * overlapping its disc at all). A buried body (a bad spawn, or a caller that placed it in rock) moves to a nearby clear
 * spot, within `PUSH_OUT_RADII` radii (rings 2 px apart, eight directions, up first). Returns false when there is none:
 * the body then flies through rock this step, as a ghost does, so it can never be stuck, and collides again once it is
 * clear. Rock never grows, so a body that only ever moves by `flyStep` and `separate` is always clear and this costs
 * one rim check.
 */
function settle(s: Space, body: FlightBody, whole: boolean): boolean {
  const ok = (x: number, y: number): boolean =>
    clearAt(s, x, y) && !(whole && s.rock && rockInDisc(s, x, y));
  body.x = clampAxis(body.x, s.shape.ring, s.world.width);
  body.y = clampAxis(body.y, s.shape.ring, s.world.height);
  if (ok(body.x, body.y)) return true;
  for (
    let d = PUSH_OUT_STEP;
    d <= s.shape.radius * PUSH_OUT_RADII;
    d += PUSH_OUT_STEP
  )
    for (const [ux, uy] of PUSH_OUT_DIRECTIONS) {
      const x = body.x + ux * d,
        y = body.y + uy * d;
      if (ok(x, y)) {
        body.x = x;
        body.y = y;
        return true;
      }
    }
  return false;
}

/**
 * Puts a body somewhere clear for the start of play (a spawn): inside the world, with no rock overlapping its circle at
 * all, not even a one-cell islet wholly inside it that the rim would never meet. Moves it to a nearby clear spot when
 * it is buried (see `settle`) and returns false when there is none. `flyStep` only checks the rim, so spawn bodies
 * through this; after that rock cannot get inside a circle that only `flyStep` and `separate` move.
 */
export function placeClear(
  body: FlightBody,
  shape: FlightShape,
  world: FlightWorld,
): boolean {
  return settle(space(shape, world), body, true);
}

/**
 * Advances one body by one fixed step (`DT`) under the held input `bits` (only the direction bits matter), mutating it
 * in place. Thrust accelerates along the held direction (diagonals normalised, opposites cancel), drag slows the body
 * (`brakeDrag` when nothing is held), the speed is capped at `topSpeed`, and the body moves in sub-steps of at most
 * `MAX_SUBSTEP` px. A blocked sub-step goes to the contact point and slides along the surface for the rest of the move
 * (the surface normal is read off the rim probes that hit), so the body rides ramps and walls and keeps its velocity
 * along them; the velocity into the surface bounces or stops. The world edge is a wall too. The rim never ends a step
 * in rock (the circle rests within about a pixel of it), unless the body started buried too deep to push out (see
 * `settle`). Returns the fastest speed of a hard hit this step, one of at least `bounceMinSpeed` into rock or the edge
 * (0 when nothing hit that hard, also for a ship pressing on a wall), for a bump sound or damage later.
 */
export function flyStep(
  body: FlightBody,
  bits: number,
  tuning: FlightTuning,
  world: FlightWorld,
): number {
  let s = space(tuning.shape, world);
  if (!settle(s, body, false)) s = { ...s, rock: false };

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
  for (let i = 0; i < substeps; i++)
    impact = Math.max(
      impact,
      advance(s, body, body.vx * h, body.vy * h, tuning),
    );
  return impact;
}

/** Moves `a` back and `b` forward `each` px along the unit vector (ux, uy), the other taking what one cannot. */
function part(
  s: Space,
  a: FlightBody,
  b: FlightBody,
  ux: number,
  uy: number,
  each: number,
): void {
  const shortA = each - shove(s, a, -ux, -uy, each);
  const shortB = each - shove(s, b, ux, uy, each);
  if (shortA > PUSH_EPSILON) shove(s, b, ux, uy, shortA);
  if (shortB > PUSH_EPSILON) shove(s, a, -ux, -uy, shortB);
}

/**
 * Pushes overlapping gunships (circles of `shape`) apart and damps their approach, mutating them. Pairs go in index
 * order (so the result depends on it: pass the ships in seat order), a few passes over all pairs. Each ship of a pair
 * moves half the overlap along the line between them; when rock or the world edge stops one, it slides along it and the
 * other takes the rest. A pair the line cannot part (two ships in a shaft as wide as one) is parted sideways, the
 * earlier ship one way and the later the other. Pushes are sub-stepped moves like flight, so nobody is pushed into
 * rock or through a wall. The approach part of the pair's relative velocity is removed equally from both; a separating
 * velocity is kept. Ships exactly on top of each other part along x, then sideways (y) if x is blocked. One shape for
 * all bodies: separate gunships from gunships; ghosts pass through everything.
 */
export function separate(
  bodies: readonly FlightBody[],
  shape: FlightShape,
  world: FlightWorld,
): void {
  const s = space(shape, world);
  const min = 2 * shape.radius;
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
        part(s, a, b, nx, ny, (min - d) / 2);
        const ex = b.x - a.x,
          ey = b.y - a.y;
        const e2 = ex * ex + ey * ey;
        if (e2 < (min - PUSH_EPSILON) * (min - PUSH_EPSILON)) {
          // Blocked along the line (a shaft, a pocket): part sideways by what makes the distance `min`, solving
          // |e + 2p·side|² = min² for p, where e is the vector from a to b now.
          const px = -ny,
            py = nx;
          const q = ex * px + ey * py;
          const p = (Math.sqrt(q * q + min * min - e2) - q) / 2;
          part(s, a, b, px, py, p);
        }
      }
    if (!overlapped) return;
  }
}
