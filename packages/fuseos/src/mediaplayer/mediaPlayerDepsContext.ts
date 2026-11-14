import { createContext } from "react";

export type MediaPlayerDeps = {
  /** Runs `callback` after `ms`; returns a cancel. Tests hand in a manual scheduler. */
  schedule: (callback: () => void, ms: number) => () => void;
  /**
   * Opens a Fuse game by its portal id once a "video" has finished buffering. Absent (the app)
   * means the desktop's own games launcher, `useFuseGameLauncher`: a window here or a browser
   * tab, per the Control Panel setting. A test passes one to watch the launch.
   */
  launchGame?: (gameId: string) => void;
};

export const defaultMediaPlayerDeps: MediaPlayerDeps = {
  schedule: (callback, ms) => {
    const handle = window.setTimeout(callback, ms);
    return () => window.clearTimeout(handle);
  },
};

export const MediaPlayerDepsContext = createContext<MediaPlayerDeps>(
  defaultMediaPlayerDeps,
);
