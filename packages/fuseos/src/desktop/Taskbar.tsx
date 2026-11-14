import { useContext } from "react";

import { FuseGamesContext } from "../fusegames/registry";
import type { WindowState } from "../state/appState";
import { Win98Icon } from "../ui/icons";

import { Clock } from "./Clock";
import { windowMeta } from "./windowMeta";

export type TaskbarProps = {
  windows: WindowState[];
  activeId: string | null;
  startMenuOpen: boolean;
  onStart: () => void;
  onWindowButton: (id: string) => void;
  startButtonProps?: Record<string, boolean | string>;
};

export function Taskbar({
  windows,
  activeId,
  startMenuOpen,
  onStart,
  onWindowButton,
  startButtonProps,
}: TaskbarProps) {
  const games = useContext(FuseGamesContext);
  return (
    <div
      className="absolute bottom-0 left-0 z-40 flex h-7 w-full items-center gap-1 border-t border-white bg-[silver] px-1"
      role="toolbar"
      aria-label="Taskbar"
    >
      <button
        type="button"
        className={`flex h-5 items-center gap-1 px-1 font-bold ${startMenuOpen ? "sunken" : ""}`}
        style={{ minWidth: 0 }}
        aria-pressed={startMenuOpen}
        onClick={onStart}
        {...startButtonProps}
      >
        <Win98Icon name="explorer" />
        Start
      </button>
      <span className="vertical-bar" aria-hidden />
      <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
        {windows.map((window) => {
          const meta = windowMeta(window, games);
          const active = window.id === activeId;
          return (
            <button
              key={window.id}
              type="button"
              className={`flex h-5 max-w-40 min-w-0 items-center gap-1 truncate px-1 ${active ? "sunken font-bold" : ""}`}
              style={{ minWidth: 0 }}
              aria-pressed={active}
              onClick={() => onWindowButton(window.id)}
            >
              <Win98Icon name={meta.icon} />
              <span className="truncate">{meta.title}</span>
            </button>
          );
        })}
      </div>
      <div className="status-field-border flex h-5 items-center">
        <Clock />
      </div>
    </div>
  );
}
