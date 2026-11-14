import type { HallOfFameEntry } from "./leaderboard";
import { parseLeaderboard } from "./leaderboard";

/** Why a leaderboard could not be shown; the window words each differently. */
export type LeaderboardFailure =
  /** No response at all: offline, the service down, a CORS refusal, or an abort that was not ours. */
  | { kind: "unreachable" }
  /** The server answered, but not with a leaderboard (a 404 for a game it does not know, a 429, a 5xx). */
  | { kind: "status"; status: number }
  /** A 200 whose body is not a leaderboard. */
  | { kind: "invalid" };

export class LeaderboardError extends Error {
  readonly failure: LeaderboardFailure;
  constructor(failure: LeaderboardFailure) {
    super(
      failure.kind === "status"
        ? `Leaderboard request failed with status ${failure.status}`
        : failure.kind === "invalid"
          ? "Leaderboard response was not a leaderboard"
          : "Leaderboard service unreachable",
    );
    this.name = "LeaderboardError";
    this.failure = failure;
  }
}

/** Where the Hall of Fame reads from. Production talks to the room service; tests hand in a memory one. */
export interface LeaderboardService {
  /** The ranked players of one Fuse game, best first. Rejects with a `LeaderboardError`, or an `AbortError` when `signal` fires. */
  fetchLeaderboard(
    gameId: string,
    signal?: AbortSignal,
  ): Promise<HallOfFameEntry[]>;
}

/** The subset of `fetch` the HTTP service needs; `globalThis.fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init: {
    method: "GET";
    signal?: AbortSignal;
    headers: Record<string, string>;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type HttpLeaderboardServiceOptions = {
  fetch: FetchLike;
  /** Where `/api/...` lives: `VITE_API_ORIGIN` when the site and the service are apart (GitHub Pages and Cloud Run), else the page's own origin. */
  apiOrigin?: string | undefined;
  /** The page origin, `location.origin`; the API's default. */
  pageOrigin: string;
};

const GAME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `/api/games/<id>/leaderboard` on the API origin; the same route every game's own account page calls. */
export function leaderboardUrl(
  gameId: string,
  options: Pick<HttpLeaderboardServiceOptions, "apiOrigin" | "pageOrigin">,
): string {
  if (!GAME_ID.test(gameId)) throw new Error("Invalid game id");
  const api = new URL(options.apiOrigin || options.pageOrigin);
  if (!["http:", "https:"].includes(api.protocol) || api.pathname !== "/")
    throw new Error("Invalid API origin");
  return new URL(`/api/games/${gameId}/leaderboard`, api).href;
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

export function createHttpLeaderboardService(
  options: HttpLeaderboardServiceOptions,
): LeaderboardService {
  return {
    async fetchLeaderboard(gameId, signal) {
      const url = leaderboardUrl(gameId, options);
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await options.fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        if (isAbort(error)) throw error;
        throw new LeaderboardError({ kind: "unreachable" });
      }
      if (!response.ok)
        throw new LeaderboardError({
          kind: "status",
          status: response.status,
        });
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (isAbort(error)) throw error;
        throw new LeaderboardError({ kind: "invalid" });
      }
      const entries = parseLeaderboard(body);
      if (!entries) throw new LeaderboardError({ kind: "invalid" });
      return entries;
    },
  };
}

/** A leaderboard per game, in memory; a test sets boards and failures and may hold a request open. */
export class MemoryLeaderboardService implements LeaderboardService {
  private readonly boards = new Map<string, HallOfFameEntry[]>();
  private failure: LeaderboardFailure | undefined;
  /** Every request made, in order, for assertions. */
  readonly requests: string[] = [];
  /** When set, requests resolve only when `release` is called (or reject when the signal aborts). */
  private gate: { promise: Promise<void>; release: () => void } | undefined;

  constructor(boards: Record<string, HallOfFameEntry[]> = {}) {
    for (const [gameId, entries] of Object.entries(boards))
      this.boards.set(gameId, entries);
  }

  setBoard(gameId: string, entries: HallOfFameEntry[]): void {
    this.boards.set(gameId, entries);
  }

  /** Every request fails this way until cleared with `undefined`. */
  failWith(failure: LeaderboardFailure | undefined): void {
    this.failure = failure;
  }

  /** Holds the next requests open until `release()`; returns the release. */
  hold(): () => void {
    let release: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.gate = { promise, release };
    return () => {
      this.gate = undefined;
      release();
    };
  }

  async fetchLeaderboard(
    gameId: string,
    signal?: AbortSignal,
  ): Promise<HallOfFameEntry[]> {
    this.requests.push(gameId);
    if (this.gate) await raceAbort(this.gate.promise, signal);
    if (signal?.aborted) throw abortError();
    if (this.failure) throw new LeaderboardError(this.failure);
    const board = this.boards.get(gameId);
    if (!board) throw new LeaderboardError({ kind: "status", status: 404 });
    return board.map((entry) => ({ ...entry }));
  }
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function raceAbort(
  promise: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}
