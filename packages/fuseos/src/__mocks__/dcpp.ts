import type { DcClientDeps, TimerHandle } from "../dcpp/dcClient";
import type { DcppDeps } from "../dcpp/dcppDeps";
import { HUBS } from "../dcpp/hubs";
import type { Random } from "../dcpp/rng";
import { createRandom } from "../dcpp/rng";
import { FUSE_TRACKS } from "../winamp/fuseTracks";

/** A clock and timers a test moves by hand: nothing fires until `advance`. */
export type FakeDcClock = {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
  advance: (ms: number) => void;
  pending: () => number;
};

/** 21:00 local time on 14 November 2003, so chat stamps are stable. */
export const DC_EPOCH = new Date(2003, 10, 14, 21, 0, 0).getTime();

export function createFakeDcClock(start = DC_EPOCH): FakeDcClock {
  type Entry = { id: number; due: number; callback: () => void };
  let now = start;
  let nextId = 1;
  let entries: Entry[] = [];
  return {
    now: () => now,
    setTimeout: (callback, ms) => {
      const entry = { id: nextId++, due: now + ms, callback };
      entries.push(entry);
      return entry.id;
    },
    clearTimeout: (handle) => {
      entries = entries.filter((entry) => entry.id !== handle);
    },
    advance: (ms) => {
      const target = now + ms;
      for (;;) {
        const due = entries
          .filter((entry) => entry.due <= target)
          .sort((a, b) => a.due - b.due || a.id - b.id)[0];
        if (!due) break;
        now = due.due;
        entries = entries.filter((entry) => entry.id !== due.id);
        due.callback();
      }
      now = target;
    },
    pending: () => entries.length,
  };
}

/** Client deps over a fake clock: the real hubs and soundtrack, a fixed seed unless a test scripts the dice. */
export function createTestDcClientDeps(
  clock: FakeDcClock,
  overrides: Partial<DcClientDeps> & { random?: Random } = {},
): DcClientDeps {
  return {
    random: createRandom(7),
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    hubs: HUBS,
    tracks: FUSE_TRACKS,
    ...overrides,
  };
}

/** The window's deps over a fake clock, seeded the same every run. */
export function createTestDcppDeps(
  clock: FakeDcClock,
  overrides: Partial<DcppDeps> = {},
): DcppDeps {
  return {
    seed: () => 7,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    hubs: HUBS,
    tracks: FUSE_TRACKS,
    ...overrides,
  };
}
