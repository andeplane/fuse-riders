/**
 * Fuse Surge's constants and id rules, with no imports: the room service's registration (`platform.ts`) reads them
 * without loading the engine or the netcode. `CAPACITY` and the bounds repeat the engine's (`engine/tuning.ts`),
 * which may not import from outside its folder; `tests/engine.test.ts` holds the two in step.
 */
export const GAME_ID = "fuse-surge";
/** Seats per room, bots included: one lane each on the deck. */
export const CAPACITY = 5;
export const MIN_RIDERS = 2;
/** The most round wins a match can be played to, and so the most any rider reports. */
export const MAX_TARGET = 5;
export const MAX_NAME = 18;
/** The most surges one match reports dodged, and the most hits taken; the result stops counting there. */
export const MOST_DODGES = 20000;
export const MOST_TAKEN = 5000;

const CONTROL = /[\u0000-\u001f\u007f]/;
const LONE_SURROGATE = /\p{Cs}/u;
/** The account name rule every game shares: trimmed, 1–18 code points, no control characters or half surrogate pairs. */
export function validName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    Array.from(value).length <= MAX_NAME &&
    !CONTROL.test(value) &&
    !LONE_SURROGATE.test(value)
  );
}

export const BOT_PREFIX = "bot:";
export const isBotId = (id: string): boolean => /^bot:[0-9]{1,6}$/.test(id);
