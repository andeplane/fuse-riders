/** Bevelled fills: black outline, light top/left, dark bottom/right — the chunky Z look. */
import { type Colour, Img } from "./image.js";
import { hash } from "./noise.js";

/** Outline, shadow, mid, light and an optional sparkle highlight. */
export type Ramp = readonly [Colour, Colour, Colour, Colour, Colour?];
/** Whether a pixel lies inside a shape. */
export type Inside = (x: number, y: number) => boolean;

/** Fills every pixel of the box (x0, y0)–(x1, y1) inside `ins`, bevelled `bev` pixels deep. */
export function shape(
  img: Img,
  ins: Inside,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  P: Ramp,
  bev = 1,
): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!ins(x, y)) continue;
      const edge =
        !ins(x - 1, y) || !ins(x + 1, y) || !ins(x, y - 1) || !ins(x, y + 1);
      let c: Colour;
      if (edge) c = P[0];
      else {
        let up = false;
        let dn = false;
        for (let k = 2; k <= bev + 1; k++) {
          if (!ins(x, y - k) || !ins(x - k, y)) up = true;
          if (!ins(x, y + k) || !ins(x + k, y)) dn = true;
        }
        c = up && !dn ? P[3] : dn ? P[1] : P[2];
        const sparkle = P[4];
        if (
          up &&
          sparkle &&
          !ins(x - 2, y - 2) &&
          ins(x + 2, y + 2) &&
          hash(x, y, 9) < 0.5
        )
          c = sparkle;
      }
      img.px(x, y, c);
    }
}

/** A rounded rectangle with corner radius `r`. */
export const roundRectInside =
  (x: number, y: number, w: number, h: number, r: number): Inside =>
  (px, py) => {
    if (px < x || py < y || px >= x + w || py >= y + h) return false;
    const cx = Math.min(Math.max(px, x + r), x + w - 1 - r);
    const cy = Math.min(Math.max(py, y + r), y + h - 1 - r);
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= r * r + r * 0.6;
  };

export const ellipseInside =
  (cx: number, cy: number, rx: number, ry: number): Inside =>
  (px, py) =>
    (px - cx) ** 2 / (rx * rx) + (py - cy) ** 2 / (ry * ry) <= 1;

/** A bevelled rounded box. */
export function sbox(
  img: Img,
  x: number,
  y: number,
  w: number,
  h: number,
  P: Ramp,
  r = 1,
  bev = 1,
): void {
  shape(img, roundRectInside(x, y, w, h, r), x, y, x + w, y + h, P, bev);
}

/** A bevelled ellipse. */
export function sell(
  img: Img,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  P: Ramp,
  bev = 1,
): void {
  shape(
    img,
    ellipseInside(cx, cy, rx, ry),
    Math.floor(cx - rx - 1),
    Math.floor(cy - ry - 1),
    Math.ceil(cx + rx + 1),
    Math.ceil(cy + ry + 1),
    P,
    bev,
  );
}

/** A one-pixel bevelled rectangle: outline, fill, light top/left and dark bottom/right edges. */
export function bevel(
  img: Img,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: Colour,
  hi: Colour,
  lo: Colour,
  out: Colour = "#101010",
): void {
  img.rect(x, y, w, h, out);
  img.rect(x + 1, y + 1, w - 2, h - 2, fill);
  img.rect(x + 1, y + 1, w - 2, 1, hi);
  img.rect(x + 1, y + 1, 1, h - 2, hi);
  img.rect(x + 1, y + h - 2, w - 2, 1, lo);
  img.rect(x + w - 2, y + 1, 1, h - 2, lo);
}
