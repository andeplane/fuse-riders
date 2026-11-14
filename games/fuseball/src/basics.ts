/**
 * Fuseball's constants and id rules, with no imports: the room service's registration (`platform.ts`) reads them
 * without loading the engine or the netcode. `CAPACITY` and `TARGET` repeat the engine's (`engine/tuning.ts`), which
 * may not import from outside its folder; `tests/engine.test.ts` holds the two in step.
 */
export const GAME_ID = "fuseball";
/** Seats per room: three riders a side at most, bots included. */
export const CAPACITY = 6;
/** Points that win the match. */
export const TARGET = 3;
export const MAX_NAME = 18;
/**
 * The most bubbles, and the most pops, one match reports. A bubble is a fresh press in the air and a pop needs a
 * bubble; a device logs what it holds once a 50 ms tick, so a press and its release take two: 6000 is ten minutes of
 * nothing else. The room's result (`online/result.ts`) stops counting there and the service (`platform.ts`) refuses
 * more, so a forged report adds no more than this to anybody's totals. The engine's own counters are cosmetic and
 * wrap at 65 536 (`engine/tuning.ts` `COUNTER`), eleven times further on.
 */
export const MOST_BUBBLES = 6000;

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
