import { createContext } from "react";

import type { PipesDeps, PipesHandle, PipesOptions } from "./pipes/pipes";

/** The lazy chunk's surface: what `await import("./pipes/pipes")` resolves to, as far as the overlay cares. */
export type PipesModule = {
  startPipes: (
    container: HTMLElement,
    options: PipesOptions,
    deps?: PipesDeps,
  ) => PipesHandle;
};

export type ScreenSaverDeps = {
  setTimeout: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  /** Calls back on any mouse, key, wheel, touch or visibility change; returns an unsubscribe. */
  subscribeActivity: (onActivity: (event: Event) => void) => () => void;
  isVisible: () => boolean;
  /**
   * A game window has keyboard focus: its iframe swallows every key and click, so the desktop sees no activity
   * while someone plays. Counts as activity, so the saver never starts over a game being played.
   */
  isGameFocused: () => boolean;
  /** Loads three.js and the pipes; only ever called once the saver is on screen. */
  loadPipes: () => Promise<PipesModule>;
};

export const defaultScreenSaverDeps: ScreenSaverDeps = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  isVisible: () => document.visibilityState !== "hidden",
  isGameFocused: () => document.activeElement instanceof HTMLIFrameElement,
  subscribeActivity: (onActivity) => {
    const events = [
      "pointermove",
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
      "visibilitychange",
    ];
    for (const event of events)
      document.addEventListener(event, onActivity, {
        capture: true,
        passive: false,
      });
    return () => {
      for (const event of events)
        document.removeEventListener(event, onActivity, true);
    };
  },
  loadPipes: () => import("./pipes/pipes"),
};

export const ScreenSaverDepsContext = createContext<ScreenSaverDeps>(
  defaultScreenSaverDeps,
);
