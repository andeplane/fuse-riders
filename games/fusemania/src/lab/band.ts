/**
 * The chart lab's listening band: a box on the frequency axis that starts out covering all of it. Inside it the song plays as it is; outside
 * it is turned down to a tenth, so one instrument's register can be heard against the charts. Pure geometry here, in
 * axis pixels; the page converts to and from hertz and drives the audio filters.
 */

/** A span along the frequency axis, in pixels, `from` below `to`. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

/** What a press on the axis takes hold of: an edge of the box, or the whole box. */
export type Grab = "low" | "high" | "move";

/** How much of the song's level is left outside the band: turned down by 90%. */
export const OUTSIDE_GAIN = 0.1;
/** The narrowest box, in pixels: still easy to take hold of. */
export const MIN_WIDTH = 8;

/**
 * What a press at `x` grabs: an edge within `reach` pixels of it, else the box when the press is inside it, else the
 * nearer edge (a press beside the box pulls that edge out to it).
 */
export function grabAt(span: Span, x: number, reach = 6): Grab {
  const low = Math.abs(x - span.from);
  const high = Math.abs(x - span.to);
  const inside = x > span.from && x < span.to;
  if (inside && low > reach && high > reach) return "move";
  return low <= high ? "low" : "high";
}

/**
 * The box after dragging from `x0` to `x`, kept inside `[min, max]`. An edge follows the pointer but stops
 * `MIN_WIDTH` short of the other edge; the whole box moves without changing width.
 */
export function dragSpan(
  start: Span,
  grab: Grab,
  x0: number,
  x: number,
  min: number,
  max: number,
): Span {
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
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

/** Whether the box covers the whole axis `[min, max]` (to the pixel): nothing is turned down then. */
export function coversAll(span: Span, min: number, max: number): boolean {
  return span.from <= min + 1 && span.to >= max - 1;
}

/** The mix that turns everything outside the band down to `OUTSIDE_GAIN`: the untouched song plus the band alone. */
export function bandMix(on: boolean): { dry: number; band: number } {
  return on
    ? { dry: OUTSIDE_GAIN, band: 1 - OUTSIDE_GAIN }
    : { dry: 1, band: 0 };
}
