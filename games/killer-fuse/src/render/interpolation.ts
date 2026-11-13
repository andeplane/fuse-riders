/**
 * Presentation only: the view a display frame draws, between two simulation steps. Positions blend along the
 * shortest way across the horizontal wrap; anything that jumped (a respawn, a rollback to another place, a new
 * round) snaps to the newer step instead of sliding across the screen.
 */
import type { RoundView, UnitView } from "../engine/index.js";
import { VIEW_WIDTH } from "./layout.js";

/** Further than this in one step is a teleport, not motion: the fastest thing in the game does about 5 px a step. */
export const SNAP_DISTANCE = 24;

export const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

/** `x` folded into [0, width). */
export function wrap(x: number, width = VIEW_WIDTH): number {
  const m = x % width;
  return m < 0 ? m + width : m;
}

/** Signed shortest horizontal way from `from` to `to` across the wrap. */
export function wrapDistance(
  from: number,
  to: number,
  width = VIEW_WIDTH,
): number {
  let d = (to - from) % width;
  if (d > width / 2) d -= width;
  else if (d < -width / 2) d += width;
  return d;
}

/** From `a` to `b` the short way round, folded back onto the screen. */
export const lerpWrapped = (
  a: number,
  b: number,
  t: number,
  width = VIEW_WIDTH,
): number => wrap(a + wrapDistance(a, b, width) * t, width);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Whether a unit moved continuously from `before` to `after`, so blending it is honest. */
export function continuous(before: UnitView, after: UnitView): boolean {
  return (
    before.dead === after.dead &&
    before.riding === after.riding &&
    before.eaten === after.eaten &&
    Math.abs(wrapDistance(before.x, after.x)) <= SNAP_DISTANCE &&
    Math.abs(after.y - before.y) <= SNAP_DISTANCE
  );
}

export function interpolateUnit(
  before: UnitView | undefined,
  after: UnitView,
  t: number,
): UnitView {
  if (!before || !continuous(before, after)) return after;
  return {
    ...after,
    x: lerpWrapped(before.x, after.x, t),
    y: lerp(before.y, after.y, t),
  };
}

/**
 * The view at `alpha` between `previous` (0) and `current` (1). Everything discrete (who is dead, what is filled,
 * the events) is the current step's.
 */
export function interpolateView(
  previous: RoundView,
  current: RoundView,
  alpha: number,
): RoundView {
  const t = clamp01(alpha);
  if (
    previous === current ||
    t === 1 ||
    previous.map.id !== current.map.id ||
    current.step < previous.step ||
    current.step - previous.step > 6
  )
    return current;
  const sameBerries = previous.loose.length === current.loose.length;
  return {
    ...current,
    units: current.units.map((unit, slot) =>
      interpolateUnit(previous.units[slot], unit, t),
    ),
    loose: current.loose.map((berry, index) => {
      const before = previous.loose[index];
      if (
        !sameBerries ||
        !before ||
        Math.abs(wrapDistance(before.x, berry.x)) > SNAP_DISTANCE ||
        Math.abs(berry.y - before.y) > SNAP_DISTANCE
      )
        return berry;
      return {
        x: lerpWrapped(before.x, berry.x, t),
        y: lerp(before.y, berry.y, t),
      };
    }),
    snail: {
      ...current.snail,
      x:
        Math.abs(current.snail.x - previous.snail.x) > SNAP_DISTANCE
          ? current.snail.x
          : lerp(previous.snail.x, current.snail.x, t),
    },
  };
}

/** The step a blended view stands at, as a fraction: what animation clocks run on, so they pause with the game. */
export const viewTime = (
  previous: RoundView,
  current: RoundView,
  alpha: number,
): number =>
  current.step < previous.step || current.step - previous.step > 6
    ? current.step
    : lerp(previous.step, current.step, clamp01(alpha));
