import type {
  FrameWindow,
  HeapSample,
  TaskManagerDeps,
} from "./taskManagerDeps";

/** A page whose animation frames fire only when a test calls `paint()`. */
export class FakeFrameWindow implements FrameWindow {
  private readonly pending = new Map<number, (time: number) => void>();
  private nextHandle = 1;
  /** Every handle ever requested, so a test can see the sampler re-arming. */
  readonly requested: number[] = [];
  readonly cancelled: number[] = [];

  constructor(private readonly now: () => number) {}

  requestAnimationFrame(callback: (time: number) => void): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.pending.set(handle, callback);
    this.requested.push(handle);
    return handle;
  }

  cancelAnimationFrame(handle: number): void {
    this.pending.delete(handle);
    this.cancelled.push(handle);
  }

  /** Runs every pending callback once, as one frame of the page would; `times` frames in a row. */
  paint(times = 1): void {
    for (let frame = 0; frame < times; frame += 1) {
      const callbacks = [...this.pending.values()];
      this.pending.clear();
      callbacks.forEach((callback) => callback(this.now()));
    }
  }

  pendingCount(): number {
    return this.pending.size;
  }
}

/** Task Manager dependencies a test drives by hand: the clock, the ticks, every page's frames and the heap. */
export class FakeTaskManagerDeps implements TaskManagerDeps {
  private time = 0;
  private ticks: Array<() => void> = [];
  readonly desktopFrame: FakeFrameWindow;
  readonly frames = new Map<string, FakeFrameWindow>();
  heapSample: HeapSample | undefined;
  unsubscribed = 0;

  constructor() {
    this.desktopFrame = new FakeFrameWindow(() => this.time);
  }

  readonly now = (): number => this.time;

  readonly subscribeTicks = (onTick: () => void): (() => void) => {
    this.ticks.push(onTick);
    return () => {
      this.ticks = this.ticks.filter((entry) => entry !== onTick);
      this.unsubscribed += 1;
    };
  };

  readonly frameWindowFor = (windowId: string): FrameWindow | undefined =>
    this.frames.get(windowId);

  readonly heap = (): HeapSample | undefined => this.heapSample;

  /** Gives window `id` a page that reports frames; returns it so the test can paint it. */
  addFrame(id: string): FakeFrameWindow {
    const frame = new FakeFrameWindow(() => this.time);
    this.frames.set(id, frame);
    return frame;
  }

  advance(ms: number): void {
    this.time += ms;
  }

  /** Moves the clock on by `ms` and fires one sampling tick. */
  tick(ms = 1000): void {
    this.advance(ms);
    [...this.ticks].forEach((onTick) => onTick());
  }

  subscriberCount(): number {
    return this.ticks.length;
  }
}
