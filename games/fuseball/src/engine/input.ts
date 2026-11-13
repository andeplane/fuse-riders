/**
 * A rider's controls as held bits: one eight-way stick and one button. The engine finds presses and releases itself,
 * from the bits it saw the step before (`Rider.prev`), so an input is only ever "what is held now".
 */
export const UP = 1,
  DOWN = 2,
  LEFT = 4,
  RIGHT = 8,
  BTN = 16;
export const INPUT_MASK = UP | DOWN | LEFT | RIGHT | BTN;

/** Held bits a stick can produce: no unknown bits, and never both ways along one axis. */
export const isInput = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= INPUT_MASK &&
  (value & ~INPUT_MASK) === 0 &&
  (value & (LEFT | RIGHT)) !== (LEFT | RIGHT) &&
  (value & (UP | DOWN)) !== (UP | DOWN);

/** The same controls seen in a mirror: left and right swapped. */
export function mirrored(bits: number): number {
  const left = bits & LEFT,
    right = bits & RIGHT;
  return (bits & ~(LEFT | RIGHT)) | (left ? RIGHT : 0) | (right ? LEFT : 0);
}
