import { RING } from "../game/index.js";

/**
 * The board's geometry, as pure functions of the screen's size: a loop street (a rounded rectangle) around a park,
 * a ring of building lots outside it, and the rectangles where the HUD-free middle of the board shows panels. It is
 * presentation only: the rules still count steps on a ring of `RING`, and `ringToT` maps a ring position onto the
 * drawn street so that every place's ring position lands at the door of its building.
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
export type Side = "top" | "right" | "bottom" | "left";
/** A building lot: its centre, the street side it faces and its position on the street (0..1, clockwise). */
export interface Lot extends Point {
  side: Side;
  t: number;
}

export interface Geometry {
  width: number;
  height: number;
  /** The street's centre line: a rounded rectangle and its corner radius. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
  /** Width of the asphalt, of each sidewalk, and of a building sprite. */
  road: number;
  walk: number;
  size: number;
  /** Portrait phone: a tall loop, and panels that use the full width. */
  compact: boolean;
  /** Inside the inner sidewalk. */
  park: Rect;
  /** Where place panels, the briefing, the handoff and the result open. */
  panel: Rect;
  /** Every lot around the loop, clockwise from the top left corner. */
  lots: Lot[];
  /** The lot of each place (by place index); the other lots are little parks. */
  placeLot: number[];
  /** Places sorted by ring position, with their ring and street position: `ringToT` interpolates between them. */
  knots: { ring: number; t: number }[];
}

const NO_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
/** Fewest lots a layout may have: every place plus a couple of little parks. */
export const MIN_LOTS = 15;

/** The street's dimensions for building size `size`. */
function streetFor(size: number) {
  return {
    road: Math.max(16, size * 0.3),
    walk: Math.max(7, size * 0.11),
    gap: size * 0.04,
  };
}

/** Lot centres around the rectangle (x0, y0)–(x1, y1), clockwise from its top left corner, at least `spacing` apart. */
export function lotRing(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  spacing: number,
): { x: number; y: number; side: Side }[] {
  const lots: { x: number; y: number; side: Side }[] = [];
  const across = Math.max(1, Math.floor((x1 - x0) / spacing)),
    down = Math.max(1, Math.floor((y1 - y0) / spacing));
  for (let i = 0; i <= across; i++)
    lots.push({ x: x0 + ((x1 - x0) * i) / across, y: y0, side: "top" });
  for (let i = 1; i < down; i++)
    lots.push({ x: x1, y: y0 + ((y1 - y0) * i) / down, side: "right" });
  for (let i = 0; i <= across; i++)
    lots.push({ x: x1 - ((x1 - x0) * i) / across, y: y1, side: "bottom" });
  for (let i = 1; i < down; i++)
    lots.push({ x: x0, y: y1 - ((y1 - y0) * i) / down, side: "left" });
  return lots;
}

/** The street's length segments: top, corner, right, corner, bottom, corner, left, corner. */
function segments(
  g: Pick<Geometry, "left" | "right" | "top" | "bottom" | "radius">,
) {
  const r = g.radius,
    w = g.right - g.left - 2 * r,
    h = g.bottom - g.top - 2 * r,
    arc = (Math.PI / 2) * r;
  return [w, arc, h, arc, w, arc, h, arc];
}

/**
 * The point on the street at position `t` (0..1, wrapping), clockwise from where the top straight begins, moved
 * `offset` px outward (negative: toward the park), with the outward normal there.
 */
export function streetPoint(
  g: Pick<Geometry, "left" | "right" | "top" | "bottom" | "radius">,
  t: number,
  offset = 0,
): Point & { nx: number; ny: number } {
  const r = g.radius,
    parts = segments(g),
    total = parts.reduce((sum, length) => sum + length, 0);
  let d = (((t % 1) + 1) % 1) * total;
  const corners = [
    { x: g.right - r, y: g.top + r, from: -Math.PI / 2 },
    { x: g.right - r, y: g.bottom - r, from: 0 },
    { x: g.left + r, y: g.bottom - r, from: Math.PI / 2 },
    { x: g.left + r, y: g.top + r, from: Math.PI },
  ];
  for (let index = 0; index < 8; index++) {
    const length = parts[index]!;
    if (d <= length || index === 7) {
      const f = length > 0 ? Math.min(1, d / length) : 0;
      const w = parts[0]!,
        h = parts[2]!;
      let x: number, y: number, nx: number, ny: number;
      switch (index) {
        case 0:
          [x, y, nx, ny] = [g.left + r + f * w, g.top, 0, -1];
          break;
        case 2:
          [x, y, nx, ny] = [g.right, g.top + r + f * h, 1, 0];
          break;
        case 4:
          [x, y, nx, ny] = [g.right - r - f * w, g.bottom, 0, 1];
          break;
        case 6:
          [x, y, nx, ny] = [g.left, g.bottom - r - f * h, -1, 0];
          break;
        default: {
          const corner = corners[(index - 1) / 2]!,
            angle = corner.from + (f * Math.PI) / 2;
          nx = Math.cos(angle);
          ny = Math.sin(angle);
          x = corner.x + nx * r;
          y = corner.y + ny * r;
        }
      }
      return { x: x + nx * offset, y: y + ny * offset, nx, ny };
    }
    d -= length;
  }
  /* c8 ignore next */
  return { x: g.left, y: g.top, nx: 0, ny: -1 };
}

/** The street position nearest to a point (sampled finely: the board asks once per layout). */
export function nearestT(
  g: Pick<Geometry, "left" | "right" | "top" | "bottom" | "radius">,
  point: Point,
  samples = 720,
): number {
  let best = 0,
    bestDistance = Infinity;
  for (let i = 0; i < samples; i++) {
    const t = i / samples,
      p = streetPoint(g, t),
      distance = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (distance < bestDistance) {
      best = t;
      bestDistance = distance;
    }
  }
  return best;
}

const wrap = (value: number) => ((value % 1) + 1) % 1;
const circular = (a: number, b: number) => {
  const d = Math.abs(wrap(a) - wrap(b));
  return Math.min(d, 1 - d);
};

/**
 * Gives each place a lot, keeping the places' order around the loop and putting each as near its ring position as
 * the lots allow (least squares, by dynamic programming over places in ring order and lots in street order). Returns
 * the lot index of each place, by place index.
 */
export function assignLots(
  rings: readonly number[],
  lots: readonly { t: number }[],
): number[] {
  const places = rings
      .map((ring, index) => ({ ring, index }))
      .sort((a, b) => a.ring - b.ring),
    order = lots
      .map((lot, index) => ({ t: lot.t, index }))
      .sort((a, b) => a.t - b.t);
  const n = places.length,
    m = order.length;
  if (m < n) throw new Error(`${n} places need at least ${n} lots, got ${m}`);
  // cost[i][j]: the best cost of placing the first i places on the first j lots.
  const cost = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(Infinity),
  );
  const took = Array.from({ length: n + 1 }, () =>
    new Array<boolean>(m + 1).fill(false),
  );
  for (let j = 0; j <= m; j++) cost[0]![j] = 0;
  for (let i = 1; i <= n; i++)
    for (let j = i; j <= m; j++) {
      const skip = cost[i]![j - 1]!,
        here =
          cost[i - 1]![j - 1]! +
          circular(places[i - 1]!.ring / RING, order[j - 1]!.t) ** 2;
      if (here <= skip) {
        cost[i]![j] = here;
        took[i]![j] = true;
      } else cost[i]![j] = skip;
    }
  const result = new Array<number>(n).fill(-1);
  for (let i = n, j = m; i > 0; j--) {
    if (took[i]![j]) {
      result[places[i - 1]!.index] = order[j - 1]!.index;
      i--;
    }
  }
  return result;
}

/** One candidate layout for building size `size`, or undefined when it does not fit. */
function layoutFor(
  width: number,
  height: number,
  insets: Insets,
  size: number,
  compact: boolean,
  rings: readonly number[],
): Geometry | undefined {
  const { road, walk, gap } = streetFor(size);
  const reach = road / 2 + walk + gap + size * 0.5;
  // Lot centres: half a sprite in from the free edges (the sprite reaches a little higher than its lot).
  const x0 = insets.left + size * 0.52,
    x1 = width - insets.right - size * 0.52,
    y0 = insets.top + size * 0.5,
    y1 = height - insets.bottom - size * 0.52;
  const left = x0 + reach,
    right = x1 - reach,
    top = y0 + reach,
    bottom = y1 - reach;
  const inner = road / 2 + walk;
  const park: Rect = {
    x: left + inner,
    y: top + inner,
    w: right - left - 2 * inner,
    h: bottom - top - 2 * inner,
  };
  const minimum = compact ? [0.22, 0.3] : [0.34, 0.34];
  if (
    park.w < Math.max(60, width * minimum[0]!) ||
    park.h < Math.max(60, height * minimum[1]!)
  )
    return;
  const radius = Math.min(
    Math.max(road * 1.4, Math.min(park.w, park.h) * 0.12),
    (right - left) / 2,
    (bottom - top) / 2,
  );
  const street = { left, right, top, bottom, radius };
  const ring = lotRing(x0, y0, x1, y1, size * 1.04);
  if (ring.length < Math.max(MIN_LOTS, rings.length)) return;
  const lots: Lot[] = ring.map((lot) => ({ ...lot, t: nearestT(street, lot) }));
  const placeLot = assignLots(rings, lots);
  const knots = rings
    .map((ring, index) => ({ ring, t: lots[placeLot[index]!]!.t }))
    .sort((a, b) => a.ring - b.ring);
  const free = {
    x: insets.left,
    y: insets.top,
    w: width - insets.left - insets.right,
    h: height - insets.top - insets.bottom,
  };
  let panel: Rect;
  if (compact) {
    // A phone: the full width, and the board's middle with a glimpse of the top and bottom rows.
    const margin = 8,
      y = free.y + Math.min(size * 0.35, free.h * 0.06),
      h = free.y + free.h - Math.min(size * 0.35, free.h * 0.06) - y;
    panel = { x: free.x + margin, y, w: free.w - 2 * margin, h };
  } else {
    const w = Math.min(free.w - 24, Math.max(520, Math.min(880, park.w - 24))),
      h = Math.min(free.h - 16, Math.max(540, Math.min(680, park.h - 16)));
    panel = {
      x: Math.round(park.x + park.w / 2 - w / 2),
      y: Math.round(Math.max(free.y + 8, park.y + park.h / 2 - h / 2)),
      w: Math.round(w),
      h: Math.round(h),
    };
  }
  return {
    width,
    height,
    ...street,
    road,
    walk,
    size,
    compact,
    park,
    panel,
    lots,
    placeLot,
    knots,
  };
}

/**
 * The board for a canvas of `width` × `height` CSS px, with `insets` kept free for the HUD: the biggest buildings
 * that still leave room for every place, a couple of little parks and a park in the middle.
 */
export function geometry(
  width: number,
  height: number,
  rings: readonly number[],
  insets: Insets = NO_INSETS,
  compact = width < 700 && height > width,
): Geometry {
  const short = Math.min(width, height);
  const biggest = Math.max(40, Math.min(190, short * (compact ? 0.3 : 0.2)));
  for (let size = biggest; size >= 24; size -= 2) {
    const layout = layoutFor(width, height, insets, size, compact, rings);
    if (layout) return layout;
  }
  // A tiny screen: no inset, small buildings, whatever fits.
  for (let size = 24; size >= 8; size -= 2) {
    const layout = layoutFor(
      Math.max(width, 200),
      Math.max(height, 200),
      NO_INSETS,
      size,
      compact,
      rings,
    );
    if (layout) return { ...layout, width, height };
  }
  /* c8 ignore next */
  throw new Error(`No board fits ${width}x${height}`);
}

/** The street position of ring position `ring` (fractional): each place's ring lands on its lot, linear between. */
export function ringToT(g: Pick<Geometry, "knots">, ring: number): number {
  const knots = g.knots,
    n = knots.length;
  const at = ((ring % RING) + RING) % RING;
  let k = n - 1;
  for (let i = 0; i < n; i++)
    if (knots[i]!.ring <= at) k = i;
    else break;
  const a = knots[k]!,
    b = knots[(k + 1) % n]!;
  const span = (b.ring - a.ring + RING) % RING || RING,
    into = (at - a.ring + RING) % RING,
    reach = wrap(b.t - a.t) || 1;
  return wrap(a.t + (reach * into) / span);
}

/** A ring position between two others, the short way round. */
export function ringBetween(
  from: number,
  to: number,
  fraction: number,
): number {
  let delta = to - from;
  if (delta > RING / 2) delta -= RING;
  if (delta < -RING / 2) delta += RING;
  return (from + delta * Math.max(0, Math.min(1, fraction)) + RING) % RING;
}

/** The box a building's sprite covers on its lot, for taps. */
export function lotBox(g: Pick<Geometry, "size">, lot: Point): Rect {
  const s = g.size;
  return { x: lot.x - s * 0.5, y: lot.y - s * 0.52, w: s, h: s * 1.02 };
}

/** The place under a point, or -1. */
export function placeAt(g: Geometry, x: number, y: number): number {
  let found = -1;
  g.placeLot.forEach((lotIndex, place) => {
    const box = lotBox(g, g.lots[lotIndex]!);
    if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h)
      found = place;
  });
  return found;
}

/** Where a walker at ring position `ring` stands: on the inner sidewalk. */
export function walkPoint(g: Geometry, ring: number): Point {
  return streetPoint(g, ringToT(g, ring), -(g.road / 2 + g.walk * 0.5));
}

/** The door of a place: on the outer sidewalk in front of its lot. */
export function doorPoint(
  g: Geometry,
  place: number,
): Point & { nx: number; ny: number } {
  return streetPoint(
    g,
    g.lots[g.placeLot[place]!]!.t,
    g.road / 2 + g.walk * 0.55,
  );
}
