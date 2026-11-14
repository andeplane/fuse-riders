import type { LocalCalendar } from "./y2kCalendar";
import type { Y2kRunStore } from "./y2kRunStore";
import { COUNTDOWN_MS } from "./y2kSequence";

/**
 * How late after a local midnight the sequence still plays: a background tab's throttled timer or a
 * short lid-close. Any later (the laptop slept through the night) and that midnight is skipped.
 */
export const GRACE_MS = 5 * 60_000;

export type Y2kSchedulerDeps = {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
  calendar: LocalCalendar;
  store: Y2kRunStore;
  /** A game is playing fullscreen: the bug waits until the player leaves fullscreen. */
  isGameFullscreen: () => boolean;
  /** Calls back whenever fullscreen is entered or left; returns an unsubscribe. */
  subscribeFullscreen: (onChange: () => void) => () => void;
};

export type DueRun = {
  /** The local midnight the run belongs to. */
  midnight: number;
  dayKey: string;
};

/**
 * The midnight a run is due for at `now`, if any: the one that just passed (within the grace
 * window) or the one about to arrive (within the countdown), unless that day has had its run.
 */
export function dueRun(
  now: number,
  calendar: LocalCalendar,
  store: Y2kRunStore,
): DueRun | null {
  const last = store.lastRun();
  const start = calendar.startOfDay(now);
  const startKey = calendar.dayKey(start);
  if (now < start + GRACE_MS && last !== startKey)
    return { midnight: start, dayKey: startKey };
  const next = calendar.nextMidnight(now);
  const nextKey = calendar.dayKey(next);
  if (now >= next - COUNTDOWN_MS && last !== nextKey)
    return { midnight: next, dayKey: nextKey };
  return null;
}

/** The instant the next countdown should begin: ten seconds before the next midnight that has not had its run. */
export function nextTriggerAt(
  now: number,
  calendar: LocalCalendar,
  store: Y2kRunStore,
): number {
  let midnight = calendar.nextMidnight(now);
  const last = store.lastRun();
  // A clock set forward and back could leave tomorrow already recorded; skip to the day after.
  while (calendar.dayKey(midnight) === last)
    midnight = calendar.nextMidnight(midnight);
  return midnight - COUNTDOWN_MS;
}

/**
 * Arms one timer for the next local midnight, re-checks the wall clock when it fires (timers drift
 * in background tabs and across sleep), waits out a fullscreen game, records the run, and hands the
 * start to `onRun`. The host calls `arm()` again once the sequence has played.
 */
export class Y2kScheduler {
  private timer: number | null = null;
  private unsubscribeFullscreen: (() => void) | null = null;

  constructor(
    private readonly deps: Y2kSchedulerDeps,
    private readonly onRun: (run: DueRun) => void,
  ) {}

  /** Looks for a due run now, else sleeps until the next countdown. Safe to call repeatedly. */
  arm(): void {
    this.stop();
    const { deps } = this;
    const now = deps.now();
    const due = dueRun(now, deps.calendar, deps.store);
    if (!due) {
      const delay = Math.max(
        0,
        nextTriggerAt(now, deps.calendar, deps.store) - now,
      );
      this.timer = deps.setTimeout(() => this.arm(), delay);
      return;
    }
    if (deps.isGameFullscreen()) {
      // Whatever ends fullscreen (or the grace window running out) decides on the next check.
      this.unsubscribeFullscreen = deps.subscribeFullscreen(() => this.arm());
      this.timer = deps.setTimeout(
        () => this.arm(),
        Math.max(0, due.midnight + GRACE_MS - now),
      );
      return;
    }
    deps.store.markRun(due.dayKey);
    this.onRun(due);
  }

  stop(): void {
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribeFullscreen?.();
    this.unsubscribeFullscreen = null;
  }
}
