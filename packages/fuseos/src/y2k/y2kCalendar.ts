/**
 * Local-time arithmetic behind the midnight schedule, injected so tests can run in a zone of their
 * own (with a DST jump) rather than the machine's. Every method takes and returns epoch milliseconds.
 */
export interface LocalCalendar {
  /** The local calendar day of an instant, as "YYYY-MM-DD": the key a run is recorded under. */
  dayKey(timestamp: number): string;
  /** The local midnight that began the day `timestamp` falls in. */
  startOfDay(timestamp: number): number;
  /** The next local midnight strictly after `timestamp`. */
  nextMidnight(timestamp: number): number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/**
 * The browser's own zone. Built from `Date`'s local setters, so a 23- or 25-hour DST day comes out
 * right without any offset arithmetic here.
 */
export const systemCalendar: LocalCalendar = {
  dayKey: (timestamp) => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  },
  startOfDay: (timestamp) => {
    const date = new Date(timestamp);
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).getTime();
  },
  nextMidnight: (timestamp) => {
    const date = new Date(timestamp);
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + 1,
    ).getTime();
  },
};

/**
 * A zone described by its UTC offset at any instant (minutes east of UTC), e.g. `() => 60` for a
 * fixed zone or a step function for one with DST. Midnights are found by one fixpoint refinement,
 * which is exact as long as the offset does not change within the hour around midnight.
 */
export function createOffsetCalendar(
  offsetMinutesAt: (timestamp: number) => number,
): LocalCalendar {
  const local = (timestamp: number) =>
    timestamp + offsetMinutesAt(timestamp) * MINUTE_MS;
  const toUtc = (localMidnight: number, near: number) => {
    const guess = localMidnight - offsetMinutesAt(near) * MINUTE_MS;
    return localMidnight - offsetMinutesAt(guess) * MINUTE_MS;
  };
  return {
    dayKey: (timestamp) => {
      const date = new Date(local(timestamp));
      return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    },
    startOfDay: (timestamp) =>
      toUtc(Math.floor(local(timestamp) / DAY_MS) * DAY_MS, timestamp),
    nextMidnight: (timestamp) =>
      toUtc((Math.floor(local(timestamp) / DAY_MS) + 1) * DAY_MS, timestamp),
  };
}
