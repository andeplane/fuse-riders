import type { Y2kDeps } from "./y2kDeps";
import { createOffsetCalendar } from "./y2kCalendar";
import { MemoryY2kRunStore } from "./y2kRunStore";

type PendingTimer = { id: number; at: number; callback: () => void };

/**
 * A clock and timer queue the tests drive by hand: `advance(ms)` moves the clock and fires every
 * timer that comes due, in order, so a 24-hour wait costs nothing.
 */
export class FakeY2kTimers {
  private current: number;
  private nextId = 1;
  private pending: PendingTimer[] = [];

  constructor(start: number) {
    this.current = start;
  }

  now = (): number => this.current;

  setTimeout = (callback: () => void, ms: number): number => {
    const id = this.nextId++;
    this.pending.push({ id, at: this.current + Math.max(0, ms), callback });
    return id;
  };

  clearTimeout = (handle: number): void => {
    this.pending = this.pending.filter((timer) => timer.id !== handle);
  };

  /** Timers waiting to fire, soonest first. */
  get scheduled(): readonly number[] {
    return [...this.pending].sort((a, b) => a.at - b.at).map((t) => t.at);
  }

  /** Moves the clock forward, running every timer due on the way in order of their due time. */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const next = [...this.pending].sort((a, b) => a.at - b.at)[0];
      if (!next || next.at > target) break;
      this.pending = this.pending.filter((timer) => timer.id !== next.id);
      this.current = Math.max(this.current, next.at);
      next.callback();
    }
    this.current = target;
  }

  /** Jumps the clock without firing anything: the laptop slept. */
  sleep(ms: number): void {
    this.current += ms;
  }
}

/** A fullscreen switch the tests flip; `change()` notifies the subscribers as `fullscreenchange` would. */
export class FakeFullscreen {
  active = false;
  private listeners = new Set<() => void>();

  isGameFullscreen = (): boolean => this.active;

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  };

  set(active: boolean): void {
    this.active = active;
    for (const listener of [...this.listeners]) listener();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

/** One hour east of UTC all year, as Oslo is in winter. */
export const FIXED_ZONE_OFFSET_MINUTES = 60;

export type TestY2kDeps = Y2kDeps & {
  timers: FakeY2kTimers;
  fullscreen: FakeFullscreen;
  store: MemoryY2kRunStore;
  /** Every line Clippy was asked to say. */
  notices: string[];
};

export type TestY2kOptions = {
  /** Where the fake clock starts; default noon UTC, 1999-12-31 in the fixed zone. */
  start?: number;
  calendar?: Y2kDeps["calendar"];
  store?: MemoryY2kRunStore;
  reducedMotion?: boolean;
  demoOnBoot?: boolean;
  random?: () => number;
};

export function createTestY2kDeps(options: TestY2kOptions = {}): TestY2kDeps {
  const timers = new FakeY2kTimers(
    options.start ?? Date.UTC(1999, 11, 31, 12, 0, 0),
  );
  const fullscreen = new FakeFullscreen();
  const store = options.store ?? new MemoryY2kRunStore();
  const notices: string[] = [];
  return {
    now: timers.now,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    calendar:
      options.calendar ?? createOffsetCalendar(() => FIXED_ZONE_OFFSET_MINUTES),
    store,
    isGameFullscreen: fullscreen.isGameFullscreen,
    subscribeFullscreen: fullscreen.subscribe,
    prefersReducedMotion: () => options.reducedMotion ?? false,
    random: options.random ?? (() => 0.25),
    notify: (text) => notices.push(text),
    demoOnBoot: options.demoOnBoot ?? false,
    timers,
    fullscreen,
    notices,
  };
}
