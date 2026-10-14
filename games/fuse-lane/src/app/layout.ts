import {
  CITY,
  STREETS,
  nextStep,
  type City,
  type MapPoint,
  type Streets,
} from "../game/index.js";

/**
 * The board's geometry, as pure functions: how the city's map picture sits on the screen (its scale and how far the
 * camera may pan), where panels open, what a tap hits, and where each player stands on the streets. It is
 * presentation only: the rules walk the step graph of `../game/streets.ts`, and this file turns steps into points on
 * the map (map pixels, the city data's coordinate space) and points on the map into points on the screen.
 */
export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Screen space the board must leave free for the HUD (px). */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The map on a screen of `width` × `height` CSS px. */
export interface BoardView {
  width: number;
  height: number;
  /** A phone held upright: the map is as tall as the screen and pans sideways; panels use the full width. */
  compact: boolean;
  /** Screen px per map px. */
  scale: number;
  /** The map's size on screen. */
  mapWidth: number;
  mapHeight: number;
  /** The camera is where the map's top-left corner lands on screen: x in `minX..0`, y in `minY..0`. */
  minX: number;
  minY: number;
  /** The screen the HUD leaves free. */
  free: Rect;
  /** Where place panels, the briefing, the handoff and the result open. */
  panel: Rect;
}
export type Camera = Point;

const NO_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
/** A wide screen shorter than this (px) is short: a phone on its side. */
export const SHORT = 520;

/**
 * The map covers the whole screen, centred, never showing an edge: on a wide screen it fills the width (a little of
 * the top and bottom may pan), on a phone held upright it is as tall as the screen and pans sideways.
 */
export function boardView(
  width: number,
  height: number,
  map: { width: number; height: number } = CITY.map,
  insets: Insets = NO_INSETS,
  compact = width < 700 && height > width,
): BoardView {
  const w = Math.max(1, width),
    h = Math.max(1, height);
  const scale = Math.max(w / map.width, h / map.height);
  const mapWidth = map.width * scale,
    mapHeight = map.height * scale;
  const free: Rect = {
    x: insets.left,
    y: insets.top,
    w: Math.max(1, w - insets.left - insets.right),
    h: Math.max(1, h - insets.top - insets.bottom),
  };
  let panel: Rect;
  if (compact) {
    // A phone: the full width, between the HUD's top and bottom pieces.
    const margin = 8;
    panel = {
      x: free.x + margin,
      y: free.y + 4,
      w: Math.max(1, free.w - 2 * margin),
      h: Math.max(1, free.h - 8),
    };
  } else {
    // A short screen (a phone on its side) gives the panel all its width: there is little height for the cards.
    const pw = Math.min(
        free.w - 24,
        h < SHORT
          ? Math.min(880, free.w)
          : Math.max(520, Math.min(880, free.w * 0.62)),
      ),
      ph = Math.min(free.h - 16, Math.max(540, Math.min(680, free.h - 48)));
    panel = {
      x: Math.round(free.x + (free.w - pw) / 2),
      y: Math.round(free.y + Math.max(8, (free.h - ph) / 2)),
      w: Math.round(Math.max(1, pw)),
      h: Math.round(Math.max(1, ph)),
    };
  }
  return {
    width: w,
    height: h,
    compact,
    scale,
    mapWidth,
    mapHeight,
    minX: Math.min(0, w - mapWidth),
    minY: Math.min(0, h - mapHeight),
    free,
    panel,
  };
}

const clamp = (value: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, value));

/** A camera kept inside the map: no edge of the screen ever shows past the picture. */
export function clampCamera(view: BoardView, camera: Camera): Camera {
  return {
    x: clamp(camera.x, view.minX, 0),
    y: clamp(camera.y, view.minY, 0),
  };
}
/** The camera that puts map point `at` in the middle of the free screen (as near as the map's edges allow). */
export function centreOn(view: BoardView, at: MapPoint): Camera {
  return clampCamera(view, {
    x: view.free.x + view.free.w / 2 - at[0] * view.scale,
    y: view.free.y + view.free.h / 2 - at[1] * view.scale,
  });
}
/** One frame of the camera easing toward `target`: `rate` per second, frame-rate independent. */
export function easeCamera(
  camera: Camera,
  target: Camera,
  seconds: number,
  rate = 6,
): Camera {
  const keep = Math.exp(-rate * Math.max(0, seconds));
  const x = target.x + (camera.x - target.x) * keep,
    y = target.y + (camera.y - target.y) * keep;
  return {
    x: Math.abs(x - target.x) < 0.25 ? target.x : x,
    y: Math.abs(y - target.y) < 0.25 ? target.y : y,
  };
}
export const toScreen = (
  view: BoardView,
  camera: Camera,
  at: MapPoint,
): Point => ({
  x: camera.x + at[0] * view.scale,
  y: camera.y + at[1] * view.scale,
});
export const toMap = (
  view: BoardView,
  camera: Camera,
  x: number,
  y: number,
): MapPoint => [(x - camera.x) / view.scale, (y - camera.y) / view.scale];

/** Whether a point lies inside a polygon (even-odd rule). */
export function inside(shape: readonly MapPoint[], at: MapPoint): boolean {
  let hit = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const [xi, yi] = shape[i]!,
      [xj, yj] = shape[j]!;
    if (
      yi > at[1] !== yj > at[1] &&
      at[0] < ((xj - xi) * (at[1] - yi)) / (yj - yi) + xi
    )
      hit = !hit;
  }
  return hit;
}
/** A polygon's bounding box. */
export function bounds(shape: readonly MapPoint[]): Rect {
  const xs = shape.map((p) => p[0]),
    ys = shape.map((p) => p[1]);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Half a label's size, in map px. */
export interface LabelSize {
  w: number;
  h: number;
}

/**
 * The place a map point hits, or -1: its name label, or else a building's outline. `labels` are the labels' half sizes
 * in map px, one for every place or one for all (labels keep their size on screen while the map scales).
 */
export function placeAt(
  at: MapPoint,
  labels: LabelSize | readonly LabelSize[] = { w: 0, h: 0 },
  city: City = CITY,
): number {
  for (let place = 0; place < city.places.length; place++) {
    const [lx, ly] = city.places[place]!.label;
    const size = Array.isArray(labels)
      ? (labels as readonly LabelSize[])[place]
      : (labels as LabelSize);
    if (
      size &&
      Math.abs(at[0] - lx) <= size.w &&
      Math.abs(at[1] - ly) <= size.h
    )
      return place;
  }
  return city.places.findIndex((place) => inside(place.tap, at));
}

/** Where a step of the streets is on the map. */
export const stepPoint = (step: number, streets: Streets = STREETS): MapPoint =>
  streets.points[step] ?? streets.points[streets.start]!;

/** The direction of the street at a step (a unit vector pointing right, or down), from its neighbours. */
export function streetDirection(
  step: number,
  streets: Streets = STREETS,
): MapPoint {
  const around = streets.neighbours[step] ?? [];
  const a = stepPoint(around[0] ?? step, streets),
    b = stepPoint(around[around.length - 1] ?? step, streets);
  let dx = b[0] - a[0],
    dy = b[1] - a[1];
  if (dx < 0 || (dx === 0 && dy < 0)) [dx, dy] = [-dx, -dy];
  const norm = Math.sqrt(dx * dx + dy * dy);
  return norm > 0 ? [dx / norm, dy / norm] : [1, 0];
}

/**
 * The steps a walker took from `from` to `to` heading for `place` (both ends included), or undefined when `to` is not
 * on that way within `limit` steps (a new week's start at home, or a change of destination).
 */
export function route(
  from: number,
  to: number,
  place: number,
  limit = 8,
): number[] | undefined {
  const path = [from];
  let at = from;
  for (let k = 0; k < limit && at !== to; k++) {
    const next = nextStep(at, place);
    if (next === at) break;
    path.push(next);
    at = next;
  }
  return at === to ? path : undefined;
}

/**
 * Where a walker is between two frames: `fraction` of the way along its route from the step in the older frame to the
 * one in the newer, heading for `place` (-1: no destination, so it stands at `to`). Also the way it faces (−1 left,
 * +1 right, 0 standing).
 */
export function walkerAt(
  from: number,
  to: number,
  place: number,
  fraction: number,
  streets: Streets = STREETS,
): { at: MapPoint; facing: -1 | 0 | 1 } {
  const path = from === to || place < 0 ? undefined : route(from, to, place);
  if (!path) return { at: stepPoint(to, streets), facing: 0 };
  const f = clamp(fraction, 0, 1) * (path.length - 1),
    k = Math.min(path.length - 2, Math.floor(f)),
    a = stepPoint(path[k]!, streets),
    b = stepPoint(path[k + 1]!, streets),
    t = f - k;
  const dx = stepPoint(to, streets)[0] - stepPoint(from, streets)[0];
  return {
    at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    facing: dx < -0.5 ? -1 : dx > 0.5 ? 1 : 0,
  };
}

/** Where the people inside a place wait: on the sidewalk in front of it, a little off the door toward the building. */
export function standPoint(place: number, city: City = CITY): MapPoint {
  const data = city.places[place]!;
  const door =
    city.nodes.find((node) => node.id === data.door)?.at ?? city.nodes[0]!.at;
  const box = bounds(data.tap),
    dx = box.x + box.w / 2 - door[0],
    dy = box.y + box.h / 2 - door[1],
    d = Math.sqrt(dx * dx + dy * dy);
  if (d === 0) return door;
  const reach = Math.min(22, d * 0.5);
  return [door[0] + (dx / d) * reach, door[1] + (dy / d) * reach];
}

/**
 * Where each player is drawn, in map px: walking along the streets, or waiting in front of the place they are in.
 * Players at the same door, or on the same spot of a street, stand side by side along it, `spacing` apart.
 */
export function standingPoints(
  players: readonly { at: MapPoint; step: number; inside: number }[],
  spacing: number,
  city: City = CITY,
  streets: Streets = STREETS,
): MapPoint[] {
  const groups = new Map<string, number[]>();
  players.forEach((player, index) => {
    const key =
      player.inside >= 0
        ? `in${player.inside}`
        : `at${Math.round(player.at[0] / 8)},${Math.round(player.at[1] / 8)}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  const points: MapPoint[] = [];
  for (const members of groups.values())
    members.forEach((index, k) => {
      const player = players[index]!;
      const base =
        player.inside >= 0 ? standPoint(player.inside, city) : player.at;
      const step =
        player.inside >= 0 ? streets.doors[player.inside]! : player.step;
      const [tx, ty] = streetDirection(step, streets);
      const spread = (k - (members.length - 1) / 2) * spacing;
      points[index] = [base[0] + tx * spread, base[1] + ty * spread];
    });
  return points;
}
