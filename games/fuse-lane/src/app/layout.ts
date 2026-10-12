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

/**
 * The street's centre line: a smooth closed curve (a rounded, gently wobbling loop), sampled densely and walked by
 * arc length. `t` runs 0..1 clockwise from the top middle; every sample has its outward normal.
 */
export interface Street {
  xs: number[];
  ys: number[];
  nxs: number[];
  nys: number[];
  /** Arc length from the start to each sample; the last entry closes the loop. */
  lengths: number[];
  total: number;
}

export interface Geometry {
  width: number;
  height: number;
  /** The street's centre line and its bounding box. */
  street: Street;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Width of the asphalt, of each sidewalk, and of a building sprite. */
  road: number;
  walk: number;
  size: number;
  /** Portrait phone: a tall loop, and panels that use the full width. */
  compact: boolean;
  /** The biggest rectangle inside the inner sidewalk. */
  park: Rect;
  /** Where place panels, the briefing, the handoff and the result open. */
  panel: Rect;
  /** Every lot around the loop, clockwise from the top middle. */
  lots: Lot[];
  /** The lot of each place (by place index); the other lots stay lawn. */
  placeLot: number[];
  /** Places sorted by ring position, with their ring and street position: `ringToT` interpolates between them. */
  knots: { ring: number; t: number }[];
}

const NO_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
/** Fewest lots a layout may have: every place plus a couple of empty ones. */
export const MIN_LOTS = 15;
/** Samples on the street's centre line. */
const SAMPLES = 960;

/** The street's dimensions for building size `size`. */
function streetFor(size: number) {
  return {
    road: Math.max(14, size * 0.26),
    walk: Math.max(5, size * 0.08),
    gap: size * 0.1,
  };
}

/**
 * The loop for the box (left, top)–(right, bottom): a squircle (rounder than a rectangle, fuller than an ellipse)
 * with a few slow bends, scaled back to fill the box exactly.
 */
export function makeStreet(
  left: number,
  top: number,
  right: number,
  bottom: number,
  samples = SAMPLES,
): Street {
  const cx = (left + right) / 2,
    cy = (top + bottom) / 2;
  const raw: [number, number][] = [];
  for (let i = 0; i < samples; i++) {
    const angle = -Math.PI / 2 + (i / samples) * Math.PI * 2,
      c = Math.cos(angle),
      s = Math.sin(angle);
    // Exponent 2/3 of a superellipse (n = 3), plus gentle bends that change along the loop.
    const bend =
      1 +
      0.05 * Math.sin(3 * angle + 0.6) +
      0.03 * Math.sin(5 * angle + 2.1) +
      0.015 * Math.cos(2 * angle);
    raw.push([
      Math.sign(c) * Math.abs(c) ** (2 / 3) * bend,
      Math.sign(s) * Math.abs(s) ** (2 / 3) * bend,
    ]);
  }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of raw) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const xs = raw.map(
      ([x]) => left + ((x - minX) / (maxX - minX)) * (right - left),
    ),
    ys = raw.map(
      ([, y]) => top + ((y - minY) / (maxY - minY)) * (bottom - top),
    );
  const nxs: number[] = [],
    nys: number[] = [],
    lengths: number[] = [0];
  for (let i = 0; i < samples; i++) {
    const a = (i - 1 + samples) % samples,
      b = (i + 1) % samples;
    const dx = xs[b]! - xs[a]!,
      dy = ys[b]! - ys[a]!,
      d = Math.hypot(dx, dy) || 1;
    // Clockwise on screen (y down): the outward normal is the tangent turned a quarter to the left.
    let nx = dy / d,
      ny = -dx / d;
    if (nx * (xs[i]! - cx) + ny * (ys[i]! - cy) < 0) [nx, ny] = [-nx, -ny];
    nxs.push(nx);
    nys.push(ny);
    const next = (i + 1) % samples;
    lengths.push(
      lengths[i]! + Math.hypot(xs[next]! - xs[i]!, ys[next]! - ys[i]!),
    );
  }
  return { xs, ys, nxs, nys, lengths, total: lengths[samples]! };
}

/**
 * The point on the street at position `t` (0..1, wrapping), clockwise from the top middle, moved `offset` px outward
 * (negative: toward the park), with the outward normal there.
 */
export function streetPoint(
  g: Pick<Geometry, "street">,
  t: number,
  offset = 0,
): Point & { nx: number; ny: number } {
  const { xs, ys, nxs, nys, lengths, total } = g.street,
    n = xs.length;
  const d = (((t % 1) + 1) % 1) * total;
  let lo = 0,
    hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const a = lo % n,
    b = (lo + 1) % n,
    span = lengths[lo + 1]! - lengths[lo]!,
    f = span > 0 ? (d - lengths[lo]!) / span : 0;
  let nx = nxs[a]! + (nxs[b]! - nxs[a]!) * f,
    ny = nys[a]! + (nys[b]! - nys[a]!) * f;
  const norm = Math.hypot(nx, ny) || 1;
  nx /= norm;
  ny /= norm;
  const x = xs[a]! + (xs[b]! - xs[a]!) * f,
    y = ys[a]! + (ys[b]! - ys[a]!) * f;
  return { x: x + nx * offset, y: y + ny * offset, nx, ny };
}

/** The street position nearest to a point. */
export function nearestT(g: Pick<Geometry, "street">, point: Point): number {
  const { xs, ys, lengths, total } = g.street;
  let best = 0,
    bestDistance = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const distance = (xs[i]! - point.x) ** 2 + (ys[i]! - point.y) ** 2;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return lengths[best]! / total;
}

/**
 * Lot centres `reach` px outside the street, as many as fit with neighbouring square lots at least `spacing` apart
 * (the larger of the x and y distance, so axis-aligned lots never touch, on the bends too), spread out evenly.
 */
export function lotsAlong(
  g: Pick<Geometry, "street">,
  reach: number,
  spacing: number,
): Lot[] {
  const steps = 1440,
    points = Array.from({ length: steps }, (_, i) => {
      const t = i / steps;
      return { ...streetPoint(g, t, reach), t };
    });
  const apart = (a: Point, b: Point) =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  /** Greedy lots at `gap` apart from the first sample; the gap that closes the loop comes last. */
  const greedy = (gap: number) => {
    const picked = [0];
    for (let i = 1; i < steps; i++)
      if (apart(points[i]!, points[picked[picked.length - 1]!]!) >= gap)
        picked.push(i);
    while (
      picked.length > 1 &&
      apart(points[picked[picked.length - 1]!]!, points[0]!) < gap
    )
      picked.pop();
    return picked;
  };
  // The widest gap that still fits as many lots as `spacing` does: the lots spread evenly round the loop.
  const count = greedy(spacing).length;
  let low = spacing,
    high = spacing * 2;
  for (let k = 0; k < 24; k++) {
    const mid = (low + high) / 2;
    if (greedy(mid).length >= count) low = mid;
    else high = mid;
  }
  return greedy(low).map((index) => {
    const p = points[index]!;
    const side: Side =
      Math.abs(p.nx) > Math.abs(p.ny)
        ? p.nx > 0
          ? "right"
          : "left"
        : p.ny > 0
          ? "bottom"
          : "top";
    return { x: p.x, y: p.y, side, t: p.t };
  });
}

/** The biggest centred rectangle inside the street's inner sidewalk (`inner` px in from the centre line). */
function parkFor(g: Pick<Geometry, "street">, inner: number): Rect {
  const edge = Array.from({ length: 360 }, (_, i) =>
    streetPoint(g, i / 360, -inner),
  );
  const cx = edge.reduce((sum, p) => sum + p.x, 0) / edge.length,
    cy = edge.reduce((sum, p) => sum + p.y, 0) / edge.length;
  const reachX = Math.max(...edge.map((p) => Math.abs(p.x - cx)));
  const candidates: { hw: number; hh: number }[] = [];
  for (let k = 1; k <= 60; k++) {
    const hw = (reachX * k) / 60;
    // No edge point may fall inside the rectangle: those within the half width cap the half height.
    let hh = Infinity;
    for (const p of edge)
      if (Math.abs(p.x - cx) < hw) hh = Math.min(hh, Math.abs(p.y - cy));
    candidates.push({ hw, hh });
  }
  // The widest that keeps most of the height: the rivals sit in its corners and the panel centres on it.
  const tallest = candidates[0]!.hh;
  let best = candidates[0]!;
  for (const candidate of candidates)
    if (
      candidate.hh >= tallest * 0.6 &&
      candidate.hw * candidate.hh >= best.hw * best.hh * 0.9 &&
      candidate.hw > best.hw
    )
      best = candidate;
  return { x: cx - best.hw, y: cy - best.hh, w: 2 * best.hw, h: 2 * best.hh };
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
    y0 = insets.top + size * 0.53,
    y1 = height - insets.bottom - size * 0.52;
  const left = x0 + reach,
    right = x1 - reach,
    top = y0 + reach,
    bottom = y1 - reach;
  const inner = road / 2 + walk;
  const minimum = compact ? [0.22, 0.3] : [0.34, 0.34];
  if (
    right - left - 2 * inner < Math.max(60, width * minimum[0]!) ||
    bottom - top - 2 * inner < Math.max(60, height * minimum[1]!)
  )
    return;
  const street = { street: makeStreet(left, top, right, bottom) };
  const lots = lotsAlong(street, reach, size * 1.08);
  if (lots.length < Math.max(MIN_LOTS, rings.length)) return;
  // Every lot on the screen, clear of the HUD, and no two lots touching.
  const boxes = lots.map((lot) => lotBox({ size }, lot));
  for (const box of boxes)
    if (
      box.x < insets.left - 1 ||
      box.x + box.w > width - insets.right + 1 ||
      box.y < insets.top - 1 ||
      box.y + box.h > height - insets.bottom + 1
    )
      return;
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!,
      b = boxes[(i + 1) % boxes.length]!;
    if (
      Math.abs(a.x - b.x) < size * 0.995 &&
      Math.abs(a.y - b.y) < size * 1.015
    )
      return;
  }
  const park = parkFor(street, inner);
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
    left,
    top,
    right,
    bottom,
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
  const biggest = Math.max(40, Math.min(190, short * (compact ? 0.3 : 0.17)));
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
