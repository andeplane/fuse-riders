/**
 * Fuseball's constants and id rules, with no imports: the room service's registration (`platform.ts`) reads them
 * without loading the engine or the netcode. `CAPACITY` and `TARGET` repeat the engine's (`engine/tuning.ts`), which
 * may not import from outside its folder; `tests/engine.test.ts` holds the two in step.
 */
export const GAME_ID = "fuseball";
/** Seats per room: a duel, a bot included. */
export const CAPACITY = 2;
/** Points that win the match. */
export const TARGET = 3;
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
