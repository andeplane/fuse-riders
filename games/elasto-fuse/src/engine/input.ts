/** A rider's held controls for one step, as bits. `TURN`, the volts and `RESTART` act on the step they go down. */
export const GAS = 1,
  BRAKE = 2,
  VOLT_LEFT = 4,
  VOLT_RIGHT = 8,
  TURN = 16,
  RESTART = 32;
export const INPUT_MASK = 63;
export const isInput = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= INPUT_MASK;
