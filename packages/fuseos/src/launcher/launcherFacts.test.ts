import {
  centeredLauncherRect,
  fakeDiskUsage,
  formatLastPlayed,
  LAUNCHER_WINDOW_SIZE,
  shouldMaximizeLauncher,
} from "./launcherFacts";

describe(shouldMaximizeLauncher.name, () => {
  it("maximizes on a display the window would not fit, not on a laptop", () => {
    expect(shouldMaximizeLauncher({ width: 1280, height: 800 })).toBe(false);
    expect(shouldMaximizeLauncher({ width: 960, height: 700 })).toBe(false);
    expect(shouldMaximizeLauncher({ width: 390, height: 844 })).toBe(true);
    expect(shouldMaximizeLauncher({ width: 1024, height: 600 })).toBe(true);
  });
});

describe(centeredLauncherRect.name, () => {
  it("centres the window in the area above the taskbar", () => {
    expect(centeredLauncherRect({ width: 1280, height: 800 })).toEqual({
      x: 190,
      y: 86,
      ...LAUNCHER_WINDOW_SIZE,
    });
  });

  it("keeps the window inside a small display", () => {
    const rect = centeredLauncherRect({ width: 800, height: 500 });
    expect(rect).toEqual({ x: 0, y: 0, width: 800, height: 472 });
  });
});

describe(formatLastPlayed.name, () => {
  const now = Date.UTC(2004, 10, 16, 14, 2);

  it("says Never without a record", () => {
    expect(formatLastPlayed(undefined, now)).toBe("Never");
  });

  it("gives the time today, then Yesterday, days ago and finally the date", () => {
    expect(formatLastPlayed(Date.UTC(2004, 10, 16, 9, 5), now)).toBe(
      "Today, 09:05",
    );
    expect(formatLastPlayed(now, now)).toBe("Today, 14:02");
    expect(formatLastPlayed(Date.UTC(2004, 10, 15, 23, 59), now)).toBe(
      "Yesterday",
    );
    expect(formatLastPlayed(Date.UTC(2004, 10, 13, 1, 0), now)).toBe(
      "3 days ago",
    );
    expect(formatLastPlayed(Date.UTC(2004, 10, 9, 1, 0), now)).toBe(
      "9 Nov 2004",
    );
    expect(formatLastPlayed(Date.UTC(1998, 5, 25), now)).toBe("25 Jun 1998");
  });
});

describe(fakeDiskUsage.name, () => {
  it("is stable per game and within the plausible range", () => {
    expect(fakeDiskUsage("fuseball")).toBe(fakeDiskUsage("fuseball"));
    expect(fakeDiskUsage("fuseball")).not.toBe(fakeDiskUsage("fuse-riders"));
    for (const id of ["fuseball", "fuse-riders", "fuse-birds", ""]) {
      const megabytes = Number(/^(\d+) MB$/.exec(fakeDiskUsage(id))?.[1]);
      expect(megabytes).toBeGreaterThanOrEqual(180);
      expect(megabytes).toBeLessThanOrEqual(980);
    }
  });
});
