/**
 * Presentation camera (12A). Cosmetic only: the simulation never reads it.
 * The canvas is always 1600 × 900 units of view (times the render scale), so
 * a larger map is shown whole at a smaller zoom. "Follow keepers" frames the
 * living keepers instead, between that whole-arena zoom and 1.
 */
export interface CameraFrame {
  /** Centre, world units. */
  x: number;
  y: number;
  /** View units per world unit: 1 shows 1600 × 900 world units. */
  zoom: number;
}
export const VIEW_WIDTH = 1600,
  VIEW_HEIGHT = 900;
type Size = { width: number; height: number };
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
/** The zoom that shows the whole arena. */
export const fitZoom = (size: Size) =>
  Math.min(VIEW_WIDTH / size.width, VIEW_HEIGHT / size.height);
export const wholeArena = (size: Size): CameraFrame => ({
  x: size.width / 2,
  y: size.height / 2,
  zoom: fitZoom(size),
});
/**
 * Frame the points (keeper centres) with a margin: zoom in until they fill
 * the view, never past 1 and never out past the whole arena, and keep the
 * view inside the arena.
 */
export function followKeepers(
  size: Size,
  points: readonly { x: number; y: number }[],
  margin = { x: 260, y: 200 },
): CameraFrame {
  const fit = fitZoom(size);
  if (!points.length) return wholeArena(size);
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  const zoom = clamp(
    Math.min(
      VIEW_WIDTH / (right - left + 2 * margin.x),
      VIEW_HEIGHT / (bottom - top + 2 * margin.y),
    ),
    fit,
    Math.max(fit, 1),
  );
  const halfWidth = VIEW_WIDTH / zoom / 2,
    halfHeight = VIEW_HEIGHT / zoom / 2;
  return {
    x: clamp((left + right) / 2, halfWidth, size.width - halfWidth),
    y: clamp((top + bottom) / 2, halfHeight, size.height - halfHeight),
    zoom,
  };
}
/** Move `from` a share `k` (0–1) of the way to `to`. */
export function easeFrame(
  from: CameraFrame,
  to: CameraFrame,
  k: number,
): CameraFrame {
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    zoom: from.zoom + (to.zoom - from.zoom) * k,
  };
}
/** A canvas point given as fractions (0–1) of its box, in world units. */
export function canvasToWorld(
  frame: CameraFrame,
  u: number,
  v: number,
): { x: number; y: number } {
  return {
    x: frame.x + ((u - 0.5) * VIEW_WIDTH) / frame.zoom,
    y: frame.y + ((v - 0.5) * VIEW_HEIGHT) / frame.zoom,
  };
}
