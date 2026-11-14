/**
 * Killer Fuse's room constants and id rules, with no imports: the room service's registration (`../platform.ts`)
 * reads them without loading the netcode or the engine.
 */

/** Seats per room: two teams of three. Even slots are Cyan, odd slots Pink; slots 0 and 1 are the Queens. */
export const CAPACITY = 6;
export const TEAMS = 2;
/** The most games one team must win to take the set. */
export const MAX_WINS = 3;
/** The most games a set plays: every game has a winner, so one team has `MAX_WINS` by then. */
export const MAX_GAMES = 2 * MAX_WINS - 1;
/** A bound on what one player can count up in one set; far past anything a real set reaches. */
export const MAX_COUNT = 100_000;
export const MAX_NAME = 18;

export const teamOfSlot = (slot: number): number => slot % TEAMS;

const CONTROL = /[\u0000-\u001f\u007f]/;
const LONE_SURROGATE = /\p{Cs}/u;
/** The account name rule every Fuse game shares: trimmed, 1–18 code points, no control characters or lone surrogates. */
export function validName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    // 18 code points are at most 36 UTF-16 units: a longer string is refused before anything copies or splits it.
    value.length <= 2 * MAX_NAME &&
    value === value.trim() &&
    Array.from(value).length <= MAX_NAME &&
    !CONTROL.test(value) &&
    !LONE_SURROGATE.test(value)
  );
}

/** A bot is the seat it fills: `bot:0` to `bot:5`. Bots hold no room seat; the id only names one in a result. */
export const BOT_PREFIX = "bot:";
export const isBotId = (id: string): boolean => /^bot:[0-5]$/.test(id);
