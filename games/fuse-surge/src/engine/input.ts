/**
 * A rider's controls as two held bits. The engine finds a jump press itself from the rider's state, so an input is
 * only ever "what is held now". Both together are legal and the jump wins: a duck dives only once jump is let go.
 */
export const JUMP = 1,
  DUCK = 2;
export const INPUT_MASK = JUMP | DUCK;

/** Held bits as the wire may carry them: a whole number with no unknown bits. */
export const isInput = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= INPUT_MASK;
