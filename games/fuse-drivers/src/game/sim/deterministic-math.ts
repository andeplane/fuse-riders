/**
 * Trigonometry for the simulation that gives bit-identical results on every platform (ADR 002).
 *
 * `Math.sin`, `cos`, `atan2` and `hypot` are allowed to differ in the last bit between JavaScript engines and
 * builds: the same replay drifted apart on macOS arm64, Linux arm64 and Linux x64 after a few hundred ticks.
 * `+ - * /`, `Math.sqrt`, `Math.round` and `Math.floor` are exact IEEE 754 operations everywhere, so everything
 * here is built from those alone. Accuracy is within ~1e-15 of `Math`; only reproducibility matters.
 */
const PI = Math.PI;
const HALF_PI = PI / 2;
const SQRT3 = Math.sqrt(3);
const TAN_PI_12 = 2 - SQRT3;

/** Taylor series for |x| <= pi/4: 11 terms leave an error below 1e-19. */
function sinSmall(x: number): number {
  const x2 = x * x;
  let term = x, sum = x;
  for (let n = 1; n <= 10; n++) { term *= -x2 / ((2 * n) * (2 * n + 1)); sum += term; }
  return sum;
}

function cosSmall(x: number): number {
  const x2 = x * x;
  let term = 1, sum = 1;
  for (let n = 1; n <= 10; n++) { term *= -x2 / ((2 * n - 1) * (2 * n)); sum += term; }
  return sum;
}

/** Quadrant and remainder in [-pi/4, pi/4]. */
function quadrant(x: number): [number, number] {
  const k = Math.round(x / HALF_PI);
  return [((k % 4) + 4) % 4, x - k * HALF_PI];
}

export function sin(x: number): number {
  const [q, r] = quadrant(x);
  return q === 0 ? sinSmall(r) : q === 1 ? cosSmall(r) : q === 2 ? -sinSmall(r) : -cosSmall(r);
}

export function cos(x: number): number {
  const [q, r] = quadrant(x);
  return q === 0 ? cosSmall(r) : q === 1 ? -sinSmall(r) : q === 2 ? -cosSmall(r) : sinSmall(r);
}

/** atan for t >= 0: fold to t <= 1, then to t <= tan(pi/12), then a series whose 28th term is below 1e-17. */
function atanPos(t: number): number {
  if (t > 1) return HALF_PI - atanPos(1 / t);
  if (t > TAN_PI_12) return PI / 6 + atanPos((t * SQRT3 - 1) / (t + SQRT3));
  const t2 = t * t;
  let term = t, sum = t;
  for (let n = 1; n <= 14; n++) { term *= -t2; sum += term / (2 * n + 1); }
  return sum;
}

export function atan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  if (x === 0) return y > 0 ? HALF_PI : -HALF_PI;
  const a = atanPos(Math.abs(y / x));
  if (x > 0) return y < 0 ? -a : a;
  return y < 0 ? a - PI : PI - a;
}

export const hypot = (x: number, y: number): number => Math.sqrt(x * x + y * y);
