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
  const normals = points.slice(1).map((p, i) => {
    const dx = p.x - points[i]!.x;
    const dy = p.y - points[i]!.y;
    const length = Math.hypot(dx, dy);
    return { x: -dy / length, y: dx / length };
  });
  const sections = points.map((p, i) => {
    const before = normals[Math.max(0, i - 1)]!;
    const after = normals[Math.min(i, normals.length - 1)]!;
    const sumX = before.x + after.x;
    const sumY = before.y + after.y;
    const length = Math.hypot(sumX, sumY);
    const normal =
      length > 1e-6 ? { x: sumX / length, y: sumY / length } : after;
    // Bound miters even for malformed/sharply corrected presentation paths.
    const miter = 1 / Math.max(0.5, normal.x * after.x + normal.y * after.y);
    const vertex = (side: number): RibbonVertex => ({
      x: p.x + normal.x * radius * OUTER * miter * side,
      y: p.y + normal.y * radius * OUTER * miter * side,
      nx: normal.x * OUTER * side,
      ny: normal.y * OUTER * side,
    });
    return [vertex(-1), vertex(1)] as const;
  });
  const vertices: RibbonVertex[] = [];
  for (let i = 1; i < sections.length; i++) {
    const [a, b] = sections[i - 1]!;
    const [c, d] = sections[i]!;
    vertices.push(a, b, c, b, d, c);
  }
  const cap = (p: TrailPoint, normal: TrailPoint, start: boolean) => {
    const angle = Math.atan2(normal.y, normal.x) + (start ? 0 : Math.PI);
    const center = { ...p, nx: 0, ny: 0 };
    const edge = (step: number): RibbonVertex => {
      const a = angle + (step / CAP_STEPS) * Math.PI;
      const nx = Math.cos(a) * OUTER;
      const ny = Math.sin(a) * OUTER;
      return { x: p.x + nx * radius, y: p.y + ny * radius, nx, ny };
    };
    for (let i = 0; i < CAP_STEPS; i++)
      vertices.push(center, edge(i), edge(i + 1));
  };
  cap(points[0]!, normals[0]!, true);
  cap(points[points.length - 1]!, normals[normals.length - 1]!, false);
  return vertices;
}

export interface TrailRibbon {
  vertices: RibbonVertex[];
  color: number;
}

export class TrailRibbonCache {
  private signature = "";
  private ribbons: TrailRibbon[] = [];

  constructor(private readonly width: number) {}

  update(strokes: readonly TrailStroke[]): readonly TrailRibbon[] {
    // Prototype cache: unchanged snapshots don't rebuild triangles. This is bounded
    // by the supplied trail state and keeps no frame history or simulation clock.
    const signature = JSON.stringify(strokes);
    if (signature === this.signature) return this.ribbons;
    this.signature = signature;
    this.ribbons = strokes.map((stroke) => ({
      vertices: stroke.paths.flatMap((path) =>
        trailRibbon(path, this.width / 2),
      ),
      color: /^#[0-9a-f]{6}$/i.test(stroke.color)
        ? parseInt(stroke.color.slice(1), 16)
        : 0xffffff,
    }));
    return this.ribbons;
  }
}
