import { useCallback, useContext } from "react";

import { OsAnalyticsContext } from "../analytics/osAnalytics";
import { DesktopDepsContext } from "../desktop/desktopDepsContext";
import type { GameLaunch } from "../settings/fuseosPrefsStore";
import {
  effectiveGameLaunch,
  FuseOsPrefsStoreContext,
} from "../settings/fuseosPrefsStore";
import { LaunchDeviceContext } from "../settings/launchDevice";
import { useAppState } from "../state/useAppState";
import { useWindowCommands } from "../windows/useWindowCommands";

import { FuseGamesContext } from "./registry";

export type FuseGameLauncher = {
  /** The mode in force right now (the stored choice, else the device default), re-read at every call. */
  launchMode: () => GameLaunch;
  /**
   * Starts a game the way the Games applet says: a window on this desktop (focused rather than duplicated when
   * already open) or a browser tab of its own. Reports the launch; an unknown id opens a window that explains itself.
   */
  launch: (gameId: string) => void;
};

/** How a Fuse game starts from an icon, the Start menu or the assistant. */
export function useFuseGameLauncher(): FuseGameLauncher {
  const { state } = useAppState();
  const commands = useWindowCommands();
  const games = useContext(FuseGamesContext);
  const prefs = useContext(FuseOsPrefsStoreContext);
  const readDevice = useContext(LaunchDeviceContext);
  const { openExternal } = useContext(DesktopDepsContext);
  const analytics = useContext(OsAnalyticsContext);

  const launchMode = useCallback(
    () => effectiveGameLaunch(prefs.get(), readDevice()),
    [prefs, readDevice],
  );

  const launch = useCallback(
    (gameId: string) => {
      const game = games.find(gameId);
      if (game && launchMode() === "tab") {
        openExternal(games.embedUrl(game));
        analytics.gameLaunched(gameId, "tab");
        return;
      }
      const existing = state.windows.find(
        (window) => window.kind === "fusegame" && window.gameId === gameId,
      );
      if (existing) {
        commands.focus(existing.id);
        return;
      }
      commands.open({ kind: "fusegame", gameId });
      if (game) analytics.gameLaunched(gameId, "window");
    },
    [games, launchMode, openExternal, analytics, state.windows, commands],
  );

  return { launchMode, launch };
}
