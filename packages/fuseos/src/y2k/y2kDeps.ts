import { createContext } from "react";

import type { LocalCalendar } from "./y2kCalendar";
import { systemCalendar } from "./y2kCalendar";
import type { Y2kRunStore } from "./y2kRunStore";
import { LocalStorageY2kRunStore } from "./y2kRunStore";
import type { Y2kSchedulerDeps } from "./y2kScheduler";

/** The hook Clippy's line goes through. The assistant is wired by the integrator: see `assistantNotifier.ts`. */
export type Y2kNotifier = (text: string) => void;

/** Clock, timers, storage, fullscreen and motion preference of the Y2K sequence, injected so tests run any day at any speed. */
export type Y2kDeps = Y2kSchedulerDeps & {
  prefersReducedMotion: () => boolean;
  /** Uniform random number in [0, 1), for the garbled clock. */
  random: () => number;
  /** Says Clippy's line; a no-op until the integrator wires the Office Assistant. */
  notify: Y2kNotifier;
  /** `?y2k=now`: play the sequence as soon as the desktop is up, for demos and screenshots; never recorded as the day's run. */
  demoOnBoot: boolean;
};

/** The hidden test trigger: `?y2k=now` on the OS URL. */
export const Y2K_PARAM = "y2k";

export function parseY2kParam(search: string): "now" | null {
  return new URLSearchParams(search).get(Y2K_PARAM) === "now" ? "now" : null;
}

function fullscreenGame(): boolean {
  return (
    typeof document !== "undefined" &&
    document.fullscreenElement instanceof HTMLIFrameElement
  );
}

export function createBrowserY2kDeps(
  options: {
    search?: string;
    calendar?: LocalCalendar;
    store?: Y2kRunStore;
  } = {},
): Y2kDeps {
  return {
    now: () => Date.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle),
    calendar: options.calendar ?? systemCalendar,
    store: options.store ?? new LocalStorageY2kRunStore(),
    isGameFullscreen: fullscreenGame,
    subscribeFullscreen: (onChange) => {
      document.addEventListener("fullscreenchange", onChange);
      return () => document.removeEventListener("fullscreenchange", onChange);
    },
    prefersReducedMotion: () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    random: () => Math.random(),
    notify: () => undefined,
    demoOnBoot: parseY2kParam(options.search ?? "") === "now",
  };
}

export const defaultY2kDeps: Y2kDeps = createBrowserY2kDeps();

export const Y2kDepsContext = createContext<Y2kDeps>(defaultY2kDeps);
