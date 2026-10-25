/**
 * The tilted RTS camera as numbers: a target on the ground, a distance along the view, and the pan, zoom and clamp
 * rules. Close in it looks north at 55°; zoomed out past `TILT_FROM` it tilts toward top-down (`pitchAt`) and the
 * scene fades in strategic markers (`markerFade`). The farthest zoom grows with the map (`farFor`) so a big map can be
 * seen whole on a 1080p screen. Pure arithmetic; the scene copies the pose onto its three.js camera.
 */

export const PITCH = (55 * Math.PI) / 180;
/** The pitch fully zoomed out: steep enough to read a big map like a board, still tilted enough to show height. */
export const TOP_PITCH = (74 * Math.PI) / 180;
/** Vertical field of view in degrees. */
export const FOV = 40;
/**
 * `FAR` is the farthest zoom on a map up to about 66 × 53 tiles; bigger maps reach further (`farFor`). `START` is the
 * zoom before the view is sized; a match opens at `startFor` its height.
 */
export const NEAR = 6,
  FAR = 70,
  START = 15;
/**
 * A match opens with about this many CSS pixels per tile across the view's middle row: some 34 tiles over a 1600 px
 * desktop board, close enough to read every robot.
 */
export const START_TILE_PX = 42;
/** The opening zoom's bounds: a short phone board stays readable, and the robots stay on their near models (`LOD_FAR`). */
export const START_MIN = 12,
  START_MAX = 24;
/** Distances over which the camera tilts from `PITCH` to `TOP_PITCH`. */
export const TILT_FROM = 40,
  TILT_TO = 160;
/** Distances over which strategic markers fade in, from none to full. */
export const MARKER_FROM = 40,
  MARKER_TO = 70;

export interface Rig {
  /** The ground point the camera looks at, in tiles. */
  x: number;
  z: number;
  /** Distance from the target along the view. */
  distance: number;
}

const smooth = (d: number, from: number, to: number) => {
  const t = Math.min(1, Math.max(0, (d - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** The farthest zoom on a `width` × `height` map: far enough for the whole map on the 4:3-ish board, never under `FAR`. */
export function farFor(width: number, height: number): number {
  return Math.max(FAR, Math.ceil(Math.max(width / 0.95, height / 0.76)));
}

/**
 * The opening zoom for a view `cssH` CSS pixels tall: `START_TILE_PX` pixels per tile across its middle row, whatever
 * its width, within the opening bounds. The ground the middle row spans is `2 tan(FOV / 2) · distance · aspect`.
 */
export function startFor(cssH: number): number {
  const across = 2 * Math.tan((FOV * Math.PI) / 360) * START_TILE_PX;
  return Math.min(START_MAX, Math.max(START_MIN, cssH / across));
}

/** The view's pitch above the ground at a distance: 55° close in, easing to `TOP_PITCH` far out. */
export function pitchAt(distance: number): number {
  return PITCH + (TOP_PITCH - PITCH) * smooth(distance, TILT_FROM, TILT_TO);
}

/** How strongly the strategic markers show at a distance, 0 (none) to 1. */
export function markerFade(distance: number): number {
  return smooth(distance, MARKER_FROM, MARKER_TO);
}

/** The camera's position for a rig. */
export function eye(rig: Rig): { x: number; y: number; z: number } {
  const pitch = pitchAt(rig.distance);
  return {
    x: rig.x,
    y: rig.distance * Math.sin(pitch),
    z: rig.z + rig.distance * Math.cos(pitch),
  };
}

/**
 * The distance kept within `NEAR` and the map's `farFor`, and the target far enough inside the map that the view shows
 * little past its edges: the screen reaches over half the distance east and west, more to the north (up the screen)
 * than to the south.
 */
export function clampRig(rig: Rig, width: number, height: number): void {
  rig.distance = Math.min(farFor(width, height), Math.max(NEAR, rig.distance));
  const d = rig.distance;
  const keep = (v: number, lo: number, hi: number) =>
    Math.min(Math.max(lo, hi), Math.max(lo, v));
  const mx = Math.min(width / 2, d * 0.6),
    north = Math.min(height / 2, d * 0.45),
    south = Math.min(height / 2, d * 0.25);
  rig.x = keep(rig.x, mx, width - mx);
  rig.z = keep(rig.z, north, height - south);
}

/** Moves the target by `dx`, `dy` CSS pixels of a `cssH`-tall view: the ground under the pointer follows it. */
export function panRig(rig: Rig, dx: number, dy: number, cssH: number): void {
  const perPixel =
    (2 * rig.distance * Math.tan((FOV * Math.PI) / 360)) / Math.max(1, cssH);
  rig.x += dx * perPixel;
  rig.z += (dy * perPixel) / Math.sin(pitchAt(rig.distance));
}

/** Zooms by `factor` (above 1 closer), at most out to `far` (the map's `farFor`). */
export function zoomRig(rig: Rig, factor: number, far = FAR): void {
  rig.distance = Math.min(far, Math.max(NEAR, rig.distance / factor));
}

/**
 * Where the view ray through normalised device point `nx`, `ny` (−1 to 1, y up) of an `aspect`-wide view meets the
 * horizontal plane at height `h`, relative to the target, for a camera `distance` away: the same ray three.js casts
 * from the camera `eye` places looking at the target. Undefined when the ray never comes down to the plane.
 */
export function groundOffset(
  distance: number,
  nx: number,
  ny: number,
  aspect: number,
  h = 0,
): { x: number; z: number } | undefined {
  const pitch = pitchAt(distance),
    k = Math.tan((FOV * Math.PI) / 360);
  const [sin, cos] = [Math.sin(pitch), Math.cos(pitch)];
  // The camera's right is +x and its up (0, cos, −sin); it looks along (0, −sin, −cos).
  const dx = nx * k * aspect,
    dy = -sin + ny * k * cos,
    dz = -cos - ny * k * sin;
  const t = (h - distance * sin) / dy;
  if (!(dy < 0) || !(t > 0)) return undefined;
  return { x: t * dx, z: distance * cos + t * dz };
}

/**
 * Zooms by `factor` about the ground under normalised device point `nx`, `ny` (the cursor) at height `h`: the target
 * shifts so that point stays under the cursor although the distance, and with it the tilt, changes. The map clamp
 * then wins, so near an edge the point drifts only as far as the clamp makes it.
 */
// prettier-ignore
export function zoomRigAt(rig: Rig, factor: number, nx: number, ny: number, aspect: number, width: number, height: number, h = 0): void {
  const before = groundOffset(rig.distance, nx, ny, aspect, h);
  zoomRig(rig, factor, farFor(width, height));
  const after = groundOffset(rig.distance, nx, ny, aspect, h);
  if (before && after) {
    rig.x += before.x - after.x;
    rig.z += before.z - after.z;
  }
  clampRig(rig, width, height);
}
