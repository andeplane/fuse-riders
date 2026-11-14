import { useCallback, useContext, useMemo, useState } from "react";

import { DesktopDepsContext } from "../desktop/desktopDepsContext";
import {
  FRIENDS_WINDOW_ID,
  StartMenuRegistryContext,
} from "../desktop/startMenuRegistry";
import { FuseGamesContext } from "../fusegames/registry";
import { useFuseGameLauncher } from "../fusegames/useFuseGameLauncher";
import { openNetworkNeighborhood } from "../network/openNetworkNeighborhood";
import { useDialUpCommands } from "../sounds/dialup/useDialUpCommands";
import type { ImageIcon } from "../ui/icons";
import { useWindowCommands } from "../windows/useWindowCommands";
import { WindowManagerContext } from "../windows/windowManagerContext";

import { LauncherDepsContext } from "./launcherDepsContext";
import {
  fakeDiskUsage,
  formatLastPlayed,
  LAUNCHER_TITLE,
} from "./launcherFacts";

export type LauncherTab = "games" | "friends" | "servers" | "news";

export const LAUNCHER_TABS: readonly { id: LauncherTab; label: string }[] = [
  { id: "games", label: "My Games" },
  { id: "friends", label: "Friends" },
  { id: "servers", label: "Servers" },
  { id: "news", label: "News" },
];

/** One row of MY GAMES and, when selected, the detail pane. */
export type LauncherGame = {
  id: string;
  name: string;
  tagline: string;
  mark: string;
  accent: string;
  /** The game's bitmap icon when it ships one; the row draws an accent tile otherwise. */
  icon: ImageIcon | undefined;
  screenshotUrl: string | undefined;
  /** The game's own page, for the LINKS column. */
  url: string;
};

export type LauncherDetails = {
  status: string;
  diskUsage: string;
  lastPlayed: string;
};

/** The pages Fusteam draws itself; the other tabs open programs of their own. */
export type LauncherPage = "games" | "news";

/** Start menu ids the Hall of Fame may register under; News opens it when one is installed. */
export const HALL_OF_FAME_REGISTRATION_IDS: readonly string[] = [
  "halloffame",
  "hall-of-fame",
];

export type LauncherViewModel = {
  /** The page under the tabs: My Games, or News while no Hall of Fame is installed. */
  tab: LauncherPage;
  /**
   * A tab across the top. Friends opens Fuse Messenger and Servers Network Neighborhood, each as a window of its
   * own (dialling in first where the session has not connected); News opens the Hall of Fame when this build
   * registers one, and Fusteam's own news page otherwise.
   */
  openTab: (tab: LauncherTab) => void;
  /** FRIENDS & CHAT and the Friends link: Fuse Messenger. */
  openFriends: () => void;
  games: LauncherGame[];
  selected: LauncherGame | undefined;
  details: LauncherDetails | undefined;
  select: (gameId: string) => void;
  /** Up and down the list, stopping at the ends like the old client. */
  selectNext: () => void;
  selectPrevious: () => void;
  /** PLAY, Enter or a double click: the selected game, through `useFuseGameLauncher` (a window here or a browser tab). */
  play: () => void;
  playGame: (gameId: string) => void;
  /** ADD A GAME...: the joke message box. */
  addGame: () => void;
};

export const ADD_GAME_MESSAGE =
  "Fusteam cannot add games from this desktop yet.\n\nEvery Fuse game lives in the fuse-games repository: fork it, run scripts/new-game.ts and open a pull request. Your game appears here when it merges.";

export function useLauncherViewModel(): LauncherViewModel {
  const registry = useContext(FuseGamesContext);
  const desktopDeps = useContext(DesktopDepsContext);
  const launcherDeps = useContext(LauncherDepsContext);
  const commands = useWindowCommands();
  // Fuse Messenger and Network Neighborhood dial in the first time one is opened by hand.
  const online = useDialUpCommands();
  const registrations = useContext(StartMenuRegistryContext);
  const { viewport } = useContext(WindowManagerContext);
  const { launch } = useFuseGameLauncher();

  const games = useMemo<LauncherGame[]>(
    () =>
      registry.games.map((game) => ({
        id: game.id,
        name: game.name,
        tagline: game.tagline,
        mark: game.mark,
        accent: game.accent,
        icon: registry.icon(game),
        screenshotUrl: registry.screenshotUrl(game),
        url: registry.embedUrl(game),
      })),
    [registry],
  );

  const [tab, setTab] = useState<LauncherPage>("games");
  const [selectedId, setSelectedId] = useState<string | undefined>(
    games[0]?.id,
  );
  const [lastPlayed, setLastPlayed] = useState(() =>
    launcherDeps.lastPlayed.get(),
  );

  const index = games.findIndex((game) => game.id === selectedId);
  const selected = games[index];

  const select = useCallback(
    (gameId: string) => {
      if (games.some((game) => game.id === gameId)) setSelectedId(gameId);
    },
    [games],
  );
  const selectNext = useCallback(() => {
    const next = games[Math.min(games.length - 1, index + 1)];
    if (next) setSelectedId(next.id);
  }, [games, index]);
  const selectPrevious = useCallback(() => {
    const previous = games[Math.max(0, index - 1)];
    if (previous) setSelectedId(previous.id);
  }, [games, index]);

  const playGame = useCallback(
    (gameId: string) => {
      const game = games.find((candidate) => candidate.id === gameId);
      if (!game) return;
      // The Games applet's choice (or the device's default): a window on this desktop, focused when already
      // open, or a browser tab; the launch is reported there.
      launch(game.id);
      launcherDeps.lastPlayed.record(game.id, desktopDeps.now());
      setLastPlayed(launcherDeps.lastPlayed.get());
    },
    [games, launch, launcherDeps, desktopDeps],
  );
  const play = useCallback(() => {
    if (selected) playGame(selected.id);
  }, [selected, playGame]);

  const openFriends = useCallback(
    () => online.open({ kind: "friends" }, { id: FRIENDS_WINDOW_ID }),
    [online],
  );
  // Capability-detected: the Hall of Fame is its own package and may not be in this build.
  const openHallOfFame = registrations.find(
    (entry) => HALL_OF_FAME_REGISTRATION_IDS.includes(entry.id) && entry.open,
  )?.open;
  const openTab = useCallback(
    (next: LauncherTab) => {
      switch (next) {
        case "games":
          setTab("games");
          return;
        case "friends":
          openFriends();
          return;
        case "servers":
          openNetworkNeighborhood(online);
          return;
        case "news":
          if (openHallOfFame) openHallOfFame(commands, viewport);
          else setTab("news");
          return;
      }
    },
    [openFriends, online, openHallOfFame, commands, viewport],
  );

  const addGame = useCallback(
    () => commands.showInfo(LAUNCHER_TITLE, ADD_GAME_MESSAGE),
    [commands],
  );

  const details = selected
    ? {
        status: "Ready to play",
        diskUsage: fakeDiskUsage(selected.id),
        lastPlayed: formatLastPlayed(
          lastPlayed[selected.id],
          desktopDeps.now(),
        ),
      }
    : undefined;

  return {
    tab,
    openTab,
    openFriends,
    games,
    selected,
    details,
    select,
    selectNext,
    selectPrevious,
    play,
    playGame,
    addGame,
  };
}
