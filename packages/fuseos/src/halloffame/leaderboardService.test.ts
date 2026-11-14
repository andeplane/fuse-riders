import type { FetchLike } from "./leaderboardService";
import {
  createHttpLeaderboardService,
  LeaderboardError,
  leaderboardUrl,
  MemoryLeaderboardService,
} from "./leaderboardService";

type FetchCall = Parameters<FetchLike>;

/** A fetch that answers every call the same way and records what it was asked. */
function fakeFetch(
  answer: (url: string, init: FetchCall[1]) => ReturnType<FetchLike>,
): { fetch: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push([url, init]);
      return answer(url, init);
    },
  };
}

const ok = (body: unknown): ReturnType<FetchLike> =>
  Promise.resolve({ ok: true, status: 200, json: async () => body });

const PLAYERS = [
  { rank: 1, name: "Ace", elo: 1042, games: 7, rounds: 7 },
  { rank: 2, name: "Bea", elo: 1000, games: 1, rounds: 1 },
];

describe(leaderboardUrl.name, () => {
  it("addresses the game's leaderboard on the API origin, falling back to the page's", () => {
    expect(
      leaderboardUrl("fuseball", {
        apiOrigin: "https://api.example.test",
        pageOrigin: "https://games.example.test",
      }),
    ).toBe("https://api.example.test/api/games/fuseball/leaderboard");
    expect(
      leaderboardUrl("fuse-riders", {
        apiOrigin: undefined,
        pageOrigin: "http://localhost:8787",
      }),
    ).toBe("http://localhost:8787/api/games/fuse-riders/leaderboard");
    expect(
      leaderboardUrl("fuse-riders", {
        apiOrigin: "",
        pageOrigin: "http://localhost:8787",
      }),
    ).toBe("http://localhost:8787/api/games/fuse-riders/leaderboard");
  });

  it("refuses a game id that could escape the route and an origin that is not one", () => {
    const options = { apiOrigin: undefined, pageOrigin: "http://localhost" };
    expect(() => leaderboardUrl("../me", options)).toThrow("Invalid game id");
    expect(() => leaderboardUrl("Fuseball", options)).toThrow(
      "Invalid game id",
    );
    expect(() => leaderboardUrl("", options)).toThrow("Invalid game id");
    expect(() =>
      leaderboardUrl("fuseball", {
        apiOrigin: "ftp://x",
        pageOrigin: "http://localhost",
      }),
    ).toThrow("Invalid API origin");
    expect(() =>
      leaderboardUrl("fuseball", {
        apiOrigin: "https://x/api",
        pageOrigin: "http://localhost",
      }),
    ).toThrow("Invalid API origin");
  });
});

describe(createHttpLeaderboardService.name, () => {
  const origins = { apiOrigin: undefined, pageOrigin: "http://localhost:8787" };

  it("GETs the leaderboard as JSON, passes the signal through and validates the body", async () => {
    const { fetch, calls } = fakeFetch(() => ok({ players: PLAYERS }));
    const service = createHttpLeaderboardService({ fetch, ...origins });
    const controller = new AbortController();
    const entries = await service.fetchLeaderboard(
      "fuseball",
      controller.signal,
    );
    expect(entries).toEqual(PLAYERS);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(
      "http://localhost:8787/api/games/fuseball/leaderboard",
    );
    expect(calls[0]?.[1]).toEqual({
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const bare = await createHttpLeaderboardService({
      fetch,
      ...origins,
    }).fetchLeaderboard("fuseball");
    expect(bare).toHaveLength(2);
    expect(calls[1]?.[1]).not.toHaveProperty("signal");
  });

  it("reports an unreachable server, a refusing status and a body that is not a leaderboard, each distinctly", async () => {
    const failure = async (fetch: FetchLike) => {
      try {
        await createHttpLeaderboardService({
          fetch,
          ...origins,
        }).fetchLeaderboard("fuseball");
      } catch (error) {
        if (error instanceof LeaderboardError) return error.failure;
        throw error;
      }
      throw new Error("resolved");
    };
    expect(
      await failure(() => Promise.reject(new TypeError("Failed to fetch"))),
    ).toEqual({
      kind: "unreachable",
    });
    expect(
      await failure(() =>
        Promise.resolve({ ok: false, status: 503, json: async () => ({}) }),
      ),
    ).toEqual({ kind: "status", status: 503 });
    expect(await failure(() => ok({ players: [{ rank: "1" }] }))).toEqual({
      kind: "invalid",
    });
    expect(
      await failure(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError("Unexpected token <")),
        }),
      ),
    ).toEqual({ kind: "invalid" });
  });

  it("lets an abort through untouched, from the request and from the body", async () => {
    const abort = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      return error;
    };
    await expect(
      createHttpLeaderboardService({
        fetch: () => Promise.reject(abort()),
        ...origins,
      }).fetchLeaderboard("fuseball"),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      createHttpLeaderboardService({
        fetch: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.reject(abort()),
          }),
        ...origins,
      }).fetchLeaderboard("fuseball"),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("describes each failure in its message", () => {
    expect(new LeaderboardError({ kind: "unreachable" }).message).toMatch(
      /unreachable/,
    );
    expect(
      new LeaderboardError({ kind: "status", status: 429 }).message,
    ).toMatch(/429/);
    expect(new LeaderboardError({ kind: "invalid" }).message).toMatch(
      /not a leaderboard/,
    );
    expect(new LeaderboardError({ kind: "invalid" }).name).toBe(
      "LeaderboardError",
    );
  });
});

describe(MemoryLeaderboardService.name, () => {
  it("serves copies of each game's board, 404s an unknown game and records requests", async () => {
    const service = new MemoryLeaderboardService({ fuseball: PLAYERS });
    const first = await service.fetchLeaderboard("fuseball");
    expect(first).toEqual(PLAYERS);
    first[0]!.name = "changed";
    expect((await service.fetchLeaderboard("fuseball"))[0]?.name).toBe("Ace");
    await expect(service.fetchLeaderboard("dice")).rejects.toMatchObject({
      failure: { kind: "status", status: 404 },
    });
    service.setBoard("dice", []);
    expect(await service.fetchLeaderboard("dice")).toEqual([]);
    expect(service.requests).toEqual(["fuseball", "fuseball", "dice", "dice"]);
  });

  it("fails every request the way it is told until cleared", async () => {
    const service = new MemoryLeaderboardService({ fuseball: PLAYERS });
    service.failWith({ kind: "unreachable" });
    await expect(service.fetchLeaderboard("fuseball")).rejects.toMatchObject({
      failure: { kind: "unreachable" },
    });
    service.failWith(undefined);
    expect(await service.fetchLeaderboard("fuseball")).toHaveLength(2);
  });

  it("holds requests open until released and honours an abort meanwhile", async () => {
    const service = new MemoryLeaderboardService({ fuseball: PLAYERS });
    const release = service.hold();
    let settled = false;
    const pending = service.fetchLeaderboard("fuseball").then((entries) => {
      settled = true;
      return entries;
    });
    const controller = new AbortController();
    const aborted = service.fetchLeaderboard("fuseball", controller.signal);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect(await pending).toHaveLength(2);
    // Released: the next request answers at once; an already aborted signal is refused at once too.
    expect(await service.fetchLeaderboard("fuseball")).toHaveLength(2);
    const done = new AbortController();
    done.abort();
    await expect(
      service.fetchLeaderboard("fuseball", done.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    const gated = service.hold();
    const early = new AbortController();
    early.abort();
    await expect(
      service.fetchLeaderboard("fuseball", early.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    gated();
  });
});
