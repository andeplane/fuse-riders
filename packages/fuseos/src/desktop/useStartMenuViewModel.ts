import { useContext } from "react";

import { APPLETS } from "../controlpanel/applets";
import { FuseGamesContext } from "../fusegames/registry";
import { GAME_LIST } from "../retro/games";
import { useDialUpCommands } from "../sounds/dialup/useDialUpCommands";
import { useAppState } from "../state/useAppState";
import type { IconRef } from "../ui/icons";
import type { WindowCommands } from "../windows/useWindowCommands";
import type { Size } from "../windows/windowManager";
import { WindowManagerContext } from "../windows/windowManagerContext";

import { DesktopDepsContext } from "./desktopDepsContext";
import { DesktopUiContext } from "./desktopUiContext";
import type { StartMenuRegistration, StartMenuSlot } from "./startMenuRegistry";
import {
  registrationsFor,
  StartMenuRegistryContext,
} from "./startMenuRegistry";
import { useDesktopViewModel } from "./useDesktopViewModel";
import { OS_NAME } from "./windowMeta";

export type StartMenuItem = {
  id: string;
  label: string;
  icon: IconRef;
  onSelect?: () => void;
  children?: StartMenuItem[];
  disabled?: boolean;
  separatorAfter?: boolean;
};

/** Start > Help > Help Topics: the project's README. */
export const HELP_URL = "https://github.com/andeplane/fuse-riders#readme";

function registeredItems(
  registrations: readonly StartMenuRegistration[],
  slot: StartMenuSlot,
  commands: WindowCommands,
  viewport: Size,
  wrap: (action: () => void) => () => void,
): StartMenuItem[] {
  return registrationsFor(registrations, slot).map((entry) => {
    const open = entry.open;
    return {
      id: entry.id,
      label: entry.label,
      icon: entry.icon,
      disabled: open === undefined,
      onSelect: open ? wrap(() => open(commands, viewport)) : undefined,
      separatorAfter: entry.separatorAfter,
    };
  });
}

export function useStartMenuViewModel(): {
  items: StartMenuItem[];
  close: () => void;
} {
  const { state, dispatch } = useAppState();
  // Network Neighborhood and Fuse Messenger dial in the first time one of them is opened by hand.
  const commands = useDialUpCommands();
  const ui = useContext(DesktopUiContext);
  const deps = useContext(DesktopDepsContext);
  const games = useContext(FuseGamesContext);
  const registrations = useContext(StartMenuRegistryContext);
  const { viewport } = useContext(WindowManagerContext);
  const desktop = useDesktopViewModel();

  const close = () => ui.setStartMenuOpen(false);
  const wrap = (action: () => void) => () => {
    close();
    action();
  };
  const registered = (slot: StartMenuSlot) =>
    registeredItems(registrations, slot, commands, viewport, wrap);

  const fuseGameItems: StartMenuItem[] = games.games.map((game) => ({
    id: `fusegame:${game.id}`,
    label: game.name,
    icon: games.icon(game) ?? "fusegame",
    onSelect: wrap(() => desktop.openFuseGame(game.id)),
  }));

  // The folder window first (a registration), then one item per retro game; the reducer keeps each to one window.
  const retroGameItems: StartMenuItem[] = [
    ...registered("retro-games"),
    ...GAME_LIST.map((game): StartMenuItem => ({
      id: `retro:${game.id}`,
      label: game.name,
      icon: game.icon,
      onSelect: wrap(() => commands.open({ kind: "retro", game: game.id })),
    })),
  ];

  // One registration fills the top-level My Computer item; none leaves it disabled, so the menu keeps its shape.
  const myComputer = registered("my-computer")[0] ?? {
    id: "my-computer",
    label: "My Computer",
    icon: "computer" as const,
    disabled: true,
  };

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
          // Paint, Winamp, Explorer, Notepad++ and the wallpaper picker are registrations (`startMenuRegistry.ts`).
          children: registered("accessories"),
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
            ...registered("games"),
            {
              id: "retro",
              label: "Retro Games",
              icon: "gamesFolder",
              children: retroGameItems,
            },
          ],
        },
        // Fusteam and any other program a package registers (`startMenuRegistry.ts`).
        ...registered("programs"),
      ],
    },
    myComputer,
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
        // One entry per Control Panel applet, so a package that registers an applet is in the Start menu too.
        ...APPLETS.map((applet): StartMenuItem => ({
          id: `applet:${applet.applet}`,
          label: applet.label,
          icon: applet.icon,
          onSelect: wrap(() =>
            commands.open({ kind: "controlpanel", applet: applet.applet }),
          ),
        })),
        ...registered("settings"),
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
        ...registered("help"),
        {
          id: "about",
          label: `About ${OS_NAME}`,
          icon: "info",
          onSelect: wrap(() => commands.open({ kind: "about" })),
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
