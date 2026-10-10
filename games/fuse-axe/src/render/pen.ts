import { VIEW_H, VIEW_W } from "../engine/view-kit.js";
import type { Pen } from "./backdrop/backdrop.js";

/**
 * The scene's drawing calls, held to the native 320 × 180 screen: what falls outside is cut off here rather than
 * handed to the context, so a figure walking in from the edge draws only its visible part and nothing ever lands off
 * screen. Coordinates are whole pixels; NaN draws nothing.
 */
export type { Pen } from "./backdrop/backdrop.js";

/** The part of `[start, start + size)` on a screen axis `limit` long, as `[from, to)`; empty when `to <= from`. */
const clip = (start: number, size: number, limit: number) =>
  [Math.max(0, start), Math.min(limit, start + size)] as const;

/** A flat rectangle of the pen's current `fillStyle`. */
export function fill<Image>(
  pen: Pen<Image>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const [x0, x1] = clip(x, w, VIEW_W);
  const [y0, y1] = clip(y, h, VIEW_H);
  if (x1 > x0 && y1 > y0) pen.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/** A `w` × `h` image with its top-left corner at (`left`, `top`), unscaled. */
export function blit<Image>(
  pen: Pen<Image>,
  image: Image,
  w: number,
  h: number,
  left: number,
  top: number,
): void {
  const [x0, x1] = clip(left, w, VIEW_W);
  const [y0, y1] = clip(top, h, VIEW_H);
  if (!(x1 > x0 && y1 > y0)) return;
  const [cw, ch] = [x1 - x0, y1 - y0];
  pen.drawImage(image, x0 - left, y0 - top, cw, ch, x0, y0, cw, ch);
}
