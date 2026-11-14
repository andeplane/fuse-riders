import { createContext } from "react";

import type { LeaderboardService } from "./leaderboardService";
import { createHttpLeaderboardService } from "./leaderboardService";

/** What the Hall of Fame needs from outside: where leaderboards come from. */
export interface HallOfFameDeps {
  leaderboards: LeaderboardService;
}

/**
 * Production: the room service's `/api/games/<id>/leaderboard`, on `VITE_API_ORIGIN` when the site is
 * deployed apart from it (GitHub Pages and Cloud Run) and on the page's own origin otherwise (`pnpm dev`,
 * which serves the built site from the service itself).
 */
export function createBrowserHallOfFameDeps(): HallOfFameDeps {
  return {
    leaderboards: createHttpLeaderboardService({
      fetch: (url, init) => fetch(url, init),
      apiOrigin: import.meta.env.VITE_API_ORIGIN,
      pageOrigin: location.origin,
    }),
  };
}

let browserDeps: HallOfFameDeps | undefined;

/** The browser deps, made on first use so importing this module never touches `location`. */
export const DEFAULT_HALL_OF_FAME_DEPS: HallOfFameDeps = {
  get leaderboards(): LeaderboardService {
    browserDeps ??= createBrowserHallOfFameDeps();
    return browserDeps.leaderboards;
  },
};

export const HallOfFameDepsContext = createContext<HallOfFameDeps>(
  DEFAULT_HALL_OF_FAME_DEPS,
);
