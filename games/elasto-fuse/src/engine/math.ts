/**
 * Deterministic arithmetic for the engine. The physics runs on IEEE doubles: `+ - * /` and `Math.sqrt` are correctly
 * rounded, so every device computes the same bits. `Math.sin`, `Math.cos` and friends are not (each JavaScript engine
 * may round them differently), so the engine's trigonometry is these polynomials, built from the exact operations only.
 */
export const PI = 3.141592653589793;
export const TAU = 2 * PI;
const HALF_PI = PI / 2;

const S3 = -1 / 6,
  S5 = 1 / 120,
  S7 = -1 / 5040,
  S9 = 1 / 362880,
  S11 = -1 / 39916800,
  S13 = 1 / 6227020800,
  S15 = -1 / 1307674368000,
  S17 = 1 / 355687428096000;

/** The sine of `x` radians, within about 1e-13 of the true value, identical on every device. */
export function sin(x: number): number {
  x -= Math.round(x / TAU) * TAU;
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const s = x * x;
  return (
    x *
    (1 +
      s *
        (S3 +
          s *
            (S5 +
              s *
                (S7 + s * (S9 + s * (S11 + s * (S13 + s * (S15 + s * S17))))))))
  );
}
export const cos = (x: number): number => sin(x + HALF_PI);

/** `sqrt(x² + y²)`; `Math.hypot` is not correctly rounded, this is. */
export const length = (x: number, y: number): number =>
  Math.sqrt(x * x + y * y);
