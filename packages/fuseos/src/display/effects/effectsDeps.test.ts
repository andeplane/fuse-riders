import { createManualTimers, defaultDisplayEffectsDeps } from "./effectsDeps";

describe("manual timers", () => {
  it("fires timers in due order as the clock advances, never early", () => {
    const timers = createManualTimers();
    const fired: string[] = [];
    timers.setTimeout(() => fired.push("late"), 300);
    timers.setTimeout(() => fired.push("early"), 100);
    expect(timers.pending()).toBe(2);
    timers.advance(99);
    expect(fired).toEqual([]);
    timers.advance(1);
    expect(fired).toEqual(["early"]);
    timers.advance(1000);
    expect(fired).toEqual(["early", "late"]);
    expect(timers.pending()).toBe(0);
  });

  it("runs a timer scheduled by another timer in the same advance, at its own due time", () => {
    const timers = createManualTimers();
    const fired: string[] = [];
    timers.setTimeout(() => {
      fired.push("first");
      timers.setTimeout(() => fired.push("second"), 100);
    }, 100);
    timers.advance(150);
    expect(fired).toEqual(["first"]);
    timers.advance(50);
    expect(fired).toEqual(["first", "second"]);
  });

  it("drops a cleared timer", () => {
    const timers = createManualTimers();
    const fired: string[] = [];
    const handle = timers.setTimeout(() => fired.push("gone"), 100);
    timers.clearTimeout(handle);
    timers.advance(1000);
    expect(fired).toEqual([]);
    expect(timers.pending()).toBe(0);
  });
});

describe("default effects deps", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uses the global timers and can cancel them", () => {
    const fired = vi.fn();
    defaultDisplayEffectsDeps.setTimeout(fired, 100);
    vi.advanceTimersByTime(99);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fired).toHaveBeenCalledTimes(1);
    const cancelled = defaultDisplayEffectsDeps.setTimeout(fired, 100);
    defaultDisplayEffectsDeps.clearTimeout(cancelled);
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("draws the curvature map on a document canvas, or reports none when it cannot draw", () => {
    const map = defaultDisplayEffectsDeps.createCurvatureMap();
    // happy-dom has no 2D canvas, so this is the "cannot draw" branch; a browser returns a PNG data URL.
    expect(map === undefined || map.startsWith("data:image/")).toBe(true);
  });
});
