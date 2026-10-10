/**
 * A rider's controls as held bits, one number per tick: the four directions steer the gunship (or the ghost) and
 * `FIRE` is held while the fire button is down (the round fires on its rising edge). Not wired into the round yet.
 */
export const UP = 1,
  DOWN = 2,
  LEFT = 4,
  RIGHT = 8,
  FIRE = 16;
export const INPUT_MASK = UP | DOWN | LEFT | RIGHT | FIRE;

/** Runtime check for input that crosses a boundary (keyboard map, phone, log entry): an integer of known bits only. */
export const isInput = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= INPUT_MASK &&
  (value & ~INPUT_MASK) === 0;

/** A thrust direction: a unit vector, or zero when no direction is held. y grows downward. */
export interface Direction {
  readonly x: number;
  readonly y: number;
}

const axis = (bits: number, minus: number, plus: number): number =>
  (bits & plus ? 1 : 0) - (bits & minus ? 1 : 0);

/** Every combination of the four direction bits, precomputed so steering allocates nothing. */
const DIRECTIONS: readonly Direction[] = Array.from(
  { length: 16 },
  (_, bits) => {
    const x = axis(bits, LEFT, RIGHT),
      y = axis(bits, UP, DOWN);
    const scale = x !== 0 && y !== 0 ? Math.SQRT1_2 : 1;
    return Object.freeze({ x: x * scale, y: y * scale });
  },
);

/**
 * The thrust direction the held bits ask for: opposite directions cancel (left + right is no sideways thrust) and
 * diagonals are normalised, so flying diagonally is exactly as fast as flying straight. Other bits are ignored.
 */
export function thrustDirection(bits: number): Direction {
  // `& 15` keeps any value, even a non-integer or NaN, inside the table.
  return DIRECTIONS[bits & (UP | DOWN | LEFT | RIGHT)] ?? DIRECTIONS[0]!;
}
