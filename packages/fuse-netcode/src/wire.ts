export const UINT32_MAX = 0xffff_ffff;

/** An unsigned 32-bit integer: every seq, tick, generation and count on the wire. */
export const uint32 = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= UINT32_MAX &&
  !Object.is(value, -0);
/** A room member id as the room service issues it (and a bot id as a game names it). */
export const memberId = (value: unknown): value is string =>
  typeof value === "string" && /^[\w:.-]{1,64}$/.test(value);
