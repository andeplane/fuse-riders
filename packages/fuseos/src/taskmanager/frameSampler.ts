import type { FrameWindow } from "./taskManagerDeps";

/** A page whose animation frames have not fired for this long is "Not Responding", as Windows reports a stalled message loop. */
export const STALL_MS = 2000;

export type TaskStatus = "running" | "notResponding";

export type FrameSample = {
  /** Frames per second over the interval since the previous sample, rounded to a whole number. */
  fps: number;
  status: TaskStatus;
};

/**
 * Counts the animation frames one page produces. A callback chain keeps a frame requested at
 * all times; `sample()` turns the count since the last call into a rate. If no frame fired
 * since the last sample the chain is re-armed, because a page that navigated (a game's own
 * links) drops the callbacks its old document held while the window object stays the same.
 */
export class FrameSampler {
  private frames = 0;
  private handle: number | undefined;
  private lastFrameAt: number | undefined;
  private lastSampleAt: number;
  private readonly startedAt: number;
  private disposed = false;

  constructor(
    readonly frame: FrameWindow,
    private readonly now: () => number,
  ) {
    this.startedAt = now();
    this.lastSampleAt = this.startedAt;
    this.arm();
  }

  private arm(): void {
    if (this.disposed) return;
    this.handle = this.frame.requestAnimationFrame(() => {
      this.frames += 1;
      this.lastFrameAt = this.now();
      this.arm();
    });
  }

  sample(): FrameSample {
    const at = this.now();
    const elapsedMs = at - this.lastSampleAt;
    const fps =
      elapsedMs > 0 ? Math.round((this.frames * 1000) / elapsedMs) : 0;
    const stalled = at - (this.lastFrameAt ?? this.startedAt) > STALL_MS;
    if (this.frames === 0 && this.handle !== undefined) {
      this.frame.cancelAnimationFrame(this.handle);
      this.arm();
    }
    this.frames = 0;
    this.lastSampleAt = at;
    return { fps, status: stalled ? "notResponding" : "running" };
  }

  dispose(): void {
    this.disposed = true;
    if (this.handle !== undefined) this.frame.cancelAnimationFrame(this.handle);
    this.handle = undefined;
  }
}

/** The last `capacity` values of a series, oldest first; what one Performance graph draws. */
export class History {
  private readonly values: number[] = [];

  constructor(readonly capacity: number) {}

  push(value: number): void {
    this.values.push(value);
    if (this.values.length > this.capacity) this.values.shift();
  }

  toArray(): readonly number[] {
    return [...this.values];
  }

  latest(): number | undefined {
    return this.values[this.values.length - 1];
  }
}
