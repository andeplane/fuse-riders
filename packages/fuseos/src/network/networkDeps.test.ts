import { defaultNetworkDeps } from "./networkDeps";

describe("defaultNetworkDeps", () => {
  it("reads the clock, the pointer media query and the browser's interval timer", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.UTC(1998, 5, 25, 12, 34)));
      expect(defaultNetworkDeps.now()).toBe(Date.UTC(1998, 5, 25, 12, 34));
      expect(typeof defaultNetworkDeps.finePointer()).toBe("boolean");
      const callback = vi.fn();
      const stop = defaultNetworkDeps.every(callback, 1000);
      vi.advanceTimersByTime(2500);
      expect(callback).toHaveBeenCalledTimes(2);
      stop();
      vi.advanceTimersByTime(2000);
      expect(callback).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("assumes a fine pointer when matchMedia is unavailable", () => {
    const original = window.matchMedia;
    window.matchMedia = () => {
      throw new Error("no matchMedia");
    };
    try {
      expect(defaultNetworkDeps.finePointer()).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });
});
