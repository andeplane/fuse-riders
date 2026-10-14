import type { TrailPoint, TrailStroke } from "./trails.js";

export interface RibbonVertex extends TrailPoint {
  /** Surface normal in the arena plane, in units of the body radius. */
  nx: number;
  ny: number;
}

// Extra geometry carries the antialiased edge and a restrained halo. The solid body
// follows the authoritative centerline at the supplied cosmetic width.
const OUTER = 1.8;
const CAP_STEPS = 16;

interface Normal {
  x: number;
  y: number;
}

const normalAt = (from: TrailPoint, to: TrailPoint): Normal => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return { x: -dy / length, y: dx / length };
};

/** One cross section: the two rim vertices at `point`, mitred between the segments that meet there. */
function crossSection(
  point: TrailPoint,
  before: Normal,
  after: Normal,
  radius: number,
): [RibbonVertex, RibbonVertex] {
  const sumX = before.x + after.x;
  const sumY = before.y + after.y;
  const length = Math.hypot(sumX, sumY);
  const normal = length > 1e-6 ? { x: sumX / length, y: sumY / length } : after;
  // Bound miters even for malformed/sharply corrected presentation paths.
  const miter = 1 / Math.max(0.5, normal.x * after.x + normal.y * after.y);
  const vertex = (side: number): RibbonVertex => ({
    x: point.x + normal.x * radius * OUTER * miter * side,
    y: point.y + normal.y * radius * OUTER * miter * side,
    nx: normal.x * OUTER * side,
    ny: normal.y * OUTER * side,
  });
  return [vertex(-1), vertex(1)];
}

/** A hemispherical end, as a fan of `CAP_STEPS` triangles around the endpoint. */
function endCap(
  point: TrailPoint,
  normal: Normal,
  radius: number,
  start: boolean,
): RibbonVertex[] {
  const angle = Math.atan2(normal.y, normal.x) + (start ? 0 : Math.PI);
  const center = { ...point, nx: 0, ny: 0 };
  const edge = (step: number): RibbonVertex => {
    const a = angle + (step / CAP_STEPS) * Math.PI;
    const nx = Math.cos(a) * OUTER;
    const ny = Math.sin(a) * OUTER;
    return { x: point.x + nx * radius, y: point.y + ny * radius, nx, ny };
  };
  const vertices: RibbonVertex[] = [];
  for (let i = 0; i < CAP_STEPS; i++)
    vertices.push(center, edge(i), edge(i + 1));
  return vertices;
}

/** A continuous triangle ribbon, with shared cross sections and hemispherical ends. */
export function trailRibbon(
  path: readonly TrailPoint[],
  radius: number,
): RibbonVertex[] {
  const points = path.filter(
    (p, i) =>
      i === 0 || Math.hypot(p.x - path[i - 1]!.x, p.y - path[i - 1]!.y) > 1e-6,
  );
  if (points.length < 2) return [];
  // At least two points remain; each segment has a normal and all indexes below
  // are bounded by the corresponding point/segment loop.
  const normals = points.slice(1).map((p, i) => normalAt(points[i]!, p));
  const sections = points.map((p, i) =>
    crossSection(
      p,
      normals[Math.max(0, i - 1)]!,
      normals[Math.min(i, normals.length - 1)]!,
      radius,
    ),
  );
  const vertices: RibbonVertex[] = [];
  for (let i = 1; i < sections.length; i++) {
    const [a, b] = sections[i - 1]!;
    const [c, d] = sections[i]!;
    vertices.push(a, b, c, b, d, c);
  }
  vertices.push(...endCap(points[0]!, normals[0]!, radius, true));
  vertices.push(
    ...endCap(
      points[points.length - 1]!,
      normals[normals.length - 1]!,
      radius,
      false,
    ),
  );
  return vertices;
}

/**
 * One path's ribbon, re-cut at a shared prefix instead of rebuilt.
 *
 * A trail path only ever grows at its end — by the tick's new segment and by the fractional tip, which
 * moves every frame — so the sections and body triangles behind that end are still exactly right. Only the
 * last cross section (its miter changes when a point is added beyond it) and the end cap are recomputed.
 * The result is bit-identical to `trailRibbon` on the same path: it is the same arithmetic, in the same
 * order, over the same points. When the path diverges earlier than its end, everything from there is
 * rebuilt, which is what a shortened, eroded or rolled-back path gets.
 */
export class TrailRibbonBuilder {
  /** The raw points consumed, before the degenerate-point filter. */
  private source: TrailPoint[] = [];
  /** How many filtered points each raw prefix produces, so a raw prefix maps onto retained geometry. */
  private kept: number[] = [];
  private points: TrailPoint[] = [];
  private normals: Normal[] = [];
  private sections: [RibbonVertex, RibbonVertex][] = [];
  /** The body triangles: six vertices per section boundary, in draw order. Never handed out. */
  private body: RibbonVertex[] = [];
  private cap: RibbonVertex[] = [];
  private vertices: RibbonVertex[] = [];

  constructor(private readonly radius: number) {}

  update(path: readonly TrailPoint[]): {
    vertices: RibbonVertex[];
    changed: boolean;
  } {
    let shared = 0;
    const common = Math.min(path.length, this.source.length);
    while (
      shared < common &&
      path[shared]!.x === this.source[shared]!.x &&
      path[shared]!.y === this.source[shared]!.y
    )
      shared++;
    if (shared === path.length && shared === this.source.length)
      return { vertices: this.vertices, changed: false };
    this.source.length = shared;
    this.kept.length = shared;
    // A raw point is kept or dropped by its own distance from the point before it, so a shared raw prefix
    // produces a shared filtered prefix, and `points` truncates to exactly that many.
    const retained = shared ? this.kept[shared - 1]! : 0;
    this.points.length = retained;
    this.normals.length = Math.max(0, retained - 1);
    this.sections.length = Math.max(0, retained - 1);
    this.body.length = Math.max(0, 6 * (retained - 2));
    if (retained < 2) this.cap = [];
    for (let i = shared; i < path.length; i++) {
      const point = path[i]!;
      this.source.push(point);
      const keep =
        i === 0 ||
        Math.hypot(point.x - path[i - 1]!.x, point.y - path[i - 1]!.y) > 1e-6;
      this.kept.push((i ? this.kept[i - 1]! : 0) + (keep ? 1 : 0));
      if (keep) this.points.push(point);
    }
    const points = this.points;
    const count = points.length;
    // Fewer than two distinct points draw nothing; the retained prefix above is already empty.
    if (count < 2) {
      this.vertices = [];
      return { vertices: this.vertices, changed: true };
    }
    for (let i = this.normals.length; i < count - 1; i++)
      this.normals.push(normalAt(points[i]!, points[i + 1]!));
    for (let i = this.sections.length; i < count; i++)
      this.sections.push(
        crossSection(
          points[i]!,
          this.normals[Math.max(0, i - 1)]!,
          this.normals[Math.min(i, count - 2)]!,
          this.radius,
        ),
      );
    for (let i = Math.max(1, retained - 1); i < count; i++) {
      const [a, b] = this.sections[i - 1]!;
      const [c, d] = this.sections[i]!;
      this.body.push(a, b, c, b, d, c);
    }
    if (!this.cap.length)
      this.cap = endCap(points[0]!, this.normals[0]!, this.radius, true);
    this.vertices = this.body.concat(
      this.cap,
      endCap(points[count - 1]!, this.normals[count - 2]!, this.radius, false),
    );
    return { vertices: this.vertices, changed: true };
  }
}

export interface TrailRibbon {
  vertices: RibbonVertex[];
  color: number;
}

/** A path is identified by where it starts: it grows at its end and is otherwise fixed. */
const pathKey = (path: readonly TrailPoint[]): string =>
  path.length ? `${path[0]!.x},${path[0]!.y}` : "";

const tint = (color: string): number =>
  /^#[0-9a-f]{6}$/i.test(color) ? parseInt(color.slice(1), 16) : 0xffffff;

/**
 * Triangles for the strokes of one frame. Paths the frame did not change keep the geometry built for them
 * earlier; a path that only grew is extended rather than rebuilt. Nothing here keeps frame history or a
 * simulation clock: everything it holds is derived from the supplied strokes, and a path the strokes stop
 * mentioning is dropped with them.
 */
export class TrailRibbonCache {
  private builders = new Map<string, TrailRibbonBuilder>();
  private ribbons: readonly TrailRibbon[] = [];
  /** Which paths made the ribbon at each index, so a shifted list never reuses a neighbour's triangles. */
  private signatures: string[] = [];

  constructor(private readonly width: number) {}

  update(strokes: readonly TrailStroke[]): readonly TrailRibbon[] {
    const builders = new Map<string, TrailRibbonBuilder>();
    const ribbons: TrailRibbon[] = [];
    const signatures: string[] = [];
    let changed = strokes.length !== this.ribbons.length;
    for (const [index, stroke] of strokes.entries()) {
      const color = tint(stroke.color);
      const previous = this.ribbons[index];
      let stale = previous === undefined || previous.color !== color;
      const parts: RibbonVertex[][] = [];
      const keys: string[] = [];
      for (const path of stroke.paths) {
        const key = pathKey(path);
        // A key already taken this frame belongs to another path; that one starts from scratch.
        const builder =
          (builders.has(key) ? undefined : this.builders.get(key)) ??
          new TrailRibbonBuilder(this.width / 2);
        const built = builder.update(path);
        if (built.changed) stale = true;
        builders.set(key, builder);
        parts.push(built.vertices);
        keys.push(key);
      }
      const signature = keys.join("|");
      signatures.push(signature);
      if (!stale && this.signatures[index] === signature) {
        ribbons.push(previous!);
        continue;
      }
      changed = true;
      ribbons.push({
        vertices:
          parts.length === 1
            ? parts[0]!
            : ([] as RibbonVertex[]).concat(...parts),
        color,
      });
    }
    this.builders = builders;
    this.signatures = signatures;
    if (!changed) return this.ribbons;
    this.ribbons = ribbons;
    return this.ribbons;
  }
}
