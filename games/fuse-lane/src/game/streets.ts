import { CITY, type City, type MapPoint } from "./data/cities/index.js";

/**
 * The streets as the rules walk them: every edge of the city's graph cut into unit steps, so a player's `pos` is one
 * whole step index, and for each place the distance and the next step toward its door from every step. Built once
 * from the city data with nothing but + − × ÷ and √ (all exactly rounded), so every device builds the same streets.
 *
 * The steps are scaled so the longest trip between two doors is about `LONGEST_TRIP` steps: the old ring road's
 * half lap, which keeps walking times where the economy was balanced.
 */
export const LONGEST_TRIP = 85;

export interface Streets {
  /** Steps in all. Steps `0..city.nodes.length - 1` are the city's nodes, in order; the rest lie along the edges. */
  size: number;
  /** Each step's point on the map. */
  points: readonly MapPoint[];
  /** Each step's neighbours, lowest index first. */
  neighbours: readonly (readonly number[])[];
  /** The step at each place's door, by place index. */
  doors: readonly number[];
  /** The step new players start on. */
  start: number;
  /** `distance[place][step]`: steps from `step` to that place's door. */
  distance: readonly Int32Array[];
  /** `next[place][step]`: the step to take from `step` toward that place's door (the door itself at the door). */
  next: readonly Int32Array[];
  /** Steps per map pixel. */
  scale: number;
}

const length = (points: readonly MapPoint[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]![0] - points[i - 1]![0],
      dy = points[i]![1] - points[i - 1]![1];
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
};

/** The point `at` map pixels along a polyline. */
function along(points: readonly MapPoint[], at: number): MapPoint {
  let left = at;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!,
      [x1, y1] = points[i]!;
    const dx = x1 - x0,
      dy = y1 - y0,
      span = Math.sqrt(dx * dx + dy * dy);
    if (left <= span || i === points.length - 1) {
      const f = span > 0 ? Math.min(1, left / span) : 0;
      return [x0 + dx * f, y0 + dy * f];
    }
    left -= span;
  }
  return points[points.length - 1]!;
}

/** Breadth-first distances from `from` over unit steps. */
function distances(
  neighbours: readonly (readonly number[])[],
  from: number,
): Int32Array {
  const out = new Int32Array(neighbours.length).fill(-1);
  const queue = [from];
  out[from] = 0;
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    for (const next of neighbours[at]!)
      if (out[next] === -1) {
        out[next] = out[at]! + 1;
        queue.push(next);
      }
  }
  return out;
}

/** The streets of `city` with `scale` steps per map pixel. */
function cut(city: City, scale: number) {
  const index = new Map(city.nodes.map((node, i) => [node.id, i]));
  const points: MapPoint[] = city.nodes.map((node) => node.at);
  const links: [number, number][] = [];
  for (const edge of city.edges) {
    const from = index.get(edge.from),
      to = index.get(edge.to);
    if (from === undefined || to === undefined || from === to)
      throw new Error(`${city.id}: bad edge ${edge.from}–${edge.to}`);
    const line = [points[from]!, ...edge.via, points[to]!];
    const total = length(line),
      steps = Math.max(1, Math.round(total * scale));
    let previous = from;
    for (let k = 1; k < steps; k++) {
      points.push(along(line, (total * k) / steps));
      links.push([previous, points.length - 1]);
      previous = points.length - 1;
    }
    links.push([previous, to]);
  }
  const neighbours = points.map(() => [] as number[]);
  for (const [a, b] of links) {
    if (!neighbours[a]!.includes(b)) neighbours[a]!.push(b);
    if (!neighbours[b]!.includes(a)) neighbours[b]!.push(a);
  }
  for (const list of neighbours) list.sort((a, b) => a - b);
  const doors = city.places.map((place) => {
    const door = index.get(place.door);
    if (door === undefined)
      throw new Error(`${city.id}: ${place.id} has no door node`);
    return door;
  });
  const distance = doors.map((door) => distances(neighbours, door));
  let longest = 0;
  for (const row of distance)
    for (const door of doors) longest = Math.max(longest, row[door]!);
  return { points, neighbours, doors, distance, longest, index };
}

export function buildStreets(
  city: City,
  longestTrip: number = LONGEST_TRIP,
): Streets {
  // The longest trip in map pixels sets the first scale; a few passes absorb the rounding of each edge to whole steps.
  const pixels = cut(city, 1);
  let scale = longestTrip / Math.max(1, pixels.longest),
    best = cut(city, scale);
  for (let pass = 0; pass < 6 && best.longest !== longestTrip; pass++) {
    const nextScale = (scale * longestTrip) / Math.max(1, best.longest),
      next = cut(city, nextScale);
    if (
      Math.abs(next.longest - longestTrip) >=
      Math.abs(best.longest - longestTrip)
    )
      break;
    scale = nextScale;
    best = next;
  }
  const { points, neighbours, doors, distance, index } = best;
  for (const row of distance)
    if (row.some((steps) => steps < 0))
      throw new Error(`${city.id}: the streets are not connected`);
  // The next step toward each door: the neighbour one step closer, the lowest index on a tie.
  const next = distance.map((row, place) => {
    const hops = new Int32Array(points.length);
    for (let step = 0; step < points.length; step++) {
      if (step === doors[place]) {
        hops[step] = step;
        continue;
      }
      hops[step] = neighbours[step]!.find(
        (neighbour) => row[neighbour] === row[step]! - 1,
      )!;
    }
    return hops;
  });
  return {
    size: points.length,
    points,
    neighbours,
    doors,
    start: index.get(city.start)!,
    distance,
    next,
    scale,
  };
}

/** The streets of the city every match is played in. */
export const STREETS: Streets = buildStreets(CITY);
/** Step positions are `0..STEPS - 1`. */
export const STEPS = STREETS.size;
/** The step at a place's door. */
export const doorOf = (place: number): number => STREETS.doors[place]!;
/** Steps from `step` to a place's door. */
export const walkSteps = (step: number, place: number): number =>
  STREETS.distance[place]![step]!;
/** The step to take from `step` toward a place's door. */
export const nextStep = (step: number, place: number): number =>
  STREETS.next[place]![step]!;
