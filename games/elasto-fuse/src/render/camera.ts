import type { BikeView } from "../engine/view.js";
import type { Level } from "../engine/view-kit.js";

/**
 * Where each pane sits on the canvas and what part of the level it shows. All of it is pure: the scene keeps one
 * camera per pane and moves it here.
 */
export interface Pane {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Camera {
  x: number;
  y: number;
}
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A desktop pane shows this many world units across; a phone fewer, never fewer than `MIN_UNITS`. */
export const MAX_UNITS = 17,
  MIN_UNITS = 10,
  PX_PER_UNIT = 75,
  /** A pane always shows at least this many units of height, so a wide strip is not a slit. */
  MIN_UNITS_HIGH = 7.5;
/**
 * The bike sits vertically centred and this share of the pane's width ahead of the pane's centre lies before it: it
 * rides 15% of the width from the edge behind it, as in the original, and slides across on a turn-around.
 */
export const AHEAD_SHARE = 0.35;
/** The camera closes this share of its gap every `FOLLOW_MS`; a gap past `SNAP` (a restart) is jumped. */
export const FOLLOW_MS = 110,
  SNAP = 9;
const GAP = 4;

/** `count` panes (1 to 5) filling `width`×`height`: side by side on a wide screen, stacked on a tall one. */
export function paneGrid(count: number, width: number, height: number): Pane[] {
  const n = Math.max(1, Math.min(5, Math.floor(count)));
  const wide = width >= height;
  // Rows of panes: one row for up to three on a wide screen, two rows from four; mirrored for a tall one.
  const rows = n <= 3 ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)];
  const panes: Pane[] = [];
  const across = wide ? width : height,
    down = wide ? height : width;
  const lineSize = (down - GAP * (rows.length - 1)) / rows.length;
  rows.forEach((cells, line) => {
    const cellSize = (across - GAP * (cells - 1)) / cells;
    for (let cell = 0; cell < cells; cell++) {
      const along = cell * (cellSize + GAP),
        cross = line * (lineSize + GAP);
      panes.push(
        wide
          ? { x: along, y: cross, w: cellSize, h: lineSize }
          : { x: cross, y: along, w: lineSize, h: cellSize },
      );
    }
  });
  return panes;
}

/** Pixels per world unit for a pane of `width`×`height` CSS pixels. */
export function paneScale(width: number, height: number): number {
  const units = Math.max(MIN_UNITS, Math.min(MAX_UNITS, width / PX_PER_UNIT));
  return Math.max(1, Math.min(width / units, height / MIN_UNITS_HIGH));
}

const bounds = new WeakMap<Level, Bounds>();
/** The box around every polygon of `level`. */
export function levelBounds(level: Level): Bounds {
  const known = bounds.get(level);
  if (known) return known;
  const box = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const polygon of level.polygons)
    for (const point of polygon) {
      box.minX = Math.min(box.minX, point.x);
      box.maxX = Math.max(box.maxX, point.x);
      box.minY = Math.min(box.minY, point.y);
      box.maxY = Math.max(box.maxY, point.y);
    }
  bounds.set(level, box);
  return box;
}

const clampAxis = (value: number, min: number, max: number, span: number) =>
  max - min <= span
    ? (min + max) / 2
    : Math.max(min + span / 2, Math.min(max - span / 2, value));

/** The ground the pane may show under (and over) the level's box, as a share of its height. */
export const GROUND_SHARE = 0.3;

/**
 * Where the camera wants to be for `bike`: level with it and ahead of it. Sideways it stays inside the level's box,
 * so the pane never shows what lies beyond the level's ends; up and down it may show `GROUND_SHARE` of solid ground,
 * so a bike on the floor is not pressed against the pane's edge (a level smaller than the pane is centred). `lift`
 * raises the bike in the pane by that many units, for a pane whose bottom is covered by touch buttons.
 */
export function cameraTarget(
  bike: BikeView,
  box: Bounds,
  unitsWide: number,
  unitsHigh: number,
  /** The look-ahead to use, in units; the scene eases it through a turn-around. */
  ahead: number = (bike.flipped ? -AHEAD_SHARE : AHEAD_SHARE) * unitsWide,
  lift = 0,
): Camera {
  const margin = 1,
    ground = unitsHigh * GROUND_SHARE;
  return {
    x: clampAxis(
      bike.x + ahead,
      box.minX - margin,
      box.maxX + margin,
      unitsWide,
    ),
    y: clampAxis(
      bike.y - lift,
      box.minY - ground - lift * 2,
      box.maxY + ground,
      unitsHigh,
    ),
  };
}

/** The camera `dtMs` later on its way to `target`. */
export function followCamera(
  camera: Camera | undefined,
  target: Camera,
  dtMs: number,
): Camera {
  if (!camera || Math.hypot(target.x - camera.x, target.y - camera.y) > SNAP)
    return { ...target };
  const share = 1 - Math.exp(-Math.max(0, dtMs) / FOLLOW_MS);
  return {
    x: camera.x + (target.x - camera.x) * share,
    y: camera.y + (target.y - camera.y) * share,
  };
}
