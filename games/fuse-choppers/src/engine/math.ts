/**
 * Integer arithmetic for the simulation. Every position and velocity is a whole number of sub-units (`SUB` per
 * pixel), so a replay folds to the same bits on every device: the engine uses + − × and truncating division only,
 * never `Math.sqrt` or trigonometry.
 */
export const SUB = 256;

/** A constant in pixels as sub-units; for module constants, not for per-tick state. */
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

/** A triangle wave over `period` steps in −1000…1000: the engine's stand-in for a sine. */
export function wave(t: number, period: number): number {
  const phase = ((t % period) + period) % period,
    quarter = period / 4;
  if (phase < quarter) return Math.trunc((phase * 1000) / quarter);
  if (phase < 3 * quarter)
    return 1000 - Math.trunc(((phase - quarter) * 1000) / quarter);
  return -1000 + Math.trunc(((phase - 3 * quarter) * 1000) / quarter);
}

/** `(x, y)` scaled to length `length`, or `(length, 0)` for a zero vector. */
export function toward(
  x: number,
  y: number,
  length: number,
): { x: number; y: number } {
  const size = isqrt(x * x + y * y);
  if (size === 0) return { x: length, y: 0 };
  return { x: div(x * length, size), y: div(y * length, size) };
}
