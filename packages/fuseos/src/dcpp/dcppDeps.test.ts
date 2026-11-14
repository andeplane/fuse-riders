import { clientDeps, defaultDcppDeps } from "./dcppDeps";
import { HUBS } from "./hubs";

describe("defaultDcppDeps", () => {
  it("uses the real clock and timers, the hub list and a per-window seed", () => {
    vi.useFakeTimers();
    try {
      const fired = vi.fn();
      defaultDcppDeps.setTimeout(fired, 50);
      const cancelled = vi.fn();
      const handle = defaultDcppDeps.setTimeout(cancelled, 50);
      defaultDcppDeps.clearTimeout(handle);
      vi.advanceTimersByTime(60);
      expect(fired).toHaveBeenCalledOnce();
      expect(cancelled).not.toHaveBeenCalled();
      expect(defaultDcppDeps.now()).toBe(Date.now());
      expect(defaultDcppDeps.seed()).toBe(Date.now());
      expect(defaultDcppDeps.hubs).toBe(HUBS);
      const deps = clientDeps(defaultDcppDeps);
      expect(deps.random()).toBeLessThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
