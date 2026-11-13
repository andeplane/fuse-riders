/**
 * Wire and checkpoint helpers: an input as five bits, a copy of the round, and the hash two peers compare. The hash
 * walks the state in sorted key order, so it does not depend on how an object was built or decoded.
 */
import type { Input, Round } from "./types.js";

export const INPUT_LEFT = 1,
  INPUT_RIGHT = 2,
  INPUT_DOWN = 4,
  INPUT_HELD = 8,
  INPUT_PRESSED = 16;
export const INPUT_MASK = 31;

export function packInput(input: Input): number {
  return (
    (input.left ? INPUT_LEFT : 0) |
    (input.right ? INPUT_RIGHT : 0) |
    (input.down ? INPUT_DOWN : 0) |
    (input.held ? INPUT_HELD : 0) |
    (input.pressed ? INPUT_PRESSED : 0)
  );
}

export function unpackInput(bits: number): Input {
  return {
    left: (bits & INPUT_LEFT) !== 0,
    right: (bits & INPUT_RIGHT) !== 0,
    down: (bits & INPUT_DOWN) !== 0,
    held: (bits & INPUT_HELD) !== 0,
    pressed: (bits & INPUT_PRESSED) !== 0,
  };
}

/** A deep copy. The state is plain data, so this is all a rollback snapshot needs. */
export function cloneRound(state: Round): Round {
  return structuredClone(state);
}

type Plain =
  | null
  | boolean
  | number
  | string
  | readonly Plain[]
  | { readonly [key: string]: Plain };

/** The state as text with every object's keys sorted. */
function canonical(value: Plain): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as { readonly [key: string]: Plain };
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key]!)}`)
    .join(",")}}`;
}

/** FNV-1a over the text, from two different offsets: 16 hex characters. */
function fnv(text: string, offset: number): string {
  let h = offset >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * 16 hex characters over the whole round except `events`, which describe the last step rather than the state the
 * next one starts from.
 */
export function hashRound(state: Round): string {
  const { events: _events, ...rest } = state;
  const text = canonical(JSON.parse(JSON.stringify(rest)) as Plain);
  return fnv(text, 0x811c9dc5) + fnv(text, 0x9747b28c);
}
