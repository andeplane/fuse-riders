import { DIRS, UNIT, cos, div, headingOf, px, sin } from "./math.js";
import { hash } from "./rng.js";
import { LOCO_HALF, START_CART } from "./tuning.js";

/**
 * The depot: one open floor between walls, with a delivery dock against the middle of the left and the right wall.
 * Everything here is fixed; the start places turn with the round's seed so no seat keeps the best one.
 */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The floor, in sub-units. The screen's top strip holds the scores and its bottom strip the steering hint. */
export const FLOOR: Rect = {
  left: px(56),
  top: px(70),
  right: px(904),
  bottom: px(502),
};
/** Where a locomotive's centre may be: the floor less its half-width. */
export const BOUNDS: Rect = {
  left: FLOOR.left + LOCO_HALF,
  top: FLOOR.top + LOCO_HALF,
  right: FLOOR.right - LOCO_HALF,
  bottom: FLOOR.bottom - LOCO_HALF,
};
export const CENTER_X = (FLOOR.left + FLOOR.right) / 2;
export const CENTER_Y = (FLOOR.top + FLOOR.bottom) / 2;

const DOCK_DEPTH = px(92),
  DOCK_HALF = px(52);
/** The two shared delivery docks: a locomotive whose centre is inside one delivers every wagon it pulls. */
export const DOCKS: readonly Rect[] = [
  {
    left: FLOOR.left,
    top: CENTER_Y - DOCK_HALF,
    right: FLOOR.left + DOCK_DEPTH,
    bottom: CENTER_Y + DOCK_HALF,
  },
  {
    left: FLOOR.right - DOCK_DEPTH,
    top: CENTER_Y - DOCK_HALF,
    right: FLOOR.right,
    bottom: CENTER_Y + DOCK_HALF,
  },
];

export const inRect = (rect: Rect, x: number, y: number, margin = 0): boolean =>
  x >= rect.left - margin &&
  x <= rect.right + margin &&
  y >= rect.top - margin &&
  y <= rect.bottom + margin;

/** The dock a point is in, or −1. */
export const dockAt = (x: number, y: number, margin = 0): number =>
  DOCKS.findIndex((dock) => inRect(dock, x, y, margin));

export const dockCenter = (index: number): { x: number; y: number } => {
  const dock = DOCKS[index]!;
  return {
    x: (dock.left + dock.right) / 2,
    y: (dock.top + dock.bottom) / 2,
  };
};

export interface Start {
  x: number;
  y: number;
  dir: number;
  /** Where this train's first cart waits. */
  cartX: number;
  cartY: number;
}

const RADIUS_X = px(250),
  RADIUS_Y = px(128);
/**
 * Start places for `count` trains: evenly round an ellipse about the middle of the floor, every train heading the
 * same way round it, so nobody starts facing a wall or a rival, and each has a cart the same distance ahead. The
 * ellipse is turned by the seed, so the places near a dock move from round to round.
 */
export function starts(seed: number, count: number): Start[] {
  const base = hash(seed, 0x57a7) % DIRS;
  return Array.from({ length: count }, (_, k) => {
    const angle = base + div(k * DIRS, count),
      c = cos(angle),
      s = sin(angle);
    const x = CENTER_X + div(RADIUS_X * c, UNIT),
      y = CENTER_Y + div(RADIUS_Y * s, UNIT);
    // The ellipse's tangent, clockwise.
    const dir = headingOf(-div(RADIUS_X * s, UNIT), div(RADIUS_Y * c, UNIT));
    return {
      x,
      y,
      dir,
      cartX: x + div(START_CART * cos(dir), UNIT),
      cartY: y + div(START_CART * sin(dir), UNIT),
    };
  });
}
