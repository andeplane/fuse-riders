import { useCallback, useContext, useEffect, useState } from "react";

import { useDesktopViewModel } from "../desktop/useDesktopViewModel";
import { FuseGamesContext } from "../fusegames/registry";
import { useWindowCommands } from "../windows/useWindowCommands";

import { MediaPlayerDepsContext } from "./mediaPlayerDepsContext";
import type { PlaybackState } from "./playback";
import {
  advancePlayback,
  BUFFER_TICK_MS,
  fakeDuration,
  playbackStatus,
  startBuffering,
} from "./playback";

export type MediaPlayerViewModel = {
  file: string;
  playback: PlaybackState;
  /** The status bar's left field. */
  status: string;
  /** The status bar's right field: elapsed over the file's "length". */
  time: string;
  play: () => void;
  stop: () => void;
  /** Dismisses the codec error box; the player is left stopped, Play tries again. */
  dismissError: () => void;
  close: () => void;
  about: () => void;
};

export type MediaPlayerOptions = {
  windowId: string;
  file: string;
  /** The game this "video" really is; buffering completes and launches it. */
  launches?: string;
};

/**
 * Buffers on a schedule from the moment the window opens. A file with a game behind it
 * launches the game and closes the player once "playback" starts; every other file fails
 * the codec check.
 */
export function useMediaPlayerViewModel({
  windowId,
  file,
  launches,
}: MediaPlayerOptions): MediaPlayerViewModel {
  const deps = useContext(MediaPlayerDepsContext);
  const games = useContext(FuseGamesContext);
  const commands = useWindowCommands();
  const desktop = useDesktopViewModel();
  const [playback, setPlayback] = useState<PlaybackState>(startBuffering);

  useEffect(() => {
    if (playback.phase !== "buffering") return undefined;
    return deps.schedule(
      () =>
        setPlayback((current) =>
          advancePlayback(current, file, launches !== undefined),
        ),
      BUFFER_TICK_MS,
    );
  }, [playback, deps, file, launches]);

  const launchGame = deps.launchGame;
  const openFuseGame = desktop.openFuseGame;
  useEffect(() => {
    if (playback.phase !== "playing" || launches === undefined) return;
    if (launchGame) launchGame(launches);
    else if (games.has(launches)) openFuseGame(launches);
    else
      commands.showError(
        "Windows Media Player",
        `"${file}" needs ${launches}, which is not installed on this computer.`,
      );
    commands.close(windowId);
  }, [
    playback,
    launches,
    launchGame,
    openFuseGame,
    games,
    commands,
    file,
    windowId,
  ]);

  const play = useCallback(() => setPlayback(startBuffering()), []);
  const stop = useCallback(() => setPlayback({ phase: "stopped" }), []);
  const close = useCallback(
    () => commands.close(windowId),
    [commands, windowId],
  );
  const about = useCallback(
    () =>
      commands.showInfo(
        "About Windows Media Player",
        "Windows Media Player 6.4 (FuseOS build)\n\nPlays every file in the Recycle Bin, provided the codec is installed. It never is.",
      ),
    [commands],
  );

  return {
    file,
    playback,
    status: playbackStatus(playback),
    time: `00:00:00 / ${fakeDuration(file)}`,
    play,
    stop,
    dismissError: stop,
    close,
    about,
  };
}
