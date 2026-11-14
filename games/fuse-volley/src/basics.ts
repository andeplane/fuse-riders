/**
 * Fuse Volley's constants and id rules, with no imports: the room service's registration (`platform.ts`) reads them
 * without loading the engine or the netcode. `CAPACITY` and the targets repeat the engine's (`engine/tuning.ts`),
 * which may not import from outside its folder; `tests/engine.test.ts` holds the two in step.
 */
export const GAME_ID = "fuse-volley";
/** Seats per room: one blob a side, a bot included. */
export const CAPACITY = 2;
/** Points that win a match, by scoring rule; both need a lead of two. */
export const RALLY_TARGET = 11;
export const CLASSIC_TARGET = 15;
/**
 * The most points one side can have when a match ends. Win by two has no ceiling in principle, so a match that is
 * still level at this many is decided by the next point (`engine/tuning.ts` `SCORE_CAP`): a report never carries more.
 */
export const SCORE_CAP = 40;
export const MAX_NAME = 18;
/**
 * The most hits one match reports for a blob. A hit is a counted touch, at most one every 4 steps (30 a second), so
 * 20 000 is eleven minutes of nothing else; the result stops counting here and the service refuses more.
 */
export const MOST_HITS = 20000;

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
