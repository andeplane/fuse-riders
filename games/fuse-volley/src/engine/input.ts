/**
 * A blob's controls as three held bits. The engine finds a jump press itself from the blob's state, so an input is
 * only ever "what is held now". Holding left and right together is legal on the wire and cancels out; a device
 * resolves the two to whichever was pressed last before it logs anything (`app/controls.ts`).
 */
export const LEFT = 1,
  RIGHT = 2,
  JUMP = 4;
export const INPUT_MASK = LEFT | RIGHT | JUMP;

/** Held bits as the wire may carry them: a whole number with no unknown bits. */
export const isInput = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= INPUT_MASK;

/** The same controls seen in a mirror: left and right swapped. */
export function mirrored(bits: number): number {
  return (
    (bits & JUMP) | (bits & LEFT ? RIGHT : 0) | (bits & RIGHT ? LEFT : 0)
  );
}
