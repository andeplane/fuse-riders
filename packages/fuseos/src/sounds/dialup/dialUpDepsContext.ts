import { createContext } from "react";

/** Timers the dial-up dialog paces its status lines with; a test hands in a manual scheduler. */
export type DialUpDeps = {
  /** Runs `callback` after `ms`; returns a cancel. */
  schedule(callback: () => void, ms: number): () => void;
};

export const defaultDialUpDeps: DialUpDeps = {
  schedule(callback, ms) {
    const id = setTimeout(callback, ms);
    return () => clearTimeout(id);
  },
};

export const DialUpDepsContext = createContext<DialUpDeps>(defaultDialUpDeps);
