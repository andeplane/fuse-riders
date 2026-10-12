/**
 * Fuse Lane's constants and id rules, with no imports: the room service's registration (`../platform.ts`) reads them
 * without loading the netcode or the rules.
 */
/** Seats per room: 2–5 players, bots included. */
export const CAPACITY = 5;
export const MAX_NAME = 18;

/** Log ticks are the fixed 50 ms clock: 20 per second. */
export const TICKS_PER_SECOND = 20;
/** Game hours per week, and the clock's resolution: one unit is one road step, 15 to the hour. */
export const WEEK_HOURS = 60;
export const UNITS_PER_HOUR = 15;
export const WEEK_UNITS = WEEK_HOURS * UNITS_PER_HOUR;
/** Road steps an avatar walks per log tick: a full lap of 170 steps in about 4 seconds. */
export const WALK_SPEED = 2;
/** The week's real-time length choices, in seconds; 60 by default. */
export const WEEK_SECONDS = [45, 60, 90] as const;
/** The Monday briefing waits this long for everyone to tap READY. */
export const BRIEFING_TICKS = 8 * TICKS_PER_SECOND;
/** A game that runs this long ends with the leader on goal progress. */
export const MAX_WEEKS = 150;
/** Goals are 10..100 in steps of 10; 50 by default. */
export const GOAL_MIN = 10,
  GOAL_MAX = 100,
  GOAL_DEFAULT = 50;

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
