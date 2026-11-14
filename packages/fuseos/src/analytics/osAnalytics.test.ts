import type { Analytics } from "fuse-ui/analytics";

import {
  createOsAnalytics,
  NO_OS_ANALYTICS,
  OS_GAME_ID,
  OsAnalyticsContext,
} from "./osAnalytics";

type Call = { event: string; properties: Record<string, unknown> | undefined };

function recorder() {
  const calls: Call[] = [];
  const registered: Record<string, unknown>[] = [];
  const analytics: Pick<Analytics, "start" | "track"> = {
    start: (properties) => {
      registered.push(properties);
    },
    track: (event, properties) => {
      calls.push({ event, properties });
    },
  };
  return { calls, registered, analytics };
}

describe(createOsAnalytics.name, () => {
  it("reports the desktop opening at once, with its role and whether it is itself embedded", () => {
    const { calls, registered, analytics } = recorder();
    createOsAnalytics(analytics, { embedded: false });
    expect(registered).toEqual([{ role: "desktop" }]);
    expect(calls).toEqual([
      { event: "App Opened", properties: { embedded: false } },
    ]);
    expect(OS_GAME_ID).toBe("fuseos");
  });

  it("reports each game launch as the launched game and how, never under the launched game's id", () => {
    const { calls, analytics } = recorder();
    const os = createOsAnalytics(analytics, { embedded: true });
    os.gameLaunched("fuseball", "window");
    os.gameLaunched("fuse-riders", "tab");
    os.gameLaunched("fuseball", "popout");
    expect(calls.slice(1)).toEqual([
      {
        event: "Game Launched",
        properties: { game: "fuseball", launch: "window" },
      },
      {
        event: "Game Launched",
        properties: { game: "fuse-riders", launch: "tab" },
      },
      {
        event: "Game Launched",
        properties: { game: "fuseball", launch: "popout" },
      },
    ]);
    // `gameId` is the shared boundary's to add; an event here never carries one of its own.
    expect(JSON.stringify(calls).includes("gameId")).toBe(false);
  });

  it("defaults to reporting nothing", () => {
    expect(() =>
      NO_OS_ANALYTICS.gameLaunched("fuseball", "window"),
    ).not.toThrow();
    expect(OsAnalyticsContext).toBeDefined();
  });
});
