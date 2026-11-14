import { createContext } from "react";

export type DesktopDeps = {
  now: () => number;
  /** Calls back every time the clock should re-render; returns an unsubscribe. */
  subscribeClock: (onTick: () => void) => () => void;
  reload: () => void;
  /** Opens a page in a new browser tab (Help topics, a game launched as a tab). */
  openExternal: (url: string) => void;
};

export const defaultDesktopDeps: DesktopDeps = {
  now: () => Date.now(),
  subscribeClock: (onTick) => {
    const handle = window.setInterval(onTick, 10_000);
    return () => window.clearInterval(handle);
  },
  reload: () => window.location.reload(),
  openExternal: (url) => {
    window.open(url, "_blank", "noopener");
  },
};

export const DesktopDepsContext =
  createContext<DesktopDeps>(defaultDesktopDeps);
