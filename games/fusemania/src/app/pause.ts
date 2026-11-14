/**
 * A clock that can be stopped: a solo song's pause.
 *
 * A solo room has nobody to keep time with, so its room clock is this one. While it is stopped no tick comes due,
 * the song position stands still and nothing is judged; started again it goes on from where it stood, so the room
 * never sees a gap. The engine knows nothing of it: a pause is not an input and changes no rule.
 */
export interface PauseClock {
  /** The time source's time less every pause so far. */
  now(): number;
  readonly paused: boolean;
  pause(): void;
  resume(): void;
}

export function createPauseClock(source: () => number): PauseClock {
  /** Time spent paused before the pause that is running. */
  let lost = 0;
  /** When the running pause began, on the source's clock. */
  let since: number | undefined;
  return {
    now: () => (since ?? source()) - lost,
    get paused() {
      return since !== undefined;
    },
    pause() {
      since ??= source();
    },
    resume() {
      if (since === undefined) return;
      lost += source() - since;
      since = undefined;
    },
  };
}

/** How long RESUME counts in before the song goes on, ms, and how many counts that is. */
export const RESUME_MS = 1500;
export const RESUME_COUNTS = 3;
/** What the count-in shows with `left` ms to go: "3", "2", "1". */
export const resumeCount = (left: number): string =>
  String(
    Math.max(
      1,
      Math.min(RESUME_COUNTS, Math.ceil((left / RESUME_MS) * RESUME_COUNTS)),
    ),
  );
