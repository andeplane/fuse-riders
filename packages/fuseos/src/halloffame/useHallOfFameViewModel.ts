import { useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { FuseGame } from "../fusegames/registry";
import { FuseGamesContext } from "../fusegames/registry";
import { useAppState } from "../state/useAppState";
import { useWindowCommands } from "../windows/useWindowCommands";

import { HallOfFameDepsContext } from "./hallOfFameDepsContext";
import type {
  HallOfFameColumn,
  HallOfFameEntry,
  HallOfFameSort,
} from "./leaderboard";
import { DEFAULT_SORT, sortEntries, toggleSort } from "./leaderboard";
import type { LeaderboardFailure } from "./leaderboardService";
import { LeaderboardError } from "./leaderboardService";

export type HallOfFameStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; entries: HallOfFameEntry[] }
  | { kind: "error"; failure: LeaderboardFailure };

export type HallOfFameViewModel = {
  games: readonly FuseGame[];
  /** The game whose board shows; undefined only when no Fuse game is installed. */
  game: FuseGame | undefined;
  selectGame: (gameId: string) => void;
  status: HallOfFameStatus;
  /** The ready entries in the chosen order; empty while loading or failed. */
  rows: HallOfFameEntry[];
  sort: HallOfFameSort;
  sortBy: (column: HallOfFameColumn) => void;
  retry: () => void;
  /** What the status bar reads. */
  statusText: string;
};

export const SERVER_NOT_RESPONDING = "The server is not responding.";

/** The message box text for each failure; the status bar shows its first line. */
export function failureMessage(failure: LeaderboardFailure): string {
  switch (failure.kind) {
    case "unreachable":
      return `${SERVER_NOT_RESPONDING}\n\nCheck that you are online, then click Retry.`;
    case "status":
      return failure.status === 404
        ? "This game has no Hall of Fame yet."
        : failure.status === 429
          ? "Too many requests. Wait a moment, then click Retry."
          : `${SERVER_NOT_RESPONDING}\n\nIt answered with error ${failure.status}. Click Retry in a moment.`;
    case "invalid":
      return `${SERVER_NOT_RESPONDING}\n\nIts answer was not a leaderboard. Click Retry in a moment.`;
  }
}

/**
 * Picks the game, loads its board through the injected service and keeps the sort. The chosen game is kept
 * in the window's state so it survives a reload; a game that is no longer installed falls back to the first.
 */
export function useHallOfFameViewModel(
  windowId: string,
  initialGameId: string | undefined,
): HallOfFameViewModel {
  const registry = useContext(FuseGamesContext);
  const { leaderboards } = useContext(HallOfFameDepsContext);
  const { dispatch } = useAppState();
  const commands = useWindowCommands();
  const games = registry.games;
  const game = useMemo(
    () =>
      (initialGameId ? registry.find(initialGameId) : undefined) ?? games[0],
    [initialGameId, registry, games],
  );
  const gameId = game?.id;
  const [status, setStatus] = useState<HallOfFameStatus>({ kind: "idle" });
  const [sort, setSort] = useState<HallOfFameSort>(DEFAULT_SORT);
  // Bumped by Retry; the load effect re-runs for the same game.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!gameId) {
      setStatus({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setStatus({ kind: "loading" });
    void leaderboards.fetchLeaderboard(gameId, controller.signal).then(
      (entries) => {
        if (!controller.signal.aborted) setStatus({ kind: "ready", entries });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const failure: LeaderboardFailure =
          error instanceof LeaderboardError
            ? error.failure
            : { kind: "unreachable" };
        setStatus({ kind: "error", failure });
        commands.showError("Hall of Fame", failureMessage(failure));
      },
    );
    return () => controller.abort();
    // `commands` is stable; listing it keeps the lint rule honest without refetching.
  }, [gameId, attempt, leaderboards, commands]);

  const selectGame = useCallback(
    (next: string) => {
      if (!registry.has(next) || next === gameId) return;
      dispatch({
        type: "patch",
        id: windowId,
        patch: (window) =>
          window.kind === "halloffame" ? { ...window, gameId: next } : window,
      });
    },
    [registry, gameId, dispatch, windowId],
  );

  const sortBy = useCallback(
    (column: HallOfFameColumn) =>
      setSort((current) => toggleSort(current, column)),
    [],
  );
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const rows = useMemo(
    () => (status.kind === "ready" ? sortEntries(status.entries, sort) : []),
    [status, sort],
  );

  const statusText =
    status.kind === "loading"
      ? "Loading..."
      : status.kind === "error"
        ? (failureMessage(status.failure).split("\n")[0] ?? "")
        : status.kind === "ready"
          ? status.entries.length === 0
            ? "No rated players yet"
            : `${status.entries.length} player${status.entries.length === 1 ? "" : "s"}`
          : "No Fuse games installed";

  return {
    games,
    game,
    selectGame,
    status,
    rows,
    sort,
    sortBy,
    retry,
    statusText,
  };
}
