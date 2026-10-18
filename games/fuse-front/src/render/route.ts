/**
 * The hero's route as both battlefields draw it: a waypoint per order (`HeroView.route`) and a leg from the hero
 * through each in turn, shown while anything is queued. Each kind has its own colour and marker, and the marks fade
 * along the route so their order reads at a glance.
 */
import type { RouteStop } from "../engine/view.js";
import { SUB, TILE_PX } from "../engine/view.js";

const TILE = SUB * TILE_PX;

/** Waypoint colours: green move, amber attack-move, red attack, violet cast. */
export const ROUTE_HEX: Readonly<Record<RouteStop["kind"], number>> = {
  move: 0x6ad83a,
  attackMove: 0xf8a030,
  attack: 0xe8483c,
  cast: 0xb07cf8,
};

/** Ring radii in sub-pixels, the marker then a second ring (0 for none): an attack rings its target twice, a cast
 * marks its centre. */
const RINGS: Readonly<Record<RouteStop["kind"], readonly [number, number]>> = {
  move: [TILE * 0.35, 0],
  attackMove: [TILE * 0.45, TILE * 0.22],
  attack: [TILE * 0.6, TILE * 0.85],
  cast: [TILE * 0.45, TILE * 0.15],
};

export interface RouteMark {
  kind: RouteStop["kind"];
  /** The waypoint and the start of the leg that leads to it (the hero, or the previous waypoint), in sub-pixels. */
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  hex: number;
  /** 1 for the first waypoint, falling along the route. */
  fade: number;
  rings: readonly [number, number];
}

/** The marks for `route` with the hero drawn at (`hx`, `hy`); none unless something is queued. */
export function routeMarks(
  route: readonly RouteStop[],
  hx: number,
  hy: number,
): RouteMark[] {
  if (!route.some((stop) => !stop.current)) return [];
  let [fromX, fromY] = [hx, hy];
  return route.map((stop, index) => {
    const mark: RouteMark = {
      kind: stop.kind,
      x: stop.x,
      y: stop.y,
      fromX,
      fromY,
      hex: ROUTE_HEX[stop.kind],
      fade: Math.max(0.35, 1 - index * 0.12),
      rings: RINGS[stop.kind],
    };
    [fromX, fromY] = [stop.x, stop.y];
    return mark;
  });
}
