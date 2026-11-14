import {
  createBrowserHallOfFameDeps,
  DEFAULT_HALL_OF_FAME_DEPS,
} from "./hallOfFameDepsContext";

type FetchArgs = [string, { method: string; headers: Record<string, string> }];

describe("the browser deps", () => {
  const calls: FetchArgs[] = [];
  beforeEach(() => {
    calls.length = 0;
    // The composition root is the one place that reaches for the page's own fetch; everything else is injected.
    vi.stubGlobal("fetch", (url: string, init: FetchArgs[1]) => {
      calls.push([url, init]);
      return Promise.resolve(
        new Response(JSON.stringify({ players: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("read the leaderboard from the page's own origin with the page's fetch", async () => {
    const deps = createBrowserHallOfFameDeps();
    expect(await deps.leaderboards.fetchLeaderboard("fuseball")).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(
      `${location.origin}/api/games/fuseball/leaderboard`,
    );
    expect(calls[0]?.[1].method).toBe("GET");
  });

  it("are made once, on first use, through the default context value", async () => {
    const first = DEFAULT_HALL_OF_FAME_DEPS.leaderboards;
    expect(DEFAULT_HALL_OF_FAME_DEPS.leaderboards).toBe(first);
    await first.fetchLeaderboard("fuse-riders");
    expect(calls[0]?.[0]).toMatch(/\/api\/games\/fuse-riders\/leaderboard$/);
  });
});
