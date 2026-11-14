import { defaultDesktopDeps } from "./desktopDepsContext";

describe("defaultDesktopDeps", () => {
  it("tells the time, ticks the clock every ten seconds until unsubscribed, and opens links in a new tab", () => {
    vi.useFakeTimers();
    try {
      const before = Date.now();
      expect(defaultDesktopDeps.now()).toBeGreaterThanOrEqual(before);
      let ticks = 0;
      const unsubscribe = defaultDesktopDeps.subscribeClock(() => {
        ticks += 1;
      });
      vi.advanceTimersByTime(20_000);
      expect(ticks).toBe(2);
      unsubscribe();
      vi.advanceTimersByTime(20_000);
      expect(ticks).toBe(2);
    } finally {
      vi.useRealTimers();
    }

    const opened: unknown[][] = [];
    const open = vi
      .spyOn(window, "open")
      .mockImplementation((...args: unknown[]) => {
        opened.push(args);
        return null;
      });
    try {
      defaultDesktopDeps.openExternal("https://example.test/");
      expect(opened).toEqual([["https://example.test/", "_blank", "noopener"]]);
    } finally {
      open.mockRestore();
    }
    // happy-dom's reload is a no-op; the adapter must still call through without throwing.
    expect(() => defaultDesktopDeps.reload()).not.toThrow();
  });
});
