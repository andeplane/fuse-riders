/**
 * The fuseDrivers game's constants and id rules, with no imports: the room service's registration (`../platform.ts`) reads
 * them without loading the netcode.
 */
export const TARGET = 50;
export const WINS_NEEDED = 2;
/** Seats per room: 2–5 players, bots included. */
export const CAPACITY = 5;
/** Watchers hold no grid slot and nothing waits on their stream. */
export const MAX_WATCHERS = 8;
/**
 * The most rounds a match plays. With a fixed roster someone reaches `WINS_NEEDED` by then (every seat but one wins
 * `WINS_NEEDED - 1`, then the deciding round); with seats coming and going it could run on, so the round that reaches
 * this bound ends the match, won by the leader (`leader` in the rules).
 */
export const MAX_ROUNDS = CAPACITY * (WINS_NEEDED - 1) + 1;
/** The most one turn or one round's bank can hold; far past anything a legal game reaches. */
export const MAX_POINTS = 10_000;
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
