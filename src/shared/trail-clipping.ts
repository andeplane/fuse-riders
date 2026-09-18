import type { TrailSegment } from "./protocol.js";

export interface TrailBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Clip one independent centerline; preserve its direction and lifetime, never join gaps. */
export function clipTrailSegment(
  segment: TrailSegment,
  bounds: TrailBounds,
): TrailSegment | undefined {
  if (
    segment.x1 >= bounds.minX &&
    segment.x1 <= bounds.maxX &&
    segment.x2 >= bounds.minX &&
    segment.x2 <= bounds.maxX &&
    segment.y1 >= bounds.minY &&
    segment.y1 <= bounds.maxY &&
    segment.y2 >= bounds.minY &&
    segment.y2 <= bounds.maxY
  )
    return segment;
  let start = 0;
  let end = 1;
  // Parametric slab intersection also handles points and axis-parallel segments.
  for (const [origin, delta, minimum, maximum] of [
    [segment.x1, segment.x2 - segment.x1, bounds.minX, bounds.maxX],
    [segment.y1, segment.y2 - segment.y1, bounds.minY, bounds.maxY],
  ]) {
    if (delta === 0) {
      if (origin < minimum || origin > maximum) return undefined;
      continue;
    }
    const a = (minimum - origin) / delta;
    const b = (maximum - origin) / delta;
    start = Math.max(start, Math.min(a, b));
    end = Math.min(end, Math.max(a, b));
    if (start > end) return undefined;
  }
  const x = (t: number) =>
    Math.max(
      bounds.minX,
      Math.min(bounds.maxX, segment.x1 + t * (segment.x2 - segment.x1)),
    );
  const y = (t: number) =>
    Math.max(
      bounds.minY,
      Math.min(bounds.maxY, segment.y1 + t * (segment.y2 - segment.y1)),
    );
  return { ...segment, x1: x(start), y1: y(start), x2: x(end), y2: y(end) };
}
