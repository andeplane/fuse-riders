import { GROUND } from "./projection.js";
import { seededRandom } from "./neuron-form.js";

/**
 * Blood vessels threading the ground beneath the battlefield: a few arteries
 * enter from the edges and branch into capillaries. Decoration only; the
 * layout is fixed per map and never affects rules, paths or selection.
 */
type Point = readonly [number, number];
export interface Vessel {
  points: readonly Point[];
  width: number;
  /** Cumulative length at each point, for sampling along the vessel. */
  lengths: readonly number[];
}

const STEP = 22;

function measured(points: Point[], width: number): Vessel {
  const lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(
      lengths[i - 1]! +
        Math.hypot(
          points[i]![0] - points[i - 1]![0],
          points[i]![1] - points[i - 1]![1],
        ),
    );
  return { points, width, lengths };
}

export function vesselNetwork(
  size: { width: number; height: number },
  seed: number,
): Vessel[] {
  const random = seededRandom(seed);
  const vessels: Vessel[] = [];
  const inside = ([x, y]: Point, margin: number) =>
    x > -margin &&
    y > -margin &&
    x < size.width + margin &&
    y < size.height + margin;
  const grow = (
    start: Point,
    heading: number,
    width: number,
    steps: number,
    depth: number,
  ) => {
    const points: Point[] = [start];
    let angle = heading;
    let drift = 0;
    for (let i = 0; i < steps; i++) {
      // A smoothed random walk: vessels meander rather than zigzag.
      drift = drift * 0.7 + (random() - 0.5) * 0.5;
      angle += drift * 0.5;
      const [x, y] = points[points.length - 1]!;
      const next: Point = [
        x + Math.cos(angle) * STEP,
        y + Math.sin(angle) * STEP * GROUND.depth,
      ];
      points.push(next);
      if (!inside(next, 80)) break;
      if (depth > 0 && i > 2 && random() < 0.07) {
        const side = random() < 0.5 ? -1 : 1;
        grow(
          next,
          angle + side * (0.6 + random() * 0.5),
          width * (0.5 + random() * 0.15),
          8 + Math.floor(random() * (depth > 1 ? 18 : 9)),
          depth - 1,
        );
      }
    }
    if (points.length > 2) vessels.push(measured(points, width));
  };
  const arteries = 2 + Math.round((size.width * size.height) / 900_000);
  for (let a = 0; a < arteries; a++) {
    // Enter from a random edge, heading roughly across the map.
    const edge = Math.floor(random() * 4);
    const along = random();
    const start: Point =
      edge === 0
        ? [along * size.width, -40]
        : edge === 1
          ? [size.width + 40, along * size.height]
          : edge === 2
            ? [along * size.width, size.height + 40]
            : [-40, along * size.height];
    const center: Point = [
      size.width * (0.3 + random() * 0.4),
      size.height * (0.3 + random() * 0.4),
    ];
    const heading = Math.atan2(
      (center[1] - start[1]) / GROUND.depth,
      center[0] - start[0],
    );
    grow(start, heading, 3.6 + random() * 1.6, 120, 2);
  }
  return vessels;
}

const f = (n: number) => n.toFixed(1);
function smoothOpen(points: readonly Point[]): string {
  let d = `M${f(points[0]![0])} ${f(points[0]![1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!,
      q = points[i + 1]!;
    d += `Q${f(p[0])} ${f(p[1])} ${f((p[0] + q[0]) / 2)} ${f((p[1] + q[1]) / 2)}`;
  }
  const last = points[points.length - 1]!;
  return `${d}L${f(last[0])} ${f(last[1])}`;
}

/** Wall, blood and a wet highlight per vessel, widest first so joins read cleanly. */
export function vesselMarkup(vessels: readonly Vessel[]): string {
  const sorted = [...vessels].sort((a, b) => b.width - a.width);
  const layer = (cls: string, width: (v: Vessel) => number, shift = 0) =>
    sorted
      .map(
        (v) =>
          `<path class="${cls}" d="${smoothOpen(v.points)}" stroke-width="${f(width(v))}"${shift ? ` transform="translate(0 ${f(shift * v.width)})"` : ""}/>`,
      )
      .join("");
  return `<g class="vessels" pointer-events="none">${layer("vessel-wall", (v) => v.width + 3)}${layer("vessel-blood", (v) => v.width)}${layer("vessel-sheen", (v) => Math.max(0.6, v.width * 0.28), -0.22)}</g>`;
}

/** Point at distance `s` along a vessel's centreline. */
export function vesselPoint(v: Vessel, s: number): Point {
  const total = v.lengths[v.lengths.length - 1]!;
  const d = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < v.lengths.length - 1 && v.lengths[i]! < d) i++;
  const a = v.points[i - 1]!,
    b = v.points[i]!;
  const span = v.lengths[i]! - v.lengths[i - 1]! || 1;
  const u = (d - v.lengths[i - 1]!) / span;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

/** Heartbeat, 0–1: a sharp systolic spike and a softer echo each ~1.1 s. */
export const HEART_MS = 1100;
export function heartbeat(now: number): number {
  const phase = (now % HEART_MS) / HEART_MS;
  const spike = (at: number, width: number) =>
    Math.exp(-(((phase - at) / width) ** 2));
  return Math.min(1, spike(0.08, 0.05) + 0.55 * spike(0.3, 0.07));
}
/**
 * Distance blood has travelled by `now`: steady flow with a surge on every
 * beat. Monotonic, so cells never run backwards.
 */
export function bloodTravel(now: number, speed: number): number {
  const beats = now / HEART_MS;
  const phase = beats % 1;
  const surge = 1 - Math.exp(-phase * 9);
  return (
    speed * (beats + Math.floor(beats) * 0.6 + surge * 0.6) * (HEART_MS / 1000)
  );
}
