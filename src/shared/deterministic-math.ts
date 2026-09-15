import sin from '@stdlib/math-base-special-sin/lib/main.js';
import cos from '@stdlib/math-base-special-cos/lib/main.js';
import atan2 from '@stdlib/math-base-special-atan2/lib/main.js';

// Explicit JavaScript entry points: identical arithmetic in every engine, no native libm dispatch.
export { sin, cos, atan2 };

/** IEEE square root over fixed arithmetic for bounded game coordinates. Not a general Math.hypot
 * replacement: native hypot is implementation-approximated and diverges across engines. */
export function hypot2(x: number, y: number): number { return Math.sqrt(x * x + y * y); }
