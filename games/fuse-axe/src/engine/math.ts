/**
 * Integer arithmetic for the simulation. Every position and velocity is a whole number of sub-units (`SUB` per
 * pixel, `px` in `tuning.ts`), so a replay folds to the same bits on every device: the engine uses + − × and
 * truncating division only, never `Math.sqrt` or trigonometry.
 */
export const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

/** Integer division rounded toward zero. */
export const div = (a: number, b: number): number => Math.trunc(a / b);
