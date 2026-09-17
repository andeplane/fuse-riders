import sin from "@stdlib/math-base-special-sin/lib/main.js";
import cos from "@stdlib/math-base-special-cos/lib/main.js";
import atan2 from "@stdlib/math-base-special-atan2/lib/main.js";

// Explicit JS entry points: identical arithmetic in browsers and Node, no native dispatch.
export { sin, cos, atan2 };

/** Exact IEEE square root plus fixed arithmetic for bounded game coordinates.
 * Deliberately not a general Math.hypot replacement: inputs must be finite and
 * small enough that their squares neither overflow nor underflow materially.
 * Native hypot is implementation-approximated and diverges across JS engines.
 */
export function hypot2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
