/**
 * A chopper's controls as held bits. In the classic mode `UP` is the lift button (Space, W or ↑); `DOWN` only
 * matters in the thrust experiment.
 */
export const UP = 1,
  DOWN = 2,
  LEFT = 4,
  RIGHT = 8,
  FIRE = 16;
export const INPUT_MASK = UP | DOWN | LEFT | RIGHT | FIRE;

export const isInput = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= INPUT_MASK &&
  (value & ~INPUT_MASK) === 0;

/** Scramble swaps left and right. */
export function scrambled(bits: number): number {
  const left = bits & LEFT,
    right = bits & RIGHT;
  return (bits & ~(LEFT | RIGHT)) | (left ? RIGHT : 0) | (right ? LEFT : 0);
}
