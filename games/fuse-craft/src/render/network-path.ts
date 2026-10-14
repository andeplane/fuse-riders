import { hexCenter } from "./projection.js";

type Point = Readonly<{ x: number; y: number }>;
export interface NetworkPath {
  from: Point;
  control: Point;
  to: Point;
}

/** The same ground conduit is used in either travel direction. */
export function networkPath(
  width: number,
  from: number,
  to: number,
): NetworkPath {
  const a = hexCenter(width, from),
    b = hexCenter(width, to);
  const bend = from === to ? 0 : (((from + to) % 3) - 1) * 5;
  return {
    from: a,
    control: { x: (a.x + b.x) / 2 + bend, y: (a.y + b.y) / 2 - bend },
    to: b,
  };
}

export function sampleNetworkPath(path: NetworkPath, progress: number) {
  const t = Math.max(0, Math.min(1, progress)),
    u = 1 - t;
  const { from: a, control: c, to: b } = path;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    dx: 2 * (u * (c.x - a.x) + t * (b.x - c.x)),
    dy: 2 * (u * (c.y - a.y) + t * (b.y - c.y)),
  };
}

/** Exact quadratic subcurve, so even a short particle trail stays on the conduit. */
export function networkPathMarkup(
  path: NetworkPath,
  start = 0,
  end = 1,
): string {
  const a = sampleNetworkPath(path, start),
    b = sampleNetworkPath(path, end);
  const span = Math.max(0, Math.min(1, end)) - Math.max(0, Math.min(1, start));
  return `M${a.x} ${a.y}Q${a.x + (a.dx * span) / 2} ${a.y + (a.dy * span) / 2} ${b.x} ${b.y}`;
}
