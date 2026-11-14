import { createOffsetCalendar } from "./y2kCalendar";
import { createTestY2kDeps } from "./y2kFakes";
import type { DueRun } from "./y2kScheduler";
import { dueRun, GRACE_MS, nextTriggerAt, Y2kScheduler } from "./y2kScheduler";
import { COUNTDOWN_MS } from "./y2kSequence";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// The fixed test zone is UTC+1, so its midnight on New Year's Day 2000 is 23:00 UTC on New Year's Eve.
const NOON = Date.UTC(1999, 11, 31, 12);
const MIDNIGHT = Date.UTC(1999, 11, 31, 23);

function setup(options: Parameters<typeof createTestY2kDeps>[0] = {}) {
  const deps = createTestY2kDeps(options);
  const runs: DueRun[] = [];
  const scheduler = new Y2kScheduler(deps, (run) => runs.push(run));
  return { deps, runs, scheduler };
}

describe(dueRun.name, () => {
  it("is due in the last ten seconds before midnight and for five minutes after, once per day", () => {
    const { deps } = setup();
    const { calendar, store } = deps;
    expect(dueRun(NOON, calendar, store)).toBeNull();
    expect(dueRun(MIDNIGHT - COUNTDOWN_MS - 1, calendar, store)).toBeNull();
    expect(dueRun(MIDNIGHT - COUNTDOWN_MS, calendar, store)).toEqual({
      midnight: MIDNIGHT,
      dayKey: "2000-01-01",
    });
    expect(dueRun(MIDNIGHT + GRACE_MS - 1, calendar, store)).toEqual({
      midnight: MIDNIGHT,
      dayKey: "2000-01-01",
    });
    expect(dueRun(MIDNIGHT + GRACE_MS, calendar, store)).toBeNull();
    store.markRun("2000-01-01");
    expect(dueRun(MIDNIGHT - 1, calendar, store)).toBeNull();
    expect(dueRun(MIDNIGHT + 1, calendar, store)).toBeNull();
  });
});

describe(nextTriggerAt.name, () => {
  it("is ten seconds before the next midnight, skipping a day already recorded", () => {
    const { deps } = setup();
    const { calendar, store } = deps;
    expect(nextTriggerAt(NOON, calendar, store)).toBe(MIDNIGHT - COUNTDOWN_MS);
    store.markRun("2000-01-01");
    expect(nextTriggerAt(NOON, calendar, store)).toBe(
      MIDNIGHT + 24 * HOUR - COUNTDOWN_MS,
    );
  });
});

describe(Y2kScheduler.name, () => {
  it("fires ten seconds before local midnight, records the day, and the host re-arms for the next day", () => {
    const { deps, runs, scheduler } = setup();
    scheduler.arm();
    expect(deps.timers.scheduled).toEqual([MIDNIGHT - COUNTDOWN_MS]);

    deps.timers.advance(11 * HOUR - COUNTDOWN_MS - 1);
    expect(runs).toEqual([]);
    deps.timers.advance(1);
    expect(runs).toEqual([{ midnight: MIDNIGHT, dayKey: "2000-01-01" }]);
    expect(deps.store.lastRun()).toBe("2000-01-01");

    // The sequence played; arming again sleeps until the day after.
    deps.timers.advance(30_000);
    scheduler.arm();
    expect(deps.timers.scheduled).toEqual([
      MIDNIGHT + 24 * HOUR - COUNTDOWN_MS,
    ]);
    deps.timers.advance(24 * HOUR);
    expect(runs).toHaveLength(2);
    expect(runs[1]?.dayKey).toBe("2000-01-02");
  });

  it("does not strike twice on the same day, even across a remount", () => {
    const { deps, runs, scheduler } = setup();
    scheduler.arm();
    deps.timers.advance(11 * HOUR);
    expect(runs).toHaveLength(1);
    scheduler.stop();

    const again = new Y2kScheduler(deps, (run) => runs.push(run));
    again.arm();
    expect(runs).toHaveLength(1);
    expect(deps.timers.scheduled).toEqual([
      MIDNIGHT + 24 * HOUR - COUNTDOWN_MS,
    ]);
  });

  it("plays late when a throttled timer fires within the grace window, and skips a midnight slept through", () => {
    const { deps, runs, scheduler } = setup();
    scheduler.arm();
    // The tab was in the background: the timer fires two minutes late.
    deps.timers.sleep(11 * HOUR + 2 * MINUTE);
    deps.timers.advance(0);
    expect(runs).toHaveLength(1);

    deps.timers.advance(30_000);
    scheduler.arm();
    // The laptop slept through the next midnight entirely.
    deps.timers.sleep(24 * HOUR + 6 * MINUTE);
    deps.timers.advance(0);
    expect(runs).toHaveLength(1);
    expect(deps.store.lastRun()).toBe("2000-01-01");
    expect(deps.timers.scheduled).toEqual([
      MIDNIGHT + 48 * HOUR - COUNTDOWN_MS,
    ]);
  });

  it("waits for a fullscreen game to end, then strikes if still within the grace window", () => {
    const { deps, runs, scheduler } = setup();
    deps.fullscreen.set(true);
    scheduler.arm();
    deps.timers.advance(11 * HOUR);
    expect(runs).toEqual([]);
    expect(deps.fullscreen.listenerCount).toBe(1);

    deps.timers.advance(3 * MINUTE);
    deps.fullscreen.set(false);
    expect(runs).toHaveLength(1);
    expect(deps.fullscreen.listenerCount).toBe(0);
  });

  it("gives up on a midnight spent fullscreen past the grace window and arms the next", () => {
    const { deps, runs, scheduler } = setup();
    deps.fullscreen.set(true);
    scheduler.arm();
    deps.timers.advance(11 * HOUR + GRACE_MS);
    expect(runs).toEqual([]);
    expect(deps.fullscreen.listenerCount).toBe(0);
    expect(deps.timers.scheduled).toEqual([
      MIDNIGHT + 24 * HOUR - COUNTDOWN_MS,
    ]);
    deps.fullscreen.set(false);
    expect(runs).toEqual([]);
  });

  it("follows the zone's own midnight across a DST change", () => {
    // UTC+1 until 01:00 UTC on 26 March 2000, UTC+2 after: the night of the change is an hour short.
    const change = Date.UTC(2000, 2, 26, 1);
    const calendar = createOffsetCalendar((ts) => (ts >= change ? 120 : 60));
    const start = Date.UTC(2000, 2, 25, 12);
    const { deps, runs, scheduler } = setup({ start, calendar });
    scheduler.arm();
    deps.timers.advance(11 * HOUR);
    expect(runs.map((run) => run.dayKey)).toEqual(["2000-03-26"]);
    deps.timers.advance(30_000);
    scheduler.arm();
    // Local midnight of 27 March is 22:00 UTC on the 26th: 23 hours after the previous one.
    expect(deps.timers.scheduled).toEqual([
      Date.UTC(2000, 2, 26, 22) - COUNTDOWN_MS,
    ]);
    deps.timers.advance(23 * HOUR);
    expect(runs.map((run) => run.dayKey)).toEqual(["2000-03-26", "2000-03-27"]);
  });

  it("stop clears the pending timer so nothing fires after unmount", () => {
    const { deps, runs, scheduler } = setup();
    scheduler.arm();
    scheduler.stop();
    expect(deps.timers.scheduled).toEqual([]);
    deps.timers.advance(24 * HOUR);
    expect(runs).toEqual([]);
  });
});
