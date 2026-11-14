import { createContext } from "react";

/** The timers the fold runs on; `window.setTimeout` in the app, a stepped fake in tests. */
export type Scheduler = {
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
};

export type System32Deps = {
  scheduler: Scheduler;
  /**
   * Shows the blue screen when the fold ends. Resolves (or returns) when the screen may go
   * away again; the restart follows. Absent: the provider draws its own simple blue screen.
   */
  showBsod?: () => Promise<void> | void;
  /** The `?fold=` demo trigger, read from the address once; absent means no demo. */
  demo?: FoldDemo;
};

/** What `?fold=` asks for; see parseFoldParam. */
export type FoldDemo =
  /** Start the whole sequence as if the folder had just been removed, questions included. */
  | { kind: "now" }
  /** Skip the questions and the waits: land on this many stages (0..FOLD_STAGES.length) and stay there. */
  | { kind: "stage"; stage: number }
  /** Go straight to the blue screen (and on to the restart). */
  | { kind: "bsod" };

export const windowScheduler: Scheduler = {
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

/** A scheduler the test drives by hand: timers fire in due order when `advance` passes their time. */
export class MemoryScheduler implements Scheduler {
  private readonly timers = new Map<
    number,
    { due: number; callback: () => void }
  >();
  private nextHandle = 1;
  now = 0;

  setTimeout(callback: () => void, ms: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, { due: this.now + ms, callback });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  /** Timers still armed. */
  get pending(): number {
    return this.timers.size;
  }

  /** Moves the clock forward, firing every timer due on the way, in due order; a callback may arm more. */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let soonest: [number, { due: number; callback: () => void }] | null =
        null;
      for (const entry of this.timers)
        if (
          entry[1].due <= target &&
          (soonest === null || entry[1].due < soonest[1].due)
        )
          soonest = entry;
      if (soonest === null) break;
      this.timers.delete(soonest[0]);
      this.now = soonest[1].due;
      soonest[1].callback();
    }
    this.now = target;
  }
}

export const defaultSystem32Deps: System32Deps = { scheduler: windowScheduler };

export const System32DepsContext =
  createContext<System32Deps>(defaultSystem32Deps);
