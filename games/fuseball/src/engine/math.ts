/**
 * Integer arithmetic for the simulation. Every position and velocity is a whole number of sub-units (`SUB` per
 * pixel), so a replay folds to the same bits on every device: the engine uses + − × and truncating division only,
 * never `Math.sqrt` or trigonometry. Truncation is toward zero, so every helper is odd (`f(-x) = -f(x)`): a mirrored
 * arena plays out mirrored, and neither side of it is favoured.
 */
export const SUB = 4096;

/** A whole number of pixels as sub-units; for module constants, not for per-step state. */
export const px = (pixels: number): number => pixels * SUB;

export const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

export const abs = (value: number): number => (value < 0 ? -value : value);

/** Integer division rounded toward zero; the `+ 0` turns a negative zero into plain zero, so state never holds one. */
export const div = (a: number, b: number): number => Math.trunc(a / b) + 0;

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

/** `(x, y)` scaled to length `length`; a zero vector points straight up, which a mirror leaves alone. */
export function toward(
  x: number,
  y: number,
  length: number,
): { x: number; y: number } {
  const size = isqrt(x * x + y * y);
  if (size === 0) return { x: 0, y: -length };
  return { x: div(x * length, size), y: div(y * length, size) };
}

/** `value` brought into `0 … size − 1` on an axis that wraps. */
export const wrap = (value: number, size: number): number =>
  ((value % size) + size) % size;

/** The shortest signed way from 0 to `difference` on an axis that wraps every `size`: in `−size/2 … size/2 − 1`. */
export function delta(difference: number, size: number): number {
  const wrapped = wrap(difference, size);
  return wrapped * 2 >= size ? wrapped - size : wrapped;
}
