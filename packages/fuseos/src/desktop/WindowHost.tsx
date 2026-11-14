import { useCallback, useContext, useEffect, useRef } from "react";

import { AboutDialog } from "../about/AboutDialog";
import { DcppWindow } from "../dcpp/DcppWindow";
import { DefragRunner } from "../defrag/DefragRunner";
import { DefragWindow } from "../defrag/DefragWindow";
import { ControlPanelWindow } from "../controlpanel/ControlPanelWindow";
import { ExplorerWindow } from "../explorer/ExplorerWindow";
import { WallpaperWindow } from "../controlpanel/WallpaperWindow";
import { FriendsWindow } from "../friends/FriendsWindow";
import {
  FuseGameWindow,
  POP_OUT_HINT,
  POP_OUT_LABEL,
  useGamePopOut,
} from "../fusegames/FuseGameWindow";
import { FuseGamesContext } from "../fusegames/registry";
import { LauncherWindow } from "../launcher/LauncherWindow";
import { MircWindow } from "../mirc/MircWindow";
import { NapsterWindow } from "../napster/NapsterWindow";
import { NotepadPlusPlusWindow } from "../notepadpp/NotepadPlusPlusWindow";
import { NetworkWindow } from "../network/NetworkWindow";
import { RoomGameWindow } from "../network/RoomGameWindow";
import { HallOfFameWindow } from "../halloffame/HallOfFameWindow";
import { PaintWindow } from "../paint/PaintWindow";
import { GameWindow } from "../retro/GameWindow";
import { RetroFolderWindow } from "../retro/RetroFolderWindow";
import { DialUpWindow } from "../sounds/dialup/DialUpWindow";
import type { WindowState } from "../state/appState";
import { TaskManagerWindow } from "../taskmanager/TaskManagerWindow";
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
  onGameFrame,
}: {
  window: WindowState;
  active: boolean;
  onGameFrame: (windowId: string, element: HTMLIFrameElement | null) => void;
}) {
  const commands = useWindowCommands();
  switch (window.kind) {
    case "fusegame":
      return (
        <FuseGameWindow
          gameId={window.gameId}
          room={window.room}
          active={active}
          onActivate={() => commands.focus(window.id)}
          onFrame={(element) => onGameFrame(window.id, element)}
        />
      );
    case "roomgame":
      return (
        <RoomGameWindow
          gameId={window.gameId}
          code={window.code}
          active={active}
          onActivate={() => commands.focus(window.id)}
        />
      );
    case "network":
      return <NetworkWindow windowId={window.id} />;
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
    case "napster":
      return <NapsterWindow windowId={window.id} />;
    case "dialup":
      return <DialUpWindow windowId={window.id} then={window.then} />;
    case "friends":
      return <FriendsWindow windowId={window.id} />;
    case "defrag":
      return <DefragWindow windowId={window.id} />;
    case "halloffame":
      return <HallOfFameWindow windowId={window.id} gameId={window.gameId} />;
    case "taskmanager":
      return <TaskManagerWindow windowId={window.id} />;
    case "mirc":
      return <MircWindow windowId={window.id} />;
    case "dcpp":
      return <DcppWindow windowId={window.id} />;
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
  // Each game window's iframe, so the title bar's Pop out can read where the game has navigated to.
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const setGameFrame = useCallback(
    (windowId: string, element: HTMLIFrameElement | null) => {
      if (element) frames.current.set(windowId, element);
      else frames.current.delete(windowId);
    },
    [],
  );
  const frameFor = useCallback(
    (windowId: string) => frames.current.get(windowId) ?? null,
    [],
  );
  const popOut = useGamePopOut(frameFor);
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
              extraTitleButtons={
                window.kind === "fusegame" && games.find(window.gameId) ? (
                  <button
                    type="button"
                    className="title-pop-out"
                    aria-label={POP_OUT_LABEL}
                    title={POP_OUT_HINT}
                    onClick={() => popOut(window.id, window.gameId)}
                  >
                    ↗
                  </button>
                ) : undefined
              }
            >
              <WindowContent
                window={window}
                active={active}
                onGameFrame={setGameFrame}
              />
            </WindowChrome>
          </WindowFrame>
        );
      })}
      {/* Disk Defragmenter's run outlives its minimized window: the runner is mounted for as long as the window exists. */}
      {windows.map((window) =>
        window.kind === "defrag" ? (
          <DefragRunner
            key={window.id}
            windowId={window.id}
            drive={window.drive}
            stage={window.stage}
          />
        ) : null,
      )}
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
