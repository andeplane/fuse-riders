/**
 * The camera: a fixed art-pixel viewport scaled by a whole number of device pixels, its position over the map, and
 * the mapping from a pointer on the page back to an art pixel and a map tile. Pure arithmetic, no DOM.
 */

/** Art pixels the viewport aims to show from top to bottom; the scale is the largest integer that keeps at least this. */
export const TARGET_ROWS = 300;
/** CSS pixels from the board's edge where a resting mouse pans the camera. */
export const EDGE = 18;
/** CSS pixels per second the edge pan moves. */
export const PAN_SPEED = 720;

export interface Viewport {
  /** Art pixels shown. */
  w: number;
  h: number;
  /** Device pixels per art pixel (a whole number). */
  scale: number;
}

/**
 * The viewport for a box of `cssW` × `cssH` CSS pixels at `dpr` device pixels per CSS pixel: the largest whole scale
 * that still shows `rows` art rows (at least 1), filling the box but never wider or taller than the map.
 */
// prettier-ignore
export function fitViewport(cssW: number, cssH: number, dpr: number, mapW: number, mapH: number, rows = TARGET_ROWS): Viewport {
  const devW = Math.max(1, Math.floor(cssW * dpr)),
    devH = Math.max(1, Math.floor(cssH * dpr));
  const scale = Math.max(1, Math.floor(devH / rows));
  return {
    w: Math.min(mapW, Math.max(1, Math.floor(devW / scale))),
    h: Math.min(mapH, Math.max(1, Math.floor(devH / scale))),
    scale,
  };
}

/** The camera's top-left kept inside the map (a viewport as large as the map sits at 0). Whole art pixels. */
export function clampCamera(
  x: number,
  y: number,
  view: Viewport,
  mapW: number,
  mapH: number,
): { x: number; y: number } {
  const clamp = (v: number, max: number) =>
    Math.round(Math.min(Math.max(0, max), Math.max(0, v)));
  return { x: clamp(x, mapW - view.w), y: clamp(y, mapH - view.h) };
}

/** The art pixel under a point `dx`, `dy` CSS pixels from the board's top-left. */
export function screenToArt(
  dx: number,
  dy: number,
  camera: { x: number; y: number },
  view: Viewport,
  dpr: number,
): { x: number; y: number } {
  return {
    x: camera.x + Math.floor((dx * dpr) / view.scale),
    y: camera.y + Math.floor((dy * dpr) / view.scale),
  };
}

/** The tile holding art pixel (x, y), or undefined off the map. */
export function artToTile(
  x: number,
  y: number,
  tilePx: number,
  width: number,
  height: number,
): { x: number; y: number } | undefined {
  const tx = Math.floor(x / tilePx),
    ty = Math.floor(y / tilePx);
  return tx >= 0 && ty >= 0 && tx < width && ty < height
    ? { x: tx, y: ty }
    : undefined;
}

/** The edge-pan direction (each −1, 0 or 1) for a mouse resting `dx`, `dy` CSS pixels into a `w` × `h` board. */
export function edgePan(
  dx: number,
  dy: number,
  w: number,
  h: number,
  edge = EDGE,
): { x: number; y: number } {
  const axis = (v: number, size: number) =>
    v < 0 || v > size ? 0 : v < edge ? -1 : v > size - edge ? 1 : 0;
  return { x: axis(dx, w), y: axis(dy, h) };
}
