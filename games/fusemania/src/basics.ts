/**
 * Fusemania's constants and id rules, with no imports: the room service's registration (`platform.ts`) reads them
 * without loading the engine or the netcode. `CAPACITY` repeats the engine's, which may not import from outside its
 * folder; `tests/engine.test.ts` holds them in step.
 */
export const GAME_ID = "fusemania";
/** Players per room. */
export const CAPACITY = 5;
/** What a rating is out of; a doubled stretch can take a battle's past it, up to twice. */
export const FULL_RATING = 1_000_000;
export const MOST_RATING = FULL_RATING * 2;
/** The most notes a chart can have, and so the most of any judgment a result reports. */
export const MOST_NOTES = 20_000;
export const MAX_NAME = 18;

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
