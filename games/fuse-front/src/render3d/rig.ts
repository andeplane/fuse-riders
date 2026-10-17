/**
 * The tilted RTS camera as numbers: a target on the ground, a distance along a fixed 55° pitch looking north, and
 * the pan, zoom and clamp rules. Pure arithmetic; the scene copies the pose onto its three.js camera.
 */

export const PITCH = (55 * Math.PI) / 180;
/** Vertical field of view in degrees. */
export const FOV = 40;
export const NEAR = 6,
  FAR = 70,
  START = 26;

export interface Rig {
  /** The ground point the camera looks at, in tiles. */
  x: number;
  z: number;
  /** Distance from the target along the view. */
  distance: number;
}

/** The camera's position for a rig. */
export function eye(rig: Rig): { x: number; y: number; z: number } {
  return {
    x: rig.x,
    y: rig.distance * Math.sin(PITCH),
    z: rig.z + rig.distance * Math.cos(PITCH),
  };
}

/**
 * The target kept far enough inside the map that the view shows little past its edges: the screen reaches over half
 * the distance east and west, more to the north (up the screen) than to the south.
 */
export function clampRig(rig: Rig, width: number, height: number): void {
  rig.distance = Math.min(FAR, Math.max(NEAR, rig.distance));
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
  rig.z += (dy * perPixel) / Math.sin(PITCH);
}

/** Zooms by `factor` (above 1 closer). */
export function zoomRig(rig: Rig, factor: number): void {
  rig.distance = Math.min(FAR, Math.max(NEAR, rig.distance / factor));
}
