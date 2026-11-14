import { createOffsetCalendar, systemCalendar } from "./y2kCalendar";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("systemCalendar", () => {
  it("keys, starts and ends the day the way Date does in the machine's zone", () => {
    const noon = new Date(1999, 11, 31, 12, 34, 56).getTime();
    expect(systemCalendar.dayKey(noon)).toBe("1999-12-31");
    expect(systemCalendar.startOfDay(noon)).toBe(
      new Date(1999, 11, 31).getTime(),
    );
    expect(systemCalendar.nextMidnight(noon)).toBe(
      new Date(2000, 0, 1).getTime(),
    );
    expect(systemCalendar.dayKey(systemCalendar.nextMidnight(noon))).toBe(
      "2000-01-01",
    );
  });

  it("pads single-digit months and days", () => {
    expect(systemCalendar.dayKey(new Date(2000, 0, 5).getTime())).toBe(
      "2000-01-05",
    );
  });
});

describe(createOffsetCalendar.name, () => {
  it("in a fixed zone, midnight is the local one, not UTC's", () => {
    const oslo = createOffsetCalendar(() => 60);
    const noonUtc = Date.UTC(1999, 11, 31, 12);
    expect(oslo.dayKey(noonUtc)).toBe("1999-12-31");
    expect(oslo.startOfDay(noonUtc)).toBe(Date.UTC(1999, 11, 30, 23));
    expect(oslo.nextMidnight(noonUtc)).toBe(Date.UTC(1999, 11, 31, 23));
    expect(oslo.dayKey(oslo.nextMidnight(noonUtc))).toBe("2000-01-01");
  });

  it("west of UTC the day key lags behind UTC's date late in the evening", () => {
    const newYork = createOffsetCalendar(() => -300);
    const lateEveningUtc = Date.UTC(2000, 0, 1, 3);
    expect(newYork.dayKey(lateEveningUtc)).toBe("1999-12-31");
    expect(newYork.nextMidnight(lateEveningUtc)).toBe(Date.UTC(2000, 0, 1, 5));
  });

  it("a day with a spring-forward DST jump lasts 23 hours and the one with fall-back 25", () => {
    // Clocks go forward at 01:00 UTC on 26 March 2000 and back at 01:00 UTC on 29 October 2000.
    const springForward = Date.UTC(2000, 2, 26, 1);
    const fallBack = Date.UTC(2000, 9, 29, 1);
    const zone = createOffsetCalendar((ts) =>
      ts >= springForward && ts < fallBack ? 120 : 60,
    );

    const beforeSpring = Date.UTC(2000, 2, 25, 12);
    const springDayStart = zone.nextMidnight(beforeSpring);
    expect(springDayStart).toBe(Date.UTC(2000, 2, 25, 23));
    expect(zone.nextMidnight(springDayStart) - springDayStart).toBe(23 * HOUR);
    expect(zone.dayKey(springDayStart)).toBe("2000-03-26");

    const beforeFall = Date.UTC(2000, 9, 28, 12);
    const fallDayStart = zone.nextMidnight(beforeFall);
    expect(fallDayStart).toBe(Date.UTC(2000, 9, 28, 22));
    expect(zone.nextMidnight(fallDayStart) - fallDayStart).toBe(25 * HOUR);
    expect(zone.startOfDay(fallDayStart + 20 * HOUR)).toBe(fallDayStart);
  });

  it("startOfDay and nextMidnight are a day apart in a fixed zone", () => {
    const zone = createOffsetCalendar(() => -600);
    const ts = Date.UTC(2000, 5, 15, 7, 30);
    expect(zone.nextMidnight(ts) - zone.startOfDay(ts)).toBe(DAY);
    expect(zone.nextMidnight(ts)).toBeGreaterThan(ts);
    expect(zone.startOfDay(ts)).toBeLessThanOrEqual(ts);
  });
});
