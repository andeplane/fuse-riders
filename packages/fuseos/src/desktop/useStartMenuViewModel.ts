import { useContext } from "react";

import { MY_COMPUTER } from "../disk/diskPath";
import { FuseGamesContext } from "../fusegames/registry";
import { GAME_LIST } from "../retro/games";
import { useAppState } from "../state/useAppState";
import type { IconName } from "../ui/icons";
import { useWindowCommands } from "../windows/useWindowCommands";

import { DesktopDepsContext } from "./desktopDepsContext";
import { DesktopUiContext } from "./desktopUiContext";
import { useDesktopViewModel } from "./useDesktopViewModel";
import { OS_NAME } from "./windowMeta";

export type StartMenuItem = {
  id: string;
  label: string;
  icon: IconName;
  onSelect?: () => void;
  children?: StartMenuItem[];
  disabled?: boolean;
  separatorAfter?: boolean;
};

/** Start > Help > Help Topics: the project's README. */
export const HELP_URL = "https://github.com/andeplane/fuse-riders#readme";

export function useStartMenuViewModel(): {
  items: StartMenuItem[];
  close: () => void;
} {
  const { state, dispatch } = useAppState();
  const commands = useWindowCommands();
  const ui = useContext(DesktopUiContext);
  const deps = useContext(DesktopDepsContext);
  const games = useContext(FuseGamesContext);
  const desktop = useDesktopViewModel();

  const close = () => ui.setStartMenuOpen(false);
  const wrap = (action: () => void) => () => {
    close();
    action();
  };

  const fuseGameItems: StartMenuItem[] = games.games.map((game) => ({
    id: `fusegame:${game.id}`,
    label: game.name,
    icon: "fusegame",
    onSelect: wrap(() => desktop.openFuseGame(game.id)),
  }));

  const retroGameItems: StartMenuItem[] = GAME_LIST.map((game) => ({
    id: `retro:${game.id}`,
    label: game.name,
    icon: game.icon,
    onSelect: wrap(() => commands.open({ kind: "retro", game: game.id })),
  }));

  const items: StartMenuItem[] = [
    {
      id: "programs",
      label: "Programs",
      icon: "programs",
      children: [
        {
          id: "accessories",
          label: "Accessories",
          icon: "programs",
          children: [
            {
              id: "paint",
              label: "Paint",
              icon: "paint",
              onSelect: wrap(desktop.openPaint),
            },
            {
              id: "winamp",
              label: "Winamp",
              icon: "winamp",
              onSelect: wrap(desktop.openWinamp),
            },
            {
              id: "wallpaper",
              label: "Change desktop background",
              icon: "wallpaper",
              onSelect: wrap(desktop.openWallpaper),
            },
            {
              id: "explorer",
              label: "Windows Explorer",
              icon: "explorer",
              onSelect: wrap(() =>
                commands.open({ kind: "explorer", location: MY_COMPUTER }),
              ),
            },
            {
              id: "notepadpp",
              label: "Notepad++",
              icon: "notepadpp",
              onSelect: wrap(() =>
                commands.open({ kind: "notepadpp", paths: ["README.md"] }),
              ),
            },
          ],
        },
        {
          id: "games",
          label: "Games",
          icon: "games",
          children: [
            ...(fuseGameItems.length > 0
              ? fuseGameItems
              : [
                  {
                    id: "no-fuse-games",
                    label: "(No Fuse games installed)",
                    icon: "fusegame" as const,
                    disabled: true,
                  },
                ]),
            {
              id: "retro",
              label: "Retro Games",
              icon: "gamesFolder",
              children: retroGameItems,
            },
          ],
        },
      ],
    },
    {
      id: "settings",
      label: "Settings",
      icon: "settings",
      children: [
        {
          id: "control-panel",
          label: "Control Panel",
          icon: "settings",
          onSelect: wrap(desktop.openControlPanel),
        },
        {
          id: "display",
          label: "Display",
          icon: "display",
          onSelect: wrap(() =>
            commands.open({ kind: "controlpanel", applet: "display" }),
          ),
        },
        {
          id: "system",
          label: "System",
          icon: "system",
          onSelect: wrap(() =>
            commands.open({ kind: "controlpanel", applet: "system" }),
          ),
        },
        {
          id: "keyboard",
          label: "Keyboard",
          icon: "keyboard",
          onSelect: wrap(() =>
            commands.open({ kind: "controlpanel", applet: "keyboard" }),
          ),
        },
      ],
    },
    {
      id: "help",
      label: "Help",
      icon: "help",
      children: [
        {
          id: "help-topics",
          label: "Help Topics",
          icon: "help",
          onSelect: wrap(() => deps.openExternal(HELP_URL)),
        },
        {
          id: "office-assistant",
          label: "Office Assistant",
          icon: "assistant",
          onSelect: wrap(() => {
            const hidden = state.assistantHidden === true;
            dispatch({ type: "setAssistantHidden", hidden: !hidden });
            if (hidden) ui.assistantDispatch({ type: "show" });
          }),
        },
        {
          id: "about",
          label: `About ${OS_NAME}`,
          icon: "info",
          onSelect: wrap(() => commands.open({ kind: "about" })),
          separatorAfter: false,
        },
      ],
      separatorAfter: true,
    },
    {
      id: "shutdown",
      label: "Shut Down...",
      icon: "shutdown",
      children: [
        {
          id: "shut-down",
          label: "Shut down",
          icon: "shutdown",
          onSelect: wrap(() => ui.setShutdownScreen(true)),
        },
        {
          id: "restart",
          label: "Restart",
          icon: "shutdown",
          onSelect: wrap(deps.reload),
        },
      ],
    },
  ];

  return { items, close };
}
