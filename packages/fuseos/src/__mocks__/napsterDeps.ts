import type { Cancel, NapsterDeps } from "../napster/napsterDeps";

import { seededRandom } from "./seededRandom";

type Scheduled = {
  due: number;
  every: number | undefined;
  callback: () => void;
  cancelled: boolean;
};

/** A clock that only moves when the test says so; `every` and `after` run in due order inside `advance`. */
export type ManualNapsterClock = {
  now(): number;
  advance(ms: number): void;
  /** Timers still waiting (not cancelled). */
  pending(): number;
};

export type TestNapsterDeps = NapsterDeps & {
  clock: ManualNapsterClock;
  /** How many times the connected chime played. */
  chimes: () => number;
};

export function createTestNapsterDeps(
  overrides: Partial<NapsterDeps> = {},
): TestNapsterDeps {
  let time = 0;
  let chimes = 0;
  const timers: Scheduled[] = [];
  const schedule = (
    ms: number,
    callback: () => void,
    every: number | undefined,
  ): Cancel => {
    const timer: Scheduled = {
      due: time + ms,
      every,
      callback,
      cancelled: false,
    };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const clock: ManualNapsterClock = {
    now: () => time,
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = timers
          .filter((timer) => !timer.cancelled && timer.due <= end)
          .sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        time = next.due;
        if (next.every === undefined) next.cancelled = true;
        else next.due += next.every;
        next.callback();
      }
      time = end;
    },
    pending: () => timers.filter((timer) => !timer.cancelled).length,
  };
  return {
    random: seededRandom(2000),
    every: (ms, callback) => schedule(ms, callback, ms),
    after: (ms, callback) => schedule(ms, callback, undefined),
    playChime: () => {
      chimes += 1;
    },
    shutdownChance: 0,
    ...overrides,
    clock,
    chimes: () => chimes,
  };
}
