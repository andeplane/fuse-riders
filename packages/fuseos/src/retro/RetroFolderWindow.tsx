import { useState } from "react";
import type { KeyboardEvent } from "react";

import { Win98Icon } from "../ui/icons";
import { MenuBar } from "../windows/MenuBar";
import type { MenuDef } from "../windows/MenuBar";
import { useWindowCommands } from "../windows/useWindowCommands";

import type { GameId } from "./gameIds";
import type { GameInfo, GameRuntime } from "./games";
import { DOS_GAMES, GAME_LIST, GAMES, WINDOWS_GAMES } from "./games";
import { useRetroCommands } from "./useRetroCommands";

export type RetroFolderView = "icons" | "details";

/** What the Type column and the status bar call each way a game runs. */
export const RUNTIME_LABELS: Record<GameRuntime, string> = {
  jsdos: "DOS program (js-dos)",
  iframe: "Web page",
  native: "Built in",
};

export type RetroFolderWindowProps = { windowId: string };

/** The folder's name: on its desktop icon, its title bar and its taskbar button. */
export const DOS_GAMES_TITLE = "DOS Games";

/**
 * The "DOS Games" folder on the desktop (also Start > Programs > Games > Retro Games > Open DOS Games folder):
 * an Explorer-style window with the DOS programs first and the Windows games in a group under them. A click
 * selects a game, a double click or Enter opens it in a window of its own, and the Details view is the licence
 * table.
 */
export function RetroFolderWindow({ windowId }: RetroFolderWindowProps) {
  const vm = useRetroFolderViewModel(windowId);
  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        {
          label: "Open",
          onSelect: vm.openSelected,
          disabled: vm.selected === null,
        },
        { separator: true },
        { label: "Close", onSelect: vm.close },
      ],
    },
    {
      label: "View",
      items: [
        {
          label: "Large Icons",
          checked: vm.view === "icons",
          onSelect: () => vm.setView("icons"),
        },
        {
          label: "Details",
          checked: vm.view === "details",
          onSelect: () => vm.setView("details"),
        },
      ],
    },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MenuBar menus={menus} />
      <div
        className="sunken-panel m-0 min-h-0 flex-1 overflow-auto bg-white"
        onClick={(event) => {
          if (event.target === event.currentTarget) vm.select(null);
        }}
      >
        {vm.view === "icons" ? (
          <IconView
            selected={vm.selected}
            onSelect={vm.select}
            onOpen={vm.open}
          />
        ) : (
          <DetailsView
            selected={vm.selected}
            onSelect={vm.select}
            onOpen={vm.open}
          />
        )}
      </div>
      <footer className="status-bar shrink-0">
        <p className="status-bar-field flex-1 truncate" aria-label="Status">
          {vm.status}
        </p>
        <p className="status-bar-field w-44 truncate" aria-label="Type">
          {vm.selectedGame ? RUNTIME_LABELS[vm.selectedGame.runtime] : ""}
        </p>
      </footer>
    </div>
  );
}

type ViewProps = {
  selected: GameId | null;
  onSelect: (game: GameId | null) => void;
  onOpen: (game: GameId) => void;
};

function openOnEnter(
  event: KeyboardEvent<HTMLElement>,
  onOpen: (game: GameId) => void,
  game: GameId,
) {
  if (event.key === "Enter") {
    event.preventDefault();
    onOpen(game);
  }
}

function IconGroup({
  label,
  games,
  selected,
  onSelect,
  onOpen,
}: ViewProps & { label: string; games: readonly GameInfo[] }) {
  return (
    <ul
      role="listbox"
      aria-label={label}
      className="m-0 flex list-none flex-wrap content-start gap-1 p-3"
    >
      {games.map((game) => {
        const isSelected = game.id === selected;
        return (
          <li
            key={game.id}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            title={game.controls}
            className="flex w-24 cursor-default flex-col items-center gap-1 p-1 text-center"
            onClick={() => onSelect(game.id)}
            onDoubleClick={() => onOpen(game.id)}
            onKeyDown={(event) => openOnEnter(event, onOpen, game.id)}
          >
            <Win98Icon name={game.icon} size={32} />
            <span
              className="px-0.5"
              style={
                isSelected
                  ? { background: "#000080", color: "#fff" }
                  : undefined
              }
            >
              {game.name}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function IconView(props: ViewProps) {
  return (
    <>
      <IconGroup label="DOS games" games={DOS_GAMES} {...props} />
      <h3 className="mx-3 mt-0 mb-0 border-b border-[silver] pb-0.5 text-[11px] font-normal text-[grey]">
        Windows games
      </h3>
      <IconGroup label="Windows games" games={WINDOWS_GAMES} {...props} />
    </>
  );
}

function DetailsView({ selected, onSelect, onOpen }: ViewProps) {
  return (
    <table className="w-full border-collapse text-left" aria-label="Licences">
      <thead>
        <tr>
          {["Name", "Type", "Controls", "Licence"].map((heading) => (
            <th key={heading} className="sticky top-0 px-2 py-0.5">
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {GAME_LIST.map((game) => {
          const isSelected = game.id === selected;
          return (
            <tr
              key={game.id}
              aria-selected={isSelected}
              tabIndex={0}
              className="cursor-default align-top"
              style={
                isSelected
                  ? { background: "#000080", color: "#fff" }
                  : undefined
              }
              onClick={() => onSelect(game.id)}
              onDoubleClick={() => onOpen(game.id)}
              onKeyDown={(event) => openOnEnter(event, onOpen, game.id)}
            >
              <td className="px-2 py-0.5 whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  <Win98Icon name={game.icon} size={16} />
                  {game.name}
                </span>
              </td>
              <td className="px-2 py-0.5 whitespace-nowrap">
                {RUNTIME_LABELS[game.runtime]}
              </td>
              <td className="px-2 py-0.5">{game.controls}</td>
              <td className="px-2 py-0.5">{game.licence}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function useRetroFolderViewModel(windowId: string): {
  view: RetroFolderView;
  setView: (view: RetroFolderView) => void;
  selected: GameId | null;
  selectedGame: GameInfo | undefined;
  select: (game: GameId | null) => void;
  open: (game: GameId) => void;
  openSelected: () => void;
  close: () => void;
  status: string;
} {
  const commands = useWindowCommands();
  const retro = useRetroCommands();
  const [view, setView] = useState<RetroFolderView>("icons");
  const [selected, select] = useState<GameId | null>(null);
  const selectedGame = selected === null ? undefined : GAMES[selected];
  const status = selectedGame
    ? `${selectedGame.name}: ${selectedGame.controls}`
    : `${GAME_LIST.length} object(s)`;
  return {
    view,
    setView,
    selected,
    selectedGame,
    select,
    open: retro.openGame,
    openSelected: () => {
      if (selected !== null) retro.openGame(selected);
    },
    close: () => commands.close(windowId),
    status,
  };
}
