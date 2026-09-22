/**
 * The fuseDrivers game's constants and id rules, with no imports: the room service's registration (`../platform.ts`) reads
 * them without loading the netcode.
 */
/** Laps in a race, and the most a corrupt report may claim. */
export const LAPS = 4;
export const MAX_LAPS = 64;
/** Seats per room: 2–5 players, bots included. */
export const CAPACITY = 5;
/** Watchers hold no grid slot and nothing waits on their stream. */
export const MAX_WATCHERS = 8;
/** A race is one round today; a series of them is the next feature. */
export const MAX_ROUNDS = 8;
/** Progress is laps and checkpoints in hundredths, so this is far past anything a legal race reaches. */
export const MAX_PROGRESS_UNITS = 100_000;
/** Weapons and wrecks are bounded by how long a race can run. */
export const MAX_EVENTS = 1_000;
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
