/**
 * A train's controls as held bits: steer left or right relative to its heading. Holding both, or neither, drives
 * straight on. There is nothing else to press: trains always move.
 */
export const LEFT = 1,
  RIGHT = 2;
export const INPUT_MASK = LEFT | RIGHT;

export const isInput = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= INPUT_MASK;

/** −1 turns left, 1 turns right, 0 drives straight. */
export const steering = (bits: number): -1 | 0 | 1 =>
  (bits & INPUT_MASK) === LEFT ? -1 : (bits & INPUT_MASK) === RIGHT ? 1 : 0;
