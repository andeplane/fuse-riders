import { createContext } from "react";

/** Browser surfaces the Network Neighborhood needs; faked in tests. */
export type NetworkDeps = {
  now: () => number;
  /** A mouse or trackpad drives the desktop (the launch preference's device default). */
  finePointer: () => boolean;
  /** Runs `callback` every `intervalMs` until the returned function is called. */
  every: (callback: () => void, intervalMs: number) => () => void;
};

export const defaultNetworkDeps: NetworkDeps = {
  now: () => Date.now(),
  finePointer: () => {
    try {
      return window.matchMedia("(pointer: fine)").matches;
    } catch {
      return true;
    }
  },
  every: (callback, intervalMs) => {
    const handle = window.setInterval(callback, intervalMs);
    return () => window.clearInterval(handle);
  },
};

export const NetworkDepsContext =
  createContext<NetworkDeps>(defaultNetworkDeps);
