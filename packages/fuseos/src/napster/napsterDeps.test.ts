import type { ChimeAudioContext } from "./napsterChime";
import {
  browserAfter,
  browserEvery,
  createBrowserAudio,
  defaultNapsterDeps,
} from "./napsterDeps";

class SilentAudio implements ChimeAudioContext {
  static made = 0;
  readonly currentTime = 0;
  readonly destination = { connect: (node: never) => node };
  constructor() {
    SilentAudio.made += 1;
  }
  createGain(): never {
    throw new Error("unused");
  }
  createOscillator(): never {
    throw new Error("unused");
  }
  close() {
    return Promise.resolve();
  }
}

describe(createBrowserAudio.name, () => {
  it("makes a context unless there is no Web Audio or the page is muted", () => {
    expect(createBrowserAudio(SilentAudio, "")()).toBeInstanceOf(SilentAudio);
    expect(createBrowserAudio(SilentAudio, "?mute")()).toBeUndefined();
    expect(createBrowserAudio(undefined, "")()).toBeUndefined();
  });
});

describe("browser timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("repeats every interval and runs once after a delay, until cancelled", () => {
    const tick = vi.fn();
    const once = vi.fn();
    const stop = browserEvery(100, tick);
    const cancelled = vi.fn();
    browserAfter(250, once);
    browserAfter(50, cancelled)();
    vi.advanceTimersByTime(350);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(once).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
    stop();
    vi.advanceTimersByTime(500);
    expect(tick).toHaveBeenCalledTimes(3);
  });
});

describe("defaultNapsterDeps", () => {
  it("is quiet where there is no Web Audio, and the court order is a rare treat", () => {
    expect(() => defaultNapsterDeps.playChime()).not.toThrow();
    expect(defaultNapsterDeps.shutdownChance).toBeGreaterThan(0);
    expect(defaultNapsterDeps.shutdownChance).toBeLessThan(0.01);
  });
});
