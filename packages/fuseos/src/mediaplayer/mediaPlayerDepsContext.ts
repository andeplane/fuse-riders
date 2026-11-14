import { createContext } from "react";

export type MediaPlayerDeps = {
  /** Runs `callback` after `ms`; returns a cancel. Tests hand in a manual scheduler. */
  schedule: (callback: () => void, ms: number) => () => void;
  /**
   * Opens a Fuse game by its portal id once a "video" has finished buffering. Absent means the
   * player opens the game in a window on this desktop itself; the games package's launcher
   * (window or tab, per the Control Panel setting) replaces it when the two are wired together.
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
