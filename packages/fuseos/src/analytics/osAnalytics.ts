import type { Analytics } from "fuse-ui/analytics";
import { createBrowserAnalytics } from "fuse-ui/analytics";
import { isEmbeddedPage } from "fuse-ui/embedded";
import { createContext } from "react";

import type { GameLaunch } from "../settings/fuseosPrefsStore";

/** The desktop's own platform id: every event the desktop reports carries `gameId: "fuseos"`. */
export const OS_GAME_ID = "fuseos";

/**
 * How a Fuse game left the desktop: into a window on it, into a browser tab of its own, or out of a window into
 * a tab (the window's Pop out button).
 */
export type GameLaunchKind = GameLaunch | "popout";

/** What the desktop reports (`docs/ANALYTICS.md`, "FuseOS"). Nothing here carries a room code or a name. */
export interface OsAnalytics {
  /** A Fuse game was started from the desktop: an icon, the Start menu, a deep link or the Pop out button. */
  gameLaunched(game: string, launch: GameLaunchKind): void;
}

/** A desktop that reports nothing: tests, and anywhere analytics has not been wired. */
export const NO_OS_ANALYTICS: OsAnalytics = {
  gameLaunched: () => undefined,
};

export type OsAnalyticsPage = {
  /** The desktop itself runs inside another page's frame (it never should; counted so it can be seen). */
  embedded: boolean;
};

/**
 * Reports the desktop's opening at once, then its game launches. `gameId` is the desktop's own (`fuseos`): the
 * shared send boundary attaches it and an event cannot override it, so the game launched travels as `game`.
 */
export function createOsAnalytics(
  analytics: Pick<Analytics, "start" | "track">,
  page: OsAnalyticsPage,
): OsAnalytics {
  analytics.start({ role: "desktop" });
  analytics.track("App Opened", { embedded: page.embedded });
  return {
    gameLaunched: (game, launch) =>
      analytics.track("Game Launched", { game, launch }),
  };
}

/** The page's one instance; the Mixpanel SDK is downloaded lazily and only where analytics is on. */
export function createBrowserOsAnalytics(): OsAnalytics {
  return createOsAnalytics(createBrowserAnalytics(OS_GAME_ID), {
    embedded: isEmbeddedPage(window),
  });
}

export const OsAnalyticsContext = createContext<OsAnalytics>(NO_OS_ANALYTICS);
