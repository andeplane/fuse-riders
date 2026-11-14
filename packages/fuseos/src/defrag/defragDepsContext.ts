import { createContext } from "react";

import type { DefragSession, DefragSessionDeps } from "./defragSession";

/** What a run needs from the browser: timers, chance and whether the user asked for less motion. */
export type DefragDeps = Pick<
  DefragSessionDeps,
  "setTimeout" | "clearTimeout" | "random" | "reducedMotion"
>;

/** The slice of `window` the motion preference is read from; an old browser may lack `matchMedia`. */
export type MotionView = {
  matchMedia?: (query: string) => { matches: boolean };
};

export function prefersReducedMotion(view: MotionView | undefined): boolean {
  return (
    typeof view?.matchMedia === "function" &&
    view.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export const defaultDefragDeps: DefragDeps = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  random: () => Math.random(),
  reducedMotion: () =>
    prefersReducedMotion(typeof window === "undefined" ? undefined : window),
};

export const DefragDepsContext = createContext<DefragDeps>(defaultDefragDeps);

/**
 * The running defragmenters by window id. The run lives here rather than in the window's component,
 * because a minimized window is not rendered and Defrag must grind on regardless: `DefragRunner`
 * (always mounted while the window exists) owns the session, the window only watches it.
 */
export interface DefragSessions {
  acquire(windowId: string, create: () => DefragSession): DefragSession;
  get(windowId: string): DefragSession | undefined;
  release(windowId: string): void;
  subscribe(listener: () => void): () => void;
}

export function createDefragSessions(): DefragSessions {
  const sessions = new Map<string, DefragSession>();
  const listeners = new Set<() => void>();
  const notify = () => [...listeners].forEach((listener) => listener());
  return {
    acquire(windowId, create) {
      const existing = sessions.get(windowId);
      if (existing) return existing;
      const session = create();
      sessions.set(windowId, session);
      notify();
      return session;
    },
    get: (windowId) => sessions.get(windowId),
    release(windowId) {
      const session = sessions.get(windowId);
      if (!session) return;
      session.dispose();
      sessions.delete(windowId);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const DefragSessionsContext = createContext<DefragSessions>(
  createDefragSessions(),
);
