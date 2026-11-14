import { defaultGamesDeps } from "./gamesDepsContext";

describe("defaultGamesDeps", () => {
  it("resolves bundles under the site base, tells the time and draws random numbers in [0, 1)", () => {
    expect(defaultGamesDeps.resolveUrl("fuseos/retro/doom/index.html")).toMatch(
      /fuseos\/retro\/doom\/index\.html$/,
    );
    expect(defaultGamesDeps.now()).toBeLessThanOrEqual(Date.now());
    for (let i = 0; i < 20; i += 1) {
      const value = defaultGamesDeps.random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("ticks subscribers four times a second and once per animation frame until unsubscribed", () => {
    vi.useFakeTimers();
    try {
      let ticks = 0;
      const stopTicks = defaultGamesDeps.subscribeSeconds(() => {
        ticks += 1;
      });
      vi.advanceTimersByTime(1000);
      expect(ticks).toBe(4);
      stopTicks();
      vi.advanceTimersByTime(1000);
      expect(ticks).toBe(4);

      let frames = 0;
      const stopFrames = defaultGamesDeps.subscribeFrames(() => {
        frames += 1;
      });
      vi.advanceTimersToNextFrame();
      vi.advanceTimersToNextFrame();
      expect(frames).toBe(2);
      stopFrames();
      vi.advanceTimersToNextFrame();
      expect(frames).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
