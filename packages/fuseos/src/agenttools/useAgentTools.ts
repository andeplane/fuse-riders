import { useContext, useMemo, useRef } from "react";

import { OsAnalyticsContext } from "../analytics/osAnalytics";
import { DesktopDepsContext } from "../desktop/desktopDepsContext";
import { DesktopUiContext } from "../desktop/desktopUiContext";
import { windowMeta } from "../desktop/windowMeta";
import { useDiskDeps } from "../disk/useDisk";
import { DisplayEffectsContext } from "../display/effects/displayEffectsContext";
import { FuseGamesContext } from "../fusegames/registry";
import { useFuseGameLauncher } from "../fusegames/useFuseGameLauncher";
import { openLauncher } from "../launcher/useOpenLauncher";
import { useEditorCommands } from "../notepadpp/editorCommands";
import { GAMES } from "../retro/games";
import { GAME_IDS } from "../retro/gameIds";
import { ScreenSaverContext } from "../screensaver/screenSaverContext";
import { useAppState } from "../state/useAppState";
import { WinampRegistryContext } from "../winamp/winampRegistryContext";
import { useWindowCommands } from "../windows/useWindowCommands";
import { WindowManagerContext } from "../windows/windowManagerContext";

import type { AgentOs, WindowInfo } from "./agentOs";
import { AgentRunContext } from "./agentRunContext";
import type { AgentTool } from "./agentTool";
import { createAgentTools } from "./createAgentTools";
import { createDiskPort } from "./diskPort";
import type { AgentEditUndo } from "./diskTools";
import { desktopTargets } from "./targets";

/**
 * The real desktop behind Clippy's tools. The ports read the desktop as it is when a tool runs, not as it was
 * when the tools were built: every render refreshes `live`, so a step sees the window the step before opened.
 */
export function useAgentOs(): AgentOs {
  const { state } = useAppState();
  const commands = useWindowCommands();
  const ui = useContext(DesktopUiContext);
  const effects = useContext(DisplayEffectsContext);
  const games = useContext(FuseGamesContext);
  const launcher = useFuseGameLauncher();
  const { openExternal } = useContext(DesktopDepsContext);
  const analytics = useContext(OsAnalyticsContext);
  const winamp = useContext(WinampRegistryContext);
  const screenSaver = useContext(ScreenSaverContext);
  const { viewport } = useContext(WindowManagerContext);
  const diskDeps = useDiskDeps();
  const editor = useEditorCommands();
  const run = useContext(AgentRunContext);

  const live = useRef({ state, ui, effects, launcher, screenSaver, editor });
  live.current = { state, ui, effects, launcher, screenSaver, editor };
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  return useMemo<AgentOs>(() => {
    const windows = (): WindowInfo[] => {
      const all = live.current.state.windows;
      const top = [...all].reverse().find((window) => !window.minimized);
      return all.map((window) => ({
        id: window.id,
        kind: window.kind,
        title: windowMeta(window, games).title,
        minimized: window.minimized,
        maximized: window.maximized,
        focused: window === top,
      }));
    };
    return {
      windows: {
        list: windows,
        open: (content) => {
          // The launcher has an id and a size rule of its own.
          if (content.kind === "launcher")
            openLauncher(commands, viewportRef.current);
          else commands.open(content);
        },
        close: commands.close,
        focus: commands.focus,
        minimize: commands.minimize,
        toggleMaximize: commands.toggleMaximize,
        showInfo: commands.showInfo,
      },
      startMenu: {
        isOpen: () => live.current.ui.startMenuOpen,
        setOpen: (open) => live.current.ui.setStartMenuOpen(open),
      },
      targets: desktopTargets(games),
      games: {
        fuse: () =>
          games.games.map((game) => ({
            id: game.id,
            name: game.name,
            tagline: game.tagline,
          })),
        retro: () => GAME_IDS.map((id) => ({ id, name: GAMES[id].name })),
        launchMode: () => live.current.launcher.launchMode(),
        launch: (id, mode) => {
          const game = games.find(id);
          if (mode === undefined || !game) {
            const chosen = live.current.launcher.launchMode();
            live.current.launcher.launch(id);
            return chosen;
          }
          if (mode === "tab") {
            openExternal(games.embedUrl(game));
            analytics.gameLaunched(id, "tab");
            return "tab";
          }
          const open = live.current.state.windows.some(
            (window) => window.kind === "fusegame" && window.gameId === id,
          );
          commands.open({ kind: "fusegame", gameId: id });
          if (!open) analytics.gameLaunched(id, "window");
          return "window";
        },
      },
      disk: createDiskPort(diskDeps),
      editor: {
        open: (path) => live.current.editor.open(path),
        readFile: (path) => live.current.editor.readFile(path),
        writeFile: (path, content) =>
          live.current.editor.writeFile(path, content),
        listModified: () => live.current.editor.listModified(),
        revert: (path) => live.current.editor.revert(path),
      },
      music: {
        controls: () => winamp.first(),
        openAndPlay: () => {
          const unsubscribe = winamp.onRegister((loaded) => {
            unsubscribe();
            loaded.play();
          });
          commands.open({ kind: "winamp" });
        },
      },
      display: {
        get: () => ({
          colorMode: live.current.ui.colorMode,
          resolution: live.current.ui.desktopArea,
          crt: live.current.effects.effects.crt,
          curvature: live.current.effects.effects.curvature,
          scheme: live.current.effects.effects.scheme,
          largeFonts: live.current.ui.largeFonts,
        }),
        setColorMode: (mode) => live.current.ui.setColorMode(mode),
        setResolution: (area) => live.current.ui.setDesktopArea(area),
        setCrt: (mode) => live.current.effects.setCrt(mode),
        setCurvature: (on) => live.current.effects.setCurvature(on),
        setScheme: (scheme) => live.current.effects.setScheme(scheme),
        setLargeFonts: (large) => live.current.ui.setLargeFonts(large),
      },
      wallpaper: {
        get: () => ({
          color: live.current.ui.backgroundColor,
          hasPicture: live.current.ui.wallpaper !== undefined,
        }),
        setColor: (hex) => live.current.ui.setBackgroundColor(hex),
      },
      screenSaver: {
        active: () => live.current.screenSaver.snapshot.active,
        preview: () => live.current.screenSaver.controls.preview(),
      },
      ...(run ? { run } : {}),
    };
  }, [commands, games, openExternal, analytics, winamp, diskDeps, run]);
}

/** Clippy's typed tools over the real desktop; the last edit's undo outlives a turn. */
export function useAgentTools(): { os: AgentOs; tools: readonly AgentTool[] } {
  const os = useAgentOs();
  const undo = useRef<AgentEditUndo | undefined>(undefined);
  return useMemo(() => ({ os, tools: createAgentTools(os, undo) }), [os]);
}
