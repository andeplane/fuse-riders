/**
 * Elasto Fuse's constants and id rules, with no imports: the room service's registration (`platform.ts`) reads them
 * without loading the engine or the netcode. `CAPACITY` and `LEVEL_COUNT` repeat the engine's, which may not import
 * from outside its folder; `tests/engine.test.ts` holds them in step.
 */
export const GAME_ID = "elasto-fuse";
/** Riders per room. */
export const CAPACITY = 5;
/** Levels in the tour. */
export const LEVEL_COUNT = 12;
/** Points for finishing a level first, second and so on; a rider that never reaches the flower gets none. */
export const PLACE_POINTS = [10, 7, 5, 3, 2] as const;
/** The most points one match can give a rider: first on every level. */
export const MOST_POINTS = PLACE_POINTS[0] * LEVEL_COUNT;
/** The most crashes and restarts one match reports for a rider; the result stops counting here. */
export const MOST_DEATHS = 5000;
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
