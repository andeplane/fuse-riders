/**
 * A hero's controls as held bits, logged per seat per step. Presses (and later double taps, combos and charge) are
 * derived from the previous step's bits, which the world keeps per hero, so a rollback never loses one.
 */
export const LEFT = 1,
  RIGHT = 2,
  UP = 4,
  DOWN = 8,
  ATTACK = 16,
  JUMP = 32,
  MAGIC = 64;
export const INPUT_MASK = LEFT | RIGHT | UP | DOWN | ATTACK | JUMP | MAGIC;

export const isInput = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= INPUT_MASK;

/** Bits held this step that were not held on the previous one. */
export const pressed = (held: number, previous: number): number =>
  held & ~previous;

/** Bits held on the previous step and let go this one. */
export const released = (held: number, previous: number): number =>
  previous & ~held;
