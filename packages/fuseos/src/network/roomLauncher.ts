import { createContext, useContext, useMemo } from "react";

import { DesktopDepsContext } from "../desktop/desktopDepsContext";
import type { FuseGameRegistry } from "../fusegames/registry";
import { FuseGamesContext } from "../fusegames/registry";
import type { GameLaunch } from "../settings/fuseosPrefsStore";
import {
  effectiveGameLaunch,
  FuseOsPrefsStoreContext,
} from "../settings/fuseosPrefsStore";
import type { WindowCommands } from "../windows/useWindowCommands";
import { useWindowCommands } from "../windows/useWindowCommands";
import { WindowsDepsContext } from "../windows/windowsDepsContext";

import { NetworkDepsContext } from "./networkDeps";
import type { RecentRoomsStore, RecentRoomTarget } from "./recentRooms";
import { RecentRoomsStoreContext } from "./recentRooms";
import { roomUrl } from "./roomCode";

export type JoinResult =
  { ok: true; launch: GameLaunch } | { ok: false; reason: "unknown-game" };

/**
 * Opens a game straight into a room. The OS's launch preference decides between a window on this
 * desktop and a browser tab; a package that ships its own launcher (B2's) provides one through
 * `RoomLauncherContext` and the window never knows the difference.
 */
export interface RoomLauncher {
  join(target: RecentRoomTarget): JoinResult;
}

export type RoomLauncherOptions = {
  games: Pick<FuseGameRegistry, "find" | "embedUrl">;
  launch: () => GameLaunch;
  commands: Pick<WindowCommands, "open">;
  openExternal: (url: string) => void;
  recentRooms: Pick<RecentRoomsStore, "record">;
  now: () => number;
};

export function createRoomLauncher(options: RoomLauncherOptions): RoomLauncher {
  return {
    join: ({ gameId, code }) => {
      const game = options.games.find(gameId);
      if (!game) return { ok: false, reason: "unknown-game" };
      const launch = options.launch();
      options.recentRooms.record({ gameId, code }, options.now());
      if (launch === "tab")
        options.openExternal(roomUrl(options.games.embedUrl(game), code));
      else options.commands.open({ kind: "roomgame", gameId, code });
      return { ok: true, launch };
    },
  };
}

/** A launcher another package injects; absent means the built-in one over the OS's own preference. */
export const RoomLauncherContext = createContext<RoomLauncher | null>(null);

/** The launcher in force. */
export function useRoomLauncher(): RoomLauncher {
  const injected = useContext(RoomLauncherContext);
  const games = useContext(FuseGamesContext);
  const prefs = useContext(FuseOsPrefsStoreContext);
  const { getViewport } = useContext(WindowsDepsContext);
  const { openExternal } = useContext(DesktopDepsContext);
  const { finePointer, now } = useContext(NetworkDepsContext);
  const recentRooms = useContext(RecentRoomsStoreContext);
  const commands = useWindowCommands();
  return useMemo(
    () =>
      injected ??
      createRoomLauncher({
        games,
        launch: () =>
          effectiveGameLaunch(prefs.get(), {
            finePointer: finePointer(),
            viewportWidth: getViewport().width,
          }),
        commands,
        openExternal,
        recentRooms,
        now,
      }),
    [
      injected,
      games,
      prefs,
      finePointer,
      getViewport,
      commands,
      openExternal,
      recentRooms,
      now,
    ],
  );
}
