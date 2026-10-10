/**
 * Cross-engine deterministic math. `Math.sin`, `Math.exp` and friends are only approximated by the language spec, so
 * their last bits can differ between V8, SpiderMonkey and JavaScriptCore, and an online replay of the same input log
 * would drift apart. These versions use only + − × ÷, comparisons, `Math.floor/round/abs/sqrt` and constants, each
 * rounded by IEEE 754 exactly, in a fixed order (JS never fuses a multiply-add), so every engine returns the same bits.
 *
 * The algorithms are fdlibm's (range reduction to a small interval, then its minimax polynomials), accurate to within
 * a few units in the last place, so they agree with `Math` to about 1e-15 over the arguments the engine produces.
 */

const PI = Math.PI;
const HALF_PI = PI / 2;
const QUARTER_PI = PI / 4;
const TWO_OVER_PI = 6.36619772367581382433e-1;
/** 2^−27: below it sin x rounds to x. */
const TINY = 7.450580596923828e-9;

// π/2 as three parts: the first two have 33 significant bits, so `n * part` is exact for |n| < 2^20.
const PIO2_1 = 1.57079632673412561417;
const PIO2_2 = 6.0771005063039659766e-11;
const PIO2_3 = 2.02226624879595063154e-21;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [−π/4, π/4]. */
function sinKernel(x: number): number {
  if (x > -TINY && x < TINY) return x;
  const z = x * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + z * x * (S1 + z * r);
}

/** cos on [−π/4, π/4]. */
function cosKernel(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + z * r);
}

/**
 * sin(x + shift·π/2) for shift 0 (sine) or 1 (cosine). `x` is reduced by the nearest multiple n·π/2 to r in about
 * [−π/4, π/4], exactly enough for |x| below 2^20·π/2 (about 1.6 million); beyond that it loses precision but stays
 * deterministic. NaN for a non-finite `x`.
 */
function sinShifted(x: number, shift: number): number {
  if (!(x - x === 0)) return NaN;
  let n = 0;
  let r = x;
  if (!(x > -QUARTER_PI && x < QUARTER_PI)) {
    n = Math.round(x * TWO_OVER_PI);
    r = x - n * PIO2_1 - n * PIO2_2 - n * PIO2_3;
  }
  const m = n + shift;
  const q = m - 4 * Math.floor(m / 4);
  if (q === 0) return sinKernel(r);
  if (q === 1) return cosKernel(r);
  if (q === 2) return -sinKernel(r);
  return -cosKernel(r);
}

/** Sine of `x` radians. */
export function sin(x: number): number {
  return sinShifted(x, 0);
}

/** Cosine of `x` radians. */
export function cos(x: number): number {
  return sinShifted(x, 1);
}

const ATAN_HI = [
  4.63647609000806093515e-1, 7.85398163397448278999e-1,
  9.82793723247329054082e-1, 1.570796326794896558,
] as const;
const ATAN_LO = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17,
  1.39033110312309984516e-17, 6.12323399573676603587e-17,
] as const;
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1,
  1.42857142725034663711e-1, -1.1111110405462355788e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2,
  6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.6531572744216915527e-2,
  1.62858201153657823623e-2,
] as const;
/** The part of π that `PI` leaves out. */
const PI_LO = 1.2246467991473531772e-16;

/** atan of a non-negative `x` (+∞ allowed). */
function atanNonNegative(x: number): number {
  let id: number;
  if (x < 0.4375) id = -1;
  else if (x < 0.6875) {
    id = 0;
    x = (2 * x - 1) / (2 + x);
  } else if (x < 1.1875) {
    id = 1;
    x = (x - 1) / (x + 1);
  } else if (x < 2.4375) {
    id = 2;
    x = (x - 1.5) / (1 + 1.5 * x);
  } else {
    id = 3;
    x = -1 / x;
  }
  const z = x * x;
  const w = z * z;
  const s1 =
    z *
    (AT[0] +
      w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  return ATAN_HI[id]! - (x * (s1 + s2) - ATAN_LO[id]! - x);
}

const isNegative = (v: number): boolean => v < 0 || 1 / v < 0;

/** Angle of the point `(x, y)` from the +x axis, in (−π, π], with `Math.atan2`'s signed zeros and infinities. */
export function atan2(y: number, x: number): number {
  if (y !== y || x !== x) return NaN;
  if (y === 0) {
    if (isNegative(x)) return isNegative(y) ? -PI : PI;
    return y;
  }
  if (x === 0) return y > 0 ? HALF_PI : -HALF_PI;
  const yInf = y === Infinity || y === -Infinity;
  if (x === Infinity || x === -Infinity) {
    const a = yInf ? (x > 0 ? PI / 4 : (3 * PI) / 4) : x > 0 ? 0 : PI;
    return y < 0 ? -a : a;
  }
  if (yInf) return y > 0 ? HALF_PI : -HALF_PI;
  const z = atanNonNegative(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : z - PI_LO - PI;
}

/** Length of `(x, y)` as one correctly rounded square root. Unlike `Math.hypot`, squares of huge inputs overflow. */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** 2^k for an integer k in [−1022, 1023], from a table built by exact doublings and halvings. */
const POW2: number[] = (() => {
  const table: number[] = new Array<number>(2046);
  let up = 1;
  let down = 1;
  for (let k = 0; k <= 1023; k++) {
    table[1022 + k] = up;
    up *= 2;
  }
  for (let k = 1; k <= 1022; k++) {
    down *= 0.5;
    table[1022 - k] = down;
  }
  return table;
})();
const pow2 = (k: number): number => POW2[1022 + k]!;

/** `y · 2^k` for integer k, with at most one rounding (into the subnormals). */
function scale(y: number, k: number): number {
  if (k > 1000) return y * pow2(k - 1000) * pow2(1000);
  if (k < -1000) return y * pow2(k + 1000) * pow2(-1000);
  return y * pow2(k);
}

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;

/** e^x. */
export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 7.09782712893383973096e2) return Infinity;
  if (x < -7.4513321910194110842e2) return 0;
  const ax = Math.abs(x);
  if (ax < 3.725290298461914e-9) return 1 + x;
  let k = 0;
  let hi = 0;
  let lo = 0;
  if (ax > 0.34657359027997264) {
    k =
      ax < 1.0397207708399179
        ? x > 0
          ? 1
          : -1
        : Math.trunc(INV_LN2 * x + (x > 0 ? 0.5 : -0.5));
    hi = x - k * LN2_HI;
    lo = k * LN2_LO;
    x = hi - lo;
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  return scale(1 - (lo - (x * c) / (2 - c) - hi), k);
}

const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;
const SQRT2 = 1.4142135623730951;

/** log₂ x; exact for powers of two. */
export function log2(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let e = 0;
  if (x < pow2(-1022)) {
    x *= pow2(54);
    e = -54;
  }
  // The exponent: the largest k with 2^k <= x, by bisection over the table.
  let low = -1022;
  let high = 1023;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (pow2(mid) <= x) low = mid;
    else high = mid - 1;
  }
  let m = x / pow2(low);
  e += low;
  if (m > SQRT2) {
    m *= 0.5;
    e += 1;
  }
  // ln m for m in [√2/2, √2], as fdlibm's log does it.
  const f = m - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const hfsq = 0.5 * f * f;
  const ln = f - (hfsq - s * (hfsq + (t2 + t1)));
  return e + ln * INV_LN2;
}
