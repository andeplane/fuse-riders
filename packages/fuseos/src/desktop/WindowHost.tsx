import { useContext, useEffect } from "react";

import { AboutDialog } from "../about/AboutDialog";
import { ControlPanelWindow } from "../controlpanel/ControlPanelWindow";
import { ExplorerWindow } from "../explorer/ExplorerWindow";
import { WallpaperWindow } from "../controlpanel/WallpaperWindow";
import { FuseGameWindow } from "../fusegames/FuseGameWindow";
import { FuseGamesContext } from "../fusegames/registry";
import { LauncherWindow } from "../launcher/LauncherWindow";
import { NotepadPlusPlusWindow } from "../notepadpp/NotepadPlusPlusWindow";
import { PaintWindow } from "../paint/PaintWindow";
import { GameWindow } from "../retro/GameWindow";
import { RetroFolderWindow } from "../retro/RetroFolderWindow";
import { DialUpWindow } from "../sounds/dialup/DialUpWindow";
import type { WindowState } from "../state/appState";
import { WinampPlayer } from "../winamp/WinampPlayer";
import { MessageBox } from "../windows/MessageBox";
import { useWindowCommands } from "../windows/useWindowCommands";
import { WindowChrome } from "../windows/WindowChrome";
import { WindowManagerContext } from "../windows/windowManagerContext";
import { WindowsDepsContext } from "../windows/windowsDepsContext";

import { DisplayViewportContext } from "./displayViewportContext";
import { windowMeta } from "./windowMeta";

function WindowContent({
  window,
  active,
}: {
  window: WindowState;
  active: boolean;
}) {
  const commands = useWindowCommands();
  switch (window.kind) {
    case "fusegame":
      return (
        <FuseGameWindow
          gameId={window.gameId}
          windowId={window.id}
          active={active}
          onActivate={() => commands.focus(window.id)}
        />
      );
    case "retro":
      return (
        <GameWindow
          windowId={window.id}
          game={window.game}
          active={active}
          onActivate={() => commands.focus(window.id)}
        />
      );
    case "retroFolder":
      return <RetroFolderWindow windowId={window.id} />;
    case "controlpanel":
      return <ControlPanelWindow windowId={window.id} />;
    case "wallpaper":
      return <WallpaperWindow windowId={window.id} />;
    case "about":
      return <AboutDialog windowId={window.id} />;
    case "dialog":
      return (
        <MessageBox
          message={window.message}
          icon={window.icon}
          onOk={() => commands.close(window.id)}
        />
      );
    case "paint":
      return <PaintWindow windowId={window.id} />;
    case "winamp":
      // Frameless: `WinampPlayer` draws it on the desktop layer, not in a frame.
      return null;
    case "explorer":
      return <ExplorerWindow windowId={window.id} location={window.location} />;
    case "notepadpp":
      return (
        <NotepadPlusPlusWindow
          windowId={window.id}
          paths={window.paths}
          activePath={window.activePath}
        />
      );
    case "launcher":
      return <LauncherWindow windowId={window.id} active={active} />;
    case "dialup":
      return <DialUpWindow windowId={window.id} then={window.then} />;
  }
}

export type WindowHostProps = {
  windows: WindowState[];
  activeId: string | null;
};

/** Renders every open window inside its frame and chrome. */
export function WindowHost({ windows, activeId }: WindowHostProps) {
  const display = useContext(DisplayViewportContext);
  const games = useContext(FuseGamesContext);
  const { WindowFrame } = useContext(WindowsDepsContext);
  const { rectFor, setRect, pruneRects, compact } =
    useContext(WindowManagerContext);
  const commands = useWindowCommands();
  const winampIndex = windows.findIndex((window) => window.kind === "winamp");
  const winamp = windows[winampIndex];
  // Window ids are reused after a close; forget the old rectangle so the next window with that id opens at its own size.
  useEffect(
    () => pruneRects(windows.map((window) => window.id)),
    [windows, pruneRects],
  );

  return (
    <>
      {windows.map((window, index) => {
        if (window.minimized || window.kind === "winamp") return null;
        const meta = windowMeta(window, games);
        const active = window.id === activeId;
        const activate = () => {
          if (!active) commands.focus(window.id);
        };
        // On a phone every resizable window fills the screen; the stored `maximized` flag is left
        // alone so the window floats again where there is room (a rotated tablet, a desktop).
        const maximized = meta.resizable && (window.maximized || compact);
        const resizable = meta.resizable && !compact;
        return (
          <WindowFrame
            key={window.id}
            id={window.id}
            rect={rectFor(window.id, index, meta.size, !meta.resizable)}
            maximized={maximized}
            resizable={resizable}
            scale={display?.scale ?? 1}
            active={active}
            zIndex={10 + index}
            onFocus={activate}
            onRectChange={(rect) => setRect(window.id, rect)}
          >
            <WindowChrome
              title={meta.title}
              icon={meta.icon}
              active={active}
              maximized={maximized}
              resizable={resizable}
              onMinimize={() => commands.minimize(window.id)}
              onToggleMaximize={() => commands.toggleMaximize(window.id)}
              onClose={() => commands.close(window.id)}
              onActivate={activate}
            >
              <WindowContent window={window} active={active} />
            </WindowChrome>
          </WindowFrame>
        );
      })}
      {/* Winamp is Webamp's own windows on a desktop-sized layer that stacks like any other window (10 + index); minimized keeps it playing unseen. */}
      {winamp ? (
        <WinampPlayer
          windowId={winamp.id}
          minimized={winamp.minimized}
          zIndex={10 + winampIndex}
          onFocus={() => {
            if (winamp.id !== activeId) commands.focus(winamp.id);
          }}
        />
      ) : null}
    </>
  );
}
