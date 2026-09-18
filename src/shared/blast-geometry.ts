import type { BlastCircle } from "./protocol.js";

/** Exact swept disk collision, including tangency and zero-length segments. */
export function segmentIntersectsDisk(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  disk: Readonly<BlastCircle>,
  padding = 0,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((disk.x - x1) * dx + (disk.y - y1) * dy) / lengthSquared,
          ),
        );
  const x = x1 + t * dx - disk.x;
  const y = y1 + t * dy - disk.y;
  return (
    x * x + y * y <= (disk.radius + padding) * (disk.radius + padding) + 1e-9
  );
}
