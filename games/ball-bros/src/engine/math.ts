import sin from "@stdlib/math-base-special-sin/lib/main.js";
import cos from "@stdlib/math-base-special-cos/lib/main.js";
import atan2 from "@stdlib/math-base-special-atan2/lib/main.js";
export { sin, cos, atan2 };
export const TAU = Math.PI * 2;
export const length = (x: number, y: number): number =>
  Math.sqrt(x * x + y * y);
export const angleDelta = (a: number, b: number): number =>
  ((((a - b + Math.PI * 3) % TAU) + TAU) % TAU) - Math.PI;
export const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;
