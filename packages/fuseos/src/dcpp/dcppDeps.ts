import { createContext } from "react";

import { FUSE_TRACKS } from "../winamp/fuseTracks";

import type { DcClientDeps } from "./dcClient";
import { HUBS } from "./hubs";
import { createRandom } from "./rng";

/** What DC++ takes from the desktop: the fake network's clock, timers, hubs and a seed per window. */
export type DcppDeps = Omit<DcClientDeps, "random"> & {
  /** The seed for a new window's random source; production uses the clock, tests a constant. */
  seed: () => number;
};

export const defaultDcppDeps: DcppDeps = {
  seed: () => Date.now(),
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  hubs: HUBS,
  tracks: FUSE_TRACKS,
};

export const DcppDepsContext = createContext<DcppDeps>(defaultDcppDeps);

export function clientDeps(deps: DcppDeps): DcClientDeps {
  const { seed, ...rest } = deps;
  return { ...rest, random: createRandom(seed()) };
}
