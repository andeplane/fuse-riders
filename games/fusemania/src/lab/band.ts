/**
 * The chart lab's listening band: a box dragged along the frequency axis. Inside it the song plays as it is; outside
 * it is turned down to a tenth, so one instrument's register can be heard against the charts. Pure geometry here, in
 * axis pixels; the page converts to and from hertz and drives the audio filters.
 */

/** A span along the frequency axis, in pixels, `from` below `to`. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

/** What a press on the axis takes hold of: an edge of the box, the whole box, or nothing (a new box starts). */
export type Grab = "low" | "high" | "move" | "new";

/** How much of the song's level is left outside the band: turned down by 90%. */
export const OUTSIDE_GAIN = 0.1;
/** The narrowest box, in pixels: still easy to take hold of. */
export const MIN_WIDTH = 8;

/** What a press at `x` grabs: an edge within `reach` pixels of it, else the box under it, else a new box. */
export function grabAt(span: Span | undefined, x: number, reach = 6): Grab {
  if (!span) return "new";
  const low = Math.abs(x - span.from);
  const high = Math.abs(x - span.to);
  if (low <= reach || high <= reach) return low <= high ? "low" : "high";
  return x > span.from && x < span.to ? "move" : "new";
}

/**
 * The box after dragging from `x0` to `x`, kept inside `[min, max]`. An edge follows the pointer but stops
 * `MIN_WIDTH` short of the other edge; the whole box moves without changing width; a new box runs between the two
 * points.
 */
export function dragSpan(
  start: Span | undefined,
  grab: Grab,
  x0: number,
  x: number,
  min: number,
  max: number,
): Span {
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  if (grab === "new" || !start) {
    const a = clamp(Math.min(x0, x));
    const b = clamp(Math.max(x0, x));
    return b - a >= MIN_WIDTH
      ? { from: a, to: b }
      : { from: a, to: Math.min(max, a + MIN_WIDTH) };
  }
  if (grab === "low")
    return {
      from: Math.max(min, Math.min(clamp(x), start.to - MIN_WIDTH)),
      to: start.to,
    };
  if (grab === "high")
    return {
      from: start.from,
      to: Math.min(max, Math.max(clamp(x), start.from + MIN_WIDTH)),
    };
  const width = start.to - start.from;
  const from = Math.max(min, Math.min(max - width, start.from + (x - x0)));
  return { from, to: from + width };
}

/** The mix that turns everything outside the band down to `OUTSIDE_GAIN`: the untouched song plus the band alone. */
export function bandMix(on: boolean): { dry: number; band: number } {
  return on
    ? { dry: OUTSIDE_GAIN, band: 1 - OUTSIDE_GAIN }
    : { dry: 1, band: 0 };
}
