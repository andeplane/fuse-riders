/**
 * Integer arithmetic for the simulation. Every position is a whole number of sub-units (`SUB` per pixel) and every
 * heading a whole number of `DIRS` per turn, so a replay folds to the same bits on every device: the engine uses
 * + − × and truncating division only, never `Math.sqrt` or the library's trigonometry.
 */
export const SUB = 256;

/** A constant in pixels as sub-units; for module constants, not for per-step state. */
export const px = (pixels: number): number => Math.round(pixels * SUB);

export const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

/** Integer division rounded toward zero. */
export const div = (a: number, b: number): number => Math.trunc(a / b);

/** floor(√n) for a non-negative integer below 2^52, by Newton's method from a power-of-two guess. */
export function isqrt(n: number): number {
  if (n < 2) return n < 0 ? 0 : n;
  let guess = 1;
  while (guess * guess < n) guess *= 2;
  let x = guess;
  for (;;) {
    const y = Math.floor((x + Math.floor(n / x)) / 2);
    if (y >= x) break;
    x = y;
  }
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** Headings per full turn. Heading 0 points right (+x) and headings grow clockwise on screen, where y points down. */
export const DIRS = 1024;
/** A unit vector's length in `sin` and `cos`. */
export const UNIT = 4096;
const QUARTER = DIRS / 4;

/**
 * The first quadrant of sine, from its Taylor series in plain + − × ÷, which IEEE 754 rounds alike everywhere (unlike
 * `Math.sin`, whose last bits may differ between engines), then rounded to whole `UNIT`s once at load.
 */
const SINES: readonly number[] = Array.from(
  { length: QUARTER + 1 },
  (_, index) => {
    const x = (index * 3.141592653589793) / (2 * QUARTER);
    let term = x,
      sum = x;
    for (let n = 1; n < 12; n++) {
      term = (-term * x * x) / (2 * n * (2 * n + 1));
      sum += term;
    }
    return Math.round(sum * UNIT);
  },
);

export const wrapDir = (dir: number): number => ((dir % DIRS) + DIRS) % DIRS;

/** sin of a heading, in `UNIT`s. */
export function sin(dir: number): number {
  const d = wrapDir(dir);
  if (d <= QUARTER) return SINES[d]!;
  if (d <= 2 * QUARTER) return SINES[2 * QUARTER - d]!;
  if (d <= 3 * QUARTER) return -SINES[d - 2 * QUARTER]!;
  return -SINES[4 * QUARTER - d]!;
}
export const cos = (dir: number): number => sin(dir + QUARTER);

/** The heading closest to the direction of `(x, y)`; heading 0 for a zero vector. */
export function headingOf(x: number, y: number): number {
  const length = isqrt(x * x + y * y);
  if (length === 0) return 0;
  // The arcsine of the smaller side only: near a quarter turn the sine barely moves, so the other side decides it.
  const steep = Math.abs(y) > Math.abs(x),
    s = div((steep ? Math.abs(x) : Math.abs(y)) * UNIT, length);
  // The first-quadrant heading whose sine is nearest `s`: SINES only rises.
  let low = 0,
    high = QUARTER;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (SINES[mid]! < s) low = mid + 1;
    else high = mid;
  }
  const small =
      low > 0 && s - SINES[low - 1]! < SINES[low]! - s ? low - 1 : low,
    a = steep ? QUARTER - small : small;
  if (x >= 0) return y >= 0 ? a : wrapDir(-a);
  return y >= 0 ? 2 * QUARTER - a : 2 * QUARTER + a;
}

/** The signed difference `to − from` between two headings, in −DIRS/2 … DIRS/2. */
export function turnBetween(from: number, to: number): number {
  const d = wrapDir(to - from);
  return d > DIRS / 2 ? d - DIRS : d;
}

/** Squared distance between two points, in sub-units squared (well inside 2^53 for anything in the arena). */
export const dist2 = (ax: number, ay: number, bx: number, by: number): number =>
  (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
